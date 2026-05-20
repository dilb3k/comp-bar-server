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

function getItemProductId(item: any): string | undefined {
  if (item.product) {
    return item.product.localId ?? item.product.id;
  }
  return item.productId;
}

function isItemNewerThan(existing: any, item: any): boolean {
  const existingDate = existing.date;
  const itemDate = item.date;

  if (itemDate && existingDate) {
    if (itemDate.localeCompare(existingDate) > 0) {
      return true;
    }
    if (itemDate.localeCompare(existingDate) === 0) {
      const existingCreatedAt = existing.updatedAt ?? existing.createdAt;
      const itemCreatedAt = item.updatedAt ?? item.createdAt;
      if (itemCreatedAt && existingCreatedAt) {
        return new Date(itemCreatedAt).getTime() > new Date(existingCreatedAt).getTime();
      }
    }
    return false;
  }

  const existingCreatedAt = existing.updatedAt ?? existing.createdAt;
  const itemCreatedAt = item.updatedAt ?? item.createdAt;

  if (itemCreatedAt && existingCreatedAt) {
    return new Date(itemCreatedAt).getTime() > new Date(existingCreatedAt).getTime();
  }

  return false;
}

export function aggregateInventoryForRange(items: any[]) {
  const uniqueByProductAndDate = new Map<string, any>();

  for (const item of items) {
    const productId = getItemProductId(item);
    if (!productId) continue;

    const date = item.date ?? "unknown";
    const key = `${productId}|||${date}`;

    const existing = uniqueByProductAndDate.get(key);
    if (!existing) {
      uniqueByProductAndDate.set(key, item);
      continue;
    }

    if (isItemNewerThan(existing, item)) {
      uniqueByProductAndDate.set(key, item);
    }
  }

  const deduplicatedItems = Array.from(uniqueByProductAndDate.values());

  const productLatestEntry = new Map<string, any>();
  const productFirstStart = new Map<string, number>();
  const productTotalSold = new Map<string, number>();
  const productTotalRevenue = new Map<string, number>();
  const productTotalProfit = new Map<string, number>();

  for (const item of deduplicatedItems) {
    const productId = getItemProductId(item);
    if (!productId) continue;

    const entrySold = item.sold ?? Math.max((item.startQuantity ?? 0) - (item.currentQuantity ?? 0), 0);
    const entryRevenue = item.revenue ?? 0;
    const entryProfit = item.realizedProfit ?? 0;

    productTotalSold.set(
      productId,
      (productTotalSold.get(productId) ?? 0) + entrySold
    );
    productTotalRevenue.set(
      productId,
      (productTotalRevenue.get(productId) ?? 0) + entryRevenue
    );
    productTotalProfit.set(
      productId,
      (productTotalProfit.get(productId) ?? 0) + entryProfit
    );

    const existing = productLatestEntry.get(productId);

    if (!existing) {
      productLatestEntry.set(productId, item);
      productFirstStart.set(productId, item.startQuantity ?? 0);
      continue;
    }

    if (isItemNewerThan(existing, item)) {
      productLatestEntry.set(productId, item);
    }
  }

  let totalStart = 0;
  let totalCurrent = 0;
  let totalSold = 0;
  let totalRevenue = 0;
  let totalProfit = 0;
  let totalStockSellValue = 0;
  let totalStockBuyValue = 0;
  let totalStockProfit = 0;

  for (const [productId, latestEntry] of productLatestEntry) {
    const latestRemaining = latestEntry.remaining ?? Math.max(latestEntry.currentQuantity ?? 0, 0);
    const latestStockSell = latestEntry.stockSellValue ?? 0;
    const latestStockBuy = latestEntry.stockBuyValue ?? 0;
    const latestStockProfit = latestEntry.potentialProfit ?? 0;
    const firstStart = productFirstStart.get(productId) ?? 0;

    const sold = productTotalSold.get(productId) ?? 0;
    const revenue = productTotalRevenue.get(productId) ?? 0;
    const profit = productTotalProfit.get(productId) ?? 0;

    totalStart += firstStart;
    totalCurrent += latestRemaining;
    totalStockSellValue += latestStockSell;
    totalStockBuyValue += latestStockBuy;
    totalStockProfit += latestStockProfit;
    totalSold += sold;
    totalRevenue += revenue;
    totalProfit += profit;
  }

  return {
    totalStart,
    totalCurrent,
    totalSold,
    totalRevenue,
    totalProfit,
    totalStockSellValue,
    totalStockBuyValue,
    totalStockProfit,
  };
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
    localId: `${date}-${product.localId}`,
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
