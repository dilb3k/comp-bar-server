import type { DailySnapshotItem } from "../../types/domain";

export function buildSnapshotItem(input: {
  productId: string;
  productName: string;
  startQuantity: number;
  currentQuantity: number;
  buyPrice: number;
  sellPrice: number;
}): DailySnapshotItem {
  const sold = Math.max(input.startQuantity - input.currentQuantity, 0);
  const revenue = sold * input.sellPrice;
  const profit = sold * (input.sellPrice - input.buyPrice);

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
