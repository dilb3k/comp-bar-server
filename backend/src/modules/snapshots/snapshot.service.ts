import { env } from "../../config/env";
import { telegramReportService } from "../../services/telegram-report.service";
import { AppError } from "../../utils/app-error";
import {
  assertNotFutureDayKey,
  compareDayKeys,
  getCurrentBusinessDate,
  isPastBusinessDate,
} from "../../utils/business-day";
import { createLocalId } from "../../utils/ids";
import type { AuthUser } from "../auth/auth.types";
import { inventoryRepository } from "../inventory/inventory.repository";
import { deriveMissingInventoryEntry } from "../inventory/inventory.logic";
import { productRepository } from "../products/product.repository";
import { productService } from "../products/product.service";
import { aggregateSnapshot, buildSnapshotItem } from "./snapshot.logic";
import { snapshotRepository } from "./snapshot.repository";

type UpsertSnapshotInput = {
  localId?: string;
  deviceId?: string;
  date: string;
  totalRevenue?: number;
  totalProfit?: number;
  totalSoldItems?: number;
  items?: any[];
  createdAt?: string;
  updatedAt?: string;
};

export class SnapshotService {
  async getDaily(actor: AuthUser, date: string) {
    const currentBusinessDate = getCurrentBusinessDate(
      env.BUSINESS_DAY_START_HOUR,
    );

    assertNotFutureDayKey(
      date,
      currentBusinessDate,
      "Future snapshot dates are not allowed",
    );

    return snapshotRepository.findDaily(actor.userId, date);
  }

  async getRange(actor: AuthUser, from: string, to: string) {
    if (compareDayKeys(from, to) > 0) {
      throw new AppError("from must be <= to", 422);
    }

    return snapshotRepository.findRange(actor.userId, from, to);
  }

  async createOrUpdate(actor: AuthUser, payload: UpsertSnapshotInput) {
    const currentBusinessDate = getCurrentBusinessDate(
      env.BUSINESS_DAY_START_HOUR,
    );

    assertNotFutureDayKey(
      payload.date,
      currentBusinessDate,
      "Future snapshot dates are not allowed",
    );

    if (isPastBusinessDate(payload.date, currentBusinessDate)) {
      throw new AppError("Past business days cannot be edited", 409);
    }

    const [entries, products] = await Promise.all([
      inventoryRepository.findByDate(actor.userId, payload.date),
      productRepository.findAllByOwner(actor.userId),
    ]);

    const visibleProducts = products.filter((p) =>
      productService.isVisibleForBusinessDate(p as any, payload.date),
    );

    const entryMap = new Map(entries.map((e) => [e.productId, e]));

    const derivedItems = visibleProducts.map((product) => {
      const inventory =
        entryMap.get((product as any).localId) ??
        deriveMissingInventoryEntry(product.toJSON() as any, payload.date);

      return buildSnapshotItem({
        productId: (product as any).localId,
        productName: String((product as any).name),
        startQuantity: Number((inventory as any).startQuantity),
        currentQuantity: Number((inventory as any).currentQuantity),
        buyPrice: Number((product as any).buyPrice),
        sellPrice: Number((product as any).sellPrice),
      });
    });

    const items = payload.items ?? derivedItems;
    const totals = aggregateSnapshot(items);

    const now = payload.updatedAt ? new Date(payload.updatedAt) : new Date();

    const snapshot = await snapshotRepository.upsertByDate(
      actor.userId,
      payload.date,
      payload.deviceId ?? "server",
      {
        localId:
          payload.localId ??
          createLocalId("snap", `${actor.userId}_${payload.date}`),
        deviceId: payload.deviceId ?? "server",
        date: payload.date,
        totalRevenue: payload.totalRevenue ?? totals.totalRevenue,
        totalProfit: payload.totalProfit ?? totals.totalProfit,
        totalSoldItems: payload.totalSoldItems ?? totals.totalSoldItems,
        items,
        isDeleted: false,
        createdAt: payload.createdAt ? new Date(payload.createdAt) : now,
        updatedAt: now,
      },
    );

    telegramReportService.reportSnapshotSaved(actor, {
      date: payload.date,
      totalRevenue: Number((snapshot as any).totalRevenue),
      totalProfit: Number((snapshot as any).totalProfit),
      totalSoldItems: Number((snapshot as any).totalSoldItems),
      itemCount: Array.isArray((snapshot as any).items)
        ? (snapshot as any).items.length
        : 0,
      deviceId: (snapshot as any).deviceId,
    });

    return snapshot;
  }
}

export const snapshotService = new SnapshotService();
