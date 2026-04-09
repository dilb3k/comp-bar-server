import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  costPrice: z.number().positive(),
  sellPrice: z.number().positive(),
  initialStock: z.number().int().min(0)
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  costPrice: z.number().positive().optional(),
  sellPrice: z.number().positive().optional(),
  initialStock: z.number().int().min(0).optional(),
  updatedAt: z.string().datetime().optional()
});

export const productParamsSchema = z.object({
  id: z.string().uuid()
});

export const listProductsQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  updatedAfter: z.string().datetime().optional(),
  updatedBefore: z.string().datetime().optional()
});
