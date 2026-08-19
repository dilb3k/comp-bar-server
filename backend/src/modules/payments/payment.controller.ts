import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { paymentService } from "./payment.service";
import { PRICING, PLAN_FEATURES } from "./payment.constants";
import { clickPaymentService, CLICK_ERROR, type ClickCompleteBody, type ClickPrepareBody } from "./click.service";
import { subscriptionService } from "../subscriptions/subscription.service";
import { authRepository } from "../auth/auth.repository";

// ---- Bot-internal endpoints (guarded by botAuth middleware) ----
export const botController = {
  async pricing(_req: Request, res: Response) {
    return sendSuccess(res, { pricing: PRICING, features: PLAN_FEATURES, clickEnabled: clickPaymentService.isEnabled() });
  },

  async lookupUser(req: Request, res: Response) {
    const result = await paymentService.lookupUserByPhone(req.body.phone);
    if (!result) throw new AppError("User not found", 404);
    return sendSuccess(res, result);
  },

  async linkTelegram(req: Request, res: Response) {
    const { userId, telegramId, telegramUsername } = req.body;
    const user = await paymentService.linkTelegram(userId, telegramId, telegramUsername);
    if (!user) throw new AppError("User not found", 404);
    return sendSuccess(res, { linked: true });
  },

  async subscriptionStatus(req: Request, res: Response) {
    const result = await paymentService.getSubscriptionStatus(String(req.params.userId));
    return sendSuccess(res, result);
  },

  async lookupByTelegramId(req: Request, res: Response) {
    const result = await paymentService.lookupUserByTelegramId(String(req.params.telegramId));
    if (!result) throw new AppError("User not found", 404);
    return sendSuccess(res, result);
  },

  async createManualPayment(req: Request, res: Response) {
    const payment = await paymentService.createManualPayment(req.body);
    return sendSuccess(res, payment, 201);
  },

  async attachReceipt(req: Request, res: Response) {
    const payment = await paymentService.attachReceipt(String(req.params.paymentId), req.body.receiptFileId);
    return sendSuccess(res, payment);
  },

  async approvePayment(req: Request, res: Response) {
    const payment = await paymentService.approveManualPayment(
      String(req.params.paymentId),
      req.body.approvedByTelegramId
    );
    return sendSuccess(res, payment);
  },

  async rejectPayment(req: Request, res: Response) {
    const payment = await paymentService.rejectPayment(
      String(req.params.paymentId),
      req.body.rejectedByTelegramId,
      req.body.reason
    );
    return sendSuccess(res, payment);
  },

  async listByUser(req: Request, res: Response) {
    const payments = await paymentService.getByUserId(String(req.params.userId));
    return sendSuccess(res, payments);
  },

  async listPending(_req: Request, res: Response) {
    const payments = await paymentService.getPending();
    return sendSuccess(res, payments);
  },

  async getPayment(req: Request, res: Response) {
    const payment = await paymentService.getById(String(req.params.paymentId));
    return sendSuccess(res, payment);
  },

  async expiringSoon(req: Request, res: Response) {
    const days = Number(req.query.days) || 3;
    const subs = await subscriptionService.findExpiringSoon(days);

    const results = [];
    for (const sub of subs) {
      const user = await authRepository.findById(sub.userId);
      if (!user || !(user as any).telegramId) continue; // can't DM someone who never linked the bot
      results.push({
        subscriptionId: String(sub._id),
        userId: sub.userId,
        telegramId: (user as any).telegramId,
        username: (user as any).username,
        tier: sub.tier,
        subscriptionEndDate: sub.endDate,
      });
    }
    return sendSuccess(res, results);
  },

  async markReminderSent(req: Request, res: Response) {
    await subscriptionService.markReminderSent(String(req.params.subscriptionId));
    return sendSuccess(res, { ok: true });
  },

  async createClickPending(req: Request, res: Response) {
    if (!clickPaymentService.isEnabled()) {
      throw new AppError("Click is not configured yet", 503);
    }
    const payment = await paymentService.createClickPending(req.body);
    const payUrl = clickPaymentService.buildPayUrl(payment.amount, payment.merchantTransId!);
    return sendSuccess(res, { payment, payUrl }, 201);
  },
};

