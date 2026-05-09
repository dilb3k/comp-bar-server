import { Schema, model, models } from "mongoose";

export interface IProductImage {
  hash: string;
  data: string;
  mimeType?: string;
  createdAt: Date;
}

const productImageSchema = new Schema<IProductImage>(
  {
    hash: { type: String, required: true, unique: true, index: true },
    data: { type: String, required: true },
    mimeType: { type: String },
    createdAt: { type: Date, default: Date.now }
  },
  {
    collection: "product_images",
    timestamps: false,
    versionKey: false
  }
);

export const ProductImageModel =
  models.ProductImage ?? model<IProductImage>("ProductImage", productImageSchema);
