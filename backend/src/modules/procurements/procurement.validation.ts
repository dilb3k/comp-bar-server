import { z } from "zod";
import { PRODUCT_UNITS, QTY_DECIMALS, roundQty } from "../../utils/quantity";

const quantitySchema = z
  .number()
  .finite()
  .positive("quantity must be > 0")
  .refine(
    (value) =>
      Math.abs(
        value * 10 ** QTY_DECIMALS - Math.round(value * 10 ** QTY_DECIMALS),
      ) < 1e-6,
    `quantity supports at most ${QTY_DECIMALS} decimals`,
  )
  .transform(roundQty);

// productId present → restock that existing product (name/unit are ignored,
// read fresh from the DB by the service). productId absent → create a brand
// new product first, using name/unit/sellPrice from here — mirrors "Mahsulotlar
// (ko'rish va yangi tovar qo'shish)" from the spec: a Bozorchi may add an item
// that doesn't exist yet, not just restock one that does.
const procurementItemSchema = z.object({
  productId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, "name is required").max(200),
  unit: z.enum(PRODUCT_UNITS).optional(),
  quantity: quantitySchema,
  buyPrice: z.number().finite().min(0, "buyPrice must be >= 0"),
  // Only meaningful when creating a new product; ignored when restocking an
  // existing one. Defaults to buyPrice (zero markup placeholder) in the
  // service so the admin can set a real sell price later on the Products
  // page — a Bozorchi only ever knows what they paid, not what it resells for.
  sellPrice: z.number().finite().min(0).optional(),
  deviceId: z.string().trim().min(1).optional(),
  barcodes: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
});

export const submitProcurementSchema = z.object({
  supplier: z.string().trim().max(120).optional(),
  items: z
    .array(procurementItemSchema)
    .min(1, "At least one item is required")
    .max(500),
});

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
const rangeFields = {
  from: date.optional(),
  to: date.optional(),
  supplier: z.string().trim().max(120).optional(),
};
export const listProcurementsQuerySchema = z
  .object({
    ...rangeFields,
    product: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    "from must be <= to",
  );
export const procurementAnalyticsQuerySchema = z
  .object({
    ...rangeFields,
    period: z.enum(["day", "week", "month", "year", "custom"]).default("day"),
    format: z.enum(["csv", "xlsx", "pdf"]).optional(),
    report: z.enum(["analytics", "receipts"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.report === "receipts" && value.format === "pdf") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Receipt ledger supports csv or xlsx" });
    if (value.period === "custom" && (!value.from || !value.to))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "custom period requires from and to",
      });
    if (value.from && value.to && value.from > value.to)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "from must be <= to",
      });
    if (
      value.from &&
      value.to &&
      (Date.parse(value.to) - Date.parse(value.from)) / 86400000 > 3660
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Range cannot exceed ten years",
      });
  });
export const procurementIdentifierSchema = z.object({
  id: z.string().trim().min(1).max(200),
});
