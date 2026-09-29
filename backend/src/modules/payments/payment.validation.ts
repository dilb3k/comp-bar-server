import { z } from "zod";

export const lookupUserSchema = z.object({
  phone: z.string().trim().min(4),
});

export const linkTelegramSchema = z.object({
  userId: z.string().trim().min(1),
  telegramId: z.string().trim().min(1),
  telegramUsername: z.string().trim().optional(),
});

export const createManualPaymentSchema = z.object({
  userId: z.string().trim().min(1),
  telegramUserId: z.string().trim().min(1),
  telegramUsername: z.string().trim().optional(),
  tier: z.enum(["bor", "pro"]),
  durationMonths: z.union([z.literal(1), z.literal(6), z.literal(12)]),
});

export const attachReceiptSchema = z.object({
  receiptFileId: z.string().trim().min(1),
});

export const approvePaymentSchema = z.object({
  approvedByTelegramId: z.string().trim().min(1),
});

export const rejectPaymentSchema = z.object({
  rejectedByTelegramId: z.string().trim().min(1),
  reason: z.string().trim().optional(),
});

export const createClickPendingSchema = createManualPaymentSchema;

export const subscriptionIdParamsSchema = z.object({
  subscriptionId: z.string().trim().min(1),
});

// Screenshot-free flow (POST /api/bot/payments/:paymentId/card-details) —
// no OCR runs on this path, so validation here is just shape, not content.
export const cardDetailsSchema = z.object({
  cardNumber: z.string().trim().min(8).max(25).regex(/^[\d\s]+$/, "cardNumber must contain only digits and spaces"),
  fullName: z.string().trim().min(2).max(200),
});
