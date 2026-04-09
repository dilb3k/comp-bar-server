import { ProductModel } from "../models/product.model";
import { SaleModel } from "../models/sale.model";

type StatsInput = {
  workspaceId: string;
  dateFrom?: string;
  dateTo?: string;
};

export const statsService = {
  async summary(input: StatsInput) {
    const match = buildSaleMatch(input);
    const rows = await SaleModel.aggregate<{
      _id: null;
      totalRevenue: number;
      totalProfit: number;
      totalSoldItems: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalPrice" },
          totalProfit: { $sum: "$profit" },
          totalSoldItems: { $sum: "$quantity" }
        }
      }
    ]);

    const row = rows[0];
    return {
      totalRevenue: row?.totalRevenue ?? 0,
      totalProfit: row?.totalProfit ?? 0,
      totalSoldItems: row?.totalSoldItems ?? 0
    };
  },

  async byProduct(input: StatsInput) {
    const match = buildSaleMatch(input);
    const grouped = await SaleModel.aggregate<{
      _id: string;
      soldQuantity: number;
      revenue: number;
      profit: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: "$productId",
          soldQuantity: { $sum: "$quantity" },
          revenue: { $sum: "$totalPrice" },
          profit: { $sum: "$profit" }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    const productIds = grouped.map((item) => item._id);
    const products =
      productIds.length > 0
        ? await ProductModel.find({
            workspaceId: input.workspaceId,
            id: { $in: productIds }
          })
            .select({ id: 1, name: 1, _id: 0 })
            .lean()
        : [];

    const productNameMap = new Map(products.map((p) => [p.id, p.name]));
    return grouped.map((item) => ({
      productId: item._id,
      productName: productNameMap.get(item._id) ?? "Unknown product",
      soldQuantity: item.soldQuantity,
      revenue: item.revenue,
      profit: item.profit
    }));
  }
};

function buildSaleMatch(input: StatsInput): Record<string, unknown> {
  const match: Record<string, unknown> = { workspaceId: input.workspaceId };
  if (input.dateFrom || input.dateTo) {
    match.createdAt = {};
    if (input.dateFrom) {
      (match.createdAt as Record<string, unknown>).$gte = new Date(input.dateFrom);
    }
    if (input.dateTo) {
      (match.createdAt as Record<string, unknown>).$lte = new Date(input.dateTo);
    }
  }
  return match;
}
