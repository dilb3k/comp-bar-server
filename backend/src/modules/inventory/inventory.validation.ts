import { z } from "zod";

import { isValidDayKey } from "../../utils/business-day";

const dayKeySchema = z.string().refine(isValidDayKey, "date must be YYYY-MM-DD");
const isoDateTime = z.string().datetime().optional();

export const inventoryDateQuerySchema = z.object({
  date: dayKeySchema
});

export const inventoryRangeQuerySchema = z.object({
  from: dayKeySchema,
  to: dayKeySchema
});

const inventoryItemSchema = z.object({
  localId: z.string().trim().min(1).optional(),
  deviceId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1),
  date: dayKeySchema.optional(),
  startQuantity: z.number().int().min(0),
  currentQuantity: z.number().int().min(0).optional(),
  note: z.string().optional().default(""),
  isDeleted: z.boolean().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
}).superRefine((value, ctx) => {
  if (
    value.currentQuantity !== undefined &&
    value.currentQuantity > value.startQuantity
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentQuantity"],
      message: "currentQuantity cannot be greater than startQuantity"
    });
  }
});

const bulkCurrentItemSchema = z.object({
  productId: z.string().trim().min(1),
  currentQuantity: z.number().int().min(0),
  note: z.string().optional().default("")
});

export const inventoryStartDaySchema = z.object({
  date: dayKeySchema.optional(),
  deviceId: z.string().trim().min(1),
  items: z.array(inventoryItemSchema).min(1)
});

export const inventoryBulkCurrentSchema = z.object({
  date: dayKeySchema.optional(),
  deviceId: z.string().trim().min(1),
  items: z.array(bulkCurrentItemSchema).min(1)
});
