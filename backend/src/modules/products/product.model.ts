import { Schema, model, models } from "mongoose";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

export interface IProduct {
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
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

const productSchema = new Schema<IProduct>(
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
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },
    deletedAt: {
      type: Date,
      default: null
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
        delete ret.deletedAt;
        ret.createdAt = iso(ret.createdAt);
        ret.updatedAt = iso(ret.updatedAt);
        return ret;
      }
    }
  }
);

productSchema.index(
  { ownerAdminId: 1, localId: 1 },
  { unique: true, name: "idx_unique_owner_localid", background: true }
);

productSchema.index(
  { ownerAdminId: 1, isDeleted: 1, displayIndex: 1 },
  { name: "idx_product_list_active_sorted", background: true }
);

productSchema.index(
  { ownerAdminId: 1, displayIndex: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: "idx_unique_displayindex_active",
    background: true
  }
);

productSchema.index(
  { ownerAdminId: 1, updatedAt: 1 },
  { name: "idx_owner_updatedat", background: true }
);

productSchema.index(
  { ownerAdminId: 1, name: "text" },
  { name: "idx_name_text", default_language: "none", background: true }
);

productSchema.index(
  { ownerAdminId: 1, isDeleted: 1, name: 1 },
  {
    name: "idx_name_regex",
    collation: { locale: "en", strength: 2 },
    background: true
  }
);

export const ProductModel =
  models.Product ?? model<IProduct>("Product", productSchema);
