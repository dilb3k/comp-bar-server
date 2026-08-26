import assert from "node:assert/strict";

import { getBusinessDate, isPastBusinessDate, getEffectiveHour, getNextBusinessDayStart } from "../utils/business-day";
import {
  calculateInventoryMetrics,
  calculateSold,
  getAdjustedInventoryQuantities
} from "../modules/inventory/inventory.logic";
import {
  formatQuantity,
  normalizeQuantity,
  qtyGreaterThan,
  roundMoney,
  roundQty
} from "../utils/quantity";
import { aggregateSnapshot, buildSnapshotItem } from "../modules/snapshots/snapshot.logic";
import { normalizeProductImage } from "../modules/products/product-image";
import { updateProductSchema } from "../modules/products/product.validation";
import { syncPayloadSchema } from "../modules/sync/sync.validation";
import { normalizePhone, maskPhone, phoneVerificationRequired, shouldClearActiveSession } from "../modules/auth/auth.utils";

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
    // Defaulted, not passed: pre-unit snapshots must still resolve to the
    // countable unit rather than leaving the field undefined.
    unit: "dona",
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

run("quantities round to the 3-decimal grid instead of drifting", () => {
  // The whole reason roundQty exists: plain float subtraction produces
  // 19.799999999999997 here, which would then be stored and compared.
  assert.equal(roundQty(22.1 - 2.3), 19.8);
  assert.equal(calculateSold(22.1, 2.3), 19.8);
  assert.equal(roundMoney(0.333 * 15000), 4995);
});

run("normalizeQuantity keeps kg fractional and forces dona whole", () => {
  assert.equal(normalizeQuantity(2.5, "kg"), 2.5);
  assert.equal(normalizeQuantity(2.5049, "kg"), 2.505);
  assert.equal(normalizeQuantity(2.5, "dona"), 3);
  assert.equal(normalizeQuantity(-4, "kg"), 0);
});

run("qtyGreaterThan ignores sub-grid rounding noise", () => {
  assert.equal(qtyGreaterThan(5.001, 5), true);
  assert.equal(qtyGreaterThan(5 + 1e-12, 5), false);
  assert.equal(qtyGreaterThan(5, 5), false);
});

run("formatQuantity trims trailing zeros and appends the unit", () => {
  assert.equal(formatQuantity(2.5, "kg"), "2.5 kg");
  assert.equal(formatQuantity(2.5, "dona"), "3 dona");
  assert.equal(formatQuantity(3.0, "kg"), "3 kg");
});

run("a discounted sale is valued at the price actually charged", () => {
  // Mirrors inventory.service.sales(): off-list units move into the locked
  // accumulators while start/current fall together, so the derived span keeps
  // valuing only the list-price units.
  //
  // Day opens 22 @ 10000 (cost 6000). Sell 2 at list, then 3 at 9000.
  const buyPrice = 6000;
  const sellPrice = 10000;

  // after the list-price sale: start 22, current 20
  // after the discounted sale: start 19, current 17, locked 3 @ 9000
  const metrics = calculateInventoryMetrics({
    startQuantity: 19,
    currentQuantity: 17,
    buyPrice,
    sellPrice,
    lockedSold: 3,
    lockedRevenue: 3 * 9000,
    lockedProfit: 3 * (9000 - buyPrice),
  });

  assert.equal(metrics.remaining, 17);
  assert.equal(metrics.sold, 5);
  assert.equal(metrics.revenue, 2 * 10000 + 3 * 9000);
  assert.equal(metrics.realizedProfit, 2 * 4000 + 3 * 3000);
  // Opening stock stays recoverable as startQuantity + lockedSold.
  assert.equal(19 + 3, 22);
});

run("selling below cost records a real loss instead of clamping at zero", () => {
  const metrics = calculateInventoryMetrics({
    startQuantity: 10,
    currentQuantity: 10,
    buyPrice: 6000,
    sellPrice: 10000,
    lockedSold: 2,
    lockedRevenue: 2 * 5000,
    lockedProfit: 2 * (5000 - 6000),
  });

  assert.equal(metrics.revenue, 10000);
  assert.equal(metrics.realizedProfit, -2000);
});

run("kg quantities survive a fractional sale end to end", () => {
  const metrics = calculateInventoryMetrics({
    startQuantity: 12.5,
    currentQuantity: 10.25,
    buyPrice: 8000,
    sellPrice: 12000,
  });

  assert.equal(metrics.sold, 2.25);
  assert.equal(metrics.remaining, 10.25);
  assert.equal(metrics.revenue, 27000);
  assert.equal(metrics.realizedProfit, 9000);
});

run("sync validation accepts fractional kg quantities and a losing day", () => {
  const result = syncPayloadSchema.safeParse({
    products: [
      {
        localId: "prd_1",
        deviceId: "dev_1",
        name: "Go'sht",
        quantity: 12.5,
        unit: "kg",
        buyPrice: 80000,
        sellPrice: 95000,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z"
      }
    ],
    inventory: [
      {
        localId: "inv_1",
        deviceId: "dev_1",
        productId: "prd_1",
        date: "2026-04-20",
        unit: "kg",
        startQuantity: 12.5,
        currentQuantity: 10.25,
        lockedProfit: -5000,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z"
      }
    ]
  });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.products?.[0]?.unit, "kg");
});

