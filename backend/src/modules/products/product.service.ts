import mongoose from "mongoose";

import { env } from "../../config/env";
import type { Product } from "../../types/domain";
import { AppError } from "../../utils/app-error";
import { createLocalId } from "../../utils/ids";
import { getBusinessDateFromTimestamp, getCurrentBusinessDate, getEffectiveHour } from "../../utils/business-day";
import { telegramReportService } from "../../services/telegram-report.service";
import type { AuthUser } from "../auth/auth.types";
import { auditService } from "../audit/audit.service";
import { inventoryRepository } from "../inventory/inventory.repository";
import { getAdjustedInventoryQuantities } from "../inventory/inventory.logic";
import { normalizeProductImage, processAndStoreProductImage } from "./product-image";
import { productRepository } from "./product.repository";

type CreateProductInput = Omit<Product, "id" | "createdAt" | "updatedAt"> & {
  localId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type UpdateProductInput = Partial<CreateProductInput>;

export class ProductService {
  async getAll(actor: AuthUser, search?: string) {
    return productRepository.findActive(actor.userId, search);
  }

  async getByIdentifier(actor: AuthUser, identifier: string) {
    const product = await productRepository.findByIdentifier(actor.userId, identifier);

    if (!product) {
      throw new AppError("Product not found", 404);
    }

    return product;
  }

  async create(actor: AuthUser, payload: CreateProductInput) {
    const timestamp = payload.createdAt ? new Date(payload.createdAt) : new Date();
    const normalizedImage = normalizeProductImage(payload.image);
    let storedImage: string | undefined;
    try {
      storedImage = await processAndStoreProductImage(normalizedImage);
    } catch {
      storedImage = normalizedImage;
    }

    let displayIndex = payload.displayIndex;
    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour);

    const session = await mongoose.startSession();
    try {
      const product = await session.withTransaction(async () => {
        if (actor.tier === "bor") {
          const activeCount = await productRepository.countActive(actor.userId, session);
          if (activeCount >= 100) {
            throw new AppError(
              "Bor tarifida maksimal 100 ta mahsulot yaratish mumkin. Pro tarifiga o'tish uchun administrator bilan bog'laning.",
              403
            );
          }
        }

        if (displayIndex === undefined || displayIndex === null) {
          displayIndex = await productRepository.getNextDisplayIndex(actor.userId, session);
        }

        let p: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            p = await productRepository.create({
              ownerAdminId: actor.userId,
              localId: payload.localId ?? createLocalId("prd", payload.deviceId),
              deviceId: payload.deviceId,
              name: payload.name,
              quantity: payload.quantity,
              buyPrice: payload.buyPrice,
              sellPrice: payload.sellPrice,
              displayIndex,
              image: storedImage ?? "",
              createdAt: payload.createdAt ? new Date(payload.createdAt) : timestamp,
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : timestamp
            }, session);
            break;
          } catch (err: any) {
            if (err?.code === 11000 && attempt < 2) {
              displayIndex = await productRepository.getNextDisplayIndex(actor.userId, session);
              continue;
            }
            throw err;
          }
        }

        if ((p as any).localId) {
          await inventoryRepository.upsertByProductAndDateWithSession(actor.userId, (p as any).localId, today, {
            localId: `${today}-${(p as any).localId}`,
            deviceId: payload.deviceId,
            productId: (p as any).localId,
            date: today,
            startQuantity: payload.quantity,
            currentQuantity: payload.quantity,
            buyPrice: Number(payload.buyPrice || 0),
            sellPrice: Number(payload.sellPrice || 0),
            note: "",
            createdAt: timestamp,
            updatedAt: timestamp
          }, session);

          await auditService.log({
            ownerAdminId: actor.userId,
            action: "CREATE",
            entityType: "product",
            entityId: (p as any).localId,
            after: { name: payload.name, quantity: payload.quantity, buyPrice: payload.buyPrice, sellPrice: payload.sellPrice },
            source: "rest",
            createdBy: actor.userId,
          });
        }

        return p;
      });

      telegramReportService.reportProductCreated(actor, {
        localId: (product as any).localId,
        name: (product as any).name,
        quantity: (product as any).quantity,
        buyPrice: (product as any).buyPrice,
        sellPrice: (product as any).sellPrice,
        deviceId: (product as any).deviceId
      });

      return product;
    } finally {
      await session.endSession();
    }
  }

  async update(actor: AuthUser, identifier: string, payload: UpdateProductInput) {
    const product = await this.getByIdentifier(actor, identifier);

    const updatedAt = payload.updatedAt ? new Date(payload.updatedAt) : new Date();
    const nextQuantity = payload.quantity ?? (product as any).quantity;
    const nextBuyPrice = payload.buyPrice ?? (product as any).buyPrice;
    const nextSellPrice = payload.sellPrice ?? (product as any).sellPrice;
    const normalizedImage = normalizeProductImage(payload.image);
    let storedImage: string | undefined;
    try {
      storedImage = await processAndStoreProductImage(normalizedImage);
    } catch {
      storedImage = normalizedImage;
    }

    if (nextSellPrice < nextBuyPrice) {
      throw new AppError("sellPrice must be greater than or equal to buyPrice", 422);
    }

    const updatePayload: Record<string, unknown> = {
      deviceId: payload.deviceId ?? (product as any).deviceId,
      name: payload.name ?? (product as any).name,
      quantity: nextQuantity,
      buyPrice: nextBuyPrice,
      sellPrice: nextSellPrice,
      image:
        payload.image !== undefined
          ? storedImage ?? (product as any).image ?? ""
          : (product as any).image ?? "",
      updatedAt
    };

    if (payload.displayIndex !== undefined) {
      updatePayload.displayIndex = payload.displayIndex;
    }

    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour);

    const session = await mongoose.startSession();
    try {
      const updatedProduct = await session.withTransaction(async () => {
        const up = await productRepository.updateById(
          actor.userId,
          (product as any)._id.toString(),
          updatePayload,
          session
        );

        const inventoryEntry = await inventoryRepository.findByProductAndDate(actor.userId, (product as any).localId, today, session);

        if (inventoryEntry) {
          const adjusted = getAdjustedInventoryQuantities(
            inventoryEntry.startQuantity,
            inventoryEntry.currentQuantity,
            nextQuantity
          );

          await inventoryRepository.upsertByProductAndDateWithSession(actor.userId, (product as any).localId, today, {
            localId: (inventoryEntry as any).localId,
            deviceId: payload.deviceId ?? (product as any).deviceId,
            productId: (product as any).localId,
            date: today,
            startQuantity: adjusted.startQuantity,
            currentQuantity: adjusted.currentQuantity,
            note: (inventoryEntry as any).note ?? "",
            createdAt: (inventoryEntry as any).createdAt,
            updatedAt
          }, session);
        } else {
          await inventoryRepository.upsertByProductAndDateWithSession(actor.userId, (product as any).localId, today, {
            localId: `${today}-${(product as any).localId}`,
            deviceId: payload.deviceId ?? (product as any).deviceId,
            productId: (product as any).localId,
            date: today,
            startQuantity: nextQuantity,
            currentQuantity: nextQuantity,
            buyPrice: Number(nextBuyPrice || 0),
            sellPrice: Number(nextSellPrice || 0),
            note: "",
              createdAt: updatedAt,
            updatedAt
          }, session);
        }

        await auditService.log({
          ownerAdminId: actor.userId,
          action: "UPDATE",
          entityType: "product",
          entityId: (product as any).localId,
          before: { quantity: (product as any).quantity, buyPrice: (product as any).buyPrice, sellPrice: (product as any).sellPrice },
          after: { quantity: nextQuantity, buyPrice: nextBuyPrice, sellPrice: nextSellPrice },
          source: "rest",
          createdBy: actor.userId,
        });

        return up;
      });

      if (updatedProduct) {
        telegramReportService.reportProductUpdated(actor, {
          localId: (updatedProduct as any).localId,
          name: (updatedProduct as any).name,
          quantity: (updatedProduct as any).quantity,
          buyPrice: (updatedProduct as any).buyPrice,
          sellPrice: (updatedProduct as any).sellPrice,
          deviceId: (updatedProduct as any).deviceId
        });
      }

      return updatedProduct;
    } finally {
      await session.endSession();
    }
  }

  async remove(actor: AuthUser, identifier: string) {
    const product = await this.getByIdentifier(actor, identifier);

    await productRepository.deleteById(actor.userId, product._id?.toString() || (product as any).id);

    telegramReportService.reportProductDeleted(actor, {
      localId: (product as any).localId,
      name: (product as any).name
    });

    return product;
  }

  isVisibleForBusinessDate(
    product: {
      createdAt: Date | string;
    },
    date: string,
    businessDayStartHour?: number
  ) {
    const hour = businessDayStartHour ?? env.BUSINESS_DAY_START_HOUR;
    const createdBusinessDate = getBusinessDateFromTimestamp(
      product.createdAt,
      hour
    );

    return createdBusinessDate <= date;
  }
}

export const productService = new ProductService();
