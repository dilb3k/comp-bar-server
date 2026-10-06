import type { PipelineStage } from "mongoose";
import { PaymentModel } from "./payment.model";
import { UserModel } from "../auth/user.model";

export type PaymentHistoryQuery = {
  page: number;
  limit: number;
  q?: string;
  status?: string;
  method?: string;
  tier?: string;
  from?: string;
  to?: string;
};
export function historyMatch(query: PaymentHistoryQuery) {
  const match: Record<string, unknown> = {};
  for (const key of ["status", "method", "tier"] as const)
    if (query[key]) match[key] = query[key];
  if (query.from || query.to)
    match.createdAt = {
      ...(query.from ? { $gte: new Date(query.from + "T00:00:00+05:00") } : {}),
      ...(query.to
        ? {
            $lt: new Date(
              new Date(query.to + "T00:00:00+05:00").getTime() + 86400000,
            ),
          }
        : {}),
    };
  return match;
}
export function historySearch(q: string) {
  const literal = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    $or: [
      "account.username",
      "account.phone_number",
      "telegramUsername",
      "telegramUserId",
      "userId",
      "merchantTransId",
      "paymentId",
    ].map((key) => ({ [key]: { $regex: literal, $options: "i" } })),
  };
}
export function paymentHistoryRow(row: any) {
  const digits = row.senderCardDetails?.cardNumber?.replace(/\D/g, "") ?? "";
  return {
    id: String(row._id),
    userId: row.userId,
    username: row.account?.username ?? null,
    phone: row.account?.phone_number ?? null,
    telegramUsername: row.telegramUsername,
    telegramUserId: row.telegramUserId,
    tier: row.tier,
    durationMonths: row.durationMonths,
    amount: row.amount,
    method: row.method,
    status: row.status,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt ?? null,
    approvedBy: row.approvedBy ?? null,
    rejectedReason: row.rejectedReason ?? null,
    needsReconciliation: !!row.needsReconciliation,
    reference:
      row.clickTransId ??
      row.merchantTransId ??
      row.ocr?.transactionRef ??
      null,
    hasReceipt: !!row.receiptHash,
    receiptAmount: row.ocr?.extractedAmount ?? null,
    sender: row.senderCardDetails
      ? {
          name: row.senderCardDetails.fullName,
          card: digits ? "•••• " + digits.slice(-4) : "—",
        }
      : null,
  };
}
export async function listPaymentHistory(query: PaymentHistoryQuery) {
  const accountStages: (PipelineStage.Lookup | PipelineStage.Set)[] = [
    {
      $lookup: {
        from: UserModel.collection.name,
        let: {
          id: {
            $convert: {
              input: "$userId",
              to: "objectId",
              onError: null,
              onNull: null,
            },
          },
        },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
          { $project: { username: 1, phone_number: 1 } },
        ],
        as: "account",
      },
    },
    {
      $set: {
        account: { $arrayElemAt: ["$account", 0] },
        paymentId: { $toString: "$_id" },
      },
    },
  ];
  const pipeline: PipelineStage[] = [
    { $match: historyMatch(query) },
    ...(query.q ? [...accountStages, { $match: historySearch(query.q) }] : []),
    {
      $facet: {
        items: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (query.page - 1) * query.limit },
          { $limit: query.limit },
          ...(query.q ? [] : accountStages),
        ],
        summary: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              settledCount: {
                $sum: {
                  $cond: [
                    { $in: ["$status", ["completed", "approved"]] },
                    1,
                    0,
                  ],
                },
              },
              settledAmount: {
                $sum: {
                  $cond: [
                    { $in: ["$status", ["completed", "approved"]] },
                    "$amount",
                    0,
                  ],
                },
              },
              pendingCount: {
                $sum: {
                  $cond: [
                    { $in: ["$status", ["pending", "provisioned"]] },
                    1,
                    0,
                  ],
                },
              },
              pendingAmount: {
                $sum: {
                  $cond: [
                    { $in: ["$status", ["pending", "provisioned"]] },
                    "$amount",
                    0,
                  ],
                },
              },
              rejectedCount: {
                $sum: {
                  $cond: [
                    { $in: ["$status", ["rejected", "cancelled"]] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
      },
    },
  ];
  const [result] = await PaymentModel.aggregate(pipeline);
  const summary = result?.summary?.[0] ?? {
    total: 0,
    settledCount: 0,
    settledAmount: 0,
    pendingCount: 0,
    pendingAmount: 0,
    rejectedCount: 0,
  };
  const { _id: _ignored, ...totals } = summary;
  return {
    items: (result?.items ?? []).map(paymentHistoryRow),
    summary: totals,
    page: query.page,
    totalPages: Math.ceil(summary.total / query.limit),
  };
}

export async function listReviewQueue(page = 1, limit = 5) {
  const [result] = await PaymentModel.aggregate([
    {
      $match: {
        method: "manual_card",
        $or: [
          { status: { $in: ["pending", "provisioned"] } },
          { needsReconciliation: true },
        ],
      },
    },
    {
      $facet: {
        items: [
          { $sort: { createdAt: 1, _id: 1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              userId: 1,
              telegramUserId: 1,
              telegramUsername: 1,
              tier: 1,
              durationMonths: 1,
              amount: 1,
              method: 1,
              status: 1,
              createdAt: 1,
              needsReconciliation: 1,
            },
          },
        ],
        count: [{ $count: "total" }],
      },
    },
  ]);
  const total = result?.count?.[0]?.total ?? 0;
  return {
    items: (result?.items ?? []).map((row: any) => ({
      ...row,
      id: String(row._id),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}
