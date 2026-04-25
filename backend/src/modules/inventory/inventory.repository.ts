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
      note: payload.note ?? ""
    }
  };
}

export class InventoryRepository {
  async findByDate(ownerAdminId: string, date: string) {
    return InventoryEntryModel.find({
      ownerAdminId,
      recordType: "inventory",
      "inventory.date": date,
      isDeleted: false
    }).sort({ createdAt: 1 });
  }

  async findRange(ownerAdminId: string, from: string, to: string) {
    return InventoryEntryModel.find({
      ownerAdminId,
      recordType: "inventory",
      "inventory.date": { $gte: from, $lte: to },
      isDeleted: false
    }).sort({ "inventory.date": 1, createdAt: 1 });
  }

  async findUpdatedSince(ownerAdminId: string, lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { ownerAdminId, recordType: "inventory", updatedAt: { $gt: new Date(lastSyncAt) } }
      : { ownerAdminId, recordType: "inventory" };

    return InventoryEntryModel.find(filter).sort({ updatedAt: 1 });
  }

  async findByProductAndDate(ownerAdminId: string, productId: string, date: string) {
    return InventoryEntryModel.findOne({
      ownerAdminId,
      recordType: "inventory",
      "inventory.productId": productId,
      "inventory.date": date
    });
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

  async upsertLastWriteWins(
    ownerAdminId: string,
    payload: InventoryRecordPayload & { localId: string; updatedAt: Date | string }
  ) {
    const existing = await InventoryEntryModel.findOne({
      ownerAdminId,
      recordType: "inventory",
      localId: payload.localId
    });

    if (!existing) {
      return InventoryEntryModel.create({
        recordType: "inventory",
        ...buildInventoryRecord({ ownerAdminId, ...payload })
      });
    }

    if (new Date(existing.updatedAt).getTime() > new Date(payload.updatedAt).getTime()) {
      return existing;
    }

    Object.assign(existing, buildInventoryRecord({ ownerAdminId, ...payload }));
    return existing.save();
  }
}

export const inventoryRepository = new InventoryRepository();
