import assert from "node:assert/strict";

import { getBusinessDate, isPastBusinessDate, getEffectiveHour } from "../utils/business-day";
import {
  calculateSold,
  getAdjustedInventoryQuantities
} from "../modules/inventory/inventory.logic";
import { aggregateSnapshot, buildSnapshotItem } from "../modules/snapshots/snapshot.logic";
import { normalizeProductImage } from "../modules/products/product-image";
import { updateProductSchema } from "../modules/products/product.validation";
import { syncPayloadSchema } from "../modules/sync/sync.validation";
import { normalizePhone, maskPhone } from "../modules/auth/auth.utils";

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

run("getBusinessDate is timezone-deterministic and applies the offset", () => {
  // Naive timestamps must be read as UTC, never the server's local timezone.
  assert.equal(getBusinessDate("2026-04-20T12:00:00", 0, 0), "2026-04-20");
  // 01:00 UTC + 5h offset = 06:00 local, business start 6 -> same business day.
  assert.equal(getBusinessDate("2026-04-20T01:00:00", 6, 300), "2026-04-20");
  // 00:30 UTC + 5h offset = 05:30 local < 6 -> previous business day.
  assert.equal(getBusinessDate("2026-04-20T00:30:00", 6, 300), "2026-04-19");
  // Explicit Z and explicit offset must agree (same instant).
  assert.equal(getBusinessDate("2026-04-20T01:00:00Z", 6, 300), "2026-04-20");
});

run("isPastBusinessDate returns true for past dates", () => {
  assert.equal(isPastBusinessDate("2026-04-19", "2026-04-20"), true);
  assert.equal(isPastBusinessDate("2026-04-20", "2026-04-20"), false);
  assert.equal(isPastBusinessDate("2026-04-21", "2026-04-20"), false);
});

run("getEffectiveHour uses pending hour when effective date has passed", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const result = getEffectiveHour({
    userId: "u1",
    username: "test",
    phone_number: "test",
    role: "admin",
    isPayed: false,
    tier: "tekin",
    businessDayStartHour: 7,
    pendingBusinessDayStartHour: 9,
    businessDayEffectiveFrom: yesterday.toISOString(),
  });
  assert.equal(result, 9);
});

run("getEffectiveHour falls back to active hour when effective date not passed", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const result = getEffectiveHour({
    userId: "u1",
    username: "test",
    phone_number: "test",
    role: "admin",
    isPayed: false,
    tier: "tekin",
    businessDayStartHour: 7,
    pendingBusinessDayStartHour: 9,
    businessDayEffectiveFrom: tomorrow.toISOString(),
  });
  assert.equal(result, 7);
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

run("aggregateSnapshot sums multiple items correctly", () => {
  const items = [
    buildSnapshotItem({ productId: "p1", productName: "Cola", startQuantity: 10, currentQuantity: 3, buyPrice: 10000, sellPrice: 15000 }),
    buildSnapshotItem({ productId: "p2", productName: "Fanta", startQuantity: 20, currentQuantity: 10, buyPrice: 8000, sellPrice: 12000 }),
  ];

  const totals = aggregateSnapshot(items);
  // p1: sold=7, rev=105000, profit=35000
  // p2: sold=10, rev=120000, profit=40000
  assert.equal(totals.totalSoldItems, 17);
  assert.equal(totals.totalRevenue, 225000);
  assert.equal(totals.totalProfit, 75000);
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

run("product image normalization drops local device paths", () => {
  assert.equal(normalizeProductImage("file:///data/user/0/app/cache/photo.jpg"), undefined);
  assert.equal(normalizeProductImage("content://media/external/images/1"), undefined);
});

run("product image normalization keeps shareable image values", () => {
  assert.equal(
    normalizeProductImage("https://cdn.example.com/products/cola.png"),
    "https://cdn.example.com/products/cola.png"
  );
  assert.equal(
    normalizeProductImage("data:image/png;base64,AAAA"),
    "data:image/png;base64,AAAA"
  );
});

run("sync validation rejects inventory with currentQuantity > startQuantity", () => {
  const result = syncPayloadSchema.safeParse({
    inventory: [
      {
        localId: "inv_1",
        deviceId: "dev_1",
        productId: "prd_1",
        date: "2026-04-20",
        startQuantity: 10,
        currentQuantity: 15,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z"
      }
    ]
  });
  assert.equal(result.success, false);
});

run("sync validation passes valid inventory", () => {
  const result = syncPayloadSchema.safeParse({
    inventory: [
      {
        localId: "inv_1",
        deviceId: "dev_1",
        productId: "prd_1",
        date: "2026-04-20",
        startQuantity: 10,
        currentQuantity: 5,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z"
      }
    ]
  });
  assert.equal(result.success, true);
});

run("normalizePhone strips formatting and keeps digits", () => {
  assert.equal(normalizePhone("+998 90 123 45 67"), "998901234567");
  assert.equal(normalizePhone("(998) 90-123-45-67"), "998901234567");
  assert.equal(normalizePhone(undefined), "");
  assert.equal(normalizePhone(""), "");
});

run("maskPhone hides middle digits, keeps head and tail", () => {
  const masked = maskPhone("998901234567");
  assert.equal(masked.startsWith("+998"), true);
  assert.equal(masked.includes("67"), true);
  assert.equal(masked.replace(/[^•]/g, "").length >= 4, true);
  assert.equal(maskPhone("12"), "+998 ••• ••• •• ••");
});

run("login verification decision requires active session AND phone", () => {
  const maskSession = (user: { activeSessionId?: string | null; phone_number?: string }) => {
    if (user.activeSessionId && user.phone_number && normalizePhone(user.phone_number).length >= 6) {
      return { maskedPhone: maskPhone(user.phone_number) };
    }
    return null;
  };
  assert.equal(maskSession({ activeSessionId: null, phone_number: "+998901234567" }), null);
  assert.equal(maskSession({ activeSessionId: "s1", phone_number: "" }), null);
  assert.equal(maskSession({ activeSessionId: "s1", phone_number: "12" }), null);
  const r = maskSession({ activeSessionId: "s1", phone_number: "+998901234567" });
  assert.notEqual(r, null);
  assert.equal((r as any).maskedPhone.startsWith("+998"), true);
});
