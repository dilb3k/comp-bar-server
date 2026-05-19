import mongoose from "mongoose";

type OldRecord = Record<string, unknown>;

function asDate(value?: Date | string | null) {
  return value ? new Date(value) : new Date();
}

export async function migrateSplitCollections() {
  if (mongoose.connection.readyState !== 1) return;

  const db = mongoose.connection.db;
  if (!db) return;

  const existingCollections = (await db.listCollections().toArray()).map((c) => c.name);

  const hasNewProducts = existingCollections.includes("products") &&
    (await db.collection("products").countDocuments()) > 0;
  const hasInventoryEntries = existingCollections.includes("inventory_entries") &&
    (await db.collection("inventory_entries").countDocuments()) > 0;
  const hasDailySnapshots = existingCollections.includes("daily_snapshots") &&
    (await db.collection("daily_snapshots").countDocuments()) > 0;

  // Check if old unified collection still has data
  const oldHasData = existingCollections.includes("products") &&
    (await db.collection("products").countDocuments({ recordType: { $exists: true } })) > 0;

  if (!oldHasData || (hasNewProducts && hasInventoryEntries && hasDailySnapshots)) {
    return;
  }

  const oldDocs = await db.collection("products").find({ recordType: { $exists: true } }).toArray();

  const productDocs: OldRecord[] = [];
  const inventoryDocs: OldRecord[] = [];
  const snapshotDocs: OldRecord[] = [];

  for (const doc of oldDocs) {
    const recordType = doc.recordType as string | undefined;

    const base = {
      ownerAdminId: doc.ownerAdminId ?? "",
      localId: doc.localId ?? "",
      deviceId: doc.deviceId ?? "",
      isDeleted: doc.isDeleted ?? false,
      deletedAt: doc.deletedAt ?? null,
      createdAt: asDate(doc.createdAt),
      updatedAt: asDate(doc.updatedAt),
    };

    if (recordType === "product") {
      const p = (doc.product as OldRecord) ?? {};
      productDocs.push({
        ...base,
        name: p.name ?? "",
        quantity: p.quantity ?? 0,
        buyPrice: p.buyPrice ?? 0,
        sellPrice: p.sellPrice ?? 0,
        image: p.image ?? "",
        displayIndex: p.displayIndex ?? 0,
      });
    } else if (recordType === "inventory") {
      const inv = (doc.inventory as OldRecord) ?? {};
      inventoryDocs.push({
        ...base,
        productId: inv.productId ?? "",
        date: inv.date ?? "",
        startQuantity: inv.startQuantity ?? 0,
        currentQuantity: inv.currentQuantity ?? 0,
        buyPrice: inv.buyPrice ?? 0,
        sellPrice: inv.sellPrice ?? 0,
        note: inv.note ?? "",
      });
    } else if (recordType === "daily") {
      const d = (doc.daily as OldRecord) ?? {};
      snapshotDocs.push({
        ...base,
        date: d.date ?? "",
        totalRevenue: d.totalRevenue ?? 0,
        totalProfit: d.totalProfit ?? 0,
        totalSoldItems: d.totalSoldItems ?? 0,
        items: d.items ?? [],
      });
    }
  }

  const operations: Promise<any>[] = [];

  if (productDocs.length > 0) {
    operations.push(
      db.collection("products").bulkWrite(
        productDocs.map((doc) => ({
          replaceOne: {
            filter: { ownerAdminId: doc.ownerAdminId, localId: doc.localId },
            replacement: doc,
            upsert: true,
          },
        })),
        { ordered: false }
      )
    );
  }

  if (inventoryDocs.length > 0) {
    operations.push(
      db.collection("inventory_entries").bulkWrite(
        inventoryDocs.map((doc) => ({
          replaceOne: {
            filter: { ownerAdminId: doc.ownerAdminId, localId: doc.localId },
            replacement: doc,
            upsert: true,
          },
        })),
        { ordered: false }
      )
    );
  }

  if (snapshotDocs.length > 0) {
    operations.push(
      db.collection("daily_snapshots").bulkWrite(
        snapshotDocs.map((doc) => ({
          replaceOne: {
            filter: { ownerAdminId: doc.ownerAdminId, localId: doc.localId },
            replacement: doc,
            upsert: true,
          },
        })),
        { ordered: false }
      )
    );
  }

  if (operations.length > 0) {
    await Promise.all(operations);
  }
}
