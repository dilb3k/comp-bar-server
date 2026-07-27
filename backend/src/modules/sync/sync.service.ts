import mongoose from "mongoose";

import type { AuthUser } from "../auth/auth.types";
import { auditService } from "../audit/audit.service";
import { inventoryRepository } from "../inventory/inventory.repository";
import { processAndStoreProductImage } from "../products/product-image";
import { productRepository } from "../products/product.repository";
import { snapshotRepository } from "../snapshots/snapshot.repository";
import { aggregateSnapshot } from "../snapshots/snapshot.logic";
import { telegramReportService } from "../../services/telegram-report.service";
import { compareDayKeys, getCurrentBusinessDate, getEffectiveHour, isPastBusinessDate } from "../../utils/business-day";
import { env } from "../../config/env";

type SyncInput = {
  products?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  inventory?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  daily?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string; deviceId: string; date: string }>;
  snapshots?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string; deviceId: string; date: string }>;
  lastSyncAt?: string;
  limit?: number;
  offset?: number;
};

type RejectedItem = {
  entity: string;
  localId: string;
  reason: string;
};

const TOLERANCE = 0.01;

export class SyncService {
  async sync(actor: AuthUser, payload: SyncInput) {
    const products = payload.products ?? [];
    const inventory = payload.inventory ?? [];
    const snapshots = payload.daily ?? payload.snapshots ?? [];
    const rejected: RejectedItem[] = [];
    const businessHour = getEffectiveHour(actor);
    const currentBusinessDate = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);

