import assert from "node:assert/strict";

import { getBusinessDate } from "../utils/business-day";
import {
  calculateSold,
  getAdjustedInventoryQuantities
} from "../modules/inventory/inventory.logic";
import { updateProductSchema } from "../modules/products/product.validation";
import { aggregateSnapshot, buildSnapshotItem } from "../modules/snapshots/snapshot.logic";
import { syncPayloadSchema } from "../modules/sync/sync.validation";

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("getBusinessDate shifts timestamps before 07:00 to previous day", () => {
  assert.equal(getBusinessDate("2026-04-20T06:59:00", 7), "2026-04-19");
  assert.equal(getBusinessDate("2026-04-20T07:00:00", 7), "2026-04-20");
});

run("product quantity updates preserve sold amount in current-day inventory", () => {
  const adjusted = getAdjustedInventoryQuantities(10, 4, 9);

  assert.equal(adjusted.soldSoFar, 6);
  assert.equal(adjusted.startQuantity, 15);
  assert.equal(adjusted.currentQuantity, 9);
});

run("snapshot aggregation derives revenue and profit from inventory", () => {
  const item = buildSnapshotItem({
    productId: "p1",
    productName: "Cola",
    startQuantity: 12,
    currentQuantity: 7,
    buyPrice: 10000,
    sellPrice: 15000
  });

  assert.equal(calculateSold(12, 7), 5);
  assert.deepEqual(item, {
    productId: "p1",
    productName: "Cola",
    sold: 5,
    buyPrice: 10000,
    sellPrice: 15000,
    revenue: 75000,
    profit: 25000
  });

  assert.deepEqual(aggregateSnapshot([item]), {
    totalRevenue: 75000,
    totalProfit: 25000,
    totalSoldItems: 5
  });
});

run("product update validation does not force image to empty string", () => {
  const parsed = updateProductSchema.parse({
    name: "Updated Cola"
  });

  assert.equal("image" in parsed, false);
});

run("sync validation preserves existing image when client omits the field", () => {
  const parsed = syncPayloadSchema.parse({
    products: [
      {
        localId: "prd_1",
        deviceId: "dev_1",
        name: "Cola",
        quantity: 5,
        buyPrice: 10000,
        sellPrice: 15000,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z"
      }
    ]
  });

  assert.equal("image" in (parsed.products?.[0] ?? {}), false);
});
