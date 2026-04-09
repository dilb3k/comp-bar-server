import { randomUUID } from "crypto";
import { model, Schema } from "mongoose";

type ProductDocument = {
  id: string;
  workspaceId: string;
  name: string;
  costPrice: number;
  sellPrice: number;
  initialStock: number;
  createdAt: Date;
  updatedAt: Date;
};

const productSchema = new Schema<ProductDocument>(
  {
    id: { type: String, default: randomUUID, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    costPrice: { type: Number, required: true, min: 0 },
    sellPrice: { type: Number, required: true, min: 0 },
    initialStock: { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

productSchema.index({ workspaceId: 1, updatedAt: -1 });

export const ProductModel = model<ProductDocument>("Product", productSchema);
