import { serverVersionPlugin } from "../../lib/versioning";
import { Schema, model, models } from "mongoose";

import { DEFAULT_UNIT, PRODUCT_UNITS } from "../../utils/quantity";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

export function serializeSnapshot(value: any) {
  const ret = { totalProcurementCost: 0, serverVersion: 0, ...value };
  ret.id = ret._id.toString(); ret._id = ret.id; delete ret.ownerAdminId;
  ret.items = (ret.items ?? []).map((item: any) => ({ unit: DEFAULT_UNIT, ...item }));
  ret.createdAt = iso(ret.createdAt); ret.updatedAt = iso(ret.updatedAt);
  return ret;
}

const snapshotItemSchema = new Schema(
  {
    productId: {
      type: String,
      required: true,
      trim: true
    },
    productName: {
      type: String,
      required: true,
      trim: true
    },
    unit: {
      type: String,
      enum: PRODUCT_UNITS,
      default: DEFAULT_UNIT
    },
    sold: {
      type: Number,
      required: true,
      min: 0
    },
    buyPrice: {
      type: Number,
      min: 0
    },
    sellPrice: {
      type: Number,
      min: 0
    },
    revenue: {
      type: Number,
      required: true,
      min: 0
    },
    profit: {
      type: Number,
      required: true
    }
  },
  { _id: false }
);

export interface IDailySnapshot {
  _id?: string;
  ownerAdminId: string;
  localId: string;
  deviceId: string;
  date: string;
  totalRevenue: number;
  totalProfit: number;
  totalSoldItems: number;
  totalProcurementCost: number;
  items: Array<Record<string, unknown>>;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

const dailySnapshotSchema = new Schema<IDailySnapshot>(
  {
    ownerAdminId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    localId: {
      type: String,
      required: true,
      trim: true
    },
    deviceId: {
      type: String,
      required: true,
      trim: true
    },
    date: {
      type: String,
      required: true
    },
    totalRevenue: {
      type: Number,
      required: true,
      min: 0
    },
    totalProfit: {
      type: Number,
      required: true
    },
    totalSoldItems: {
      type: Number,
      required: true,
      min: 0
    },
    // Bozordan kirim qilingan tovarlar uchun shu kunlik umumiy xarid summasi
    // (see procurement.service.ts). Computed in recompute() from Procurement
    // documents, same as totalRevenue/totalProfit are computed from
    // InventoryEntry rows — never written directly by any other code path.
    totalProcurementCost: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    items: {
      type: [snapshotItemSchema],
      default: []
    },
  },
  {
    collection: "daily_snapshots",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        return serializeSnapshot(ret);
      }
    }
  }
);

dailySnapshotSchema.index(
  { ownerAdminId: 1, localId: 1 },
  { unique: true, name: "idx_unique_owner_localid", background: true }
);

dailySnapshotSchema.index(
  { ownerAdminId: 1, date: 1 },
  { unique: true, name: "idx_unique_date", background: true }
);

dailySnapshotSchema.index(
  { ownerAdminId: 1, updatedAt: 1 },
  { name: "idx_owner_updatedat", background: true }
);

dailySnapshotSchema.plugin(serverVersionPlugin);

export const DailySnapshotModel =
  models.DailySnapshot ?? model<IDailySnapshot>("DailySnapshot", dailySnapshotSchema);
