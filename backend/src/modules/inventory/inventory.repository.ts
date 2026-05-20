import { InventoryEntryModel } from "./inventory.model";

type InventoryPayload = Record<string, unknown>;

function buildInventoryRecord(payload: InventoryPayload) {
  return {
    ownerAdminId: payload.ownerAdminId,
    localId: payload.localId,
    deviceId: payload.deviceId,
    productId: payload.productId,
    date: payload.date,
    startQuantity: payload.startQuantity,
    currentQuantity: payload.currentQuantity,
    buyPrice: payload.buyPrice ?? 0,
    sellPrice: payload.sellPrice ?? 0,
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

  async findUpdatedSince(ownerAdminId: string, lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { ownerAdminId, updatedAt: { $gte: new Date(lastSyncAt) } }
      : { ownerAdminId };

    return InventoryEntryModel.find(filter).sort({ updatedAt: 1 });
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

  async upsertByProductAndDate(
    ownerAdminId: string,
    productId: string,
    date: string,
    payload: InventoryPayload
  ) {
    const record = buildInventoryRecord({ ownerAdminId, ...payload });
    return InventoryEntryModel.findOneAndUpdate(
      { ownerAdminId, productId, date },
      { $set: record },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
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
              Object.assign(conflicting, record);
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

    Object.assign(existing, record);
    return existing.save({ session });
  }
}

export const inventoryRepository = new InventoryRepository();
