import { InventoryEntryModel } from "./inventory.model";

type InventoryPayload = Record<string, unknown>;

function buildInventoryRecord(payload: InventoryPayload) {
  return {
    ownerAdminId: payload.ownerAdminId,
    localId: payload.localId,
    deviceId: payload.deviceId,
    productId: payload.productId,
    // startDay/bulkCurrent/sales/sync all pass productName, but it used to be
    // dropped here. The denormalized copy exists so an entry still shows the
    // real product name after the product itself is deleted — with it missing,
    // upsertLastWriteWins' Object.assign set the path to undefined (which
    // mongoose turns into an $unset), history for deleted products degraded to
    // "O'chirilgan mahsulot", and the read-path backfill rewrote it on every
    // single GET.
    productName: payload.productName,
    date: payload.date,
    startQuantity: payload.startQuantity,
    currentQuantity: payload.currentQuantity,
    buyPrice: payload.buyPrice ?? 0,
    sellPrice: payload.sellPrice ?? 0,
    lockedRevenue: payload.lockedRevenue ?? 0,
    lockedProfit: payload.lockedProfit ?? 0,
    lockedSold: payload.lockedSold ?? 0,
    note: payload.note ?? "",
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt
  };
}

export class InventoryRepository {
  async findByDate(ownerAdminId: string, date: string, session?: any) {
    let query = InventoryEntryModel.find({
      ownerAdminId,
      date,
    }).sort({ createdAt: 1 });
    if (session) query = query.session(session);
    return query;
  }

  async findRange(ownerAdminId: string, from: string, to: string) {
    return InventoryEntryModel.find({
      ownerAdminId,
      date: { $gte: from, $lte: to },
    }).sort({ date: 1, createdAt: 1 });
  }

  async findByDateRange(ownerAdminId: string, from?: string, to?: string) {
    const filter: Record<string, unknown> = {
      ownerAdminId,
    };

    if (from || to) {
      const dateFilter: Record<string, string> = {};
      if (from) dateFilter.$gte = from;
      if (to) dateFilter.$lte = to;
      filter.date = dateFilter;
    }

    return InventoryEntryModel.find(filter).sort({ date: 1, createdAt: 1 });
  }

  async findUpdatedSince(ownerAdminId: string, lastSyncAt?: string, limit = 1000, offset = 0) {
    const filter = lastSyncAt
      ? { ownerAdminId, updatedAt: { $gte: new Date(lastSyncAt) } }
      : { ownerAdminId };

    return InventoryEntryModel.find(filter).sort({ updatedAt: 1 }).skip(offset).limit(limit);
  }

  async findByProductAndDate(ownerAdminId: string, productId: string, date: string, session?: any) {
    let query = InventoryEntryModel.findOne({
      ownerAdminId,
      productId,
      date
    });
    if (session) query = query.session(session);
    return query;
  }

  async upsertByProductAndDateWithSession(
    ownerAdminId: string,
    productId: string,
    date: string,
    payload: InventoryPayload,
    session?: any
  ) {
    const record = buildInventoryRecord({ ownerAdminId, ...payload });
    const options: Record<string, unknown> = {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true
    };
    if (session) options.session = session;
    return InventoryEntryModel.findOneAndUpdate(
      { ownerAdminId, productId, date },
      { $set: record },
      options
    );
  }

  async incrementQuantitiesByProductAndDate(
    ownerAdminId: string,
    productId: string,
    date: string,
    delta: number,
    session?: any
  ) {
    const options: Record<string, unknown> = { new: true };
    if (session) options.session = session;
    return InventoryEntryModel.findOneAndUpdate(
      { ownerAdminId, productId, date },
      { $inc: { startQuantity: delta, currentQuantity: delta }, $set: { updatedAt: new Date() } },
      options
    );
  }

  async updateProductNameByProductId(ownerAdminId: string, productId: string, productName: string) {
    return InventoryEntryModel.updateMany(
      { ownerAdminId, productId, productName: "" },
      { $set: { productName } },
    );
  }

  async upsertLastWriteWins(
    ownerAdminId: string,
    payload: InventoryPayload & { localId: string; updatedAt: Date | string },
    session?: any
  ) {
    const record = buildInventoryRecord({ ownerAdminId, ...payload });
    const payloadUpdatedAt = new Date(payload.updatedAt);

    let query = InventoryEntryModel.findOne({
      ownerAdminId,
      $or: [
        { localId: payload.localId },
        { productId: record.productId, date: record.date }
      ]
    });
    if (session) query = query.session(session);
    const existing = await query;

    if (!existing) {
      const createOptions = session ? { session } : {};
      try {
        return await InventoryEntryModel.create([record], createOptions).then((docs) => docs[0]);
      } catch (error: any) {
        if (error?.code === 11000) {
          let retryQuery = InventoryEntryModel.findOne({
            ownerAdminId,
            $or: [
              { localId: payload.localId },
              { productId: record.productId, date: record.date }
            ]
          });
          if (session) retryQuery = retryQuery.session(session);
          const conflicting = await retryQuery;
          if (conflicting) {
            if (new Date(conflicting.updatedAt).getTime() <= payloadUpdatedAt.getTime()) {
              const merged = {
                ...record,
                buyPrice: payload.buyPrice !== undefined ? record.buyPrice : conflicting.buyPrice,
                sellPrice: payload.sellPrice !== undefined ? record.sellPrice : conflicting.sellPrice,
                lockedRevenue: payload.lockedRevenue !== undefined ? record.lockedRevenue : conflicting.lockedRevenue,
                lockedProfit: payload.lockedProfit !== undefined ? record.lockedProfit : conflicting.lockedProfit,
                lockedSold: payload.lockedSold !== undefined ? record.lockedSold : conflicting.lockedSold,
                productName: payload.productName !== undefined ? record.productName : conflicting.productName,
              };
              Object.assign(conflicting, merged);
              return conflicting.save({ session });
            }
            return conflicting;
          }
        }
        throw error;
      }
    }

    if (new Date(existing.updatedAt).getTime() > payloadUpdatedAt.getTime()) {
      return existing;
    }

    const merged = {
      ...record,
      buyPrice: payload.buyPrice !== undefined ? record.buyPrice : existing.buyPrice,
      sellPrice: payload.sellPrice !== undefined ? record.sellPrice : existing.sellPrice,
      lockedRevenue: payload.lockedRevenue !== undefined ? record.lockedRevenue : existing.lockedRevenue,
      lockedProfit: payload.lockedProfit !== undefined ? record.lockedProfit : existing.lockedProfit,
      lockedSold: payload.lockedSold !== undefined ? record.lockedSold : existing.lockedSold,
      productName: payload.productName !== undefined ? record.productName : existing.productName,
    };
    Object.assign(existing, merged);
    return existing.save({ session });
  }
}

export const inventoryRepository = new InventoryRepository();
