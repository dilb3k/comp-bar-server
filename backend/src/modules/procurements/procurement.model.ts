import { serverVersionPlugin } from "../../lib/versioning";
import { Schema, model, models } from "mongoose";

import { DEFAULT_UNIT, PRODUCT_UNITS, type ProductUnit } from "../../utils/quantity";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

export function serializeProcurement(value: any) {
  const ret = { serverVersion: 0, ...value, id: value._id.toString(), _id: value._id.toString() };
  delete ret.ownerAdminId;
  ret.items = (ret.items ?? []).map((item: any) => ({ unit: DEFAULT_UNIT, isNewProduct: false, ...item }));
  ret.createdAt = iso(ret.createdAt); ret.updatedAt = iso(ret.updatedAt);
  return ret;
}

export interface IProcurementItem {
  productId: string;
  name: string;
  unit: ProductUnit;
  quantity: number;
  buyPrice: number;
  lineCost: number;
  isNewProduct: boolean;
  previousBuyPrice?: number;
}

export interface IProcurement {
  _id?: string;
  ownerAdminId: string;
  localId: string;
  date: string;
  items: IProcurementItem[];
  totalCost: number;
  supplier?: string;
  // Who actually typed this in — "procurement" for a scoped Bozorchi token,
  // "full" for an admin/superAdmin entering a kirim themselves. Independent
  // of createdByUserId, which is always the same tenant account either way
  // (see auth.service.ts#loginAsProcurementAgent — ownership never changes,
  // only the capability that issued the write does).
  createdByScope: "procurement" | "full";
  createdByUserId: string;
  createdByUsername?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

const procurementItemSchema = new Schema<IProcurementItem>(
  {
    productId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    unit: { type: String, enum: PRODUCT_UNITS, default: DEFAULT_UNIT },
    quantity: { type: Number, required: true, min: 0 },
    buyPrice: { type: Number, required: true, min: 0 },
    lineCost: { type: Number, required: true, min: 0 },
    isNewProduct: { type: Boolean, default: false },
    previousBuyPrice: { type: Number, min: 0 },
  },
  { _id: false }
);

const procurementSchema = new Schema<IProcurement>(
  {
    ownerAdminId: { type: String, required: true, trim: true, index: true },
    localId: { type: String, required: true, trim: true },
    date: { type: String, required: true },
    items: { type: [procurementItemSchema], default: [] },
    totalCost: { type: Number, required: true, min: 0 },
    supplier: { type: String, trim: true, maxlength: 120 },
    createdByScope: { type: String, enum: ["procurement", "full"], required: true },
    createdByUserId: { type: String, required: true, trim: true },
    createdByUsername: { type: String, trim: true },
  },
  {
    collection: "procurements",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        return serializeProcurement(ret);
      },
    },
  }
);

procurementSchema.index(
  { ownerAdminId: 1, localId: 1 },
  { unique: true, name: "idx_unique_owner_localid", background: true }
);

procurementSchema.index(
  { ownerAdminId: 1, date: 1 },
  { name: "idx_owner_date", background: true }
);

procurementSchema.index({ ownerAdminId: 1, supplier: 1, date: -1 });
procurementSchema.index({ ownerAdminId: 1, "items.productId": 1, date: -1 });
procurementSchema.plugin(serverVersionPlugin);

export const ProcurementModel =
  models.Procurement ?? model<IProcurement>("Procurement", procurementSchema);
