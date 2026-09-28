import { Schema, model, models } from "mongoose";

// LEGACY (deprecated). Product photos are now stored in Cloudflare R2 and
// referenced by Product.imageUrl — see lib/r2.ts and
// utils/image-processing.ts. This collection and the GET
// /api/products/image/:hash route that reads it are kept, unmodified, only
// so products created before that migration keep resolving their photo.
// Nothing new is written here unless R2 is unconfigured (dev-only fallback,
// see product-image.ts's processProductImageInput).
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
