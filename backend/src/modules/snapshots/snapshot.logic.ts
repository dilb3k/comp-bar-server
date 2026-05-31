import type { DailySnapshotItem } from "../../types/domain";

export function buildSnapshotItem(input: {
  productId: string;
  productName: string;
  startQuantity: number;
  currentQuantity: number;
  buyPrice: number;
  sellPrice: number;
  lockedRevenue?: number;
  lockedProfit?: number;
  lockedSold?: number;
}): DailySnapshotItem {
  const newSold = Math.max(input.startQuantity - input.currentQuantity, 0);
  const sold = (input.lockedSold ?? 0) + newSold;
  const revenue = (input.lockedRevenue ?? 0) + newSold * input.sellPrice;
  const profit = (input.lockedProfit ?? 0) + newSold * (input.sellPrice - input.buyPrice);

  return {
    productId: input.productId,
    productName: input.productName,
    sold,
    buyPrice: input.buyPrice,
    sellPrice: input.sellPrice,
    revenue,
    profit
  };
}

export function aggregateSnapshot(items: DailySnapshotItem[]) {
  return items.reduce(
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
}
