import { Schema, model, models } from "mongoose";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

export interface ICatalogItem {
  _id?: string;
  ownerAdminId: string;
  localId: string;
  deviceId: string;
  name: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  image: string;
  displayIndex: number;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

const catalogItemSchema = new Schema<ICatalogItem>(
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
    name: {
      type: String,
      trim: true,
      default: ""
    },
    quantity: {
      type: Number,
      min: 0,
      default: 0
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
    image: {
      type: String,
      default: ""
    },
    displayIndex: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  {
    collection: "products",
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

catalogItemSchema.index(
  { ownerAdminId: 1, localId: 1 },
  { unique: true, name: "idx_unique_owner_localid", background: true }
);

catalogItemSchema.index(
  { ownerAdminId: 1, displayIndex: 1 },
  { name: "idx_product_list_active_sorted", background: true }
);

catalogItemSchema.index(
  { ownerAdminId: 1, updatedAt: 1 },
  { name: "idx_owner_updatedat", background: true }
);

catalogItemSchema.index(
  { ownerAdminId: 1, name: "text" },
  { name: "idx_name_text", default_language: "none", background: true }
);

catalogItemSchema.index(
  { ownerAdminId: 1, name: 1 },
  {
    name: "idx_name_regex",
    collation: { locale: "en", strength: 2 },
    background: true
  }
);

export const CatalogItemModel =
  models.CatalogItem ?? model<ICatalogItem>("CatalogItem", catalogItemSchema);
