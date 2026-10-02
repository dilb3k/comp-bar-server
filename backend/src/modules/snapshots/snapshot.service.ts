import { withOwnerTransaction } from "../../lib/transaction";
import { env } from "../../config/env";
import { AppError } from "../../utils/app-error";
import { assertNotFutureDayKey, assertPaidRangeAllowed, compareDayKeys, getCurrentBusinessDate, getEffectiveHour, isPastBusinessDate } from "../../utils/business-day";
import type { AuthUser } from "../auth/auth.types";
import { InventoryEntryModel } from "../inventory/inventory.model";
import { ProcurementModel } from "../procurements/procurement.model";
import { DailySnapshotModel } from "./snapshot.model";
import { buildSnapshotItem } from "./snapshot.logic";
import { snapshotRepository } from "./snapshot.repository";

type UpsertSnapshotInput = { localId?: string; deviceId?: string; date: string; totalRevenue?: number; totalProfit?: number; totalSoldItems?: number; items?: any[]; createdAt?: string; updatedAt?: string };

export class SnapshotService {
  async getDaily(actor: AuthUser, date: string) {
    assertPaidRangeAllowed(actor, date, date);
    assertNotFutureDayKey(date, getCurrentBusinessDate(getEffectiveHour(actor), env.TIMEZONE_OFFSET), "Future snapshot dates are not allowed");
    return snapshotRepository.findDaily(actor.userId, date);
  }

  async getRange(actor: AuthUser, from: string, to: string) {
    if (compareDayKeys(from, to) > 0) throw new AppError("from must be <= to", 422);
    assertPaidRangeAllowed(actor, from, to);
    return snapshotRepository.findRange(actor.userId, from, to);
  }

  async createOrUpdate(actor: AuthUser, payload: UpsertSnapshotInput) {
    const today = getCurrentBusinessDate(getEffectiveHour(actor), env.TIMEZONE_OFFSET);
    assertNotFutureDayKey(payload.date, today, "Future snapshot dates are not allowed");
    if (isPastBusinessDate(payload.date, today)) throw new AppError("Past business days cannot be edited", 409);
    return this.recompute(actor, payload.date, payload.deviceId ?? "server");
  }

  /** Internal projection; joins the caller's transaction, including late offline events.
   * A normal sale reads only its affected inventory rows, not the 1,000-product catalog.
   * Full rebuilds use stored entries, retaining sales of deleted products.
   */
  async recompute(actor: AuthUser, date: string, deviceId: string, productIds?: string[]) {
    return withOwnerTransaction(actor.userId, async (session) => {
      const filter = { ownerAdminId: actor.userId, date };
      const exists = productIds?.length ? await DailySnapshotModel.exists(filter).session(session) : null;
      const incremental = Boolean(exists && productIds?.length);
      const entries = await InventoryEntryModel.find({ ...filter,
        ...(incremental ? { productId: { $in: [...new Set(productIds)] } } : {}),
      }).session(session).lean();
      const items = entries.map((entry: any) => buildSnapshotItem({
        productId: entry.productId, productName: entry.productName || "O'chirilgan mahsulot", unit: entry.unit,
        startQuantity: entry.startQuantity, currentQuantity: entry.currentQuantity,
        buyPrice: entry.buyPrice ?? 0, sellPrice: entry.sellPrice ?? 0,
        lockedRevenue: entry.lockedRevenue ?? 0, lockedProfit: entry.lockedProfit ?? 0, lockedSold: entry.lockedSold ?? 0,
      }));
      // Procurement docs live in their own collection (not InventoryEntry),
      // so this is a direct sum rather than derived from `items` the way
      // totalRevenue/totalProfit are — always a full sum for the day, never
      // the `incremental` partial-productIds path above (a day's total
      // Kirim cost doesn't change just because one product's inventory row
      // was touched for an unrelated reason).
      const procurementAgg = await ProcurementModel.aggregate([
        { $match: { ownerAdminId: actor.userId, date } },
        { $group: { _id: null, total: { $sum: "$totalCost" } } },
      ]).session(session);
      const totalProcurementCost = Math.round((procurementAgg[0]?.total ?? 0) * 100) / 100;
      const now = new Date();
      // Pipeline expressions use $literal for every user-supplied value (a name
      // beginning with '$' is text, never a field/expression).
      return DailySnapshotModel.findOneAndUpdate(filter, [
        { $set: {
          ownerAdminId: { $literal: actor.userId }, date: { $literal: date }, deviceId: { $literal: deviceId },
          localId: { $ifNull: ["$localId", { $literal: `snapshot-${date}` }] },
          createdAt: { $ifNull: ["$createdAt", now] }, updatedAt: now,
          items: incremental ? { $concatArrays: [
            { $filter: { input: { $ifNull: ["$items", []] }, as: "item", cond: { $not: [{ $in: ["$$item.productId", { $literal: productIds }] }] } } },
            { $literal: items },
          ] } : { $literal: items },
        } },
        { $set: {
          totalRevenue: { $round: [{ $sum: "$items.revenue" }, 2] },
          totalProfit: { $round: [{ $sum: "$items.profit" }, 2] },
          totalSoldItems: { $round: [{ $sum: "$items.sold" }, 3] },
          totalProcurementCost: { $literal: totalProcurementCost },
        } },
      ], { session, upsert: true, new: true, timestamps: false }).lean();
    });
  }
}
export const snapshotService = new SnapshotService();
