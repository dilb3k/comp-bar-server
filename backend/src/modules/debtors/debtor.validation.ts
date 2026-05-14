import { z } from "zod";

export const createDebtorSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  amount: z.number().min(0, "amount must be >= 0").default(0),
});

export const updateDebtorSchema = z.object({
  name: z.string().trim().min(1).optional(),
  amount: z.number().min(0).optional(),
});

export const adjustDebtSchema = z.object({
  amount: z.number().positive("amount must be positive"),
  type: z.enum(["add", "subtract"]),
  note: z.string().optional(),
});

export const debtorIdentifierParamsSchema = z.object({
  id: z.string().min(1),
});
