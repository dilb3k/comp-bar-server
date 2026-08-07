import crypto from "node:crypto";

import { env } from "../../config/env";

// Click (click.uz) Merchant API — Prepare/Complete webhook protocol.
// Reference: https://docs.click.uz/en/click-api-request/
//
// Click calls our endpoint twice per payment:
//   1. Prepare (action=0) — Click has taken the user's money into escrow and
//      asks us to confirm the order is valid before it's captured.
//   2. Complete (action=1) — the money is captured; we activate the
//      subscription here (see payment.service.ts#completeClickPayment).
//
// Both requests are signed with an MD5 hash built from specific fields in a
// fixed order plus our SECRET_KEY — we recompute the same hash and compare,
// exactly like verifying an HMAC, to make sure the request really came from
// Click and wasn't forged.
export const CLICK_ERROR = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_NOT_FOUND: -5,
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  ERROR_IN_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
} as const;

export type ClickPrepareBody = {
  click_trans_id: string;
  service_id: string;
  merchant_trans_id: string;
  amount: string;
  action: string;
  sign_time: string;
  sign_string: string;
  error?: string;
};

export type ClickCompleteBody = ClickPrepareBody & {
  merchant_prepare_id: string;
};

class ClickPaymentService {
  isEnabled() {
    return Boolean(env.CLICK_MERCHANT_ID && env.CLICK_SERVICE_ID && env.CLICK_SECRET_KEY);
  }

  verifyPrepareSignature(body: ClickPrepareBody): boolean {
    if (!env.CLICK_SECRET_KEY) return false;
    const expected = crypto
      .createHash("md5")
      .update(
        `${body.click_trans_id}${body.service_id}${env.CLICK_SECRET_KEY}${body.merchant_trans_id}${body.amount}${body.action}${body.sign_time}`
      )
      .digest("hex");
    return expected === body.sign_string;
  }

  verifyCompleteSignature(body: ClickCompleteBody): boolean {
    if (!env.CLICK_SECRET_KEY) return false;
    const expected = crypto
      .createHash("md5")
      .update(
        `${body.click_trans_id}${body.service_id}${env.CLICK_SECRET_KEY}${body.merchant_trans_id}${body.merchant_prepare_id}${body.amount}${body.action}${body.sign_time}`
      )
      .digest("hex");
    return expected === body.sign_string;
  }

  // The pay-page URL the bot sends the user to. `transaction_param` carries
  // our own merchantTransId back through Click unchanged.
  buildPayUrl(amount: number, merchantTransId: string): string {
    const params = new URLSearchParams({
      service_id: env.CLICK_SERVICE_ID ?? "",
      merchant_id: env.CLICK_MERCHANT_ID ?? "",
      amount: String(amount),
      transaction_param: merchantTransId,
    });
    return `https://my.click.uz/services/pay?${params.toString()}`;
  }
}

export const clickPaymentService = new ClickPaymentService();
