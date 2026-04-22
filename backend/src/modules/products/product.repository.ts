import { FilterQuery, Types } from "mongoose";

import { ProductModel } from "./product.model";

export class ProductRepository {
  async findActive(ownerAdminId: string, search?: string) {
    const filter: FilterQuery<typeof ProductModel> = {
      ownerAdminId,
      entityType: "product",
      isDeleted: false
    };

    if (search?.trim()) {
      filter.name = { $regex: search.trim(), $options: "i" };
    }

    return ProductModel.find(filter).sort({ name: 1 });
  }

  async findAllByOwner(ownerAdminId: string) {
    return ProductModel.find({
      ownerAdminId,
      entityType: "product"
    }).sort({ updatedAt: 1 });
  }

  async findAllUpdatedSince(ownerAdminId: string, lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { ownerAdminId, entityType: "product", updatedAt: { $gt: new Date(lastSyncAt) } }
      : { ownerAdminId, entityType: "product" };

    return ProductModel.find(filter).sort({ updatedAt: 1 });
  }

  async findByIdentifier(ownerAdminId: string, identifier: string) {
    const orConditions: Array<Record<string, unknown>> = [{ localId: identifier }];

    if (Types.ObjectId.isValid(identifier)) {
      orConditions.push({ _id: identifier });
    }

    return ProductModel.findOne({ ownerAdminId, entityType: "product", $or: orConditions });
  }

  async findByLocalIds(ownerAdminId: string, localIds: string[]) {
    return ProductModel.find({ ownerAdminId, entityType: "product", localId: { $in: localIds } });
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
      entityType: "product",
      $or: orFilters
    });
  }

  async create(payload: Record<string, unknown>) {
    return ProductModel.create({ entityType: "product", ...payload });
  }

  async updateById(ownerAdminId: string, id: string, payload: Record<string, unknown>) {
    return ProductModel.findOneAndUpdate(
      { _id: id, ownerAdminId, entityType: "product" },
      payload,
      { new: true, runValidators: true }
    );
  }

  async updateByLocalId(ownerAdminId: string, localId: string, payload: Record<string, unknown>) {
    return ProductModel.findOneAndUpdate({ ownerAdminId, entityType: "product", localId }, payload, {
      new: true,
      upsert: false,
      runValidators: true
    });
  }

  async upsertLastWriteWins(
    ownerAdminId: string,
    payload: Record<string, unknown> & { localId: string; updatedAt: Date | string }
  ) {
    const existing = await ProductModel.findOne({
      ownerAdminId,
      entityType: "product",
      localId: payload.localId
    });

    if (!existing) {
      return ProductModel.create({ ownerAdminId, entityType: "product", ...payload });
    }

    if (new Date(existing.updatedAt).getTime() > new Date(payload.updatedAt).getTime()) {
      return existing;
    }

    Object.assign(existing, payload);
    return existing.save();
  }
}

export const productRepository = new ProductRepository();
