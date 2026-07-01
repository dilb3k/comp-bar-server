import mongoose from "mongoose";

import { env } from "../../config/env";
import { AppError } from "../../utils/app-error";
import { telegramReportService } from "../../services/telegram-report.service";
import {
  assertNotFutureDayKey,
  compareDayKeys,
  getBusinessDateFromTimestamp,
  getCurrentBusinessDate,
  getEffectiveHour,
  isPastBusinessDate,
} from "../../utils/business-day";
import type { AuthUser } from "../auth/auth.types";
import { productRepository } from "../products/product.repository";
import { auditService } from "../audit/audit.service";
import { snapshotService } from "../snapshots/snapshot.service";
import { inventoryRepository } from "./inventory.repository";
import {
  calculateInventoryMetrics,
  deriveMissingInventoryEntry,
  aggregateInventory,
  aggregateInventoryForRange,
} from "./inventory.logic";

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isProductVisibleOnDate(product: any, date: string): boolean {
  if (!product) return false;
  const p = typeof product.toJSON === "function" ? product.toJSON() : product;
  if (p.createdAt) {
    const createdBusinessDate = getBusinessDateFromTimestamp(p.createdAt, env.BUSINESS_DAY_START_HOUR, env.TIMEZONE_OFFSET);
    if (createdBusinessDate > date) return false;
  }
  return true;
}

type StartDayInput = {
  date?: string;
  deviceId: string;
  items: Array<{
    productId: string;
    startQuantity: number;
    currentQuantity?: number;
    note?: string;
    localId?: string;
    updatedAt?: string;
    createdAt?: string;
  }>;
};

type BulkCurrentInput = {
  date?: string;
  deviceId: string;
  items: Array<{
    productId: string;
    currentQuantity: number;
    note?: string;
  }>;
};

function buildInventoryResponse(product: any, inventory: any) {
  const productJson =
    typeof product?.toJSON === "function" ? product.toJSON() : product;
  const inventoryJson =
    typeof inventory?.toJSON === "function" ? inventory.toJSON() : inventory;

  const storedBuyPrice = toNumber(inventoryJson?.buyPrice ?? 0);
  const storedSellPrice = toNumber(inventoryJson?.sellPrice ?? 0);
  const effectiveBuyPrice = storedBuyPrice > 0 ? storedBuyPrice : toNumber(productJson?.buyPrice || 0);
  const effectiveSellPrice = storedSellPrice > 0 ? storedSellPrice : toNumber(productJson?.sellPrice || 0);

  const metrics = calculateInventoryMetrics({
    startQuantity: toNumber(inventoryJson?.startQuantity ?? 0),
    currentQuantity: toNumber(inventoryJson?.currentQuantity ?? 0),
    buyPrice: effectiveBuyPrice,
    sellPrice: effectiveSellPrice,
    lockedRevenue: toNumber(inventoryJson?.lockedRevenue ?? 0),
    lockedProfit: toNumber(inventoryJson?.lockedProfit ?? 0),
    lockedSold: toNumber(inventoryJson?.lockedSold ?? 0),
  });

  return {
    ...inventoryJson,
    ...metrics,
    name: productJson?.name,
    quantity: productJson?.quantity,
    buyPrice: effectiveBuyPrice,
    sellPrice: effectiveSellPrice,
    image: productJson?.image ?? "",
    product: productJson,
  };
}

export class InventoryService {
  private getAllowedDate(actor: AuthUser, date?: string) {
    const businessHour = getEffectiveHour(actor);
    const currentBusinessDate = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);
    const targetDate = date ?? currentBusinessDate;

    assertNotFutureDayKey(
      targetDate,
      currentBusinessDate,
      "Inventory cannot be created for a future date",
    );

    if (isPastBusinessDate(targetDate, currentBusinessDate)) {
      throw new AppError("Past business days cannot be edited", 409);
    }

