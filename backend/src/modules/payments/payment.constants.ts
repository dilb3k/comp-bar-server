// Single source of truth for plan pricing — mirrors hisvex-landing's
// "narxlar" (pricing) section exactly (src/App.tsx, id="narxlar") so the
// bot never drifts from what the marketing site promises. If pricing ever
// changes, update it here first; the bot reads it via GET /api/bot/pricing
// rather than hardcoding its own copy.
export type PlanTier = "bor" | "pro";
export type PlanDuration = 1 | 6 | 12;

export const PRICING: Record<PlanTier, Record<PlanDuration, number>> = {
  bor: {
    1: 44_000,
    6: 237_600,
    12: 422_400,
  },
  pro: {
    1: 99_000,
    6: 534_600,
    12: 950_400,
  },
};

export const PLAN_FEATURES: Record<PlanTier, string[]> = {
  bor: ["100 ta mahsulotgacha", "Savdo va qarzdorlar", "Offline sync"],
  pro: ["Cheksiz mahsulot", "To'liq Statistika & Reyting", "Telegram hisobotlari", "Ustuvor qo'llab-quvvatlash"],
};

export function isValidTier(value: unknown): value is PlanTier {
  return value === "bor" || value === "pro";
}

export function isValidDuration(value: unknown): value is PlanDuration {
  return value === 1 || value === 6 || value === 12;
}
