import { Schema, model, models } from "mongoose";

import { DEFAULT_UNIT, PRODUCT_UNITS, normalizeUnit, type ProductUnit } from "../../utils/quantity";

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
  unit: ProductUnit;
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
    // Unit of measure. Documents written before this field existed have no
    // `unit` key at all (mongoose `default` only applies on insert, not on
    // read), so toJSON below normalizes it — every client therefore sees a
    // concrete unit and no backfill migration is needed.
    unit: {
      type: String,
      enum: PRODUCT_UNITS,
      default: DEFAULT_UNIT
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
        ret.unit = normalizeUnit(ret.unit);
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
// must never share one. Scoped to ownerAdminId, matching the tenant-scoped
// uniqueness convention used by idx_unique_owner_localid above (barcodes are
// not required to be globally unique across different tenants).
//
// PARTIAL, not sparse. A compound *sparse* index includes a document when ANY
// indexed field exists — and `ownerAdminId` always exists — so every product
// got indexed, barcode-less ones under a `barcodes: null` key. That made the
// second barcode-less product for an admin collide with the first on
// {ownerAdminId, null} and fail with E11000, i.e. an admin could only ever
// own one product without a barcode.
//
// `$type: "string"` is what excludes them: on an array field it matches only
// when at least one element is a string, so products with no `barcodes` field
// AND products with an empty `barcodes: []` both fall outside the index, while
// every real barcode stays covered by the uniqueness guarantee.
productSchema.index(
  { ownerAdminId: 1, barcodes: 1 },
  {
    name: "idx_barcodes",
    background: true,
    unique: true,
    partialFilterExpression: { barcodes: { $type: "string" } }
  }
);

export const ProductModel =
  models.Product ?? model<IProduct>("Product", productSchema);
