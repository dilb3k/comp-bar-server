import { DailySnapshotModel } from "./snapshot.model";

export class SnapshotRepository {
  async findDaily(ownerAdminId: string, date: string) {
    return DailySnapshotModel.findOne({ ownerAdminId, date, isDeleted: false }).sort({ updatedAt: -1 });
  }

  async findRange(ownerAdminId: string, from: string, to: string) {
    return DailySnapshotModel.find({
      ownerAdminId,
      date: { $gte: from, $lte: to },
      isDeleted: false
    }).sort({ date: 1, updatedAt: 1 });
  }

  async findUpdatedSince(ownerAdminId: string, lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { ownerAdminId, updatedAt: { $gt: new Date(lastSyncAt) } }
      : { ownerAdminId };

    return DailySnapshotModel.find(filter).sort({ updatedAt: 1 });
  }

  async upsertByDate(
    ownerAdminId: string,
    date: string,
    deviceId: string,
    payload: Record<string, unknown>
  ) {
    return DailySnapshotModel.findOneAndUpdate(
      { ownerAdminId, date, deviceId },
      { ownerAdminId, ...payload },
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
    const existing = await DailySnapshotModel.findOne({ ownerAdminId, localId: payload.localId });

    if (!existing) {
      return DailySnapshotModel.create({ ownerAdminId, ...payload });
    }

    if (new Date(existing.updatedAt).getTime() > new Date(payload.updatedAt).getTime()) {
      return existing;
    }

    Object.assign(existing, payload);
    return existing.save();
  }
}

export const snapshotRepository = new SnapshotRepository();
