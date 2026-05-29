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
async function dropStaleIndex(collectionName: string, indexName: string) {
  const db = mongoose.connection.db;
  if (!db) return;

  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);
  if (!existingCollections.includes(collectionName)) return;

  const collection = db.collection(collectionName);

  let indexes: Array<{ name?: string }> = [];
  try {
    indexes = await collection.indexes();
  } catch {
    return;
  }

  if (!indexes.some((idx) => idx.name === indexName)) return;

  try {
    await collection.dropIndex(indexName);
    console.log(`[migrateFixDisplayIndex] Dropped stale index ${indexName} on ${collectionName}`);
  } catch (error) {
    console.warn(
      `[migrateFixDisplayIndex] Could not drop ${indexName} on ${collectionName}:`,
      (error as Error).message
    );
  }
}

export async function migrateFixDisplayIndex() {
  if (mongoose.connection.readyState !== 1) return;

  // Stale UNIQUE index on products.displayIndex (presentation ordering, not identity).
  await dropStaleIndex("products", "idx_unique_displayindex");

  // Stale UNIQUE index on users.phone_number: the login identifier moved to
  // `username`, and phone_number is now a non-unique additional field (default
  // ""). A leftover unique index would throw E11000 on the second user.
  await dropStaleIndex("users", "phone_number_1");
}
