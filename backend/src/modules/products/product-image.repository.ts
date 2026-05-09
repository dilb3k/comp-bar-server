import { ProductImageModel } from "./product-image.model";

export class ProductImageRepository {
  async upsertByHash(hash: string, data: string, mimeType?: string) {
    const existing = await ProductImageModel.findOne({ hash });
    if (existing) return existing;
    return ProductImageModel.create({ hash, data, mimeType });
  }

  async findByHash(hash: string) {
    return ProductImageModel.findOne({ hash });
  }
}

export const productImageRepository = new ProductImageRepository();
