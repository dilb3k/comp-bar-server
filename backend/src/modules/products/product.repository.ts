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
      displayIndex: payload.displayIndex ?? 0,
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

  if ("displayIndex" in payload) {
    update["product.displayIndex"] = payload.displayIndex;
  }

  if (hasOwn(payload, "image")) {
    update["product.image"] = payload.image;
  }

  return update;
}

export class ProductRepository {
  async getNextDisplayIndex(ownerAdminId: string): Promise<number> {
    const maxProduct = await ProductModel.findOne(
      { ownerAdminId, recordType: "product", isDeleted: false },
      { "product.displayIndex": 1, _id: 0 }
    ).sort({ "product.displayIndex": -1 }).limit(1);

    if (maxProduct && (maxProduct as any)?.product?.displayIndex !== undefined) {
      return (maxProduct as any).product.displayIndex + 1;
    }
    return 0;
  }

  async findActive(ownerAdminId: string, search?: string) {
    const filter: FilterQuery<typeof ProductModel> = {
      ownerAdminId,
      recordType: "product",
      isDeleted: false
    };

    if (search?.trim()) {
      filter["product.name"] = { $regex: search.trim(), $options: "i" };
    }

    return ProductModel.find(filter).sort({
      "product.displayIndex": 1,
      "product.name": 1
    });
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

  async countActive(ownerAdminId: string) {
    return ProductModel.countDocuments({
      ownerAdminId,
      recordType: "product",
      isDeleted: false,
    });
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

  async create(payload: ProductRecordPayload, session?: any) {
    const options = session ? { session } : {};
    return ProductModel.create([{
      recordType: "product",
      ...buildProductRecord(payload)
    }], options).then((docs) => docs[0]);
  }

  async updateById(ownerAdminId: string, id: string, payload: ProductRecordPayload, session?: any) {
    const options: Record<string, unknown> = { new: true, runValidators: true };
    if (session) options.session = session;
    return ProductModel.findOneAndUpdate(
      { _id: id, ownerAdminId, recordType: "product" },
      { $set: buildProductUpdate(payload) },
      options
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
    payload: ProductRecordPayload & { localId: string; updatedAt: Date | string },
    session?: any
  ) {
    const existing = await ProductModel.findOne({
      ownerAdminId,
      recordType: "product",
      localId: payload.localId
    }).session(session ?? null);

    if (!existing) {
      const options = session ? { session } : {};
      try {
        return await ProductModel.create([{
          recordType: "product",
          ...buildProductRecord({ ownerAdminId, ...payload })
        }], options).then((docs) => docs[0]);
      } catch (error: any) {
        if (error?.code === 11000) {
          const conflicting = await ProductModel.findOne({
            ownerAdminId,
            recordType: "product",
            localId: payload.localId
          }).session(session ?? null);
          if (conflicting) {
            const same = new Date(conflicting.updatedAt).getTime() <= new Date(payload.updatedAt).getTime();
            if (same) {
              Object.assign(
                conflicting,
                buildProductRecord({
                  ownerAdminId,
                  ...payload,
                  ...(hasOwn(payload, "image") ? {} : { image: (conflicting as any).product?.image ?? "" })
                })
              );
              return conflicting.save({ session });
            }
            return conflicting;
          }
        }
        throw error;
      }
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
    return existing.save({ session });
  }
}

export const productRepository = new ProductRepository();