    return { targetDate, currentBusinessDate };
  }

  async getByDate(actor: AuthUser, from?: string, to?: string) {
    const [entries, products] = await Promise.all([
      inventoryRepository.findByDateRange(actor.userId, from, to),
      productRepository.findAllByOwner(actor.userId),
    ]);

    const productMap = new Map(products.map((product) => [product.localId, product]));
    const productsWithInventory = new Set<string>();

    const items = entries.map((entry) => {
      productsWithInventory.add(entry.productId);
      const product = productMap.get(entry.productId) ?? null;

      if (!product) {
        const storedBuyPrice = toNumber(entry.buyPrice ?? 0);
        const storedSellPrice = toNumber(entry.sellPrice ?? 0);
        return {
          ...entry.toJSON(),
          ...calculateInventoryMetrics({
            startQuantity: toNumber(entry.startQuantity),
            currentQuantity: toNumber(entry.currentQuantity),
            buyPrice: storedBuyPrice,
            sellPrice: storedSellPrice,
            lockedRevenue: toNumber(entry.lockedRevenue ?? 0),
            lockedProfit: toNumber(entry.lockedProfit ?? 0),
            lockedSold: toNumber(entry.lockedSold ?? 0),
          }),
          name: entry.productName || "O'chirilgan mahsulot",
          buyPrice: storedBuyPrice,
          sellPrice: storedSellPrice,
          image: "",
          product: null,
        };
      }

      return buildInventoryResponse(product, entry);
    });

    const isSingleDate = from && to && from === to;
    if (isSingleDate) {
      for (const product of products) {
        if (!productsWithInventory.has(product.localId) && isProductVisibleOnDate(product, from)) {
          const derived = deriveMissingInventoryEntry(product, from);
          items.push(buildInventoryResponse(product, derived));
        }
      }
    }

    const summary = aggregateInventoryForRange(items);

    return {
      items,
      summary,
    };
  }
  async getRange(actor: AuthUser, from: string, to: string) {
    if (compareDayKeys(from, to) > 0) {
      throw new AppError("from must be less than or equal to to", 422);
    }

    const [entries, products] = await Promise.all([
      inventoryRepository.findRange(actor.userId, from, to),
      productRepository.findAllByOwner(actor.userId),
    ]);

    const productMap = new Map(
      products.map((product) => [product.localId, product]),
    );
    const productsWithInventory = new Set<string>();

    const items = entries.map((entry) => {
      productsWithInventory.add(entry.productId);
      const product = productMap.get(entry.productId) ?? null;

      if (!product) {
        const storedBuyPrice = toNumber(entry.buyPrice ?? 0);
        const storedSellPrice = toNumber(entry.sellPrice ?? 0);
        return {
          ...entry.toJSON(),
          ...calculateInventoryMetrics({
            startQuantity: toNumber(entry.startQuantity),
            currentQuantity: toNumber(entry.currentQuantity),
            buyPrice: storedBuyPrice,
            sellPrice: storedSellPrice,
            lockedRevenue: toNumber(entry.lockedRevenue ?? 0),
            lockedProfit: toNumber(entry.lockedProfit ?? 0),
            lockedSold: toNumber(entry.lockedSold ?? 0),
          }),
          name: entry.productName || "O'chirilgan mahsulot",
          buyPrice: storedBuyPrice,
          sellPrice: storedSellPrice,
          image: "",
          product: null,
        };
      }

      return buildInventoryResponse(product, entry);
    });

    const isSingleDate = from === to;
    if (isSingleDate) {
      for (const product of products) {
        if (!productsWithInventory.has(product.localId) && isProductVisibleOnDate(product, from)) {
          const derived = deriveMissingInventoryEntry(product, from);
          items.push(buildInventoryResponse(product, derived));
        }
      }
    }

    const summary = aggregateInventoryForRange(items);

    return {
      items,
      summary,
    };
  }

  async startDay(actor: AuthUser, payload: StartDayInput) {
    const { targetDate } = this.getAllowedDate(actor, payload.date);
    const now = new Date();

    const session = await mongoose.startSession();
    try {
      const results = await session.withTransaction(async () => {
        const products = await productRepository.findByIdentifiers(
          actor.userId,
          payload.items.map((item) => item.productId),
          session,
        );
        const productMap = new Map<string, any>();

        for (const product of products) {
          productMap.set(product.localId, product);
          productMap.set(product._id.toString(), product);
        }

        const items: any[] = [];
        for (const item of payload.items) {
          const product = productMap.get(item.productId);

          if (!product) {
            throw new AppError(
              `Active product not found for productId=${item.productId}`,
              404,
            );
          }

          const startQuantity = item.startQuantity;
          const currentQuantity = item.currentQuantity ?? item.startQuantity;

          if (currentQuantity > startQuantity) {
            throw new AppError(
              "currentQuantity cannot be greater than startQuantity",
              422,
            );
          }

          const existingEntry = await inventoryRepository.findByProductAndDate(
            actor.userId,
            (product as any).localId,
            targetDate,
            session,
          );

          const entry = await inventoryRepository.upsertByProductAndDateWithSession(
            actor.userId,
            (product as any).localId,
            targetDate,
            {
              localId:
                item.localId ??
                `${targetDate}-${product.localId}`,
              deviceId: payload.deviceId,
              productId: (product as any).localId,
              productName: product.name ?? "",
              date: targetDate,
              startQuantity,
              currentQuantity,
              buyPrice: toNumber(product.buyPrice || 0),
              sellPrice: toNumber(product.sellPrice || 0),
              lockedRevenue: toNumber((existingEntry as any)?.lockedRevenue ?? 0),
              lockedProfit: toNumber((existingEntry as any)?.lockedProfit ?? 0),
              lockedSold: toNumber((existingEntry as any)?.lockedSold ?? 0),
              note: item.note ?? "",
              createdAt: item.createdAt ? new Date(item.createdAt) : now,
              updatedAt: item.updatedAt ? new Date(item.updatedAt) : now,
            },
            session,
          );

          await productRepository.updateById(
            actor.userId,
            (product as any)._id.toString(),
            {
              quantity: currentQuantity,
              updatedAt: now,
            },
            session,
          );

          await auditService.log({
            ownerAdminId: actor.userId,
            action: "START_DAY",
            entityType: "inventory",
            entityId: item.productId,
            after: { productId: item.productId, date: targetDate, startQuantity, currentQuantity },
            source: "rest",
            createdBy: actor.userId,
          });

          items.push(
            buildInventoryResponse(
              {
                ...product.toJSON(),
                quantity: currentQuantity,
                updatedAt: now.toISOString(),
              },
              entry,
            ),
          );
        }
        return items;
      });

      telegramReportService.reportInventoryStarted(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
        items: results.map((entry) => ({
          productName: entry.product?.name,
          startQuantity: toNumber(entry.startQuantity),
          currentQuantity: toNumber(entry.currentQuantity),
          sold: toNumber(entry.sold),
        })),
      });

      return results;
    } finally {
      await session.endSession();
    }
  }

  async bulkUpdateCurrent(actor: AuthUser, payload: BulkCurrentInput) {
    const { targetDate } = this.getAllowedDate(actor, payload.date);
    const now = new Date();

    const session = await mongoose.startSession();
    try {
      const results = await session.withTransaction(async () => {
        const products = await productRepository.findByIdentifiers(
          actor.userId,
          payload.items.map((item) => item.productId),
          session,
        );
        const productMap = new Map<string, any>();

        for (const product of products) {
          productMap.set(product.localId, product);
          productMap.set(product._id.toString(), product);
        }

        const items = await Promise.all(
          payload.items.map(async (item) => {
            const product = productMap.get(item.productId);

            if (!product) {
              throw new AppError(
                `Active product not found for productId=${item.productId}`,
                404,
              );
            }

            const existing = await inventoryRepository.findByProductAndDate(
              actor.userId,
              (product as any).localId,
              targetDate,
              session,
            );

            const productQuantity = toNumber((product as any).quantity ?? 0);

            if (existing && item.currentQuantity > toNumber((existing as any).startQuantity)) {
              throw new AppError(
                "currentQuantity cannot be greater than startQuantity",
                422,
              );
            }

            if (!existing && item.currentQuantity > productQuantity) {
              throw new AppError(
                "currentQuantity cannot be greater than product quantity",
                422,
              );
            }

            const startQuantity = existing
              ? toNumber((existing as any).startQuantity)
              : productQuantity;

            const updated = await inventoryRepository.upsertByProductAndDateWithSession(
              actor.userId,
              (product as any).localId,
              targetDate,
              {
                localId:
                  (existing as any)?.localId ??
                  `${targetDate}-${(product as any).localId}`,
                deviceId: payload.deviceId,
                productId: (product as any).localId,
                productName: product.name ?? "",
                date: targetDate,
                startQuantity,
                currentQuantity: item.currentQuantity,
                buyPrice: toNumber((existing as any)?.buyPrice ?? product.buyPrice ?? 0),
                sellPrice: toNumber((existing as any)?.sellPrice ?? product.sellPrice ?? 0),
                lockedRevenue: toNumber((existing as any)?.lockedRevenue ?? 0),
                lockedProfit: toNumber((existing as any)?.lockedProfit ?? 0),
                lockedSold: toNumber((existing as any)?.lockedSold ?? 0),
                note: item.note ?? (existing as any)?.note ?? "",
                createdAt: (existing as any)?.createdAt ?? now,
                updatedAt: now,
              },
              session,
            );

            await productRepository.updateById(
              actor.userId,
              (product as any)._id.toString(),
              {
                quantity: item.currentQuantity,
                updatedAt: now,
              },
              session,
            );

            const action = existing ? "UPDATE" : "START_DAY";
            await auditService.log({
              ownerAdminId: actor.userId,
              action,
              entityType: "inventory",
              entityId: item.productId,
              before: existing
                ? { currentQuantity: (existing as any).currentQuantity }
                : undefined,
              after: { productId: item.productId, date: targetDate, startQuantity, currentQuantity: item.currentQuantity },
              source: "rest",
              createdBy: actor.userId,
            });

            return buildInventoryResponse(
              {
                ...product.toJSON(),
                quantity: item.currentQuantity,
                updatedAt: now.toISOString(),
              },
              updated,
            );
          }),
        );
        return items;
      });

      telegramReportService.reportInventoryUpdated(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
        items: results.map((entry) => ({
          productName: entry.product?.name,
          startQuantity: toNumber(entry.startQuantity),
          currentQuantity: toNumber(entry.currentQuantity),
          sold: toNumber(entry.sold),
        })),
      });

      await snapshotService.createOrUpdate(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
      });

      return results;
    } finally {
      await session.endSession();
    }
  }

  async sales(actor: AuthUser, payload: {
    date?: string;
    deviceId: string;
    lines: Array<{ productId: string; quantity: number }>;
  }) {
    const { targetDate } = this.getAllowedDate(actor, payload.date);
    const now = new Date();

    const session = await mongoose.startSession();
    try {
      const items = await session.withTransaction(async () => {
        const productIds = payload.lines.map((l) => l.productId);
        const products = await productRepository.findByIdentifiers(
          actor.userId,
          productIds,
          session,
        );
        const productMap = new Map<string, any>();
        for (const p of products) {
          productMap.set(p.localId, p);
          productMap.set(p._id.toString(), p);
        }

        const results = await Promise.all(
          payload.lines.map(async (line) => {
            const product = productMap.get(line.productId);
            if (!product) {
              throw new AppError(`Product not found: ${line.productId}`, 404);
            }

            const existing = await inventoryRepository.findByProductAndDate(
              actor.userId,
              (product as any).localId,
              targetDate,
              session,
            );

            const productQty = toNumber((product as any).quantity ?? 0);
            const startQty = existing
              ? toNumber((existing as any).startQuantity)
              : productQty;
            const currentQty = existing
              ? toNumber((existing as any).currentQuantity)
              : productQty;

            if (line.quantity > currentQty) {
              throw new AppError(
                `Sotilgan miqdor (${line.quantity}) qoldiqdan (${currentQty}) ko'p bo'lishi mumkin emas`,
                422,
              );
            }

            const newCurrent = currentQty - line.quantity;

            const updated = await inventoryRepository.upsertByProductAndDateWithSession(
              actor.userId,
              (product as any).localId,
              targetDate,
              {
                localId:
                  (existing as any)?.localId ??
                  `${targetDate}-${(product as any).localId}`,
                deviceId: payload.deviceId,
                productId: (product as any).localId,
                productName: product.name ?? "",
                date: targetDate,
                startQuantity: startQty,
                currentQuantity: newCurrent,
                buyPrice: toNumber((existing as any)?.buyPrice ?? product.buyPrice ?? 0),
                sellPrice: toNumber((existing as any)?.sellPrice ?? product.sellPrice ?? 0),
                lockedRevenue: toNumber((existing as any)?.lockedRevenue ?? 0),
                lockedProfit: toNumber((existing as any)?.lockedProfit ?? 0),
                lockedSold: toNumber((existing as any)?.lockedSold ?? 0),
                note: (existing as any)?.note ?? "",
                createdAt: (existing as any)?.createdAt ?? now,
                updatedAt: now,
              },
              session,
            );

            await productRepository.updateById(
              actor.userId,
              (product as any)._id.toString(),
              { quantity: newCurrent, updatedAt: now },
              session,
            );

            await auditService.log({
              ownerAdminId: actor.userId,
              action: "UPDATE",
              entityType: "inventory",
              entityId: line.productId,
              before: existing
                ? { currentQuantity: (existing as any).currentQuantity }
                : undefined,
              after: { productId: line.productId, date: targetDate, currentQuantity: newCurrent, sold: line.quantity },
              source: "rest",
              createdBy: actor.userId,
            });

            return buildInventoryResponse(
              {
                ...product.toJSON(),
                quantity: newCurrent,
                updatedAt: now.toISOString(),
              },
              updated,
            );
          }),
        );

        return results;
      });

      await snapshotService.createOrUpdate(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
      });

      const snapshot = await snapshotService.getDaily(actor, targetDate);

      telegramReportService.reportInventoryUpdated(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
        items: items.map((entry) => ({
          productName: entry.product?.name,
          startQuantity: toNumber(entry.startQuantity),
          currentQuantity: toNumber(entry.currentQuantity),
          sold: toNumber(entry.sold),
        })),
      });

      return { items, snapshot };
    } finally {
      await session.endSession();
    }
  }

  async getDashboard(actor: AuthUser) {
    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);

    const [products, inventoryResult, snapshot] = await Promise.all([
      productRepository.findAllByOwner(actor.userId),
      this.getByDate(actor, today, today),
      snapshotService.getDaily(actor, today),
    ]);

    return {
      products,
      inventory: inventoryResult.items,
      inventorySummary: inventoryResult.summary,
      snapshot,
    };
  }
}

export const inventoryService = new InventoryService();
