import { z } from "zod";
import { normalizeProductImage } from "../products/product-image";


const syncedProductSchema = z.object({
  localId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  quantity: z.number().int().min(0),
  buyPrice: z.number().positive(),
  sellPrice: z.number().positive(),
  image: z.string().optional().transform((value) => normalizeProductImage(value)),
  isDeleted: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const syncedInventorySchema = z.object({
  localId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  date: z.string(),
  startQuantity: z.number().int().min(0),
  currentQuantity: z.number().int().min(0),
  note: z.string().optional().default(""),
  isDeleted: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const syncedSnapshotSchema = z.object({
  localId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  date: z.string(),
  totalRevenue: z.number().min(0),
  totalProfit: z.number(),
  totalSoldItems: z.number().int().min(0),
  items: z.array(
    z.object({
      productId: z.string().trim().min(1),
      productName: z.string().trim().min(1),
      sold: z.number().int().min(0),
      buyPrice: z.number().min(0).optional(),
      sellPrice: z.number().min(0).optional(),
      revenue: z.number().min(0),
      profit: z.number()
    })
  ),
  isDeleted: z.boolean().optional().default(false),
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
