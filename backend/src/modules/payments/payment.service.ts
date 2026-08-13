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

    await subscriptionService.activateFromPayment(
      payment.userId,
      payment.tier,
      payment.durationMonths,
      `bot-manual:${approvedByTelegramId}`
    );

    payment.status = "completed";
    payment.approvedBy = `bot:${approvedByTelegramId}`;
    payment.approvedAt = new Date();
    await payment.save();
    return payment.toJSON();
  }

  async rejectPayment(paymentId: string, rejectedByTelegramId: string, reason?: string) {
    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);
    if (payment.status !== "pending") throw new AppError("Payment is not pending", 400);

    payment.status = "rejected";
    payment.approvedBy = `bot:${rejectedByTelegramId}`;
    payment.approvedAt = new Date();
    payment.rejectedReason = reason ?? null;
    await payment.save();
    return payment.toJSON();
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

    await subscriptionService.activateFromPayment(
      payment.userId,
      payment.tier,
      payment.durationMonths,
      `bot-click:${clickTransId}`
    );

    payment.status = "completed";
    payment.clickTransId = clickTransId;
    payment.clickPaydocId = clickPaydocId;
    payment.approvedBy = "click";
    payment.approvedAt = new Date();
    await payment.save();
    return payment.toJSON();
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
