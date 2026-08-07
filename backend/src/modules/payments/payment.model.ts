import { Schema, model, models } from "mongoose";

export type PaymentMethod = "click" | "manual_card";
export type PaymentStatus = "pending" | "approved" | "rejected" | "completed" | "cancelled";
export type PaymentTier = "bor" | "pro";

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
      enum: ["pending", "approved", "rejected", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
    receiptFileId: { type: String, default: null },
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

export const PaymentModel = models.Payment ?? model<IPayment>("Payment", paymentSchema);
