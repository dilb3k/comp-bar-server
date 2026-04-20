import { inventoryRepository } from "../inventory/inventory.repository";
import { productRepository } from "../products/product.repository";
import { snapshotRepository } from "../snapshots/snapshot.repository";

type SyncInput = {
  products?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  inventory?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  snapshots?: Array<Record<string, unknown> & { localId: string; updatedAt: string; createdAt: string }>;
  lastSyncAt?: string;
};

export class SyncService {
  async sync(payload: SyncInput) {
    const products = payload.products ?? [];
    const inventory = payload.inventory ?? [];
    const snapshots = payload.snapshots ?? [];

    await Promise.all(
      products.map((item) =>
        productRepository.upsertLastWriteWins({
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          deletedAt: item.isDeleted ? new Date(item.updatedAt) : null
        })
      )
    );

    await Promise.all(
      inventory.map((item) =>
        inventoryRepository.upsertLastWriteWins({
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt)
        })
      )
    );

    await Promise.all(
      snapshots.map((item) =>
        snapshotRepository.upsertLastWriteWins({
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt)
        })
      )
    );

    const [serverProducts, serverInventory, serverSnapshots] = await Promise.all([
      productRepository.findAllUpdatedSince(payload.lastSyncAt),
      inventoryRepository.findUpdatedSince(payload.lastSyncAt),
      snapshotRepository.findUpdatedSince(payload.lastSyncAt)
    ]);

    return {
      products: serverProducts.map((item) => item.toJSON()),
      inventory: serverInventory.map((item) => item.toJSON()),
      snapshots: serverSnapshots.map((item) => item.toJSON()),
      serverTime: new Date().toISOString()
    };
  }
}

export const syncService = new SyncService();
