import mongoose from "mongoose";

import { env } from "../../config/env";
import type { Product } from "../../types/domain";
import { AppError } from "../../utils/app-error";
import { createLocalId } from "../../utils/ids";
import { getBusinessDateFromTimestamp, getCurrentBusinessDate, getEffectiveHour } from "../../utils/business-day";
import { normalizeQuantity, normalizeUnit, roundQty } from "../../utils/quantity";
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

    // The unit decides what a quantity may even look like, so resolve it
    // before anything touches payload.quantity: "dona" snaps to a whole
    // number, "kg" keeps its 3 decimals.
    const unit = normalizeUnit(payload.unit);
    const quantity = normalizeQuantity(Number(payload.quantity ?? 0), unit);

    let displayIndex = payload.displayIndex;
    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);

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

        if (payload.barcodes?.length) {
          for (const code of payload.barcodes) {
            if (!code) continue;
            const existingBarcode = await productRepository.findByBarcode(actor.userId, code, session);
            if (existingBarcode) {
              throw new AppError(
                `"${existingBarcode.name}" mahsuloti allaqachon bu barcode dan foydalanmoqda`,
                409,
              );
            }
          }
        }

        let localId = payload.localId ?? createLocalId("prd", payload.deviceId);

        let p: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            p = await productRepository.create({
              ownerAdminId: actor.userId,
              localId,
              deviceId: payload.deviceId,
              name: payload.name,
              quantity,
              unit,
              buyPrice: payload.buyPrice,
              sellPrice: payload.sellPrice,
              displayIndex,
              image: storedImage ?? "",
              barcodes: payload.barcodes,
              createdAt: payload.createdAt ? new Date(payload.createdAt) : timestamp,
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : timestamp
            }, session);
            break;
          } catch (err: any) {
            // Note: displayIndex is no longer a unique index (see product.model.ts),
            // so a displayIndex-specific retry branch here would be dead code.
            if (err?.code === 11000 && err?.message?.includes("barcodes")) {
              // The pre-check above and this insert aren't atomic against a
              // concurrent request; the unique index is the real guard here.
              // Surface a clean error instead of the raw duplicate-key exception.
              throw new AppError(
                "Ushbu barcode allaqachon boshqa mahsulotda ishlatilmoqda",
                409,
              );
            }
            if (err?.code === 11000 && err?.message?.includes("localId") && !payload.localId && attempt < 2) {
              localId = createLocalId("prd", payload.deviceId);
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
            productName: payload.name,
            unit,
            date: today,
            startQuantity: quantity,
            currentQuantity: quantity,
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
            after: { name: payload.name, quantity, unit, buyPrice: payload.buyPrice, sellPrice: payload.sellPrice },
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
        unit: (product as any).unit,
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
    // Switching a product to "dona" must also make its existing stock
    // countable — otherwise a 2.5 kg product silently keeps a half piece.
    const nextUnit = normalizeUnit(payload.unit ?? (product as any).unit);
    const nextQuantity = normalizeQuantity(
      Number(payload.quantity ?? (product as any).quantity ?? 0),
      nextUnit,
    );
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
      unit: nextUnit,
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

    if (payload.barcodes !== undefined) {
      updatePayload.barcodes = payload.barcodes;
    }

    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);

    const session = await mongoose.startSession();
    try {
      const updatedProduct = await session.withTransaction(async () => {
        if (payload.barcodes?.length) {
          for (const code of payload.barcodes) {
            if (!code) continue;
            const existingBarcode = await productRepository.findByBarcode(actor.userId, code, session);
            if (existingBarcode && existingBarcode.localId !== (product as any).localId) {
              throw new AppError(
                `"${existingBarcode.name}" mahsuloti allaqachon bu barcode dan foydalanmoqda`,
                409,
              );
            }
          }
        }

        let up: any;
        try {
          up = await productRepository.updateById(
            actor.userId,
            (product as any)._id.toString(),
            updatePayload,
            session
          );
        } catch (err: any) {
          if (err?.code === 11000 && err?.message?.includes("barcodes")) {
            // The pre-check above and this write aren't atomic against a
            // concurrent request; the unique index is the real guard here.
            // Surface a clean error instead of the raw duplicate-key exception.
            throw new AppError(
              "Ushbu barcode allaqachon boshqa mahsulotda ishlatilmoqda",
              409,
            );
          }
          throw err;
        }

        const inventoryEntry = await inventoryRepository.findByProductAndDate(actor.userId, (product as any).localId, today, session);

        if (inventoryEntry) {
          const adjusted = getAdjustedInventoryQuantities(
            inventoryEntry.startQuantity,
            inventoryEntry.currentQuantity,
            nextQuantity
          );

          const oldSellPrice = Number((inventoryEntry as any).sellPrice ?? 0);
          const oldBuyPrice = Number((inventoryEntry as any).buyPrice ?? 0);
          let lockedRev = Number((inventoryEntry as any).lockedRevenue ?? 0);
          let lockedProf = Number((inventoryEntry as any).lockedProfit ?? 0);
          let lockedS = Number((inventoryEntry as any).lockedSold ?? 0);
          let startQ = adjusted.startQuantity;
          let currentQ = adjusted.currentQuantity;
          let saveSellPrice = oldSellPrice;
          let saveBuyPrice = oldBuyPrice;

          const userChangedSellPrice = payload.sellPrice !== undefined && nextSellPrice !== oldSellPrice;
          // Mirrors the sellPrice-correction handling above: an admin correcting the
          // cost basis mid-day must not silently rewrite profit for units already
          // sold today. Lock in revenue/profit for units sold so far using the
          // entry's pre-correction prices, then let the corrected price(s) apply
          // prospectively from this point forward.
          const userChangedBuyPrice = payload.buyPrice !== undefined && nextBuyPrice !== oldBuyPrice;
          if (userChangedSellPrice || userChangedBuyPrice) {
            const sold = adjusted.soldSoFar;
            if (sold > 0) {
              lockedRev += sold * oldSellPrice;
              lockedProf += sold * (oldSellPrice - oldBuyPrice);
              lockedS += sold;
              startQ = adjusted.currentQuantity;
              currentQ = adjusted.currentQuantity;
            }
            if (userChangedSellPrice) saveSellPrice = nextSellPrice;
            if (userChangedBuyPrice) saveBuyPrice = nextBuyPrice;
          }

          await inventoryRepository.upsertByProductAndDateWithSession(actor.userId, (product as any).localId, today, {
            localId: (inventoryEntry as any).localId,
            deviceId: payload.deviceId ?? (inventoryEntry as any).deviceId,
            productId: (product as any).localId,
            productName: payload.name ?? (product as any).name,
            unit: nextUnit,
            date: today,
            startQuantity: startQ,
            currentQuantity: currentQ,
            buyPrice: saveBuyPrice,
            sellPrice: saveSellPrice,
            lockedRevenue: lockedRev,
            lockedProfit: lockedProf,
            lockedSold: lockedS,
            note: (inventoryEntry as any).note ?? "",
            createdAt: (inventoryEntry as any).createdAt,
            updatedAt
          }, session);
        } else {
          await inventoryRepository.upsertByProductAndDateWithSession(actor.userId, (product as any).localId, today, {
            localId: `${today}-${(product as any).localId}`,
            deviceId: payload.deviceId ?? (product as any).deviceId,
            productId: (product as any).localId,
            productName: payload.name ?? (product as any).name,
            unit: nextUnit,
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
          before: { quantity: (product as any).quantity, unit: normalizeUnit((product as any).unit), buyPrice: (product as any).buyPrice, sellPrice: (product as any).sellPrice },
          after: { quantity: nextQuantity, unit: nextUnit, buyPrice: nextBuyPrice, sellPrice: nextSellPrice },
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
          unit: (updatedProduct as any).unit,
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

  async restock(actor: AuthUser, identifier: string, deltaQuantity: number) {
    const product = await this.getByIdentifier(actor, identifier);

    if (typeof deltaQuantity !== "number" || !Number.isFinite(deltaQuantity) || deltaQuantity <= 0) {
      throw new AppError("deltaQuantity must be a positive number", 422);
    }

    const unit = normalizeUnit((product as any).unit);
    const delta = normalizeQuantity(deltaQuantity, unit);
    if (delta <= 0) {
      throw new AppError(
        unit === "kg"
          ? "Qo'shiladigan miqdor 0 dan katta bo'lishi kerak"
          : "Qo'shiladigan miqdor kamida 1 dona bo'lishi kerak",
        422,
      );
    }

    const updatedAt = new Date();
    const businessHour = getEffectiveHour(actor);
    const today = getCurrentBusinessDate(businessHour, env.TIMEZONE_OFFSET);

    const session = await mongoose.startSession();
    try {
      const updatedProduct = await session.withTransaction(async () => {
        const up = await productRepository.incrementQuantity(
          actor.userId,
          (product as any)._id.toString(),
          delta,
          session
        );

        if (!up) {
          throw new AppError("Product not found", 404);
        }

        const inventoryEntry = await inventoryRepository.incrementQuantitiesByProductAndDate(
          actor.userId,
          (product as any).localId,
          today,
          delta,
          session
        );

        if (!inventoryEntry) {
          await inventoryRepository.upsertByProductAndDateWithSession(actor.userId, (product as any).localId, today, {
            localId: `${today}-${(product as any).localId}`,
            deviceId: (product as any).deviceId,
            productId: (product as any).localId,
            productName: (product as any).name,
            unit,
            date: today,
            startQuantity: roundQty((up as any).quantity),
            currentQuantity: roundQty((up as any).quantity),
            buyPrice: Number((up as any).buyPrice || 0),
            sellPrice: Number((up as any).sellPrice || 0),
            note: "",
            createdAt: updatedAt,
            updatedAt
          }, session);
        }

        await auditService.log({
          ownerAdminId: actor.userId,
          action: "RESTOCK",
          entityType: "product",
          entityId: (product as any).localId,
          before: { quantity: (product as any).quantity, unit },
          after: { quantity: (up as any).quantity, delta, unit },
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
          unit: (updatedProduct as any).unit,
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

    await inventoryRepository.updateProductNameByProductId(
      actor.userId,
      (product as any).localId,
      (product as any).name ?? "O'chirilgan mahsulot",
    );

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
    // Must go through TIMEZONE_OFFSET like every other business-date
    // computation (see inventory.service.ts's isProductVisibleOnDate) —
    // omitting it resolves the boundary in raw UTC instead of the business's
    // local time, which can misclassify products created near the day
    // boundary by up to the offset's width (5h for TIMEZONE_OFFSET=300).
    const createdBusinessDate = getBusinessDateFromTimestamp(
      product.createdAt,
      hour,
      env.TIMEZONE_OFFSET
    );

    return createdBusinessDate <= date;
  }
}

export const productService = new ProductService();
