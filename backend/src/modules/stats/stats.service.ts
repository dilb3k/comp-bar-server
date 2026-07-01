import mongoose from "mongoose";
import { UserModel } from "../auth/user.model";
import { ProductModel } from "../products/product.model";
import { InventoryEntryModel } from "../inventory/inventory.model";
import { DailySnapshotModel } from "../snapshots/snapshot.model";
import { DebtorModel } from "../debtors/debtor.model";
import { SubscriptionModel } from "../subscriptions/subscription.model";

export class StatsService {
  async getDatabaseStats() {
    const [
      totalAdmins,
      totalProducts,
      totalInventory,
      totalSnapshots,
      totalDebtors,
      totalSubscriptions,
      totalActiveSubscriptions,
    ] = await Promise.all([
      UserModel.countDocuments({ role: "admin" }),
      ProductModel.countDocuments({}),
      InventoryEntryModel.countDocuments({}),
      DailySnapshotModel.countDocuments({}),
      DebtorModel.countDocuments(),
      SubscriptionModel.countDocuments(),
      SubscriptionModel.countDocuments({ isActive: true }),
    ]);

    let dbSize = "N/A";
    let storageSize = "N/A";
    let indexSize = "N/A";
    let totalSize = "N/A";
    let collections = 0;
    let objects = 0;
    let avgObjectSize = "0 B";
    try {
      const db = mongoose.connection.db;
      if (db) {
        const dbStats = await db.stats();
        dbSize = this.formatBytes((dbStats as any).dataSize ?? 0);
        storageSize = this.formatBytes((dbStats as any).storageSize ?? 0);
        indexSize = this.formatBytes((dbStats as any).indexSize ?? 0);
        totalSize = this.formatBytes((dbStats as any).totalSize ?? (dbStats as any).fileSize ?? 0);
        collections = (dbStats as any).collections ?? 0;
        objects = (dbStats as any).objects ?? 0;
        const avgObjBytes = (dbStats as any).avgObjSize ?? 0;
        avgObjectSize = this.formatBytes(avgObjBytes);
      }
    } catch {
      // db.stats() may timeout on free tier, skip silently
    }

    return {
      database: {
        name: mongoose.connection.db?.databaseName ?? "unknown",
        size: dbSize,
        storageSize,
        indexSize,
        totalSize,
        collections,
        objects,
        avgObjectSize,
      },
      records: {
        totalAdmins,
        totalProducts,
        totalInventory,
        totalSnapshots,
        totalDebtors,
        totalSubscriptions,
        totalActiveSubscriptions,
        totalRecords:
          totalAdmins +
          totalProducts +
          totalInventory +
          totalSnapshots +
          totalDebtors +
          totalSubscriptions,
      },
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
