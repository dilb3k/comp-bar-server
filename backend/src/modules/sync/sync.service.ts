import mongoose from "mongoose";

import type { AuthUser } from "../auth/auth.types";
import { auditService } from "../audit/audit.service";
import { inventoryRepository } from "../inventory/inventory.repository";
import { processAndStoreProductImage } from "../products/product-image";
import { productRepository } from "../products/product.repository";
import { snapshotRepository } from "../snapshots/snapshot.repository";
import { snapshotService } from "../snapshots/snapshot.service";
import { aggregateSnapshot } from "../snapshots/snapshot.logic";
import { telegramReportService } from "../../services/telegram-report.service";
import { compareDayKeys, getCurrentBusinessDate, getEffectiveHour, isPastBusinessDate } from "../../utils/business-day";
import { normalizeUnit, roundMoney, roundQty } from "../../utils/quantity";
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
        // NOTE: these must run sequentially (not via Promise.all) — the MongoDB
        // driver does not support concurrent operations sharing one ClientSession;
        // running them in parallel is undefined behaviour per the driver docs.
        for (const item of processedProducts) {
          await productRepository.upsertLastWriteWins(actor.userId, item as any, session);
        }

        for (const item of validInventory) {
          await inventoryRepository.upsertLastWriteWins(actor.userId, item as any, session);
        }

        // The generic sync path is also how an offline sale/inventory edit reaches the
        // server (desktop/mobile queue InventoryEntry deltas while offline, then replay
        // them here). The dedicated /inventory/sales, /inventory/start-day and
        // /inventory/bulk-current REST endpoints keep Product.quantity mirroring
        // InventoryEntry.currentQuantity for "today" inside their own transactions — do
        // the same here so a synced offline change doesn't leave the product's top-level
        // stock count stale relative to the day's authoritative inventory record.
        const productQuantityUpdates = new Map<string, { quantity: number; updatedAt: Date }>();
        for (const item of validInventory) {
          const productId = item.productId as string | undefined;
          const currentQuantity = item.currentQuantity;
          if (!productId || typeof currentQuantity !== "number" || !Number.isFinite(currentQuantity)) {
            continue;
          }
          // Multiple queued items can touch the same product; consistent with
          // upsertLastWriteWins elsewhere in this file, the item with the latest
          // updatedAt wins — not simply the last one encountered in payload order.
          const itemUpdatedAt = item.updatedAt as Date;
          const existing = productQuantityUpdates.get(productId);
          if (!existing || itemUpdatedAt.getTime() >= existing.updatedAt.getTime()) {
            productQuantityUpdates.set(productId, { quantity: currentQuantity, updatedAt: itemUpdatedAt });
          }
        }
        for (const [productLocalId, { quantity }] of productQuantityUpdates.entries()) {
          await productRepository.setQuantityByLocalId(actor.userId, productLocalId, quantity, session);
        }

        for (const item of validSnapshots) {
          const itemDate = item.date as string | undefined;
          let snapshotData = { ...item };

          if (itemDate && itemDate.length > 0) {
            // Sequential (not Promise.all) — both queries share the same
            // ClientSession, and concurrent ops on one session are unsupported.
            const entries = await inventoryRepository.findByDate(actor.userId, itemDate, session);
            const products = await productRepository.findAllByOwner(actor.userId, session);

            const productMap = new Map(products.map((p: any) => [p.localId, p]));
            const derivedItems = entries.map((entry: any) => {
              const product = productMap.get(entry.productId);
              // Effective price = entry's locked-in price when > 0, else current
              // product price. Matches snapshot.service and buildInventoryResponse.
              const storedBuyPrice = Number(entry.buyPrice ?? 0);
              const storedSellPrice = Number(entry.sellPrice ?? 0);
              const buyPrice = storedBuyPrice > 0 ? storedBuyPrice : Number(product?.buyPrice ?? 0);
              const sellPrice = storedSellPrice > 0 ? storedSellPrice : Number(product?.sellPrice ?? 0);
              const newSold = roundQty(Math.max(Number(entry.startQuantity ?? 0) - Number(entry.currentQuantity ?? 0), 0));
              const lockedSold = Number(entry.lockedSold ?? 0);
              const lockedRevenue = Number(entry.lockedRevenue ?? 0);
              const lockedProfit = Number(entry.lockedProfit ?? 0);
              return {
                productId: entry.productId,
                productName: product?.name ?? entry.productName ?? "",
                unit: normalizeUnit(product?.unit ?? entry.unit),
                sold: roundQty(lockedSold + newSold),
                buyPrice,
                sellPrice,
                revenue: roundMoney(lockedRevenue + newSold * sellPrice),
                profit: roundMoney(lockedProfit + newSold * (sellPrice - buyPrice))
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

      // Same rationale as the Product.quantity mirroring above: the dedicated
      // /inventory/sales REST endpoint recomputes that day's DailySnapshot
      // (dashboard revenue/profit/sold totals) inside its own transaction after
      // every sale. The generic sync path only recomputes a snapshot when the
      // client explicitly included one in `daily`/`snapshots` — but an offline
      // sale/inventory edit queued on the client only ever produces `inventory`
      // items (see desktop/mobile offline queues), never a `daily` entry. Without
      // this, a synced offline sale would leave that day's stored snapshot stale
      // until something unrelated happened to trigger a recompute. Auto-recompute
      // for every business date touched by validInventory that wasn't already
      // explicitly (re)computed above via validSnapshots.
      const explicitSnapshotDates = new Set(validSnapshots.map((item) => item.date as string));
      const inventoryTouchedDates = new Set(
        validInventory
          .map((item) => item.date as string | undefined)
          .filter((date): date is string => Boolean(date) && !explicitSnapshotDates.has(date as string))
      );
      for (const date of inventoryTouchedDates) {
        try {
          await snapshotService.createOrUpdate(actor, { date, deviceId: "sync-auto" });
        } catch (error) {
          // Non-fatal: the sale/inventory data itself already synced successfully
          // above; a snapshot recompute failure here shouldn't fail the whole sync
          // call (the next createOrUpdate call, e.g. from an online sale or a later
          // sync, will self-heal it since it always derives from scratch).
          rejected.push({ entity: "snapshot", localId: `auto-${date}`, reason: "RECOMPUTE_FAILED" });
        }
      }

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
