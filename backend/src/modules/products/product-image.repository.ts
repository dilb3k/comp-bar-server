import { ProductImageModel } from "./product-image.model";

export class ProductImageRepository {
  async upsertByHash(hash: string, data: string, mimeType?: string) {
    return ProductImageModel.findOneAndUpdate(
      { hash },
      { $setOnInsert: { hash, data, mimeType, createdAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async findByHash(hash: string) {
    return ProductImageModel.findOne({ hash });
  }
}

export const productImageRepository = new ProductImageRepository();
