import mongoose from "mongoose";
import { UserModel } from "../auth/user.model";
import { ProductModel } from "../products/product.model";
import { InventoryEntryModel } from "../inventory/inventory.model";
import { DailySnapshotModel } from "../snapshots/snapshot.model";
import { DebtorModel } from "../debtors/debtor.model";
import { SubscriptionModel } from "../subscriptions/subscription.model";
import { CatalogItemModel } from "../catalog/catalog-item.model";

export class StatsService {
  async getDatabaseStats() {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database not connected");
    }

    const dbStats = await db.stats();

    const [
      totalAdmins,
      totalProducts,
      totalInventory,
      totalSnapshots,
      totalDebtors,
      totalSubscriptions,
      totalActiveSubscriptions,
      totalCatalogItems,
    ] = await Promise.all([
      UserModel.countDocuments({ role: "admin" }),
      ProductModel.countDocuments({ isDeleted: false }),
      InventoryEntryModel.countDocuments({ isDeleted: false }),
      DailySnapshotModel.countDocuments({ isDeleted: false }),
      DebtorModel.countDocuments(),
      SubscriptionModel.countDocuments(),
      SubscriptionModel.countDocuments({ isActive: true }),
      CatalogItemModel.countDocuments({ isDeleted: false }),
    ]);

    // Get per-collection storage stats
    const collections = await db.listCollections().toArray();
    const collectionStats: Record<string, { count: number; size: string }> = {};

    for (const col of collections) {
      const colStats = await db.command({ collStats: col.name }) as any;
      collectionStats[col.name] = {
        count: colStats.count ?? 0,
        size: this.formatBytes(colStats.size ?? 0),
      };
    }

    return {
      database: {
        name: db.databaseName,
        size: this.formatBytes(dbStats.dataSize),
        storageSize: this.formatBytes(dbStats.storageSize),
        indexSize: this.formatBytes(dbStats.indexSize),
        totalSize: this.formatBytes(dbStats.dataSize + dbStats.indexSize),
        collections: dbStats.collections,
        objects: dbStats.objects,
        avgObjectSize: this.formatBytes(dbStats.avgObjSize),
      },
      records: {
        totalAdmins,
        totalProducts,
        totalInventory,
        totalSnapshots,
        totalDebtors,
        totalSubscriptions,
        totalActiveSubscriptions,
        totalCatalogItems,
        totalRecords:
          totalAdmins +
          totalProducts +
          totalInventory +
          totalSnapshots +
          totalDebtors +
          totalSubscriptions +
          totalCatalogItems,
      },
      collections: collectionStats,
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }
}

export const statsService = new StatsService();
