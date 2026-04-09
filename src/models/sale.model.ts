import { model, Schema } from "mongoose";

type SaleDocument = {
  id: string;
  workspaceId: string;
  productId: string;
  quantity: number;
  totalPrice: number;
  profit: number;
  createdAt: Date;
  createdBy: string;
};

const saleSchema = new Schema<SaleDocument>(
  {
    id: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    totalPrice: { type: Number, required: true, min: 0 },
    profit: { type: Number, required: true },
    createdAt: { type: Date, required: true, index: true },
    createdBy: { type: String, required: true, index: true }
  },
  { timestamps: false }
);

saleSchema.index({ workspaceId: 1, createdAt: 1 });

export const SaleModel = model<SaleDocument>("Sale", saleSchema);
