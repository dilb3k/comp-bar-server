import { z } from "zod";
import { PRODUCT_UNITS, QTY_DECIMALS, roundQty } from "../../utils/quantity";

const quantitySchema = z
  .number()
  .finite()
  .positive("quantity must be > 0")
  .refine(
    (value) => Math.abs(value * 10 ** QTY_DECIMALS - Math.round(value * 10 ** QTY_DECIMALS)) < 1e-6,
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
  name: z.string().trim().min(1, "name is required"),
  unit: z.enum(PRODUCT_UNITS).optional(),
  quantity: quantitySchema,
  buyPrice: z.number().finite().min(0, "buyPrice must be >= 0"),
  // Only meaningful when creating a new product; ignored when restocking an
  // existing one. Defaults to buyPrice (zero markup placeholder) in the
  // service so the admin can set a real sell price later on the Products
  // page — a Bozorchi only ever knows what they paid, not what it resells for.
  sellPrice: z.number().finite().min(0).optional(),
  deviceId: z.string().trim().min(1).optional(),
});

export const submitProcurementSchema = z.object({
  items: z.array(procurementItemSchema).min(1, "At least one item is required").max(500),
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export const listProcurementsQuerySchema = z.object({ from: date.optional(), to: date.optional() })
  .refine(value => !value.from || !value.to || value.from <= value.to, "from must be <= to");
