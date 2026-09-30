import crypto from "node:crypto";

import { AppError } from "../../utils/app-error";
import { isR2Enabled, uploadImage } from "../../lib/r2";
import { buildReceiptImageKey, processImageToWebp } from "../../utils/image-processing";
import { extractTransactionRef, parseReceiptAmount, runOcr } from "../../utils/ocr";
import { authRepository } from "../auth/auth.repository";
import { subscriptionService } from "../subscriptions/subscription.service";
import { PaymentModel, type PaymentTier } from "./payment.model";
import { PRICING } from "./payment.constants";

const PROVISION_WINDOW_MS = 48 * 60 * 60 * 1000;

export class PaymentService {
  // ---- Manual card-transfer flow ----
  // User picks a plan in the bot, the bot shows a card number + exact
  // amount + this payment's id as the transfer "comment"/reference, the
  // user sends a screenshot, and the bot forwards it to an admin chat for a
  // human Approve/Reject tap. No merchant account needed, works today.
  async createManualPayment(input: {
    userId: string;
    telegramUserId: string;
    telegramUsername?: string;
    tier: PaymentTier;
    durationMonths: 1 | 6 | 12;
  }) {
    const amount = PRICING[input.tier][input.durationMonths];
    const payment = await PaymentModel.create({
      userId: input.userId,
      telegramUserId: input.telegramUserId,
      telegramUsername: input.telegramUsername ?? "",
      tier: input.tier,
      durationMonths: input.durationMonths,
      amount,
      method: "manual_card",
      status: "pending",
    });
    return payment.toJSON();
  }

