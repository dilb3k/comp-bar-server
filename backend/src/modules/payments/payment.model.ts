import { Schema, model, models } from "mongoose";

export type PaymentMethod = "click" | "manual_card";
// "provisioned" sits between pending and completed: the OCR on a submitted
// receipt matched the expected amount, so the user's tier was already
// upgraded on trust, but a human hasn't confirmed the receipt yet. It
// resolves to "completed" (admin confirms) or "rejected" (admin rejects, or
// the 48h auto-expire cron gives up waiting) — never anything else.
export type PaymentStatus = "pending" | "provisioned" | "approved" | "rejected" | "completed" | "cancelled";
export type PaymentTier = "bor" | "pro";

export interface IPaymentOcrResult {
  extractedAmount: number | null;
  extractedText: string | null;
  transactionRef: string | null;
  amountMatched: boolean;
}

export interface IPaymentSenderCardDetails {
  cardNumber: string;
  fullName: string;
}

export interface IPayment {
  userId: string; // Hisvex admin's user id (the account being upgraded)
  telegramUserId: string;
  telegramUsername?: string;
  tier: PaymentTier;
  durationMonths: 1 | 6 | 12;
  amount: number; // so'm
  method: PaymentMethod;
  status: PaymentStatus;
  receiptFileId?: string; // Telegram file_id of the manual-transfer screenshot
  // R2 URL of the (compressed) receipt screenshot — see payment.service.ts's
  // attachReceipt. Independent of receiptFileId above: Telegram's file_id
  // expires/rotates and isn't fetchable from outside Telegram, so admins
  // reviewing from anywhere other than the bot chat need a real URL.
  receiptImageUrl?: string | null;
  // sha256 of the ORIGINAL (pre-compression) receipt bytes — unique+sparse
  // (see index below) so the same screenshot can't be submitted for two
  // different payments. Computed from the original, not the re-encoded
  // WebP, because re-encoding isn't guaranteed byte-identical across runs.
  receiptHash?: string | null;
  ocr?: IPaymentOcrResult | null;
  // Filled by the screenshot-free flow (POST /api/bot/payments/:id/card-details)
  // when the user can't produce a screenshot — no OCR runs on this path, an
  // admin reviews it manually.
  senderCardDetails?: IPaymentSenderCardDetails | null;
  // Set together, when OCR auto-provisions the tier (status -> "provisioned").
  provisionedAt?: Date | null;
  // provisionedAt + 48h — the auto-expire cron's cutoff (see server.ts).
  provisionExpiresAt?: Date | null;
  clickTransId?: string;
  clickPaydocId?: string;
  merchantTransId?: string; // our own reference passed to Click as merchant_trans_id
  approvedBy?: string; // "bot:<telegramId>" or a superAdmin userId
  approvedAt?: Date;
  rejectedReason?: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    userId: { type: String, required: true, index: true },
    telegramUserId: { type: String, required: true, index: true },
    telegramUsername: { type: String, default: "" },
    tier: { type: String, required: true, enum: ["bor", "pro"] },
    durationMonths: { type: Number, required: true, enum: [1, 6, 12] },
    amount: { type: Number, required: true },
    method: { type: String, required: true, enum: ["click", "manual_card"] },
    status: {
      type: String,
      required: true,
      enum: ["pending", "provisioned", "approved", "rejected", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
    receiptFileId: { type: String, default: null },
    receiptImageUrl: { type: String, default: null },
    receiptHash: { type: String, default: null },
    ocr: {
      type: new Schema<IPaymentOcrResult>(
        {
          extractedAmount: { type: Number, default: null },
          extractedText: { type: String, default: null, maxlength: 500 },
          transactionRef: { type: String, default: null },
          amountMatched: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: null,
    },
    senderCardDetails: {
      type: new Schema<IPaymentSenderCardDetails>(
        {
          cardNumber: { type: String, required: true },
          fullName: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    provisionedAt: { type: Date, default: null },
    provisionExpiresAt: { type: Date, default: null, index: true },
    clickTransId: { type: String, default: null, index: true },
    clickPaydocId: { type: String, default: null },
    merchantTransId: { type: String, default: null, index: true },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: null },
    note: { type: String, default: null },
  },
  {
    collection: "payments",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        ret.id = ret._id.toString();
        ret._id = ret.id;
        return ret;
      },
    },
  }
);

paymentSchema.index({ status: 1, createdAt: -1 });

// Sparse: most payments never carry a receiptHash (Click, screenshot-free
// card-details flow), and a sparse index only indexes documents where the
// field exists — a plain unique index would make the second such payment
// collide on {receiptHash: null}, exactly the products.idx_barcodes bug
// product.model.ts's comment describes for a *compound* sparse index. Here
// there's nothing else in the key, so plain `sparse` (not `partial`) is
// sufficient: it already excludes every doc where receiptHash is absent.
paymentSchema.index(
  { receiptHash: 1 },
  { name: "idx_receipt_hash_unique", unique: true, sparse: true },
);

// Used by the 48h auto-expire cron (see server.ts) to find provisioned
// payments past their deadline without scanning the whole collection.
paymentSchema.index(
  { status: 1, provisionExpiresAt: 1 },
  { name: "idx_provisioned_expiry" },
);

export const PaymentModel = models.Payment ?? model<IPayment>("Payment", paymentSchema);
