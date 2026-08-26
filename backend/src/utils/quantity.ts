/**
 * Units of measure and the rounding rules that go with them.
 *
 * Quantities used to be integers everywhere ("dona" was the only unit, so
 * `z.number().int()` was a valid guard). Weighted goods ("kg") make that false:
 * 2.5 kg is a legitimate quantity, and every quantity path — validation,
 * inventory arithmetic, sync — now has to tolerate fractions.
 *
 * Fractions bring binary floating point with them (`22.1 - 2.3` is
 * `19.799999999999997`), which would slowly poison stock counts and revenue
 * totals across repeated sales. Every arithmetic result that lands in the
 * database or in a comparison therefore goes through `roundQty`/`roundMoney`
 * here, so the two sides of `currentQuantity > startQuantity` can never differ
 * by a phantom 1e-15.
 */

export const PRODUCT_UNITS = ["dona", "kg"] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const DEFAULT_UNIT: ProductUnit = "dona";

/** Fractional precision allowed for weighted units. 1 g resolution. */
export const QTY_DECIMALS = 3;

const QTY_FACTOR = 10 ** QTY_DECIMALS;

/** Smallest quantity difference that counts as real; anything under is noise. */
export const QTY_EPSILON = 1 / (QTY_FACTOR * 2);

export function isProductUnit(value: unknown): value is ProductUnit {
  return typeof value === "string" && (PRODUCT_UNITS as readonly string[]).includes(value);
}

export function normalizeUnit(value: unknown): ProductUnit {
  return isProductUnit(value) ? value : DEFAULT_UNIT;
}

/** Round a quantity to the storable precision (3 decimals). */
export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * QTY_FACTOR) / QTY_FACTOR;
}

/** Round a money amount to 2 decimals — so'm is quoted whole, but a
 *  fractional-kg line (0.333 kg x 15000) must not carry 1e-12 tails. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Coerce a quantity to what its unit can actually represent: "dona" is
 * countable so it stays integral, "kg" keeps 3 decimals. Applied at every
 * write boundary so a client that sends 2.5 dona can't create a half-piece.
 */
export function normalizeQuantity(value: number, unit: ProductUnit = DEFAULT_UNIT): number {
  if (!Number.isFinite(value)) return 0;
  const safe = Math.max(value, 0);
  return unit === "kg" ? roundQty(safe) : Math.round(safe);
}

/** True when `a` exceeds `b` by more than rounding noise. */
export function qtyGreaterThan(a: number, b: number): boolean {
  return a - b > QTY_EPSILON;
}

/** Human-readable quantity: trims trailing zeros and appends the unit. */
export function formatQuantity(value: number, unit: ProductUnit = DEFAULT_UNIT): string {
  const rounded = unit === "kg" ? roundQty(value) : Math.round(value);
  const text = unit === "kg" ? String(Number(rounded.toFixed(QTY_DECIMALS))) : String(rounded);
  return `${text} ${unit}`;
}