run("sync validation still rejects quantities finer than 1 gram", () => {
  const result = syncPayloadSchema.safeParse({
    inventory: [
      {
        localId: "inv_1",
        deviceId: "dev_1",
        productId: "prd_1",
        date: "2026-04-20",
        startQuantity: 12.55555,
        currentQuantity: 10,
        createdAt: "2026-04-20T10:00:00.000Z",
        updatedAt: "2026-04-20T11:00:00.000Z"
      }
    ]
  });
  assert.equal(result.success, false);
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
  assert.equal(phoneVerificationRequired({ activeSessionId: null, phone_number: "+998901234567" }), false);
  assert.equal(phoneVerificationRequired({ activeSessionId: "s1", phone_number: "" }), false);
  assert.equal(phoneVerificationRequired({ activeSessionId: "s1", phone_number: "12" }), false);
  assert.equal(phoneVerificationRequired({ activeSessionId: "s1", phone_number: "+998901234567" }), true);
  assert.equal(maskPhone("998901234567").startsWith("+998"), true);
});

run("trusted device skips phone verification even when another session is active", () => {
  const user = { activeSessionId: "s1", phone_number: "+998901234567", verifiedDeviceIds: ["dev-b"] };
  assert.equal(phoneVerificationRequired(user, "dev-b"), false);
  assert.equal(phoneVerificationRequired(user, "dev-x"), true);
  assert.equal(phoneVerificationRequired(user), true);
  assert.equal(phoneVerificationRequired({ ...user, verifiedDeviceIds: [] }, "dev-b"), true);
});

run("logout only clears the active session, stale sessions cannot kill it", () => {
  assert.equal(shouldClearActiveSession({ activeSessionId: "s2" }, "s2"), true);
  assert.equal(shouldClearActiveSession({ activeSessionId: "s2" }, "s1"), false);
  assert.equal(shouldClearActiveSession({ activeSessionId: null }, "s1"), false);
  assert.equal(shouldClearActiveSession({ activeSessionId: "s2" }, undefined), false);
});

run("getNextBusinessDayStart resolves the hour in the business timezone, not the server's", () => {
  // UTC+5 (Tashkent, TIMEZONE_OFFSET=300). From 2026-04-20T09:00Z (14:00 local)
  // the next business day starting at 10:00 local is 2026-04-21T05:00Z.
  const from = new Date("2026-04-20T09:00:00Z");
  assert.equal(
    getNextBusinessDayStart(10, 300, from).toISOString(),
    "2026-04-21T05:00:00.000Z"
  );
  // Hour 0 -> local midnight of the next day.
  assert.equal(
    getNextBusinessDayStart(0, 300, from).toISOString(),
    "2026-04-20T19:00:00.000Z"
  );
  // With no offset the local frame is UTC itself.
  assert.equal(
    getNextBusinessDayStart(10, 0, from).toISOString(),
    "2026-04-21T10:00:00.000Z"
  );
  // Late-evening local time must still roll to the *next* local day, not skip one:
  // 2026-04-20T20:00Z is already 2026-04-21 01:00 local, so next is 2026-04-22.
  assert.equal(
    getNextBusinessDayStart(6, 300, new Date("2026-04-20T20:00:00Z")).toISOString(),
    "2026-04-22T01:00:00.000Z"
  );
});

run("a scheduled hour change becomes effective, and getEffectiveHour honours it", () => {
  // Regression: auth.middleware used to clear the pending pair without copying
  // the value into businessDayStartHour, so a scheduled change was silently
  // discarded and the hour never actually changed.
  const base = {
    userId: "u1",
    username: "test",
    phone_number: "test",
    role: "admin" as const,
    isPayed: false,
    tier: "tekin" as const,
  };
  const from = new Date("2026-04-20T09:00:00Z");
  const effectiveFrom = getNextBusinessDayStart(10, 300, from);

  // Before the boundary the old hour still applies.
  assert.equal(
    getEffectiveHour({
      ...base,
      businessDayStartHour: 6,
      pendingBusinessDayStartHour: 10,
      businessDayEffectiveFrom: new Date(Date.now() + 60_000).toISOString(),
    }),
    6
  );

  // After the boundary the pending hour applies...
  assert.equal(
    getEffectiveHour({
      ...base,
      businessDayStartHour: 6,
      pendingBusinessDayStartHour: 10,
      businessDayEffectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    }),
    10
  );

  // ...and once the middleware has promoted it (pending cleared, active moved),
  // the effective hour must still be the chosen one — not fall back to the old.
  assert.equal(
    getEffectiveHour({
      ...base,
      businessDayStartHour: 10,
      pendingBusinessDayStartHour: null,
      businessDayEffectiveFrom: null,
    }),
    10
  );

  assert.ok(effectiveFrom instanceof Date);
});
