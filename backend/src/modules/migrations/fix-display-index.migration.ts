import mongoose from "mongoose";
import { ProductModel } from "../products/product.model";

export async function migrateFixDisplayIndex() {
  if (mongoose.connection.readyState !== 1) return;

  const db = mongoose.connection.db;
  if (!db) return;

  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);
  if (!existingCollections.includes("products")) return;

  const result = await ProductModel.updateMany(
    { displayIndex: 0, isDeleted: false },
    { $set: { displayIndex: 1 } }
  );

  if (result.modifiedCount > 0) {
    console.log(`[migrateFixDisplayIndex] Updated ${result.modifiedCount} products with displayIndex: 0`);
  }
}
