import { InventoryEntryModel } from "./inventory.model";

export class InventoryRepository {
  async findByDate(ownerAdminId: string, date: string) {
    return InventoryEntryModel.find({
      ownerAdminId,
      entityType: "inventory",
      date,
      isDeleted: false
    }).sort({ createdAt: 1 });
  }

  async findRange(ownerAdminId: string, from: string, to: string) {
    return InventoryEntryModel.find({
      ownerAdminId,
      entityType: "inventory",
      date: { $gte: from, $lte: to },
      isDeleted: false
    }).sort({ date: 1, createdAt: 1 });
  }

  async findUpdatedSince(ownerAdminId: string, lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { ownerAdminId, entityType: "inventory", updatedAt: { $gt: new Date(lastSyncAt) } }
      : { ownerAdminId, entityType: "inventory" };

    return InventoryEntryModel.find(filter).sort({ updatedAt: 1 });
  }

  async findByProductAndDate(ownerAdminId: string, productId: string, date: string) {
    return InventoryEntryModel.findOne({ ownerAdminId, entityType: "inventory", productId, date });
  }

  async upsertByProductAndDate(
    ownerAdminId: string,
    productId: string,
    date: string,
    payload: Record<string, unknown>
  ) {
    return InventoryEntryModel.findOneAndUpdate(
      { ownerAdminId, entityType: "inventory", productId, date },
      { ownerAdminId, entityType: "inventory", ...payload },
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
    payload: Record<string, unknown> & { localId: string; updatedAt: Date | string }
  ) {
    const existing = await InventoryEntryModel.findOne({
      ownerAdminId,
      entityType: "inventory",
      localId: payload.localId
    });

    if (!existing) {
      return InventoryEntryModel.create({ ownerAdminId, entityType: "inventory", ...payload });
    }

    if (new Date(existing.updatedAt).getTime() > new Date(payload.updatedAt).getTime()) {
      return existing;
    }

    Object.assign(existing, payload);
    return existing.save();
  }
}

export const inventoryRepository = new InventoryRepository();
