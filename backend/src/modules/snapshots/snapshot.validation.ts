import { z } from "zod";

import { isValidDayKey } from "../../utils/business-day";

const dayKeySchema = z.string().refine(isValidDayKey, "date must be YYYY-MM-DD");
const isoDateTime = z.string().datetime().optional();

export const snapshotDateQuerySchema = z.object({
  date: dayKeySchema
});

export const snapshotRangeQuerySchema = z.object({
  from: dayKeySchema,
  to: dayKeySchema
});

const snapshotItemSchema = z.object({
  productId: z.string().trim().min(1),
  productName: z.string().trim().min(1),
  sold: z.number().int().min(0),
  buyPrice: z.number().min(0).optional(),
  sellPrice: z.number().min(0).optional(),
  revenue: z.number().min(0),
  profit: z.number()
});

export const upsertSnapshotSchema = z.object({
  localId: z.string().trim().min(1).optional(),
  deviceId: z.string().trim().min(1).default("server"),
  date: dayKeySchema,
  totalRevenue: z.number().min(0).optional(),
  totalProfit: z.number().optional(),
  totalSoldItems: z.number().int().min(0).optional(),
  items: z.array(snapshotItemSchema).optional(),
  isDeleted: z.boolean().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
});
