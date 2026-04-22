import { InventoryEntryModel } from "./inventory.model";

export class InventoryRepository {
  async findByDate(date: string) {
    return InventoryEntryModel.find({
      entityType: "inventory",
      date,
      isDeleted: false
    }).sort({ createdAt: 1 });
  }

  async findRange(from: string, to: string) {
    return InventoryEntryModel.find({
      entityType: "inventory",
      date: { $gte: from, $lte: to },
      isDeleted: false
    }).sort({ date: 1, createdAt: 1 });
  }

  async findUpdatedSince(lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { entityType: "inventory", updatedAt: { $gt: new Date(lastSyncAt) } }
      : { entityType: "inventory" };

    return InventoryEntryModel.find(filter).sort({ updatedAt: 1 });
  }

  async findByProductAndDate(productId: string, date: string) {
    return InventoryEntryModel.findOne({ entityType: "inventory", productId, date });
  }

  async upsertByProductAndDate(
    productId: string,
    date: string,
    payload: Record<string, unknown>
  ) {
    return InventoryEntryModel.findOneAndUpdate(
      { entityType: "inventory", productId, date },
      { entityType: "inventory", ...payload },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true
      }
    );
  }

  async upsertLastWriteWins(
    payload: Record<string, unknown> & { localId: string; updatedAt: Date | string }
  ) {
    const existing = await InventoryEntryModel.findOne({
      entityType: "inventory",
      localId: payload.localId
    });

    if (!existing) {
      return InventoryEntryModel.create({ entityType: "inventory", ...payload });
    }

    if (new Date(existing.updatedAt).getTime() > new Date(payload.updatedAt).getTime()) {
      return existing;
    }

    Object.assign(existing, payload);
    return existing.save();
  }
}

export const inventoryRepository = new InventoryRepository();
