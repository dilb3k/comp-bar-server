import mongoose from "mongoose";

import { ProductModel } from "./product.model";

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
      filter: { ownerAdminId, recordType: "product", localId: doc.localId },
      replacement: {
        ownerAdminId,
        recordType: "product",
        localId: doc.localId,
        deviceId: doc.deviceId,
        isDeleted: doc.isDeleted ?? false,
        deletedAt: doc.deletedAt ?? null,
        createdAt: asDate(doc.createdAt),
        updatedAt: asDate(doc.updatedAt),
        product: {
          name: doc.name ?? "",
          quantity: doc.quantity ?? 0,
          buyPrice: doc.buyPrice ?? 0,
          sellPrice: doc.sellPrice ?? 0,
          image: doc.image ?? ""
        }
      }
    };
  }

  return {
    filter: { ownerAdminId, recordType: "inventory", localId: doc.localId },
    replacement: {
      ownerAdminId,
      recordType: "inventory",
      localId: doc.localId,
      deviceId: doc.deviceId,
      isDeleted: doc.isDeleted ?? false,
      createdAt: asDate(doc.createdAt),
      updatedAt: asDate(doc.updatedAt),
      inventory: {
        productId: doc.productId ?? "",
        date: doc.date ?? "",
        startQuantity: doc.startQuantity ?? 0,
        currentQuantity: doc.currentQuantity ?? 0,
        note: doc.note ?? ""
      }
    }
  };
}

function normalizeLegacySnapshotDoc(doc: LegacySnapshotDoc) {
  const ownerAdminId = normalizeOwner(doc.ownerAdminId);

  if (!ownerAdminId || !doc.localId || !doc.deviceId || !doc.date) {
    return null;
  }

  return {
    filter: { ownerAdminId, recordType: "daily", localId: doc.localId },
    replacement: {
      ownerAdminId,
      recordType: "daily",
      localId: doc.localId,
      deviceId: doc.deviceId,
      isDeleted: doc.isDeleted ?? false,
      createdAt: asDate(doc.createdAt),
      updatedAt: asDate(doc.updatedAt),
      daily: {
        date: doc.date,
        totalRevenue: doc.totalRevenue ?? 0,
        totalProfit: doc.totalProfit ?? 0,
        totalSoldItems: doc.totalSoldItems ?? 0,
        items: doc.items ?? []
      }
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
    mongoose.connection.collection("catalog_items").find({}).toArray(),
    mongoose.connection.collection("dailysnapshots").find({}).toArray()
  ]);

  const operations = [
    ...legacyCatalogDocs
      .map((doc) => normalizeLegacyCatalogDoc(doc as LegacyCatalogDoc))
      .filter(isDefined)
      .map((entry) => ({
        replaceOne: {
          filter: entry.filter,
          replacement: entry.replacement,
          upsert: true
        }
      })),
    ...legacySnapshotDocs
      .map((doc) => normalizeLegacySnapshotDoc(doc as LegacySnapshotDoc))
      .filter(isDefined)
      .map((entry) => ({
        replaceOne: {
          filter: entry.filter,
          replacement: entry.replacement,
          upsert: true
        }
      }))
  ];

  if (operations.length === 0) {
    return;
  }

  await ProductModel.bulkWrite(operations, { ordered: false });
}