  // OCR-assisted receipt intake: hashes the screenshot to block reuse,
  // reads the amount off it, and — if that amount matches exactly — grants
  // the tier immediately ("provisioned") pending a human confirming the
  // same screenshot later (see approveManualPayment/rejectPayment below,
  // and the 48h auto-expire cron in server.ts for what happens if nobody
  // does). A screenshot that doesn't OCR-match stays "pending" exactly like
  // before this feature existed — an admin reviews it manually, same as a
  // payment submitted through the card-details flow.
  async attachReceipt(paymentId: string, receiptFileId: string, file: { buffer: Buffer; mimetype: string }) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);
    if (payment.status !== "pending") throw new AppError("Payment is not pending", 400);

    if (!isR2Enabled()) {
      throw new AppError("Image storage is not configured", 503);
    }

    // Nothing below this point (OCR, R2 upload) is guarded against a second
    // concurrent call for the same paymentId — a double-tapped "send" in the
    // bot, or a retried upload, both plausibly land two attachReceipt calls
    // close together for one payment. Without a claim, both would read
    // status:"pending", both run OCR/R2, and if both OCR-match, both would
    // call activateFromPayment — creating two Subscription rows for one
    // payment (subscription.service.ts has no uniqueness constraint against
    // that). The actual claim happens once at the end via one atomic
    // findOneAndUpdate; this only starts the (expensive, side-effect-only)
    // work.

    // Hash the ORIGINAL bytes, before any compression — sharp's WebP output
    // isn't guaranteed byte-identical across runs/versions, so hashing the
    // re-encoded image could let the same screenshot slip through twice
    // with a different hash each time. Cheap (no sharp/OCR yet), so this
    // runs first and fails fast on a duplicate before spending CPU on
    // either.
    const receiptHash = crypto.createHash("sha256").update(file.buffer).digest("hex");

    const duplicate = await PaymentModel.findOne({
      receiptHash,
      _id: { $ne: payment._id },
    });
    if (duplicate) {
      throw new AppError("Bu chek allaqachon boshqa to'lov uchun ishlatilgan", 409);
    }

    // OCR runs on the ORIGINAL bytes (WebP re-compression can blur small
    // receipt text enough to hurt recognition), while compression for R2
    // storage happens independently — both operate on the same input, run
    // concurrently since neither depends on the other's result.
    const [ocrText, processed] = await Promise.all([
      runOcr(file.buffer).catch((error) => {
        console.error("[attachReceipt] OCR failed, receipt stays pending for manual review", error);
        return "";
      }),
      processImageToWebp(file.buffer),
    ]);

    const { extractedAmount, matched } = parseReceiptAmount(ocrText, payment.amount);
    const transactionRef = extractTransactionRef(ocrText);

    const receiptImageUrl = await uploadImage(
      processed.buffer,
      buildReceiptImageKey(receiptHash),
      processed.contentType,
    );

    const ocr = {
      extractedAmount,
      extractedText: ocrText ? ocrText.slice(0, 500) : null,
      transactionRef,
      amountMatched: matched,
    };
    const now = new Date();

    // The actual claim: atomic on this one document, conditioned on the
    // status this function itself observed at the top still holding. If a
    // second concurrent call already moved it away from "pending" (its own
    // claim landed first), this matches nothing and `claimed` comes back
    // null — the loser bails out below without ever calling
    // activateFromPayment, instead of both callers racing into it.
    const claimed = await PaymentModel.findOneAndUpdate(
      { _id: payment._id, status: "pending" },
      {
        $set: {
          receiptFileId,
          receiptImageUrl,
          receiptHash,
          ocr,
          ...(matched
            ? { status: "provisioned", provisionedAt: now, provisionExpiresAt: new Date(now.getTime() + PROVISION_WINDOW_MS) }
            : {}),
        },
      },
      { new: true },
    );

    if (!claimed) {
      throw new AppError("Bu to'lov allaqachon ko'rib chiqilgan yoki chek biriktirilgan", 409);
    }

    let provisioned = false;

    if (matched) {
      try {
        await subscriptionService.activateFromPayment(
          claimed.userId,
          claimed.tier,
          claimed.durationMonths,
          `bot-ocr-provisional:${claimed._id}`,
        );
        provisioned = true;
      } catch (error) {
        // Activation failed after the claim already marked this
        // "provisioned" — don't leave it claiming a tier that was never
        // actually granted. Falling back to "pending" means an admin can
        // still approve it manually (see approveManualPayment's pending
        // branch). Conditioned on status:"provisioned" for the same reason
        // as the claim above — if this payment was somehow already moved on
        // (e.g. the 48h auto-expire cron, vanishingly unlikely this soon but
        // not impossible under clock skew), don't stomp on that.
        const reverted = await PaymentModel.findOneAndUpdate(
          { _id: claimed._id, status: "provisioned" },
          { $set: { status: "pending", provisionedAt: null, provisionExpiresAt: null } },
          { new: true },
        );
        if (reverted) Object.assign(claimed, reverted.toObject());
        console.error("[attachReceipt] OCR auto-provision activation failed, reverted to pending", error);
      }
    }

    return { payment: claimed.toJSON(), provisioned };
  }

  // Screenshot-free flow: the user couldn't produce a screenshot, so they
  // type in the card they sent from + their name instead. No OCR runs on
  // this path — status stays "pending" for an admin to review by hand
  // against their own bank statement.
  async submitCardDetails(paymentId: string, cardNumber: string, fullName: string) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);
    if (payment.status !== "pending") throw new AppError("Payment is not pending", 400);

    payment.senderCardDetails = { cardNumber, fullName };
    await payment.save();
    return payment.toJSON();
  }

  async approveManualPayment(paymentId: string, approvedByTelegramId: string) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);

    if (payment.status === "provisioned") {
      // The tier was already granted when OCR matched the amount (see
      // attachReceipt) — this tap is the human sign-off, not a second
      // activation. Calling activateFromPayment again here would extend
      // the subscription a second time for one payment.
      const claimed = await PaymentModel.findOneAndUpdate(
        { _id: payment._id, status: "provisioned" },
        {
          $set: {
            status: "completed",
            approvedBy: `bot:${approvedByTelegramId}`,
            approvedAt: new Date(),
          },
        },
        { new: true },
      );
      const result = claimed ?? (await PaymentModel.findById(payment._id)) ?? payment;
      return result.toJSON();
    }

    if (payment.status !== "pending") throw new AppError("Payment is not pending", 400);

    // Same read-then-write race as completeClickPayment used to have, human
    // rather than webhook-retry triggered (two admins tapping Approve on the
    // same pending payment within milliseconds) — atomically claim the
    // pending->completed transition before activating, so only the winner
    // credits the subscription.
    const claimed = await PaymentModel.findOneAndUpdate(
      { _id: payment._id, status: "pending" },
      {
        $set: {
          status: "completed",
          approvedBy: `bot:${approvedByTelegramId}`,
          approvedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!claimed) {
      const latest = await PaymentModel.findById(payment._id);
      return (latest ?? payment).toJSON();
    }

    try {
      await subscriptionService.activateFromPayment(
        claimed.userId,
        claimed.tier,
        claimed.durationMonths,
        `bot-manual:${approvedByTelegramId}`
      );
    } catch (err) {
      // Revert to pending so a retried Approve tap can try activation again
      // instead of being stuck "completed" with no subscription granted.
      await PaymentModel.updateOne(
        { _id: claimed._id, status: "completed" },
        { $set: { status: "pending", approvedBy: null, approvedAt: null } }
      );
      throw err;
    }

    return claimed.toJSON();
  }

  async rejectPayment(paymentId: string, rejectedByTelegramId: string, reason?: string) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);

    if (payment.status !== "pending" && payment.status !== "provisioned") {
      throw new AppError("Payment is not pending", 400);
    }

    // A "provisioned" payment already has its tier granted (see
    // attachReceipt) — rejecting it must take that back. A "pending" one
    // never got anything, so rejecting it is a no-op on the subscription.
    const wasProvisioned = payment.status === "provisioned";

    // Same atomic-claim reasoning as approveManualPayment above — claim
    // whichever of the two states this payment was actually read in, so a
    // concurrent request that already moved it away is detected as a lost
    // race rather than silently reapplying a downgrade someone else already
    // handled.
    const claimed = await PaymentModel.findOneAndUpdate(
      { _id: payment._id, status: payment.status },
      {
        $set: {
          status: "rejected",
          approvedBy: `bot:${rejectedByTelegramId}`,
          approvedAt: new Date(),
          rejectedReason: reason ?? null,
        },
      },
      { new: true }
    );

    if (!claimed) {
      const latest = await PaymentModel.findById(payment._id);
      return { payment: (latest ?? payment).toJSON(), wasDowngraded: false };
    }

    let wasDowngraded = false;
    if (wasProvisioned) {
      try {
        await subscriptionService.deactivateFromPayment(claimed.userId, `bot-reject:${rejectedByTelegramId}`);
        wasDowngraded = true;
      } catch (error) {
        // The rejection itself already landed either way — log and leave
        // this for an operator to fix by hand rather than blocking the
        // reject over a downgrade failure.
        console.error("[rejectPayment] failed to downgrade after rejecting a provisioned payment", error);
      }
    }

    return { payment: claimed.toJSON(), wasDowngraded };
  }

  async getByUserId(userId: string) {
    const payments = await PaymentModel.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
    return payments.map((p: any) => ({ ...p, id: p._id?.toString(), _id: undefined }));
  }

  async getPending() {
    const payments = await PaymentModel.find({ status: "pending" }).sort({ createdAt: 1 }).lean();
    return payments.map((p: any) => ({ ...p, id: p._id?.toString(), _id: undefined }));
  }

  async getById(paymentId: string) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);
    return payment.toJSON();
  }

  // ---- Click flow ----
  // Creates the pending record before redirecting the user to Click's pay
  // page; merchantTransId is what we hand Click as merchant_trans_id and
  // get back unchanged in Prepare/Complete callbacks, so it's how we find
  // our way back to this payment.
  async createClickPending(input: {
    userId: string;
    telegramUserId: string;
    telegramUsername?: string;
    tier: PaymentTier;
    durationMonths: 1 | 6 | 12;
  }) {
    const amount = PRICING[input.tier][input.durationMonths];
    const merchantTransId = crypto.randomUUID();
    const payment = await PaymentModel.create({
      userId: input.userId,
      telegramUserId: input.telegramUserId,
      telegramUsername: input.telegramUsername ?? "",
      tier: input.tier,
      durationMonths: input.durationMonths,
      amount,
      method: "click",
      status: "pending",
      merchantTransId,
    });
    return payment.toJSON();
  }

  async findByMerchantTransId(merchantTransId: string) {
    return PaymentModel.findOne({ merchantTransId });
  }

  async completeClickPayment(payment: InstanceType<typeof PaymentModel>, clickTransId: string, clickPaydocId: string) {
    if (payment.status === "completed") {
      // Click may retry Complete — this must be idempotent, not a second
      // subscription activation.
      return payment.toJSON();
    }
    if (payment.status !== "pending") {
      throw new AppError("Payment is not pending", 400);
    }

    // Atomically claim the pending->completed transition before activating
    // anything. The read-then-write this replaced (check payment.status,
    // then activate, then save) let two concurrent Complete calls for the
    // same payment (Click retries the webhook on timeout/ambiguous response)
    // both observe "pending" and both call activateFromPayment, double
    // crediting the subscription. Only the request that wins this
    // conditional update performs the activation; a request that loses the
    // race falls back to the same idempotent "already completed" response.
    const claimed = await PaymentModel.findOneAndUpdate(
      { _id: payment._id, status: "pending" },
      {
        $set: {
          status: "completed",
          clickTransId,
          clickPaydocId,
          approvedBy: "click",
          approvedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!claimed) {
      // Lost the race — another concurrent request already completed it.
      const latest = await PaymentModel.findById(payment._id);
      return (latest ?? payment).toJSON();
    }

    try {
      await subscriptionService.activateFromPayment(
        claimed.userId,
        claimed.tier,
        claimed.durationMonths,
        `bot-click:${clickTransId}`
      );
    } catch (err) {
      // Activation failed after we'd already claimed "completed" — revert to
      // "pending" so this isn't left stuck completed-but-unactivated with no
      // way to retry (Click's retried Complete webhook, or a manual retry,
      // needs to see "pending" again to try activation once more).
      await PaymentModel.updateOne(
        { _id: claimed._id, status: "completed" },
        {
          $set: {
            status: "pending",
            clickTransId: null,
            clickPaydocId: null,
            approvedBy: null,
            approvedAt: null,
          },
        }
      );
      throw err;
    }

    return claimed.toJSON();
  }

  async cancelClickPayment(payment: InstanceType<typeof PaymentModel>) {
    payment.status = "cancelled";
    await payment.save();
    return payment.toJSON();
  }

  // ---- Shared lookups the bot needs ----
  async lookupUserByPhone(phone: string) {
    const user = await authRepository.findByPhone(phone);
    if (!user) return null;
    const { tier, subscription } = await subscriptionService.getUserTier(
      user._id.toString(),
      (user as any).role,
      (user as any).isPayed
    );
    return {
      userId: user._id.toString(),
      username: (user as any).username,
      phone_number: (user as any).phone_number,
      tier,
      subscriptionEndDate: subscription?.endDate ?? null,
    };
  }

  async linkTelegram(userId: string, telegramId: string, telegramUsername?: string) {
    return authRepository.linkTelegram(userId, telegramId, telegramUsername);
  }

  // Lets the bot re-resolve an already-linked account from telegramId alone
  // (see auth.repository.ts's findByTelegramId, which this account gets
  // linked into via linkTelegram above). The bot's own "am I linked"
  // state is just an in-memory Telegraf session, wiped on every restart —
  // without this, that meant re-prompting every previously-linked user to
  // share their phone number again after each deploy, even though the
  // backend never forgot who they were.
  async lookupUserByTelegramId(telegramId: string) {
    const user = await authRepository.findByTelegramId(telegramId);
    if (!user) return null;
    const { tier, subscription } = await subscriptionService.getUserTier(
      user._id.toString(),
      (user as any).role,
      (user as any).isPayed
    );
    return {
      userId: user._id.toString(),
      username: (user as any).username,
      phone_number: (user as any).phone_number,
      tier,
      subscriptionEndDate: subscription?.endDate ?? null,
    };
  }

  async getSubscriptionStatus(userId: string) {
    const user = await authRepository.findById(userId);
    if (!user) throw new AppError("User not found", 404);
    const { tier, subscription } = await subscriptionService.getUserTier(
      userId,
      (user as any).role,
      (user as any).isPayed
    );
    return {
      userId,
      username: (user as any).username,
      tier,
      subscriptionEndDate: subscription?.endDate ?? null,
    };
  }

  // Second layer of defense behind OCR for the trust window attachReceipt
  // opens: a "provisioned" payment nobody confirmed within 48h gets its
  // tier taken back automatically, the same way an admin's Reject would.
  // Called hourly by a cron in server.ts. Claims each payment individually
  // (rather than a single updateMany) so a payment an admin approves/rejects
  // in the middle of this run is left alone instead of raced.
  async autoExpireProvisionedPayments(): Promise<
    Array<{ paymentId: string; userId: string; tier: PaymentTier; amount: number }>
  > {
    const now = new Date();
    const overdue = await PaymentModel.find({
      status: "provisioned",
      provisionExpiresAt: { $lt: now },
    });

    const expired: Array<{ paymentId: string; userId: string; tier: PaymentTier; amount: number }> = [];

    for (const payment of overdue) {
      const claimed = await PaymentModel.findOneAndUpdate(
        { _id: payment._id, status: "provisioned" },
        {
          $set: {
            status: "rejected",
            rejectedReason: "Auto-expired: not confirmed by admin within 48h",
            approvedBy: "cron:auto-expire",
            approvedAt: now,
          },
        },
        { new: true },
      );

      // Lost the race to an admin who approved/rejected this in the
      // meantime — whatever they did already stands, nothing more to do.
      if (!claimed) continue;

      try {
        await subscriptionService.deactivateFromPayment(claimed.userId, "cron-auto-expire");
      } catch (error) {
        console.error(
          `[autoExpireProvisionedPayments] downgrade failed for user ${claimed.userId} (payment ${claimed._id})`,
          error,
        );
        // The payment itself is already "rejected" — leaving isPayed as-is
        // means the tier lingers until the next run tries again (this query
        // only matches status:"provisioned", so a fix has to happen by hand
        // or by re-running deactivateFromPayment directly) rather than a
        // silently half-applied state with no record of what's still owed.
        continue;
      }

      expired.push({
        paymentId: claimed._id.toString(),
        userId: claimed.userId,
        tier: claimed.tier,
        amount: claimed.amount,
      });
    }

    return expired;
  }
}

export const paymentService = new PaymentService();
