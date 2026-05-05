import type { AuthUser } from "../auth/auth.types";
import { telegramReportService } from "../../services/telegram-report.service";
import { inventoryRepository } from "../inventory/inventory.repository";
import { productRepository } from "../products/product.repository";
import { snapshotRepository } from "../snapshots/snapshot.repository";

type SyncInput = {
  products?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  inventory?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  daily?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string; deviceId: string; date: string }>;
  snapshots?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string; deviceId: string; date: string }>;
  lastSyncAt?: string;
};

export class SyncService {
  async sync(actor: AuthUser, payload: SyncInput) {
    const products = payload.products ?? [];
    const inventory = payload.inventory ?? [];
    const snapshots = payload.daily ?? payload.snapshots ?? [];

    await Promise.all(
      products.map((item) =>
        productRepository.upsertLastWriteWins(actor.userId, {
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          deletedAt: item.isDeleted ? new Date(item.updatedAt) : null
        })
      )
    );

    await Promise.all(
      inventory.map((item) =>
        inventoryRepository.upsertLastWriteWins(actor.userId, {
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt)
        })
      )
    );

    await Promise.all(
      snapshots.map((item) =>
        snapshotRepository.upsertLastWriteWins(actor.userId, {
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          deviceId: item.deviceId,
          date: item.date
        })
      )
    );

    const [serverProducts, serverInventory, serverSnapshots] = await Promise.all([
      productRepository.findAllUpdatedSince(actor.userId, payload.lastSyncAt),
      inventoryRepository.findUpdatedSince(actor.userId, payload.lastSyncAt),
      snapshotRepository.findUpdatedSince(actor.userId, payload.lastSyncAt)
    ]);

    if (products.length > 0 || inventory.length > 0 || snapshots.length > 0) {
      telegramReportService.reportSync(actor, {
        products: products.length,
        inventory: inventory.length,
        snapshots: snapshots.length,
        lastSyncAt: payload.lastSyncAt
      });
    }

    return {
      products: serverProducts.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
      inventory: serverInventory.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
      daily: serverSnapshots.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
      snapshots: serverSnapshots.map((item: { toJSON: () => Record<string, unknown> }) => item.toJSON()),
      serverTime: new Date().toISOString()
    };
  }
}

export const syncService = new SyncService();
