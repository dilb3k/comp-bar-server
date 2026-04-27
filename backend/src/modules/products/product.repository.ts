import { FilterQuery, Types } from "mongoose";

import { ProductModel } from "./product.model";

type ProductRecordPayload = Record<string, unknown>;

function hasOwn(payload: ProductRecordPayload, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function buildProductRecord(payload: ProductRecordPayload) {
  return {
    ownerAdminId: payload.ownerAdminId,
    localId: payload.localId,
    deviceId: payload.deviceId,
    isDeleted: payload.isDeleted ?? false,
    deletedAt: payload.deletedAt ?? null,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    product: {
      name: payload.name,
      quantity: payload.quantity,
      buyPrice: payload.buyPrice,
      sellPrice: payload.sellPrice,
      ...(hasOwn(payload, "image") ? { image: payload.image ?? "" } : {})
    }
  };
}

function buildProductUpdate(payload: ProductRecordPayload) {
  const update: Record<string, unknown> = {};

  if ("deviceId" in payload) {
    update.deviceId = payload.deviceId;
  }

  if ("isDeleted" in payload) {
    update.isDeleted = payload.isDeleted;
  }

  if ("deletedAt" in payload) {
    update.deletedAt = payload.deletedAt;
  }

  if ("createdAt" in payload) {
    update.createdAt = payload.createdAt;
  }

  if ("updatedAt" in payload) {
    update.updatedAt = payload.updatedAt;
  }

  if ("name" in payload) {
    update["product.name"] = payload.name;
  }

  if ("quantity" in payload) {
    update["product.quantity"] = payload.quantity;
  }

  if ("buyPrice" in payload) {
    update["product.buyPrice"] = payload.buyPrice;
  }

  if ("sellPrice" in payload) {
    update["product.sellPrice"] = payload.sellPrice;
  }

  if (hasOwn(payload, "image")) {
    update["product.image"] = payload.image;
  }

  return update;
}

export class ProductRepository {
  async findActive(ownerAdminId: string, search?: string) {
    const filter: FilterQuery<typeof ProductModel> = {
      ownerAdminId,
      recordType: "product",
      isDeleted: false
    };

    if (search?.trim()) {
      filter["product.name"] = { $regex: search.trim(), $options: "i" };
    }

    return ProductModel.find(filter).sort({ "product.name": 1 });
  }

  async findAllByOwner(ownerAdminId: string) {
    return ProductModel.find({
      ownerAdminId,
      recordType: "product"
    }).sort({ updatedAt: 1 });
  }

  async findAllUpdatedSince(ownerAdminId: string, lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { ownerAdminId, recordType: "product", updatedAt: { $gt: new Date(lastSyncAt) } }
      : { ownerAdminId, recordType: "product" };

    return ProductModel.find(filter).sort({ updatedAt: 1 });
  }

  async findByIdentifier(ownerAdminId: string, identifier: string) {
    const orConditions: Array<Record<string, unknown>> = [{ localId: identifier }];

    if (Types.ObjectId.isValid(identifier)) {
      orConditions.push({ _id: identifier });
    }

    return ProductModel.findOne({ ownerAdminId, recordType: "product", $or: orConditions });
  }

  async findByLocalIds(ownerAdminId: string, localIds: string[]) {
    return ProductModel.find({ ownerAdminId, recordType: "product", localId: { $in: localIds } });
  }

  async findByIdentifiers(ownerAdminId: string, identifiers: string[]) {
    const normalized = Array.from(new Set(identifiers.filter(Boolean)));
    const objectIds = normalized.filter((identifier) => Types.ObjectId.isValid(identifier));
    const orFilters: Array<Record<string, unknown>> = [{ localId: { $in: normalized } }];

    if (objectIds.length > 0) {
      orFilters.push({ _id: { $in: objectIds } });
    }

    return ProductModel.find({
      ownerAdminId,
      recordType: "product",
      $or: orFilters
    });
  }

  async create(payload: ProductRecordPayload) {
    return ProductModel.create({
      recordType: "product",
      ...buildProductRecord(payload)
    });
  }

  async updateById(ownerAdminId: string, id: string, payload: ProductRecordPayload) {
    return ProductModel.findOneAndUpdate(
      { _id: id, ownerAdminId, recordType: "product" },
      { $set: buildProductUpdate(payload) },
      { new: true, runValidators: true }
    );
  }

  async updateByLocalId(ownerAdminId: string, localId: string, payload: ProductRecordPayload) {
    return ProductModel.findOneAndUpdate(
      { ownerAdminId, recordType: "product", localId },
      { $set: buildProductUpdate(payload) },
      {
        new: true,
        upsert: false,
        runValidators: true
      }
    );
  }

  async upsertLastWriteWins(
    ownerAdminId: string,
    payload: ProductRecordPayload & { localId: string; updatedAt: Date | string }
  ) {
    const existing = await ProductModel.findOne({
      ownerAdminId,
      recordType: "product",
      localId: payload.localId
    });

    if (!existing) {
      return ProductModel.create({
        recordType: "product",
        ...buildProductRecord({ ownerAdminId, ...payload })
      });
    }

    if (new Date(existing.updatedAt).getTime() > new Date(payload.updatedAt).getTime()) {
      return existing;
    }

    Object.assign(
      existing,
      buildProductRecord({
        ownerAdminId,
        ...payload,
        ...(hasOwn(payload, "image") ? {} : { image: (existing as any).product?.image ?? "" })
      })
    );
    return existing.save();
  }
}

export const productRepository = new ProductRepository();
