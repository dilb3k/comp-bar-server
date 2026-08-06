import mongoose from "mongoose";

/**
 * Idempotent, safe-to-run-always healer for the products.idx_barcodes index.
 *
 * product.model.ts now declares { ownerAdminId, barcodes } as UNIQUE (sparse)
 * to close a race where two near-simultaneous requests could create two
 * products sharing one barcode (previously only checked at the application
 * level via findByBarcode, which is a find-then-create race). Mongoose's
 * autoIndex does not upgrade an *existing* index in place when only its
 * options change (same name + keys, different `unique`) — MongoDB rejects
 * that as an index-options conflict and leaves the old (non-unique) index
 * standing, silently. So we handle the transition explicitly here, the same
 * way fix-display-index.migration.ts handles its own stale-index case.
 *
 * Safety: if any admin already has two+ products sharing a barcode (possible
 * pre-existing data from before this fix), creating the unique index would
 * fail outright. We NEVER auto-resolve that by deleting or renaming data —
 * we only detect it, log every conflicting group loudly so an operator can
 * fix it manually, and leave the old non-unique index in place until the
 * data is clean. Once clean, a subsequent boot will create the unique index.
 */
export async function migrateProductBarcodeUniqueIndex() {
  if (mongoose.connection.readyState !== 1) return;

  const db = mongoose.connection.db;
  if (!db) return;

  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);
  if (!existingCollections.includes("products")) return;

  const collection = db.collection("products");

  let indexes: Array<{ name?: string; unique?: boolean }> = [];
  try {
    indexes = await collection.indexes();
  } catch {
    return;
  }

  const existingIndex = indexes.find((idx) => idx.name === "idx_barcodes");
  if (existingIndex?.unique) {
    // Already migrated.
    return;
  }

  // Detect pre-existing duplicate barcodes within the same tenant. Never
  // auto-delete/auto-rename — just report and bail so the unique index is
  // not attempted (and does not crash the app) until data is fixed.
  let duplicates: Array<{ _id: { ownerAdminId: string; barcode: string }; count: number; productIds: unknown[] }> = [];
  try {
    duplicates = (await collection
      .aggregate([
        { $match: { barcodes: { $exists: true, $ne: [] } } },
        { $unwind: "$barcodes" },
        {
          $group: {
            _id: { ownerAdminId: "$ownerAdminId", barcode: "$barcodes" },
            count: { $sum: 1 },
            productIds: { $push: "$_id" },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray()) as any[];
  } catch (error) {
    console.warn(
      "[migrateProductBarcodeUniqueIndex] Could not check for pre-existing duplicate barcodes:",
      (error as Error).message,
    );
    return;
  }

  if (duplicates.length > 0) {
    console.error(
      `[migrateProductBarcodeUniqueIndex] Found ${duplicates.length} barcode(s) shared by multiple products for the same admin. ` +
        "The unique barcode index was NOT created — manually resolve these (e.g. clear/change the barcode on the duplicate " +
        "product) and restart the server to complete the migration. Conflicting groups:",
    );
    for (const dup of duplicates) {
      console.error(
        `  ownerAdminId=${dup._id.ownerAdminId} barcode=${dup._id.barcode} productIds=[${dup.productIds.join(", ")}]`,
      );
    }
    return;
  }

  if (existingIndex && !existingIndex.unique) {
    try {
      await collection.dropIndex("idx_barcodes");
      console.log("[migrateProductBarcodeUniqueIndex] Dropped stale non-unique idx_barcodes index on products");
    } catch (error) {
      console.warn(
        "[migrateProductBarcodeUniqueIndex] Could not drop stale idx_barcodes index:",
        (error as Error).message,
      );
      return;
    }
  }

  try {
    await collection.createIndex(
      { ownerAdminId: 1, barcodes: 1 },
      { name: "idx_barcodes", unique: true, sparse: true, background: true },
    );
    console.log("[migrateProductBarcodeUniqueIndex] Created unique idx_barcodes index on products");
  } catch (error) {
    console.warn(
      "[migrateProductBarcodeUniqueIndex] Could not create unique idx_barcodes index:",
      (error as Error).message,
    );
  }
}
