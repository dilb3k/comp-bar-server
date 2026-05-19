import { InventoryEntryModel } from "./inventory.model";

type InventoryRecordPayload = Record<string, unknown>;

function buildInventoryRecord(payload: InventoryRecordPayload) {
  return {
    ownerAdminId: payload.ownerAdminId,
    localId: payload.localId,
    deviceId: payload.deviceId,
    isDeleted: payload.isDeleted ?? false,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    inventory: {
      productId: payload.productId,
      date: payload.date,
      startQuantity: payload.startQuantity,
      currentQuantity: payload.currentQuantity,
      buyPrice: payload.buyPrice ?? 0,
      sellPrice: payload.sellPrice ?? 0,
      note: payload.note ?? ""
    }
  };
}

export class InventoryRepository {
  async findByDate(ownerAdminId: string, date: string, session?: any) {
    let query = InventoryEntryModel.find({
      ownerAdminId,
      recordType: "inventory",
      "inventory.date": date,
      isDeleted: false
    }).sort({ createdAt: 1 });
    if (session) query = query.session(session);
    return query;
  }

  async findRange(ownerAdminId: string, from: string, to: string) {
    return InventoryEntryModel.find({
      ownerAdminId,
      recordType: "inventory",
      "inventory.date": { $gte: from, $lte: to },
      isDeleted: false
    }).sort({ "inventory.date": 1, createdAt: 1 });
  }

  async findByDateRange(ownerAdminId: string, from?: string, to?: string) {
    const filter: Record<string, unknown> = {
      ownerAdminId,
      recordType: "inventory",
      isDeleted: false,
    };

    if (from || to) {
      const dateFilter: Record<string, string> = {};
      if (from) dateFilter.$gte = from;
      if (to) dateFilter.$lte = to;
      filter["inventory.date"] = dateFilter;
    }

    return InventoryEntryModel.find(filter).sort({ "inventory.date": 1, createdAt: 1 });
  }

  async findUpdatedSince(ownerAdminId: string, lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { ownerAdminId, recordType: "inventory", updatedAt: { $gt: new Date(lastSyncAt) } }
      : { ownerAdminId, recordType: "inventory" };

    return InventoryEntryModel.find(filter).sort({ updatedAt: 1 });
  }

  async findByProductAndDate(ownerAdminId: string, productId: string, date: string, session?: any) {
    let query = InventoryEntryModel.findOne({
      ownerAdminId,
      recordType: "inventory",
      "inventory.productId": productId,
      "inventory.date": date
    });
    if (session) query = query.session(session);
    return query;
  }

  async upsertByProductAndDate(
    ownerAdminId: string,
    productId: string,
    date: string,
    payload: InventoryRecordPayload
  ) {
    return InventoryEntryModel.findOneAndUpdate(
      {
        ownerAdminId,
        recordType: "inventory",
        "inventory.productId": productId,
        "inventory.date": date
      },
      { $set: buildInventoryRecord({ ownerAdminId, ...payload }) },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true
      }
    );
  }

  async upsertByProductAndDateWithSession(
    ownerAdminId: string,
    productId: string,
    date: string,
    payload: InventoryRecordPayload,
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
      {
        ownerAdminId,
        recordType: "inventory",
        "inventory.productId": productId,
        "inventory.date": date
      },
      { $set: record },
      options
    );
  }

  async upsertLastWriteWins(
    ownerAdminId: string,
    payload: InventoryRecordPayload & { localId: string; updatedAt: Date | string },
    session?: any
  ) {
    const record = buildInventoryRecord({ ownerAdminId, ...payload });
    const payloadUpdatedAt = new Date(payload.updatedAt);

    let query = InventoryEntryModel.findOne({
      ownerAdminId,
      recordType: "inventory",
      $or: [
        { localId: payload.localId },
        { "inventory.productId": record.inventory?.productId, "inventory.date": record.inventory?.date }
      ]
    });
    if (session) query = query.session(session);
    const existing = await query;

    if (!existing) {
      const createOptions = session ? { session } : {};
      try {
        return await InventoryEntryModel.create([{
          recordType: "inventory",
          ...record
        }], createOptions).then((docs) => docs[0]);
      } catch (error: any) {
        if (error?.code === 11000) {
          let retryQuery = InventoryEntryModel.findOne({
            ownerAdminId,
            recordType: "inventory",
            $or: [
              { localId: payload.localId },
              { "inventory.productId": record.inventory?.productId, "inventory.date": record.inventory?.date }
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
