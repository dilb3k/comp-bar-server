import { z } from "zod";
import { normalizeProductImage } from "../products/product-image";


const syncedProductSchema = z.object({
  localId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  quantity: z.number().int().min(0),
  buyPrice: z.number().positive("buyPrice must be > 0"),
  sellPrice: z.number().positive("sellPrice must be > 0"),
  image: z.string().optional().transform((value) => normalizeProductImage(value)),
  displayIndex: z.number().int().min(1).optional(),
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
  startQuantity: z.number().int().min(0),
  currentQuantity: z.number().int().min(0),
  note: z.string().optional().default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((value, ctx) => {
  if (value.currentQuantity > value.startQuantity) {
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
  totalProfit: z.number().min(0),
  totalSoldItems: z.number().int().min(0),
  items: z.array(
    z.object({
      productId: z.string().trim().min(1),
      productName: z.string().trim().min(1),
      sold: z.number().int().min(0),
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
  lastSyncAt: z.string().datetime().optional()
});
