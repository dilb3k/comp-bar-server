import { z } from "zod";

import { isValidDayKey } from "../../utils/business-day";
import { QTY_DECIMALS, QTY_EPSILON, roundQty } from "../../utils/quantity";

const dayKeySchema = z.string().refine(isValidDayKey, "date must be YYYY-MM-DD");
const isoDateTime = z.string().optional();

/**
 * Quantities carry fractions now (a "kg" product can be 2.5), so the guard is
 * precision rather than integrality — see utils/quantity for why every value
 * is snapped to the 3-decimal grid before any arithmetic touches it.
 */
const quantitySchema = z
  .number()
  .min(0)
  .refine(
    (value) => Math.abs(value * 10 ** QTY_DECIMALS - Math.round(value * 10 ** QTY_DECIMALS)) < 1e-6,
    `quantity supports at most ${QTY_DECIMALS} decimals`,
  )
  .transform(roundQty);

export const inventoryDateQuerySchema = z.object({
  date: dayKeySchema.optional(),
  from: dayKeySchema.optional(),
  to: dayKeySchema.optional()
});

export const inventoryRangeQuerySchema = z.object({
  from: dayKeySchema,
  to: dayKeySchema
});

const inventoryItemSchema = z.object({
  localId: z.string().trim().min(1).optional(),
  deviceId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1),
  date: dayKeySchema.optional(),
  startQuantity: quantitySchema,
  currentQuantity: quantitySchema.optional(),
  note: z.string().optional().default(""),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
}).superRefine((value, ctx) => {
  // Epsilon-tolerant: both sides have already been rounded to the same grid,
  // so a difference smaller than half a step is rounding noise, not an
  // over-count worth rejecting.
  if (
    value.currentQuantity !== undefined &&
    value.currentQuantity - value.startQuantity > QTY_EPSILON
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentQuantity"],
      message: "currentQuantity cannot be greater than startQuantity"
    });
  }
});

/**
 * Money actually taken for a line, overriding whatever the list price would
 * have produced. It is an absolute amount rather than a per-unit price
 * because that is the only way a figure the user typed can be stored
 * exactly: a target of 25 000 over 3 units has no exact per-unit price
 * (8333.33 x 3 = 24 999.99), so any price-based route loses a tiyin.
 */
const lineRevenueSchema = z.number().min(0).finite().optional();

const bulkCurrentItemSchema = z.object({
  productId: z.string().trim().min(1),
  currentQuantity: quantitySchema,
  /**
   * Restates the revenue for every unit this edit accounts as sold — the
   * "Kutilgan tushum" figure on the inventory screen. Profit follows from it
   * automatically, since the cost of those units does not change.
   */
  lineRevenue: lineRevenueSchema,
  note: z.string().optional().default("")
});

export const inventoryStartDaySchema = z.object({
  date: dayKeySchema.optional(),
  deviceId: z.string().trim().min(1),
  items: z.array(inventoryItemSchema).min(1)
});

export const inventoryBulkCurrentSchema = z.object({
  date: dayKeySchema.optional(),
  deviceId: z.string().trim().min(1),
  items: z.array(bulkCurrentItemSchema).min(1)
});

const salesLineItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: quantitySchema.refine((value) => value > 0, "quantity must be > 0"),
  /**
   * The price actually charged per unit for this line, when it differs from
   * the product's list price — a haggled price the cashier typed on the row.
   * Omitted means "charge the list price".
   *
   * Deliberately allowed below buyPrice (a clearance sale at a loss is a real
   * thing) and down to 0 (a giveaway); the resulting negative profit is
   * representable — see the lockedProfit field in inventory.model.ts.
   */
  unitPrice: z.number().min(0).finite().optional(),
  /**
   * Money actually taken for the whole line. Wins over `unitPrice` when both
   * are present, because it is the only form that can carry a hand-typed
   * cart total without rounding drift — see lineRevenueSchema above.
   */
  lineRevenue: lineRevenueSchema,
});

export const inventorySalesSchema = z.object({
  date: dayKeySchema.optional(),
  deviceId: z.string().trim().min(1),
  lines: z.array(salesLineItemSchema).min(1),
});
