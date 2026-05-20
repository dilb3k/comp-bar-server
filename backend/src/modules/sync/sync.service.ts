import mongoose from "mongoose";

import type { AuthUser } from "../auth/auth.types";
import { auditService } from "../audit/audit.service";
import { inventoryRepository } from "../inventory/inventory.repository";
import { processAndStoreProductImage } from "../products/product-image";
import { productRepository } from "../products/product.repository";
import { snapshotRepository } from "../snapshots/snapshot.repository";
import { aggregateSnapshot } from "../snapshots/snapshot.logic";
import { telegramReportService } from "../../services/telegram-report.service";
import { getCurrentBusinessDate, getEffectiveHour, isPastBusinessDate } from "../../utils/business-day";

type SyncInput = {
  products?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  inventory?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  daily?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string; deviceId: string; date: string }>;
  snapshots?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string; deviceId: string; date: string }>;
  lastSyncAt?: string;
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
    const currentBusinessDate = getCurrentBusinessDate(businessHour);

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
              const buyPrice = Number(entry.buyPrice ?? product?.buyPrice ?? 0);
              const sellPrice = Number(entry.sellPrice ?? product?.sellPrice ?? 0);
              const sold = Math.max(Number(entry.startQuantity ?? 0) - Number(entry.currentQuantity ?? 0), 0);
              return {
                productId: entry.productId,
                productName: product?.name ?? "",
                sold,
                buyPrice,
                sellPrice,
                revenue: sold * sellPrice,
                profit: sold * (sellPrice - buyPrice)
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

      const [serverProducts, serverInventory, serverSnapshots] = await Promise.all([
        productRepository.findAllUpdatedSince(actor.userId, payload.lastSyncAt),
        inventoryRepository.findUpdatedSince(actor.userId, payload.lastSyncAt),
        snapshotRepository.findUpdatedSince(actor.userId, payload.lastSyncAt)
      ]);

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
        products: serverProducts.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
        inventory: serverInventory.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
        daily: serverSnapshots.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
        serverTime: new Date().toISOString()
      };
    } finally {
      await session.endSession();
    }
  }
}

export const syncService = new SyncService();
