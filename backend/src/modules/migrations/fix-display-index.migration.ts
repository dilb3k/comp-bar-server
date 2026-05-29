import mongoose from "mongoose";

/**
 * Idempotent, safe-to-run-always healer.
 *
 * Older deployments created a UNIQUE index on { ownerAdminId, displayIndex }
 * (`idx_unique_displayindex`). displayIndex is presentation ordering, not an
 * identity, so that constraint throws E11000 on product creation, sync, and
 * reordering. Mongoose's autoIndex never drops stale indexes, so we drop it
 * explicitly here. No-op once the index is gone.
 */
export async function migrateFixDisplayIndex() {
  if (mongoose.connection.readyState !== 1) return;

  const db = mongoose.connection.db;
  if (!db) return;

  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);
  if (!existingCollections.includes("products")) return;

  const collection = db.collection("products");

  let indexes: Array<{ name?: string }> = [];
  try {
    indexes = await collection.indexes();
  } catch {
    return;
  }

  if (!indexes.some((idx) => idx.name === "idx_unique_displayindex")) return;

  try {
    await collection.dropIndex("idx_unique_displayindex");
    console.log("[migrateFixDisplayIndex] Dropped stale unique index idx_unique_displayindex");
  } catch (error) {
    console.warn(
      "[migrateFixDisplayIndex] Could not drop idx_unique_displayindex:",
      (error as Error).message
    );
  }
}
