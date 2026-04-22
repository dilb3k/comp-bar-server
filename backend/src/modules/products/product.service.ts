import { env } from "../../config/env";
import type { Product } from "../../types/domain";
import { AppError } from "../../utils/app-error";
import { createLocalId } from "../../utils/ids";
import { getBusinessDateFromTimestamp, getCurrentBusinessDate } from "../../utils/business-day";
import type { AuthUser } from "../auth/auth.types";
import { inventoryRepository } from "../inventory/inventory.repository";
import { getAdjustedInventoryQuantities } from "../inventory/inventory.logic";
import { productRepository } from "./product.repository";

type CreateProductInput = Omit<Product, "id" | "createdAt" | "updatedAt" | "isDeleted"> & {
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
    const product = await productRepository.create({
      ownerAdminId: actor.userId,
      localId: payload.localId ?? createLocalId("prd", payload.deviceId),
      deviceId: payload.deviceId,
      name: payload.name,
      quantity: payload.quantity,
      buyPrice: payload.buyPrice,
      sellPrice: payload.sellPrice,
      image: payload.image ?? "",
      isDeleted: false,
      createdAt: payload.createdAt ? new Date(payload.createdAt) : timestamp,
      updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : timestamp
    });

    const today = getCurrentBusinessDate(env.BUSINESS_DAY_START_HOUR);

    await inventoryRepository.upsertByProductAndDate(actor.userId, (product as any).localId, today, {
      localId: createLocalId("inv", `${(product as any).localId}_${today}`),
      deviceId: payload.deviceId,
      productId: (product as any).localId,
      date: today,
      startQuantity: payload.quantity,
      currentQuantity: payload.quantity,
      note: "",
      isDeleted: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return product;
  }

  async update(actor: AuthUser, identifier: string, payload: UpdateProductInput) {
    const product = await this.getByIdentifier(actor, identifier);

    if (product.isDeleted) {
      throw new AppError("Deleted product cannot be updated", 409);
    }

    const updatedAt = payload.updatedAt ? new Date(payload.updatedAt) : new Date();
    const nextQuantity = payload.quantity ?? (product as any).quantity;
    const nextBuyPrice = payload.buyPrice ?? (product as any).buyPrice;
    const nextSellPrice = payload.sellPrice ?? (product as any).sellPrice;

    if (nextSellPrice < nextBuyPrice) {
      throw new AppError("sellPrice must be greater than or equal to buyPrice", 422);
    }

    const updatedProduct = await productRepository.updateById(actor.userId, (product as any)._id.toString(), {
      deviceId: payload.deviceId ?? (product as any).deviceId,
      name: payload.name ?? (product as any).name,
      quantity: nextQuantity,
      buyPrice: nextBuyPrice,
      sellPrice: nextSellPrice,
      image: payload.image ?? (product as any).image ?? "",
      updatedAt
    });

    const today = getCurrentBusinessDate(env.BUSINESS_DAY_START_HOUR);
    const inventoryEntry = await inventoryRepository.findByProductAndDate(actor.userId, (product as any).localId, today);

    if (inventoryEntry) {
      const adjusted = getAdjustedInventoryQuantities(
        inventoryEntry.startQuantity,
        inventoryEntry.currentQuantity,
        nextQuantity
      );

      await inventoryRepository.upsertByProductAndDate(actor.userId, (product as any).localId, today, {
        localId: (inventoryEntry as any).localId,
        deviceId: payload.deviceId ?? (product as any).deviceId,
        productId: (product as any).localId,
        date: today,
        startQuantity: adjusted.startQuantity,
        currentQuantity: adjusted.currentQuantity,
        note: (inventoryEntry as any).note ?? "",
        isDeleted: false,
        createdAt: (inventoryEntry as any).createdAt,
        updatedAt
      });
    } else {
      await inventoryRepository.upsertByProductAndDate(actor.userId, (product as any).localId, today, {
        localId: createLocalId("inv", `${(product as any).localId}_${today}`),
        deviceId: payload.deviceId ?? (product as any).deviceId,
        productId: (product as any).localId,
        date: today,
        startQuantity: nextQuantity,
        currentQuantity: nextQuantity,
        note: "",
        isDeleted: false,
        createdAt: updatedAt,
        updatedAt
      });
    }

    return updatedProduct;
  }

  async remove(actor: AuthUser, identifier: string) {
    const product = await this.getByIdentifier(actor, identifier);
    const now = new Date();

    const deletedProduct = await productRepository.updateById(actor.userId, (product as any)._id.toString(), {
      isDeleted: true,
      deletedAt: now,
      updatedAt: now
    });

    return deletedProduct;
  }

  isVisibleForBusinessDate(
    product: {
      createdAt: Date | string;
      deletedAt?: Date | string | null;
      isDeleted: boolean;
    },
    date: string
  ) {
    const createdBusinessDate = getBusinessDateFromTimestamp(
      product.createdAt,
      env.BUSINESS_DAY_START_HOUR
    );

    if (createdBusinessDate > date) {
      return false;
    }

    if (!product.isDeleted || !product.deletedAt) {
      return true;
    }

    const deletedBusinessDate = getBusinessDateFromTimestamp(
      product.deletedAt,
      env.BUSINESS_DAY_START_HOUR
    );

    return deletedBusinessDate > date;
  }
}

export const productService = new ProductService();
