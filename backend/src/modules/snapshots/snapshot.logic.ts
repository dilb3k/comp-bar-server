import type { DailySnapshotItem } from "../../types/domain";
import { normalizeUnit, roundMoney, roundQty, type ProductUnit } from "../../utils/quantity";

export function buildSnapshotItem(input: {
  productId: string;
  productName: string;
  unit?: ProductUnit | string;
  startQuantity: number;
  currentQuantity: number;
  buyPrice: number;
  sellPrice: number;
  lockedRevenue?: number;
  lockedProfit?: number;
  lockedSold?: number;
}): DailySnapshotItem {
  const newSold = roundQty(Math.max(input.startQuantity - input.currentQuantity, 0));
  const sold = roundQty((input.lockedSold ?? 0) + newSold);
  const revenue = roundMoney((input.lockedRevenue ?? 0) + newSold * input.sellPrice);
  const profit = roundMoney((input.lockedProfit ?? 0) + newSold * (input.sellPrice - input.buyPrice));

  return {
    productId: input.productId,
    productName: input.productName,
    unit: normalizeUnit(input.unit),
    sold,
    buyPrice: input.buyPrice,
    sellPrice: input.sellPrice,
    revenue,
    profit
  };
}

export function aggregateSnapshot(items: DailySnapshotItem[]) {
  const totals = items.reduce(
    (acc, item) => ({
      totalRevenue: acc.totalRevenue + item.revenue,
      totalProfit: acc.totalProfit + item.profit,
      totalSoldItems: acc.totalSoldItems + item.sold
    }),
    {
      totalRevenue: 0,
      totalProfit: 0,
      totalSoldItems: 0
    }
  );

  return {
    totalRevenue: roundMoney(totals.totalRevenue),
    totalProfit: roundMoney(totals.totalProfit),
    totalSoldItems: roundQty(totals.totalSoldItems)
  };
}
