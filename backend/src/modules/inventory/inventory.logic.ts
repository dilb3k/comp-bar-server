export function calculateSold(startQuantity: number, currentQuantity: number) {
  return Math.max(startQuantity - currentQuantity, 0);
}

export function calculateInventoryMetrics({
  startQuantity,
  currentQuantity,
  buyPrice,
  sellPrice,
}: {
  startQuantity: number;
  currentQuantity: number;
  buyPrice: number;
  sellPrice: number;
}) {
  const safeStart = Math.max(startQuantity, 0);
  const safeCurrent = Math.max(currentQuantity, 0);

  const remaining = safeCurrent;
  const sold = Math.max(safeStart - safeCurrent, 0);

  const revenue = sold * sellPrice;
  const realizedProfit = sold * (sellPrice - buyPrice);

  const stockSellValue = remaining * sellPrice;
  const stockBuyValue = remaining * buyPrice;

  const potentialProfit = remaining * (sellPrice - buyPrice);

  const marginPercent =
    sellPrice > 0 ? Math.round(((sellPrice - buyPrice) / sellPrice) * 100) : 0;

  return {
    remaining,
    sold,
    revenue,
    realizedProfit,
    stockSellValue,
    stockBuyValue,
    potentialProfit,
    marginPercent,
  };
}

export function aggregateInventory(items: any[]) {
  return items.reduce(
    (acc, item) => {
      acc.totalStart += item.startQuantity || 0;
      acc.totalCurrent += item.remaining || 0;
      acc.totalSold += item.sold || 0;
      acc.totalRevenue += item.revenue || 0;
      acc.totalProfit += item.realizedProfit || 0;
      acc.totalStockSellValue += item.stockSellValue || 0;
      acc.totalStockBuyValue += item.stockBuyValue || 0;
      acc.totalStockProfit += item.potentialProfit || 0;
      return acc;
    },
    {
      totalStart: 0,
      totalCurrent: 0,
      totalSold: 0,
      totalRevenue: 0,
      totalProfit: 0,
      totalStockSellValue: 0,
      totalStockBuyValue: 0,
      totalStockProfit: 0,
    },
  );
}

export function getAdjustedInventoryQuantities(
  previousStartQuantity: number,
  previousCurrentQuantity: number,
  newQuantity: number,
) {
  const soldSoFar = calculateSold(
    previousStartQuantity,
    previousCurrentQuantity,
  );
  return {
    soldSoFar,
    startQuantity: soldSoFar + newQuantity,
    currentQuantity: newQuantity,
  };
}

export function deriveMissingInventoryEntry(product: any, date: string) {
  const now = new Date().toISOString();
  return {
    localId: `derived_${product.localId}_${date}`,
    deviceId: product.deviceId,
    productId: product.localId,
    date,
    startQuantity: product.quantity,
    currentQuantity: product.quantity,
    note: "",
    isDeleted: false,
    updatedAt: now,
    createdAt: now,
  };
}
