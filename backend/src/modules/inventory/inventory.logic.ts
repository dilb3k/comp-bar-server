import type { InventoryEntry } from "../../types/domain";

export function calculateSold(startQuantity: number, currentQuantity: number) {
  return Math.max(startQuantity - currentQuantity, 0);
}

export function getAdjustedInventoryQuantities(
  previousStartQuantity: number,
  previousCurrentQuantity: number,
  newQuantity: number
) {
  const soldSoFar = calculateSold(previousStartQuantity, previousCurrentQuantity);
  return {
    soldSoFar,
    startQuantity: soldSoFar + newQuantity,
    currentQuantity: newQuantity
  };
}

export function deriveMissingInventoryEntry(
  product: Pick<InventoryEntry, never> & {
    localId: string;
    deviceId: string;
    quantity: number;
  },
  date: string
): InventoryEntry {
  const now = new Date().toISOString();
  return {
    localId: `derived_${product.localId}_${date}`,
    deviceId: product.deviceId,
    productId: product.localId,
    date,
    startQuantity: product.quantity,
    currentQuantity: product.quantity,
    note: "",
    isDeleted: false,
    updatedAt: now,
    createdAt: now
  };
}