// ---- Click webhook (public, signature-verified — see click.service.ts) ----
// Click's own protocol requires every response — success AND failure — to
// come back as HTTP 200 with an `error` field (never our app's normal
// {success,data}/{success:false,error} envelope, and never a thrown
// exception bubbling to errorMiddleware, which Click can't parse). Both
// handlers below are fully self-contained try/catch so an unexpected
// failure (DB hiccup, etc.) still returns a well-formed Click error instead
// of a raw 500 / stack trace to an external caller.
export const clickController = {
  async prepare(req: Request, res: Response) {
    try {
      const body = req.body as ClickPrepareBody;

      if (!clickPaymentService.isEnabled()) {
        return res.json({ error: CLICK_ERROR.ERROR_IN_REQUEST, error_note: "Click not configured" });
      }
      if (!clickPaymentService.verifyPrepareSignature(body)) {
        return res.json({ error: CLICK_ERROR.SIGN_CHECK_FAILED, error_note: "SIGN CHECK FAILED!" });
      }

      const payment = await paymentService.findByMerchantTransId(body.merchant_trans_id);
      if (!payment) {
        return res.json({ error: CLICK_ERROR.USER_NOT_FOUND, error_note: "Payment not found" });
      }
      if (payment.status === "cancelled" || payment.status === "rejected") {
        return res.json({ error: CLICK_ERROR.TRANSACTION_CANCELLED, error_note: "Payment cancelled" });
      }
      if (Number(body.amount) !== payment.amount) {
        return res.json({ error: CLICK_ERROR.INCORRECT_AMOUNT, error_note: "Incorrect amount" });
      }

      return res.json({
        click_trans_id: body.click_trans_id,
        merchant_trans_id: body.merchant_trans_id,
        merchant_prepare_id: payment._id?.toString(),
        error: CLICK_ERROR.SUCCESS,
        error_note: "Success",
      });
    } catch (err) {
      console.error("Click prepare failed", err);
      return res.json({ error: CLICK_ERROR.ERROR_IN_REQUEST, error_note: "Internal error" });
    }
  },

  async complete(req: Request, res: Response) {
    try {
      const body = req.body as ClickCompleteBody;

      if (!clickPaymentService.isEnabled()) {
        return res.json({ error: CLICK_ERROR.ERROR_IN_REQUEST, error_note: "Click not configured" });
      }
      if (!clickPaymentService.verifyCompleteSignature(body)) {
        return res.json({ error: CLICK_ERROR.SIGN_CHECK_FAILED, error_note: "SIGN CHECK FAILED!" });
      }

      const payment = await paymentService.findByMerchantTransId(body.merchant_trans_id);
      if (!payment) {
        return res.json({ error: CLICK_ERROR.USER_NOT_FOUND, error_note: "Payment not found" });
      }

      // Same check prepare() makes — Complete's signature covers merchant_prepare_id
      // in addition to amount, but doesn't re-derive amount from our own records, so
      // a forged/tampered amount here would still pass signature verification if
      // it were signed with a leaked/reused sign_string. Re-verify against what we
      // actually created the payment for, exactly like prepare() does.
      if (Number(body.amount) !== payment.amount) {
        return res.json({ error: CLICK_ERROR.INCORRECT_AMOUNT, error_note: "Incorrect amount" });
      }

      // error < 0 means Click itself is telling us the payment failed/was
      // cancelled on their side (e.g. the user's card was declined after
      // Prepare succeeded) — reflect that instead of activating anything.
      if (Number(body.error) < 0) {
        await paymentService.cancelClickPayment(payment);
        return res.json({
          click_trans_id: body.click_trans_id,
          merchant_trans_id: body.merchant_trans_id,
          merchant_confirm_id: payment._id?.toString(),
          error: CLICK_ERROR.SUCCESS,
          error_note: "Cancelled",
        });
      }

      const updated = await paymentService.completeClickPayment(payment, body.click_trans_id, body.merchant_prepare_id);
      return res.json({
        click_trans_id: body.click_trans_id,
        merchant_trans_id: body.merchant_trans_id,
        merchant_confirm_id: updated.id,
        error: CLICK_ERROR.SUCCESS,
        error_note: "Success",
      });
    } catch (err) {
      console.error("Click complete failed", err);
      return res.json({ error: CLICK_ERROR.FAILED_TO_UPDATE, error_note: "Failed to activate subscription" });
    }
  },
};
