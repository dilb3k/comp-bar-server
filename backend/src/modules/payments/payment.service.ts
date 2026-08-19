import crypto from "node:crypto";

import { AppError } from "../../utils/app-error";
import { authRepository } from "../auth/auth.repository";
import { subscriptionService } from "../subscriptions/subscription.service";
import { PaymentModel, type PaymentTier } from "./payment.model";
import { PRICING } from "./payment.constants";

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

  async attachReceipt(paymentId: string, receiptFileId: string) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);
    if (payment.status !== "pending") throw new AppError("Payment is not pending", 400);
    payment.receiptFileId = receiptFileId;
    await payment.save();
    return payment.toJSON();
  }

  async approveManualPayment(paymentId: string, approvedByTelegramId: string) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);
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
    if (payment.status !== "pending") throw new AppError("Payment is not pending", 400);

    // Same atomic-claim reasoning as approveManualPayment above — no
    // activation call to roll back here, so a plain conditional update
    // (rather than a full findOneAndUpdate+catch) is enough.
    const claimed = await PaymentModel.findOneAndUpdate(
      { _id: payment._id, status: "pending" },
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
      return (latest ?? payment).toJSON();
    }

    return claimed.toJSON();
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
}

export const paymentService = new PaymentService();
