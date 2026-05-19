import { Schema, model, models } from "mongoose";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
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
  items: Array<Record<string, unknown>>;
  isDeleted: boolean;
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
    items: {
      type: [snapshotItemSchema],
      default: []
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    collection: "daily_snapshots",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.ownerAdminId;
        ret.createdAt = iso(ret.createdAt);
        ret.updatedAt = iso(ret.updatedAt);
        return ret;
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

export const DailySnapshotModel =
  models.DailySnapshot ?? model<IDailySnapshot>("DailySnapshot", dailySnapshotSchema);
