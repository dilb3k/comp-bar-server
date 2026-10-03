import mongoose, { type PipelineStage } from "mongoose";
import { env } from "../../config/env";
import { AppError } from "../../utils/app-error";
import {
  getCurrentBusinessDate,
  getEffectiveHour,
} from "../../utils/business-day";
import { roundMoney, roundQty } from "../../utils/quantity";
import type { AuthUser } from "../auth/auth.types";
import { ProductModel } from "../products/product.model";
import { DailySnapshotModel } from "../snapshots/snapshot.model";
import { ProcurementModel } from "./procurement.model";

export type AnalyticsQuery = {
  period?: "day" | "week" | "month" | "year" | "custom";
  from?: string;
  to?: string;
  supplier?: string;
};
export function procurementRange(query: AnalyticsQuery, today: string) {
  const period = query.period ?? "day";
  const anchor = query.from ?? today;
  const d = new Date(anchor + "T00:00:00Z");
  const key = (v: Date) => v.toISOString().slice(0, 10);
  let from = anchor,
    to = anchor;
  if (period === "custom") {
    if (!query.from || !query.to)
      throw new AppError("from and to required", 422);
    from = query.from;
    to = query.to;
  } else if (period === "week") {
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    from = key(d);
    d.setUTCDate(d.getUTCDate() + 6);
    to = key(d);
  } else if (period === "month") {
    const first = new Date(d);
    first.setUTCDate(1);
    from = key(first);
    const last = new Date(first);
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    to = key(last);
  } else if (period === "year") {
    from = `${d.getUTCFullYear()}-01-01`;
    to = `${d.getUTCFullYear()}-12-31`;
  }
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 3660)
    throw new AppError("Invalid or excessive date range", 422);
  const granularity =
    period === "year" || (Date.parse(to) - Date.parse(from)) / 86400000 > 120
      ? "month"
      : "day";
  return { from, to, period, granularity };
}
export function requireProcurementFinance(actor: AuthUser) {
  if (actor.scope === "procurement") throw new AppError("Forbidden", 403);
  if (actor.tier === "tekin") throw new AppError("Payment required", 402);
}
function trendKeys(from: string, to: string, monthly: boolean) {
  const result: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  if (monthly) d.setUTCDate(1);
  while (d.toISOString().slice(0, 10) <= to) {
    result.push(d.toISOString().slice(0, monthly ? 7 : 10));
    if (monthly) d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}
export async function procurementAnalytics(
  actor: AuthUser,
  query: AnalyticsQuery,
) {
  requireProcurementFinance(actor);
  const today = getCurrentBusinessDate(
    getEffectiveHour(actor),
    env.TIMEZONE_OFFSET,
  );
  const range = procurementRange(query, today);
  const owner = actor.userId;
  const date = { $gte: range.from, $lte: range.to };
  const bucket = {
    $substrBytes: ["$date", 0, range.granularity === "month" ? 7 : 10],
  };
  const match = {
    ownerAdminId: owner,
    date,
    ...(query.supplier ? { supplier: query.supplier } : {}),
  };
  const productGroup = {
    _id: { productId: "$items.productId", unit: "$items.unit" },
    name: { $last: "$items.name" },
    quantity: { $sum: "$items.quantity" },
    totalCost: { $sum: "$items.lineCost" },
    firstBuyPrice: { $first: "$items.buyPrice" },
    previousBuyPrice: { $first: "$items.previousBuyPrice" },
    latestBuyPrice: { $last: "$items.buyPrice" },
  };
  // All three collections are read at one MongoDB snapshot. This read-only
  // transaction never increments owner_write_versions or mutates stock.
  const session = await mongoose.startSession();
  let result: any;
  try {
    await session.withTransaction(
      async () => {
        const [p] = await ProcurementModel.aggregate([
          { $match: match },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    spend: { $sum: "$totalCost" },
                    batches: { $sum: 1 },
                  },
                },
              ],
              quantities: [
                { $unwind: "$items" },
                {
                  $group: {
                    _id: "$items.unit",
                    quantity: { $sum: "$items.quantity" },
                  },
                },
              ],
              trends: [
                {
                  $group: {
                    _id: bucket,
                    spend: { $sum: "$totalCost" },
                    batches: { $sum: 1 },
                  },
                },
              ],
              products: [
                { $unwind: { path: "$items", includeArrayIndex: "lineIndex" } },
                { $sort: { date: 1, createdAt: 1, localId: 1, lineIndex: 1 } },
                { $group: productGroup },
                { $sort: { totalCost: -1, "_id.productId": 1 } },
                { $limit: 20 },
              ],
            },
          },
        ] as PipelineStage[])
          .session(session)
          .option({ maxTimeMS: 15000 });
        const sales = await DailySnapshotModel.aggregate([
          { $match: { ownerAdminId: owner, date } },
          {
            $group: {
              _id: bucket,
              revenue: { $sum: "$totalRevenue" },
              grossProfit: { $sum: "$totalProfit" },
            },
          },
        ])
          .session(session)
          .option({ maxTimeMS: 15000 });
        const [stock] = await ProductModel.aggregate([
          { $match: { ownerAdminId: owner, deletedAt: { $exists: false } } },
          {
            $group: {
              _id: null,
              value: { $sum: { $multiply: ["$quantity", "$buyPrice"] } },
            },
          },
        ])
          .session(session)
          .option({ maxTimeMS: 15000 });
        const procurementByKey = new Map(
          (p?.trends ?? []).map((v: any) => [v._id, v]),
        );
        const salesByKey = new Map(sales.map((v: any) => [v._id, v]));
        const costTrends = trendKeys(
          range.from,
          range.to,
          range.granularity === "month",
        ).map((key) => {
          const cost: any = procurementByKey.get(key);
          const sale: any = salesByKey.get(key);
          return {
            date: key,
            spend: roundMoney(cost?.spend ?? 0),
            batches: cost?.batches ?? 0,
            revenue: roundMoney(sale?.revenue ?? 0),
            grossProfit: roundMoney(sale?.grossProfit ?? 0),
          };
        });
        const totalProcurementSpend = roundMoney(p?.totals[0]?.spend ?? 0);
        const totalBatchesCount = p?.totals[0]?.batches ?? 0;
        const totalItemsProcured = { dona: 0, kg: 0 };
        for (const row of p?.quantities ?? [])
          if (row._id === "dona" || row._id === "kg")
            totalItemsProcured[row._id as "dona" | "kg"] = roundQty(
              row.quantity,
            );
        const totalRevenue = roundMoney(
          sales.reduce((sum: number, v: any) => sum + v.revenue, 0),
        );
        const grossProfit = roundMoney(
          sales.reduce((sum: number, v: any) => sum + v.grossProfit, 0),
        );
        result = {
          ...range,
          supplier: query.supplier ?? null,
          generatedAt: new Date().toISOString(),
          inventoryValuation: "current-latest-purchase-cost",
          salesBasis: "accrual-revenue",
          totalProcurementSpend,
          totalItemsProcured,
          totalBatchesCount,
          averageBatchValue: totalBatchesCount
            ? roundMoney(totalProcurementSpend / totalBatchesCount)
            : 0,
          costTrends,
          topCostProducts: (p?.products ?? []).map((v: any) => {
            const baseline = v.previousBuyPrice ?? v.firstBuyPrice;
            return {
              productId: v._id.productId,
              name: v.name,
              unit: v._id.unit,
              quantity: roundQty(v.quantity),
              totalCost: roundMoney(v.totalCost),
              averageBuyPrice: v.quantity
                ? roundMoney(v.totalCost / v.quantity)
                : 0,
              firstBuyPrice: v.firstBuyPrice,
              previousBuyPrice: v.previousBuyPrice ?? null,
              latestBuyPrice: v.latestBuyPrice,
              priceChangePercent:
                baseline > 0
                  ? roundMoney((v.latestBuyPrice / baseline - 1) * 100)
                  : null,
            };
          }),
          totalRevenue,
          grossProfit,
          costOfGoodsSold: roundMoney(totalRevenue - grossProfit),
          cashFlowBalance: roundMoney(totalRevenue - totalProcurementSpend),
          inventoryValue: roundMoney(stock?.value ?? 0),
        };
      },
      { readConcern: { level: "snapshot" } },
    );
    return result;
  } finally {
    await session.endSession();
  }
}
export async function procurementSummary(actor: AuthUser) {
  const today = getCurrentBusinessDate(
    getEffectiveHour(actor),
    env.TIMEZONE_OFFSET,
  );
  const [r] = await ProcurementModel.aggregate([
    { $match: { ownerAdminId: actor.userId } },
    {
      $facet: {
        today: [
          { $match: { date: today } },
          { $group: { _id: null, spend: { $sum: "$totalCost" } } },
        ],
        month: [
          {
            $match: { date: { $gte: today.slice(0, 7) + "-01", $lte: today } },
          },
          { $group: { _id: null, spend: { $sum: "$totalCost" } } },
        ],
        latest: [
          { $sort: { date: -1, createdAt: -1, localId: -1 } },
          { $limit: 1 },
          { $project: { _id: 0, localId: 1, date: 1, totalCost: 1, items: 1 } },
        ],
      },
    },
  ]).option({ maxTimeMS: 15000 });
  const last = r?.latest[0];
  const quantities = { dona: 0, kg: 0 };
  for (const item of last?.items ?? [])
    quantities[item.unit as "dona" | "kg"] = roundQty(
      (quantities[item.unit as "dona" | "kg"] ?? 0) + item.quantity,
    );
  return {
    date: today,
    todaySpend: roundMoney(r?.today[0]?.spend ?? 0),
    monthSpend: roundMoney(r?.month[0]?.spend ?? 0),
    lastBatch: last
      ? {
          localId: last.localId,
          date: last.date,
          totalCost: last.totalCost,
          lineCount: last.items.length,
          quantities,
        }
      : null,
  };
}
