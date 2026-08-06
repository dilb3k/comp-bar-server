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
  barcodes?: string[];
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
    barcodes: {
      type: [String],
      default: undefined
    }
  },
  {
    collection: "products",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        ret.id = ret._id.toString();
        ret._id = ret.id;
        delete ret.ownerAdminId;
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

// displayIndex is presentation ordering, NOT an identity. It must never be
// unique: products are created/synced with a default displayIndex of 1 and
// reorders temporarily collide, both of which would throw E11000 under a
// unique index (and the legacy fix-displayIndex migration itself produced
// duplicate values). A single non-unique index supports the list sort.
productSchema.index(
  { ownerAdminId: 1, displayIndex: 1 },
  { name: "idx_product_list_active_sorted", background: true }
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
  { ownerAdminId: 1, name: 1 },
  {
    name: "idx_name_regex",
    collation: { locale: "en", strength: 2 },
    background: true
  }
);

// Unlike displayIndex (presentation ordering, deliberately non-unique — see
// comment above), a barcode is an identity: two products for the same admin
// must never share one. `sparse: true` keeps products without a barcode
// (undefined/no `barcodes` field) from colliding with each other. Scoped to
// ownerAdminId, matching the tenant-scoped uniqueness convention used by
// idx_unique_owner_localid above (barcodes are not required to be globally
// unique across different tenants).
productSchema.index(
  { ownerAdminId: 1, barcodes: 1 },
  {
    name: "idx_barcodes",
    background: true,
    unique: true,
    sparse: true
  }
);

export const ProductModel =
  models.Product ?? model<IProduct>("Product", productSchema);
