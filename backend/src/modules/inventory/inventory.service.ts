import { env } from "../../config/env";
import { AppError } from "../../utils/app-error";
import {
  assertNotFutureDayKey,
  compareDayKeys,
  getCurrentBusinessDate,
  isPastBusinessDate
} from "../../utils/business-day";
import { createLocalId } from "../../utils/ids";
import type { AuthUser } from "../auth/auth.types";
import { productRepository } from "../products/product.repository";
import { productService } from "../products/product.service";
import {
  calculateSold,
  deriveMissingInventoryEntry
} from "./inventory.logic";
import { inventoryRepository } from "./inventory.repository";

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

export class InventoryService {
  private getAllowedDate(date?: string) {
    const currentBusinessDate = getCurrentBusinessDate(env.BUSINESS_DAY_START_HOUR);
    const targetDate = date ?? currentBusinessDate;

    assertNotFutureDayKey(targetDate, currentBusinessDate, "Inventory cannot be created for a future date");

    if (isPastBusinessDate(targetDate, currentBusinessDate)) {
      throw new AppError("Past business days cannot be edited", 409);
    }

    return { targetDate, currentBusinessDate };
  }

  async getByDate(actor: AuthUser, date: string) {
    const currentBusinessDate = getCurrentBusinessDate(env.BUSINESS_DAY_START_HOUR);
    assertNotFutureDayKey(date, currentBusinessDate, "Future inventory dates are not allowed");

    const [entries, products] = await Promise.all([
      inventoryRepository.findByDate(actor.userId, date),
      productRepository.findAllByOwner(actor.userId)
    ]);

    const visibleProducts = products.filter((product) =>
      productService.isVisibleForBusinessDate(product as any, date)
    );

    const entryMap = new Map(entries.map((entry) => [entry.productId, entry]));

    return visibleProducts.map((product) => {
      const inventory =
        entryMap.get((product as any).localId) ??
        deriveMissingInventoryEntry(product.toJSON() as any, date);
      const inventoryJson = typeof (inventory as any).toJSON === "function"
        ? (inventory as any).toJSON()
        : inventory;

      return {
        ...inventoryJson,
        sold: calculateSold(
          Number((inventory as any).startQuantity),
          Number((inventory as any).currentQuantity)
        ),
        product: product.toJSON()
      };
    });
  }

  async getRange(actor: AuthUser, from: string, to: string) {
    if (compareDayKeys(from, to) > 0) {
      throw new AppError("from must be less than or equal to to", 422);
    }

    const [entries, products] = await Promise.all([
      inventoryRepository.findRange(actor.userId, from, to),
      productRepository.findAllByOwner(actor.userId)
    ]);

    const productMap = new Map(products.map((product) => [product.localId, product]));

    return entries.map((entry) => ({
      ...entry.toJSON(),
      sold: calculateSold(Number((entry as any).startQuantity), Number((entry as any).currentQuantity)),
      product: productMap.get(entry.productId)?.toJSON() ?? null
    }));
  }

  async startDay(actor: AuthUser, payload: StartDayInput) {
    const { targetDate } = this.getAllowedDate(payload.date);
    const now = new Date();
    const products = await productRepository.findByIdentifiers(
      actor.userId,
      payload.items.map((item) => item.productId)
    );
    const productMap = new Map<string, any>();

    for (const product of products) {
      productMap.set(product.localId, product);
      productMap.set(product._id.toString(), product);
    }

    return Promise.all(
      payload.items.map(async (item) => {
        const product = productMap.get(item.productId);

        if (!product || product.isDeleted) {
          throw new AppError(`Active product not found for productId=${item.productId}`, 404);
        }

        const startQuantity = item.startQuantity;
        const currentQuantity = item.currentQuantity ?? item.startQuantity;

        if (currentQuantity > startQuantity) {
          throw new AppError("currentQuantity cannot be greater than startQuantity", 422);
        }

        const entry = await inventoryRepository.upsertByProductAndDate(actor.userId, (product as any).localId, targetDate, {
          localId: item.localId ?? createLocalId("inv", `${product.localId}_${targetDate}`),
          deviceId: payload.deviceId,
          productId: (product as any).localId,
          date: targetDate,
          startQuantity,
          currentQuantity,
          note: item.note ?? "",
          isDeleted: false,
          createdAt: item.createdAt ? new Date(item.createdAt) : now,
          updatedAt: item.updatedAt ? new Date(item.updatedAt) : now
        });

        await productRepository.updateById(actor.userId, (product as any)._id.toString(), {
          quantity: currentQuantity,
          updatedAt: now
        });

        return {
          ...entry?.toJSON(),
          sold: calculateSold(startQuantity, currentQuantity),
          product: {
            ...product.toJSON(),
            quantity: currentQuantity,
            updatedAt: now.toISOString()
          }
        };
      })
    );
  }

  async bulkUpdateCurrent(actor: AuthUser, payload: BulkCurrentInput) {
    const { targetDate } = this.getAllowedDate(payload.date);
    const now = new Date();
    const products = await productRepository.findByIdentifiers(
      actor.userId,
      payload.items.map((item) => item.productId)
    );
    const productMap = new Map<string, any>();

    for (const product of products) {
      productMap.set(product.localId, product);
      productMap.set(product._id.toString(), product);
    }

    return Promise.all(
      payload.items.map(async (item) => {
        const product = productMap.get(item.productId);

        if (!product || product.isDeleted) {
          throw new AppError(`Active product not found for productId=${item.productId}`, 404);
        }

        const existing = await inventoryRepository.findByProductAndDate(actor.userId, (product as any).localId, targetDate);

        if (!existing) {
          throw new AppError(
            `Inventory start entry not found for productId=${item.productId} and date=${targetDate}`,
            404
          );
        }

        if (item.currentQuantity > existing.startQuantity) {
          throw new AppError("currentQuantity cannot be greater than startQuantity", 422);
        }

        const updated = await inventoryRepository.upsertByProductAndDate(actor.userId, (product as any).localId, targetDate, {
          localId: (existing as any).localId,
          deviceId: payload.deviceId,
          productId: (product as any).localId,
          date: targetDate,
          startQuantity: Number((existing as any).startQuantity),
          currentQuantity: item.currentQuantity,
          note: item.note ?? ((existing as any).note ?? ""),
          isDeleted: false,
          createdAt: (existing as any).createdAt,
          updatedAt: now
        });

        await productRepository.updateById(actor.userId, (product as any)._id.toString(), {
          quantity: item.currentQuantity,
          updatedAt: now
        });

        return {
          ...updated?.toJSON(),
          sold: calculateSold(Number((existing as any).startQuantity), item.currentQuantity),
          product: {
            ...product.toJSON(),
            quantity: item.currentQuantity,
            updatedAt: now.toISOString()
          }
        };
      })
    );
  }
}

export const inventoryService = new InventoryService();