    const processedProducts = await Promise.all(
      products.map(async (item) => {
        let storedImage: string | undefined;
        try {
          storedImage = await processAndStoreProductImage(item.image as string | undefined);
        } catch {
          storedImage = item.image as string | undefined;
        }
        return {
          ...item,
          image: storedImage ?? (item.image as string | undefined),
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt)
        };
      })
    );

    const validInventory: Array<Record<string, unknown>> = [];
    for (const item of inventory) {
      const invDate = item.date as string | undefined;
      if (!invDate) {
        rejected.push({ entity: "inventory", localId: item.localId, reason: "MISSING_DATE" });
        continue;
      }
      if (isPastBusinessDate(invDate, currentBusinessDate)) {
        rejected.push({ entity: "inventory", localId: item.localId, reason: "PAST_DAY_LOCKED" });
        continue;
      }
      if (compareDayKeys(invDate, currentBusinessDate) > 0) {
        rejected.push({ entity: "inventory", localId: item.localId, reason: "FUTURE_DAY_NOT_ALLOWED" });
        continue;
      }
      validInventory.push({
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt)
      });
    }

    const validSnapshots: Array<Record<string, unknown>> = [];
    for (const item of snapshots) {
      const snapDate = item.date as string | undefined;
      if (snapDate && isPastBusinessDate(snapDate, currentBusinessDate)) {
        rejected.push({ entity: "snapshot", localId: item.localId, reason: "PAST_DAY_LOCKED" });
        continue;
      }
      validSnapshots.push({
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt)
      });
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Promise.all(
          processedProducts.map((item) =>
            productRepository.upsertLastWriteWins(actor.userId, item as any, session)
          )
        );

        await Promise.all(
          validInventory.map((item) =>
            inventoryRepository.upsertLastWriteWins(actor.userId, item as any, session)
          )
        );

        for (const item of validSnapshots) {
          const itemDate = item.date as string | undefined;
          let snapshotData = { ...item };

          if (itemDate && itemDate.length > 0) {
            const [entries, products] = await Promise.all([
              inventoryRepository.findByDate(actor.userId, itemDate, session),
              productRepository.findAllByOwner(actor.userId, session)
            ]);

            const productMap = new Map(products.map((p: any) => [p.localId, p]));
            const derivedItems = entries.map((entry: any) => {
              const product = productMap.get(entry.productId);
              // Effective price = entry's locked-in price when > 0, else current
              // product price. Matches snapshot.service and buildInventoryResponse.
              const storedBuyPrice = Number(entry.buyPrice ?? 0);
              const storedSellPrice = Number(entry.sellPrice ?? 0);
              const buyPrice = storedBuyPrice > 0 ? storedBuyPrice : Number(product?.buyPrice ?? 0);
              const sellPrice = storedSellPrice > 0 ? storedSellPrice : Number(product?.sellPrice ?? 0);
              const newSold = Math.max(Number(entry.startQuantity ?? 0) - Number(entry.currentQuantity ?? 0), 0);
              const lockedSold = Number(entry.lockedSold ?? 0);
              const lockedRevenue = Number(entry.lockedRevenue ?? 0);
              const lockedProfit = Number(entry.lockedProfit ?? 0);
              return {
                productId: entry.productId,
                productName: product?.name ?? entry.productName ?? "",
                sold: lockedSold + newSold,
                buyPrice,
                sellPrice,
                revenue: lockedRevenue + newSold * sellPrice,
                profit: lockedProfit + newSold * (sellPrice - buyPrice)
              };
            });

            const derivedTotals = aggregateSnapshot(derivedItems);
            const clientTotalRevenue = Number((item as any).totalRevenue ?? 0);
            const clientTotalProfit = Number((item as any).totalProfit ?? 0);
            const clientTotalSold = Number((item as any).totalSoldItems ?? 0);

            if (derivedItems.length > 0) {
              const revenueDiff = Math.abs(derivedTotals.totalRevenue - clientTotalRevenue);
              const profitDiff = Math.abs(derivedTotals.totalProfit - clientTotalProfit);
              const soldDiff = Math.abs(derivedTotals.totalSoldItems - clientTotalSold);

              if (revenueDiff > TOLERANCE || profitDiff > TOLERANCE || soldDiff > TOLERANCE) {
                snapshotData = {
                  ...snapshotData,
                  totalRevenue: derivedTotals.totalRevenue,
                  totalProfit: derivedTotals.totalProfit,
                  totalSoldItems: derivedTotals.totalSoldItems,
                  items: derivedItems as any
                };
              }
            }
          }

          await snapshotRepository.upsertLastWriteWins(actor.userId, snapshotData as any, session);
        }

        const totalChanges = processedProducts.length + validInventory.length + validSnapshots.length;
        if (totalChanges > 0) {
          await auditService.log({
            ownerAdminId: actor.userId,
            action: "SYNC",
            entityType: "sync",
            entityId: `batch-${Date.now()}`,
            after: {
              products: processedProducts.length,
              inventory: validInventory.length,
              snapshots: validSnapshots.length,
              rejected: rejected.length
            },
            source: "sync",
            createdBy: actor.userId,
          });
        }
      });

      const limit = payload.limit ?? 1000;
      const offset = payload.offset ?? 0;
      const fetchLimit = limit + 1;

      const [serverProducts, serverInventory, serverSnapshots] = await Promise.all([
        productRepository.findAllUpdatedSince(actor.userId, payload.lastSyncAt, fetchLimit, offset),
        inventoryRepository.findUpdatedSince(actor.userId, payload.lastSyncAt, fetchLimit, offset),
        snapshotRepository.findUpdatedSince(actor.userId, payload.lastSyncAt, fetchLimit, offset)
      ]);

      const hasMore =
        serverProducts.length > limit ||
        serverInventory.length > limit ||
        serverSnapshots.length > limit;

      const trimmedProducts = serverProducts.slice(0, limit);
      const trimmedInventory = serverInventory.slice(0, limit);
      const trimmedSnapshots = serverSnapshots.slice(0, limit);

      if (processedProducts.length > 0 || validInventory.length > 0 || validSnapshots.length > 0) {
        telegramReportService.reportSync(actor, {
          products: processedProducts.length,
          inventory: validInventory.length,
          snapshots: validSnapshots.length,
          lastSyncAt: payload.lastSyncAt
        });
      }

      return {
        accepted: {
          products: processedProducts.length,
          inventory: validInventory.length,
          snapshots: validSnapshots.length
        },
        rejected,
        products: trimmedProducts.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
        inventory: trimmedInventory.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
        daily: trimmedSnapshots.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
        hasMore,
        serverTime: new Date().toISOString()
      };
    } finally {
      await session.endSession();
    }
  }
}

export const syncService = new SyncService();
