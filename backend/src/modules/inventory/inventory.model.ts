import { Schema, model, models } from "mongoose";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

export interface IInventoryEntry {
  _id?: string;
  ownerAdminId: string;
  localId: string;
  deviceId: string;
  productId: string;
  date: string;
  startQuantity: number;
  currentQuantity: number;
  buyPrice: number;
  sellPrice: number;
  note: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

const inventoryEntrySchema = new Schema<IInventoryEntry>(
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
    productId: {
      type: String,
      required: true,
      trim: true
    },
    date: {
      type: String,
      required: true
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
    buyPrice: {
      type: Number,
      min: 0,
      default: 0
    },
    sellPrice: {
      type: Number,
      min: 0,
      default: 0
    },
    note: {
      type: String,
      default: ""
    }
  },
  {
    collection: "inventory_entries",
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

inventoryEntrySchema.index(
  { ownerAdminId: 1, localId: 1 },
  { unique: true, name: "idx_unique_owner_localid", background: true }
);

inventoryEntrySchema.index(
  { ownerAdminId: 1, productId: 1, date: 1 },
  { unique: true, name: "idx_unique_product_date", background: true }
);

inventoryEntrySchema.index(
  { ownerAdminId: 1, date: 1, createdAt: 1 },
  { name: "idx_range_date", background: true }
);

inventoryEntrySchema.index(
  { ownerAdminId: 1, updatedAt: 1 },
  { name: "idx_owner_updatedat", background: true }
);

export const InventoryEntryModel =
  models.InventoryEntry ?? model<IInventoryEntry>("InventoryEntry", inventoryEntrySchema);
