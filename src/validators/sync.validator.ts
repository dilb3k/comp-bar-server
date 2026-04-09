import { z } from "zod";

const createSaleActionSchema = z.object({
  type: z.literal("CREATE_SALE"),
  data: z.object({
    id: z.string().uuid(),
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
    createdAt: z.string().datetime()
  })
});

export const syncPushSchema = z.object({
  deviceId: z.string().min(1).max(120),
  actions: z.array(createSaleActionSchema).max(1000)
});

export const syncPullQuerySchema = z.object({
  lastSync: z.string().datetime(),
  page: z.string().optional(),
  pageSize: z.string().optional()
});
