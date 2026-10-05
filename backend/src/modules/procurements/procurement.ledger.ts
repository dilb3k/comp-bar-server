import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { AppError } from "../../utils/app-error";
import type { AuthUser } from "../auth/auth.types";
import { env } from "../../config/env";
import {
  getCurrentBusinessDate,
  getEffectiveHour,
} from "../../utils/business-day";
import { roundMoney, roundQty } from "../../utils/quantity";
import {
  procurementRange,
  requireProcurementFinance,
  type AnalyticsQuery,
} from "./procurement.analytics";
import { ProcurementModel, type IProcurement } from "./procurement.model";

export function procurementLedgerRows(
  receipts: IProcurement[],
  from: string,
  to: string,
  language = "uz",
) {
  const ru = language === "ru";
  const rows: (string | number)[][] = [
    [ru ? "Приходы" : "Kirimlar"],
    [ru ? "Период" : "Davr", from, to],
    [],
    [
      "№",
      ru ? "Дата" : "Sana",
      ru ? "Поставщик" : "Yetkazib beruvchi",
      ru ? "Товар" : "Mahsulot",
      ru ? "Количество" : "Miqdor",
      ru ? "Единица" : "Birlik",
      ru ? "Цена закупки" : "Xarid narxi",
      ru ? "Сумма" : "Jami summa",
      ru ? "Партия" : "Partiya",
    ],
  ];
  const quantities = { dona: 0, kg: 0 };
  let total = 0;
  let index = 0;
  for (const receipt of receipts) {
    total += receipt.totalCost;
    for (const item of receipt.items) {
      const unit = item.unit === "kg" ? "kg" : "dona";
      quantities[unit] += item.quantity;
      rows.push([
        ++index,
        receipt.date,
        receipt.supplier || "—",
        item.name,
        roundQty(item.quantity),
        ru && unit === "dona" ? "шт." : unit,
        roundMoney(item.buyPrice),
        roundMoney(item.lineCost),
        receipt.localId,
      ]);
    }
  }
  rows.push([
    "",
    ru ? "Итого" : "Jami",
    "",
    "",
    `${roundQty(quantities.dona)} ${ru ? "шт." : "dona"} / ${roundQty(quantities.kg)} kg`,
    "",
    "",
    roundMoney(total),
    receipts.length,
  ]);
  return rows;
}

export async function procurementLedger(
  actor: AuthUser,
  query: AnalyticsQuery,
  language: string,
) {
  requireProcurementFinance(actor);
  const { from, to } = procurementRange(
    query,
    getCurrentBusinessDate(getEffectiveHour(actor), env.TIMEZONE_OFFSET),
  );
  // Cursor bounds database buffering; refuse oversized exports explicitly, never truncate.
  const cursor = ProcurementModel.find({
    ownerAdminId: actor.userId,
    date: { $gte: from, $lte: to },
    ...(query.supplier ? { supplier: query.supplier } : {}),
  })
    .sort({ date: 1, createdAt: 1, localId: 1 })
    .maxTimeMS(15000)
    .lean<IProcurement[]>().cursor({ batchSize: 32 });
  const receipts: IProcurement[] = [];
  let lineCount = 0;
  let bytes = 0;
  try {
    for await (const receipt of cursor) {
      lineCount += receipt.items.length;
      bytes += Buffer.byteLength(JSON.stringify(receipt));
      if (lineCount > 50000 || receipts.length >= 10000 || bytes > 8 * 1024 * 1024) {
        throw new AppError("Report is too large. Choose a shorter date range.", 422);
      }
      receipts.push(receipt);
      if (receipts.length % 32 === 0) await yieldEventLoop();
    }
  } finally { await cursor.close(); }
  return {
    kind: "receipts" as const,
    from,
    to,
    rows: procurementLedgerRows(receipts, from, to, language),
  };
}
