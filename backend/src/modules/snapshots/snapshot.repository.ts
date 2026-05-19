import { DailySnapshotModel } from "./snapshot.model";

export type SnapshotPayload = {
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
  payload: SnapshotPayload,
) {
  return {
    ownerAdminId,
    localId: payload.localId,
    deviceId: payload.deviceId,
    date: payload.date,
    totalRevenue: payload.totalRevenue,
    totalProfit: payload.totalProfit,
    totalSoldItems: payload.totalSoldItems,
    items: payload.items ?? [],
    isDeleted: payload.isDeleted ?? false,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt
  };
}

export class SnapshotRepository {
  async findDaily(ownerAdminId: string, date: string) {
    return DailySnapshotModel.findOne({
      ownerAdminId,
      date,
      isDeleted: false,
    }).sort({ updatedAt: -1 });
  }

  async findRange(ownerAdminId: string, from: string, to: string) {
    return DailySnapshotModel.find({
      ownerAdminId,
      date: { $gte: from, $lte: to },
      isDeleted: false,
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
    payload: SnapshotPayload,
    session?: any,
  ) {
    let query = DailySnapshotModel.findOne({
      ownerAdminId,
      date,
    });
    if (session) query = query.session(session);
    const existing = await query;

    const updateRecord = buildSnapshotRecord(ownerAdminId, {
      ...payload,
      deviceId,
      date,
    });

    if (existing) {
      Object.assign(existing, updateRecord);
      return existing.save({ session });
    }

    const createOptions = session ? { session } : {};
    return DailySnapshotModel.create([updateRecord], createOptions).then((docs) => docs[0]);
  }

  async upsertLastWriteWins(
    ownerAdminId: string,
    payload: SnapshotPayload & {
      localId: string;
      updatedAt: Date | string;
    },
    session?: any,
  ) {
    let query = DailySnapshotModel.findOne({
      ownerAdminId,
      date: payload.date,
    });
    if (session) query = query.session(session);
    const existing = await query;

    if (
      existing &&
      new Date(existing.updatedAt).getTime() >
        new Date(payload.updatedAt).getTime()
    ) {
      return existing;
    }

    const record = buildSnapshotRecord(ownerAdminId, payload);

    if (existing) {
      Object.assign(existing, record);
      return existing.save({ session });
    }

    const createOptions = session ? { session } : {};
    return DailySnapshotModel.create([record], createOptions).then((docs) => docs[0]);
  }
}

export const snapshotRepository = new SnapshotRepository();
