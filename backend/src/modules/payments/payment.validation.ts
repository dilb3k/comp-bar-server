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
