import { DailySnapshotModel } from "./snapshot.model";

export class SnapshotRepository {
  async findDaily(date: string) {
    return DailySnapshotModel.findOne({ date, isDeleted: false }).sort({ updatedAt: -1 });
  }

  async findRange(from: string, to: string) {
    return DailySnapshotModel.find({
      date: { $gte: from, $lte: to },
      isDeleted: false
    }).sort({ date: 1, updatedAt: 1 });
  }

  async findUpdatedSince(lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { updatedAt: { $gt: new Date(lastSyncAt) } }
      : {};

    return DailySnapshotModel.find(filter).sort({ updatedAt: 1 });
  }

  async upsertByDate(date: string, deviceId: string, payload: Record<string, unknown>) {
    return DailySnapshotModel.findOneAndUpdate(
      { date, deviceId },
      payload,
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
    const existing = await DailySnapshotModel.findOne({ localId: payload.localId });

    if (!existing) {
      return DailySnapshotModel.create(payload);
    }

    if (new Date(existing.updatedAt).getTime() > new Date(payload.updatedAt).getTime()) {
      return existing;
    }

    Object.assign(existing, payload);
    return existing.save();
  }
}

export const snapshotRepository = new SnapshotRepository();
