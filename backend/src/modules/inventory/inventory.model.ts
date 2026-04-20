import { Schema, model } from "mongoose";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

const inventorySchema = new Schema(
  {
    localId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    deviceId: {
      type: String,
      required: true,
      trim: true
    },
    productId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    date: {
      type: String,
      required: true,
      index: true
    },
    startQuantity: {
      type: Number,
      required: true,
      min: 0
    },
    currentQuantity: {
      type: Number,
      required: true,
      min: 0
    },
    note: {
      type: String,
      default: ""
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
        ret.createdAt = iso(ret.createdAt);
        ret.updatedAt = iso(ret.updatedAt);
        return ret;
      }
    }
  }
);

inventorySchema.index({ productId: 1, date: 1 }, { unique: true });
inventorySchema.index({ updatedAt: -1 });

export const InventoryEntryModel = model("InventoryEntry", inventorySchema);
