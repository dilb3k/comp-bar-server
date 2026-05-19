import mongoose from "mongoose";

type LegacyCatalogDoc = {
  ownerAdminId?: string | null;
  localId?: string | null;
  deviceId?: string | null;
  entityType?: "product" | "inventory";
  name?: string;
  quantity?: number;
  buyPrice?: number;
  sellPrice?: number;
  image?: string;
  productId?: string;
  date?: string;
  startQuantity?: number;
  currentQuantity?: number;
  note?: string;
  isDeleted?: boolean;
  deletedAt?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

type LegacySnapshotDoc = {
  ownerAdminId?: string | null;
  localId?: string | null;
  deviceId?: string | null;
  date?: string;
  totalRevenue?: number;
  totalProfit?: number;
  totalSoldItems?: number;
  items?: Array<Record<string, unknown>>;
  isDeleted?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

function asDate(value?: Date | string | null) {
  return value ? new Date(value) : new Date();
}

function normalizeOwner(value?: string | null) {
  return value ? String(value) : null;
}

function normalizeLegacyCatalogDoc(doc: LegacyCatalogDoc) {
  const ownerAdminId = normalizeOwner(doc.ownerAdminId);

  if (!ownerAdminId || !doc.localId || !doc.deviceId || !doc.entityType) {
    return null;
  }

  if (doc.entityType === "product") {
    return {
      collection: "products" as const,
      filter: { ownerAdminId, localId: doc.localId },
      replacement: {
        ownerAdminId,
        localId: doc.localId,
        deviceId: doc.deviceId,
        name: doc.name ?? "",
        quantity: doc.quantity ?? 0,
        buyPrice: doc.buyPrice ?? 0,
        sellPrice: doc.sellPrice ?? 0,
        image: doc.image ?? "",
        displayIndex: 0,
        isDeleted: doc.isDeleted ?? false,
        deletedAt: doc.deletedAt ?? null,
        createdAt: asDate(doc.createdAt),
        updatedAt: asDate(doc.updatedAt),
      }
    };
  }

  return {
    collection: "inventory_entries" as const,
    filter: { ownerAdminId, localId: doc.localId },
    replacement: {
      ownerAdminId,
      localId: doc.localId,
      deviceId: doc.deviceId,
      productId: doc.productId ?? "",
      date: doc.date ?? "",
      startQuantity: doc.startQuantity ?? 0,
      currentQuantity: doc.currentQuantity ?? 0,
      buyPrice: 0,
      sellPrice: 0,
      note: doc.note ?? "",
      isDeleted: doc.isDeleted ?? false,
      createdAt: asDate(doc.createdAt),
      updatedAt: asDate(doc.updatedAt),
    }
  };
}

function normalizeLegacySnapshotDoc(doc: LegacySnapshotDoc) {
  const ownerAdminId = normalizeOwner(doc.ownerAdminId);

  if (!ownerAdminId || !doc.localId || !doc.deviceId || !doc.date) {
    return null;
  }

  return {
    collection: "daily_snapshots" as const,
    filter: { ownerAdminId, localId: doc.localId },
    replacement: {
      ownerAdminId,
      localId: doc.localId,
      deviceId: doc.deviceId,
      date: doc.date,
      totalRevenue: doc.totalRevenue ?? 0,
      totalProfit: doc.totalProfit ?? 0,
      totalSoldItems: doc.totalSoldItems ?? 0,
      items: doc.items ?? [],
      isDeleted: doc.isDeleted ?? false,
      createdAt: asDate(doc.createdAt),
      updatedAt: asDate(doc.updatedAt),
    }
  };
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

export async function migrateLegacyProductRecords() {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const [legacyCatalogDocs, legacySnapshotDocs] = await Promise.all([
    mongoose.connection.collection("catalog_items").find({}).toArray().catch(() => []),
    mongoose.connection.collection("dailysnapshots").find({}).toArray().catch(() => [])
  ]);

  const normalized = [
    ...legacyCatalogDocs
      .map((doc) => normalizeLegacyCatalogDoc(doc as LegacyCatalogDoc))
      .filter(isDefined),
    ...legacySnapshotDocs
      .map((doc) => normalizeLegacySnapshotDoc(doc as LegacySnapshotDoc))
      .filter(isDefined)
  ];

  if (normalized.length === 0) {
    return;
  }

  const grouped = new Map<string, { filter: Record<string, unknown>; replacement: Record<string, unknown> }[]>();
  for (const entry of normalized) {
    const list = grouped.get(entry.collection) ?? [];
    list.push({ filter: entry.filter, replacement: entry.replacement });
    grouped.set(entry.collection, list);
  }

  for (const [collectionName, ops] of grouped) {
    const bulkOps = ops.map((op) => ({
      replaceOne: {
        filter: op.filter,
        replacement: op.replacement,
        upsert: true,
      },
    }));

    await mongoose.connection.collection(collectionName).bulkWrite(bulkOps, { ordered: false });
  }
}
