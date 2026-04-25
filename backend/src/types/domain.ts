export interface Product {
  id?: string;
  localId: string;
  deviceId: string;
  name: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  image?: string;
  isDeleted: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface InventoryEntry {
  id?: string;
  localId: string;
  deviceId: string;
  productId: string;
  date: string;
  startQuantity: number;
  currentQuantity: number;
  note?: string;
  isDeleted: boolean;
  updatedAt: string;
  createdAt: string;
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
  localId: string;
  deviceId: string;
  date: string;
  totalRevenue: number;
  totalProfit: number;
  totalSoldItems: number;
  items: DailySnapshotItem[];
  isDeleted: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface SyncPayload {
  products?: Product[];
  inventory?: InventoryEntry[];
  daily?: DailySnapshot[];
  snapshots?: DailySnapshot[];
  lastSyncAt?: string;
}
