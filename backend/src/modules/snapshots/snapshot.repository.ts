import { DailySnapshotModel } from "./snapshot.model";

export type SnapshotRecordPayload = {
  localId: string;
  deviceId: string;
  date: string;
  totalRevenue?: number;
  totalProfit?: number;
  totalSoldItems?: number;
  items?: any[];
  isDeleted?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

function buildSnapshotRecord(
  ownerAdminId: string,
  payload: SnapshotRecordPayload,
) {
  return {
    recordType: "daily",
    ownerAdminId,
    localId: payload.localId,
    deviceId: payload.deviceId,
    isDeleted: payload.isDeleted ?? false,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    daily: {
      date: payload.date,
      totalRevenue: payload.totalRevenue,
      totalProfit: payload.totalProfit,
      totalSoldItems: payload.totalSoldItems,
      items: payload.items ?? [],
    },
  };
}

export class SnapshotRepository {
  async findDaily(ownerAdminId: string, date: string) {
    return DailySnapshotModel.findOne({
      ownerAdminId,
      recordType: "daily",
      "daily.date": date,
      isDeleted: false,
    }).sort({ updatedAt: -1 });
  }

  async findRange(ownerAdminId: string, from: string, to: string) {
    return DailySnapshotModel.find({
      ownerAdminId,
      recordType: "daily",
      "daily.date": { $gte: from, $lte: to },
      isDeleted: false,
    }).sort({ "daily.date": 1, updatedAt: 1 });
  }

  async findUpdatedSince(ownerAdminId: string, lastSyncAt?: string) {
    const filter = lastSyncAt
      ? { ownerAdminId, recordType: "daily", updatedAt: { $gt: new Date(lastSyncAt) } }
      : { ownerAdminId, recordType: "daily" };

    return DailySnapshotModel.find(filter).sort({ updatedAt: 1 });
  }

  async upsertByDate(
    ownerAdminId: string,
    date: string,
    deviceId: string,
    payload: SnapshotRecordPayload,
  ) {
    const existing = await DailySnapshotModel.findOne({
      ownerAdminId,
      recordType: "daily",
      "daily.date": date,
    });

    const updateRecord = buildSnapshotRecord(ownerAdminId, {
      ...payload,
      deviceId,
      date,
    });

    if (existing) {
      Object.assign(existing, updateRecord);
      return existing.save();
    }

    return DailySnapshotModel.create(updateRecord);
  }

  async upsertLastWriteWins(
    ownerAdminId: string,
    payload: SnapshotRecordPayload & {
      localId: string;
      updatedAt: Date | string;
    },
  ) {
    const existing = await DailySnapshotModel.findOne({
      ownerAdminId,
      recordType: "daily",
      localId: payload.localId,
    });

    if (!existing) {
      return DailySnapshotModel.create(
        buildSnapshotRecord(ownerAdminId, payload),
      );
    }

    if (
      new Date(existing.updatedAt).getTime() >
      new Date(payload.updatedAt).getTime()
    ) {
      return existing;
    }

    Object.assign(existing, buildSnapshotRecord(ownerAdminId, payload));
    return existing.save();
  }
}

export const snapshotRepository = new SnapshotRepository();
