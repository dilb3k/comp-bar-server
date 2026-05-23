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
import { inventoryRepository } from "./inventory.repository";
import {
  calculateInventoryMetrics,
  deriveMissingInventoryEntry,
  aggregateInventory,
  aggregateInventoryForRange,
} from "./inventory.logic";

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

  const storedBuyPrice = Number(inventoryJson?.buyPrice ?? 0);
  const storedSellPrice = Number(inventoryJson?.sellPrice ?? 0);
  const effectiveBuyPrice = storedBuyPrice > 0 ? storedBuyPrice : Number(productJson?.buyPrice || 0);
  const effectiveSellPrice = storedSellPrice > 0 ? storedSellPrice : Number(productJson?.sellPrice || 0);

  const metrics = calculateInventoryMetrics({
    startQuantity: Number(inventoryJson?.startQuantity ?? 0),
    currentQuantity: Number(inventoryJson?.currentQuantity ?? 0),
    buyPrice: effectiveBuyPrice,
    sellPrice: effectiveSellPrice,
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
        const storedBuyPrice = Number(entry.buyPrice ?? 0);
        const storedSellPrice = Number(entry.sellPrice ?? 0);
        return {
          ...entry.toJSON(),
          ...calculateInventoryMetrics({
            startQuantity: Number(entry.startQuantity),
            currentQuantity: Number(entry.currentQuantity),
            buyPrice: storedBuyPrice,
            sellPrice: storedSellPrice,
          }),
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
        const storedBuyPrice = Number(entry.buyPrice ?? 0);
        const storedSellPrice = Number(entry.sellPrice ?? 0);
        return {
          ...entry.toJSON(),
          ...calculateInventoryMetrics({
            startQuantity: Number(entry.startQuantity),
            currentQuantity: Number(entry.currentQuantity),
            buyPrice: storedBuyPrice,
            sellPrice: storedSellPrice,
          }),
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

        const items = await Promise.all(
          payload.items.map(async (item) => {
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
                date: targetDate,
                startQuantity,
                currentQuantity,
                buyPrice: Number(product.buyPrice || 0),
                sellPrice: Number(product.sellPrice || 0),
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

            return buildInventoryResponse(
              {
                ...product.toJSON(),
                quantity: currentQuantity,
                updatedAt: now.toISOString(),
              },
              entry,
            );
          }),
        );
        return items;
      });

      telegramReportService.reportInventoryStarted(actor, {
        date: targetDate,
        deviceId: payload.deviceId,
        items: results.map((entry) => ({
          productName: entry.product?.name,
          startQuantity: Number(entry.startQuantity),
          currentQuantity: Number(entry.currentQuantity),
          sold: Number(entry.sold),
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

            if (!existing) {
              throw new AppError(
                `Inventory start entry not found for productId=${item.productId} and date=${targetDate}`,
                404,
              );
            }

            if (item.currentQuantity > existing.startQuantity) {
              throw new AppError(
                "currentQuantity cannot be greater than startQuantity",
                422,
              );
            }

            const updated = await inventoryRepository.upsertByProductAndDateWithSession(
              actor.userId,
              (product as any).localId,
              targetDate,
              {
                localId: (existing as any).localId,
                deviceId: payload.deviceId,
                productId: (product as any).localId,
                date: targetDate,
                startQuantity: Number((existing as any).startQuantity),
                currentQuantity: item.currentQuantity,
                buyPrice: Number((existing as any).buyPrice ?? product.buyPrice ?? 0),
                sellPrice: Number((existing as any).sellPrice ?? product.sellPrice ?? 0),
                note: item.note ?? (existing as any).note ?? "",
                createdAt: (existing as any).createdAt,
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

            await auditService.log({
              ownerAdminId: actor.userId,
              action: "UPDATE",
              entityType: "inventory",
              entityId: item.productId,
              before: { currentQuantity: (existing as any).currentQuantity },
              after: { currentQuantity: item.currentQuantity },
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
          startQuantity: Number(entry.startQuantity),
          currentQuantity: Number(entry.currentQuantity),
          sold: Number(entry.sold),
        })),
      });

      return results;
    } finally {
      await session.endSession();
    }
  }
}

export const inventoryService = new InventoryService();
