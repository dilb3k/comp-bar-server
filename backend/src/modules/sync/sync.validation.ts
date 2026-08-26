import { z } from "zod";
import { PRODUCT_UNITS, QTY_DECIMALS, QTY_EPSILON, roundQty } from "../../utils/quantity";
import { normalizeProductImage } from "../products/product-image";

/**
 * Offline clients replay quantities through this endpoint, so it has to accept
 * the same fractional values the REST endpoints now do (a "kg" product can be
 * 2.5). Precision, not integrality, is the guard — see utils/quantity.
 */
const syncedQuantitySchema = z
  .number()
  .min(0)
  .refine(
    (value) => Math.abs(value * 10 ** QTY_DECIMALS - Math.round(value * 10 ** QTY_DECIMALS)) < 1e-6,
    `quantity supports at most ${QTY_DECIMALS} decimals`,
  )
  .transform(roundQty);

const syncedProductSchema = z.object({
  localId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  quantity: syncedQuantitySchema,
  unit: z.enum(PRODUCT_UNITS).optional(),
  buyPrice: z.number().positive("buyPrice must be > 0"),
  sellPrice: z.number().positive("sellPrice must be > 0"),
  image: z.string().optional().transform((value) => normalizeProductImage(value)),
  displayIndex: z.number().int().min(1).optional(),
  barcodes: z.array(z.string().trim().min(1)).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((value, ctx) => {
  if (value.sellPrice < value.buyPrice) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sellPrice"],
      message: "sellPrice must be greater than or equal to buyPrice"
    });
  }
});

const syncedInventorySchema = z.object({
  localId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  date: z.string(),
  unit: z.enum(PRODUCT_UNITS).optional(),
  startQuantity: syncedQuantitySchema,
  currentQuantity: syncedQuantitySchema,
  buyPrice: z.number().min(0).optional(),
  sellPrice: z.number().min(0).optional(),
  lockedRevenue: z.number().min(0).optional(),
  // Unbounded below, matching the model: a sale below cost (clearance, a
  // haggled price, a discount past the margin) is a real loss to record.
  lockedProfit: z.number().optional(),
  lockedSold: syncedQuantitySchema.optional(),
  note: z.string().optional().default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((value, ctx) => {
  // Epsilon-tolerant: both sides are already snapped to the same 3-decimal
  // grid, so a smaller gap is rounding noise rather than an over-count.
  if (value.currentQuantity - value.startQuantity > QTY_EPSILON) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentQuantity"],
      message: "currentQuantity cannot be greater than startQuantity"
    });
  }
});

const syncedSnapshotSchema = z.object({
  localId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  date: z.string(),
  totalRevenue: z.number().min(0),
  // See lockedProfit above — a day can close at a loss.
  totalProfit: z.number(),
  totalSoldItems: syncedQuantitySchema,
  items: z.array(
    z.object({
      productId: z.string().trim().min(1),
      productName: z.string().trim().min(1),
      unit: z.enum(PRODUCT_UNITS).optional(),
      sold: syncedQuantitySchema,
      buyPrice: z.number().positive().optional(),
      sellPrice: z.number().positive().optional(),
      revenue: z.number().min(0),
      profit: z.number()
    })
  ).superRefine((items, ctx) => {
    for (const item of items) {
      if (item.sellPrice !== undefined && item.buyPrice !== undefined && item.sellPrice < item.buyPrice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [String(items.indexOf(item)), "sellPrice"],
          message: "sellPrice must be greater than or equal to buyPrice"
        });
      }
    }
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const syncPayloadSchema = z.object({
  products: z.array(syncedProductSchema).optional(),
  inventory: z.array(syncedInventorySchema).optional(),
  daily: z.array(syncedSnapshotSchema).optional(),
  snapshots: z.array(syncedSnapshotSchema).optional(),
  lastSyncAt: z.string().datetime().optional(),
  // Pagination for the server->client page of changes returned alongside
  // this sync (see sync.service.ts). Zod strips unrecognized keys by
  // default, so omitting these here silently dropped every client-provided
  // limit/offset and pinned every sync response to the hardcoded defaults —
  // a client could never page past the first 1000 changed records per entity.
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional()
});
