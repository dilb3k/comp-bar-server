import { z } from "zod";
import { PRODUCT_UNITS, QTY_DECIMALS, roundQty } from "../../utils/quantity";
import { normalizeProductImage } from "./product-image";

const isoDateTime = z.string().datetime().optional();

const unitSchema = z.enum(PRODUCT_UNITS);

/**
 * Quantities are no longer integers: a "kg" product can legitimately be 2.5.
 * The guard is now precision (3 decimals, see utils/quantity) rather than
 * integrality — and the value is snapped to that grid here so downstream
 * arithmetic starts from a clean number. Whether a *given* product may carry
 * a fraction at all is decided by its unit, enforced in product.service where
 * the unit is known (validation sees create payloads without it on updates).
 */
const quantitySchema = z
  .number()
  .min(0, "quantity must be >= 0")
  .refine(
    (value) => Math.abs(value * 10 ** QTY_DECIMALS - Math.round(value * 10 ** QTY_DECIMALS)) < 1e-6,
    `quantity supports at most ${QTY_DECIMALS} decimals`,
  )
  .transform(roundQty);

const productBaseSchema = z.object({
  localId: z.string().trim().min(1).optional(),
  deviceId: z.string().trim().min(1),
  name: z.string().trim().min(1, "name is required"),
  quantity: quantitySchema,
  unit: unitSchema.optional(),
  buyPrice: z.number().positive("buyPrice must be > 0"),
  sellPrice: z.number().positive("sellPrice must be > 0"),
  image: z.string().optional().transform((value) => normalizeProductImage(value)),
  barcodes: z.array(z.string().trim()).optional(),
  displayIndex: z.number().int().min(1).optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
});

export const productIdentifierParamsSchema = z.object({
  id: z.string().min(1)
});

export const productSearchQuerySchema = z.object({
  search: z.string().trim().optional()
});

export const createProductSchema = productBaseSchema.superRefine((value, ctx) => {
  if (value.sellPrice < value.buyPrice) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sellPrice"],
      message: "sellPrice must be greater than or equal to buyPrice"
    });
  }
});

export const restockProductSchema = z.object({
  quantity: quantitySchema.refine((value) => value > 0, "quantity must be > 0")
});

export const updateProductSchema = productBaseSchema.partial().extend({
  deviceId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  quantity: quantitySchema.optional(),
  unit: unitSchema.optional(),
  buyPrice: z.number().positive().optional(),
  sellPrice: z.number().positive().optional()
}).superRefine((value, ctx) => {
  if (
    value.buyPrice !== undefined &&
    value.sellPrice !== undefined &&
    value.sellPrice < value.buyPrice
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sellPrice"],
      message: "sellPrice must be greater than or equal to buyPrice"
    });
  }
});
