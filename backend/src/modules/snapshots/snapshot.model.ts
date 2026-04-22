import { Schema, model, models } from "mongoose";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

const snapshotItemSchema = new Schema(
  {
    productId: {
      type: String,
      required: true
    },
    productName: {
      type: String,
      required: true
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
  {
    _id: false
  }
);

const dailySnapshotSchema = new Schema(
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
      required: true,
      index: true
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

dailySnapshotSchema.index({ ownerAdminId: 1, localId: 1 }, { unique: true });
dailySnapshotSchema.index({ ownerAdminId: 1, deviceId: 1, date: 1 }, { unique: true });
dailySnapshotSchema.index({ ownerAdminId: 1, date: 1, isDeleted: 1, updatedAt: -1 });

export const DailySnapshotModel =
  models.DailySnapshot ?? model("DailySnapshot", dailySnapshotSchema);
