import { FilterQuery, Types } from "mongoose";

import { ProductModel } from "./product.model";

export class ProductRepository {
  async findActive(search?: string) {
    const filter: FilterQuery<typeof ProductModel> = {
      entityType: "product",
      isDeleted: false
    };

    if (search?.trim()) {
      filter.name = { $regex: search.trim(), $options: "i" };
    }

    return ProductModel.find(filter).sort({ name: 1 });
  }

  async findAllUpdatedSince(lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { entityType: "product", updatedAt: { $gt: new Date(lastSyncAt) } }
      : { entityType: "product" };

    return ProductModel.find(filter).sort({ updatedAt: 1 });
  }

  async findByIdentifier(identifier: string) {
    const orConditions: Array<Record<string, unknown>> = [{ localId: identifier }];

    if (Types.ObjectId.isValid(identifier)) {
      orConditions.push({ _id: identifier });
    }

    return ProductModel.findOne({ entityType: "product", $or: orConditions });
  }

  async findByLocalIds(localIds: string[]) {
    return ProductModel.find({ entityType: "product", localId: { $in: localIds } });
  }

  async create(payload: Record<string, unknown>) {
    return ProductModel.create({ entityType: "product", ...payload });
  }

  async updateById(id: string, payload: Record<string, unknown>) {
    return ProductModel.findOneAndUpdate(
      { _id: id, entityType: "product" },
      payload,
      { new: true, runValidators: true }
    );
  }

  async updateByLocalId(localId: string, payload: Record<string, unknown>) {
    return ProductModel.findOneAndUpdate({ entityType: "product", localId }, payload, {
      new: true,
      upsert: false,
      runValidators: true
    });
  }

  async upsertLastWriteWins(
    payload: Record<string, unknown> & { localId: string; updatedAt: Date | string }
  ) {
    const existing = await ProductModel.findOne({
      entityType: "product",
      localId: payload.localId
    });

    if (!existing) {
      return ProductModel.create({ entityType: "product", ...payload });
    }

    if (new Date(existing.updatedAt).getTime() > new Date(payload.updatedAt).getTime()) {
      return existing;
    }

    Object.assign(existing, payload);
    return existing.save();
  }
}

export const productRepository = new ProductRepository();
