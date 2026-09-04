import { FilterQuery, Types } from "mongoose";

import { normalizeUnit } from "../../utils/quantity";
import { ProductModel, IProduct } from "./product.model";

type ProductPayload = Record<string, unknown>;

function hasOwn(payload: ProductPayload, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function buildProductRecord(payload: ProductPayload) {
  return {
    ownerAdminId: payload.ownerAdminId,
    localId: payload.localId,
    deviceId: payload.deviceId,
    name: payload.name ?? "",
    quantity: payload.quantity ?? 0,
    unit: normalizeUnit(payload.unit),
    buyPrice: payload.buyPrice ?? 0,
    sellPrice: payload.sellPrice ?? 0,
    displayIndex: payload.displayIndex ?? 1,
    ...(hasOwn(payload, "image") ? { image: payload.image ?? "" } : {}),
    ...(hasOwn(payload, "barcodes") ? { barcodes: Array.isArray(payload.barcodes) ? payload.barcodes.filter(Boolean) : undefined } : {}),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt
  };
}

function buildProductUpdate(payload: ProductPayload) {
  const update: Record<string, unknown> = {};

  if ("deviceId" in payload) update.deviceId = payload.deviceId;
  if ("createdAt" in payload) update.createdAt = payload.createdAt;
  if ("updatedAt" in payload) update.updatedAt = payload.updatedAt;
  if ("name" in payload) update.name = payload.name;
  if ("quantity" in payload) update.quantity = payload.quantity;
  if ("unit" in payload) update.unit = normalizeUnit(payload.unit);
  if ("buyPrice" in payload) update.buyPrice = payload.buyPrice;
  if ("sellPrice" in payload) update.sellPrice = payload.sellPrice;
  if ("displayIndex" in payload) update.displayIndex = payload.displayIndex;
  if (hasOwn(payload, "image")) update.image = payload.image;
  if (hasOwn(payload, "barcodes")) update.barcodes = Array.isArray(payload.barcodes) ? payload.barcodes.filter(Boolean) : [];

  return update;
}

export class ProductRepository {
  async getNextDisplayIndex(ownerAdminId: string, session?: any): Promise<number> {
    const query = ProductModel.findOne(
      { ownerAdminId },
      { displayIndex: 1, _id: 0 }
    ).sort({ displayIndex: -1 }).limit(1);
    if (session) query.session(session);
    const maxProduct = await query;

    if (maxProduct && maxProduct.displayIndex !== undefined) {
      return maxProduct.displayIndex + 1;
    }
    return 1;
  }

  async findActive(ownerAdminId: string, search?: string) {
    const filter: FilterQuery<IProduct> = {
      ownerAdminId,
    };

    if (search?.trim()) {
      filter.name = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    return ProductModel.find(filter).sort({
      displayIndex: 1,
      name: 1
    });
  }

  async findAllByOwner(ownerAdminId: string, session?: any) {
    const query = ProductModel.find({ ownerAdminId }).sort({ updatedAt: 1 });
    if (session) query.session(session);
    return query;
  }

  async findAllUpdatedSince(ownerAdminId: string, lastSyncAt?: string, limit = 1000, offset = 0) {
    const filter = lastSyncAt
      ? { ownerAdminId, updatedAt: { $gte: new Date(lastSyncAt) } }
      : { ownerAdminId };

    return ProductModel.find(filter).sort({ updatedAt: 1 }).skip(offset).limit(limit);
  }

  async countActive(ownerAdminId: string, session?: any) {
    let query = ProductModel.countDocuments({
      ownerAdminId,
    });
    if (session) query = query.session(session);
    return query;
  }

  // Which of these localIds already exist for this owner — used to tell an
  // offline-queued *new* product apart from an edit to one that already made
  // it to the server, so a tier's product cap (see sync.service.ts) can be
  // applied to the former without blocking the latter.
  async findExistingLocalIds(ownerAdminId: string, localIds: string[], session?: any): Promise<Set<string>> {
    if (localIds.length === 0) return new Set();
    let query = ProductModel.find({ ownerAdminId, localId: { $in: localIds } }).select("localId");
    if (session) query = query.session(session);
    const docs = await query;
    return new Set(docs.map((d: any) => d.localId));
  }

  async findByBarcode(ownerAdminId: string, barcode: string, session?: any) {
    const query = ProductModel.findOne({ ownerAdminId, barcodes: barcode });
    if (session) query.session(session);
    return query;
  }

  async findByIdentifier(ownerAdminId: string, identifier: string) {
    const orConditions: Array<Record<string, unknown>> = [{ localId: identifier }];

    if (Types.ObjectId.isValid(identifier)) {
      orConditions.push({ _id: identifier });
    }

    return ProductModel.findOne({ ownerAdminId, $or: orConditions });
  }

  async findByLocalIds(ownerAdminId: string, localIds: string[]) {
    return ProductModel.find({ ownerAdminId, localId: { $in: localIds } });
  }

  async findByIdentifiers(ownerAdminId: string, identifiers: string[], session?: any) {
    const normalized = Array.from(new Set(identifiers.filter(Boolean)));
    const objectIds = normalized.filter((identifier) => Types.ObjectId.isValid(identifier));
    const orFilters: Array<Record<string, unknown>> = [{ localId: { $in: normalized } }];

    if (objectIds.length > 0) {
      orFilters.push({ _id: { $in: objectIds } });
    }

    const query = ProductModel.find({
      ownerAdminId,
      $or: orFilters
    });
    if (session) query.session(session);
    return query;
  }

  async create(payload: ProductPayload, session?: any) {
    const options = session ? { session } : {};
    return ProductModel.create([buildProductRecord(payload)], options).then((docs) => docs[0]);
  }

  async updateById(ownerAdminId: string, id: string, payload: ProductPayload, session?: any) {
    const options: Record<string, unknown> = { new: true, runValidators: true };
    if (session) options.session = session;
    return ProductModel.findOneAndUpdate(
      { _id: id, ownerAdminId },
      { $set: buildProductUpdate(payload) },
      options
    );
  }

  async incrementQuantity(ownerAdminId: string, id: string, delta: number, session?: any) {
    const options: Record<string, unknown> = { new: true };
    if (session) options.session = session;
    return ProductModel.findOneAndUpdate(
      { _id: id, ownerAdminId },
      { $inc: { quantity: delta }, $set: { updatedAt: new Date() } },
      options
    );
  }

  async deleteById(ownerAdminId: string, id: string) {
    return ProductModel.findOneAndDelete({ _id: id, ownerAdminId });
  }

  async setQuantityByLocalId(ownerAdminId: string, localId: string, quantity: number, session?: any) {
    const options: Record<string, unknown> = { new: true };
    if (session) options.session = session;
    return ProductModel.findOneAndUpdate(
      { ownerAdminId, localId },
      { $set: { quantity, updatedAt: new Date() } },
      options
    );
  }

  async updateByLocalId(ownerAdminId: string, localId: string, payload: ProductPayload) {
    return ProductModel.findOneAndUpdate(
      { ownerAdminId, localId },
      { $set: buildProductUpdate(payload) },
      { new: true, upsert: false, runValidators: true }
    );
  }

  async upsertLastWriteWins(
    ownerAdminId: string,
    payload: ProductPayload & { localId: string; updatedAt: Date | string },
    session?: any
  ) {
    const existing = await ProductModel.findOne({
      ownerAdminId,
      localId: payload.localId
    }).session(session ?? null);

    if (!existing) {
      const options = session ? { session } : {};
      try {
        return await ProductModel.create([buildProductRecord({ ownerAdminId, ...payload })], options).then((docs) => docs[0]);
      } catch (error: any) {
        if (error?.code === 11000) {
          const conflicting = await ProductModel.findOne({
            ownerAdminId,
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
                  ...(hasOwn(payload, "image") ? {} : { image: conflicting.image ?? "" })
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
        ...(hasOwn(payload, "image") ? {} : { image: existing.image ?? "" })
      })
    );
    return existing.save({ session });
  }
}

export const productRepository = new ProductRepository();
