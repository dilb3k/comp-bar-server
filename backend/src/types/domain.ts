export interface Product {
  id: string;
  ownerAdminId: string;
  localId: string;
  deviceId: string;
  name: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  image: string;
  displayIndex: number;
  barcodes?: string[];
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface InventoryEntry {
  id?: string;
  ownerAdminId?: string;
  localId: string;
  deviceId: string;
  productId: string;
  date: string;
  startQuantity: number;
  currentQuantity: number;
  buyPrice?: number;
  sellPrice?: number;
  lockedRevenue?: number;
  lockedProfit?: number;
  lockedSold?: number;
  note?: string;
  updatedAt: Date | string;
  createdAt: Date | string;
}

export interface DailySnapshotItem {
  productId: string;
  productName: string;
  sold: number;
  buyPrice?: number;
  sellPrice?: number;
  revenue: number;
  profit: number;
}

export interface DailySnapshot {
  id?: string;
  ownerAdminId?: string;
  localId: string;
  deviceId: string;
  date: string;
  totalRevenue: number;
  totalProfit: number;
  totalSoldItems: number;
  items: DailySnapshotItem[];
  updatedAt: Date | string;
  createdAt: Date | string;
}

export interface SyncPayload {
  products?: Product[];
  inventory?: InventoryEntry[];
  daily?: DailySnapshot[];
  snapshots?: DailySnapshot[];
  lastSyncAt?: string;
}
