import { z } from "zod";
import { normalizeProductImage } from "./product-image";

const isoDateTime = z.string().datetime().optional();
const productBaseSchema = z.object({
  localId: z.string().trim().min(1).optional(),
  deviceId: z.string().trim().min(1),
  name: z.string().trim().min(1, "name is required"),
  quantity: z.number().int().min(0, "quantity must be >= 0"),
  buyPrice: z.number().positive("buyPrice must be > 0"),
  sellPrice: z.number().positive("sellPrice must be > 0"),
  image: z.string().optional().transform((value) => normalizeProductImage(value)),
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

export const updateProductSchema = productBaseSchema.partial().extend({
  deviceId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  quantity: z.number().int().min(0).optional(),
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
