import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { ProcurementModel } from "../modules/procurements/procurement.model";
import { ProductModel } from "../modules/products/product.model";
import { InventoryEntryModel } from "../modules/inventory/inventory.model";
import { DailySnapshotModel } from "../modules/snapshots/snapshot.model";
import { UserModel } from "../modules/auth/user.model";
import { OwnerWriteVersion } from "../lib/transaction";
import {
  procurementAnalytics,
  procurementRange,
  procurementSummary,
} from "../modules/procurements/procurement.analytics";
import { procurementService } from "../modules/procurements/procurement.service";
import {
  procurementExport,
  procurementCsv,
} from "../modules/procurements/procurement.export";
import { procurementAnalyticsQuerySchema } from "../modules/procurements/procurement.validation";
import { getCurrentBusinessDate } from "../utils/business-day";
import type { AuthUser } from "../modules/auth/auth.types";
before(async () => {
  assert.match(process.env.MONGODB_URL ?? "", /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(process.env.MONGODB_URL!);
  await Promise.all(
    [
      ProcurementModel,
      ProductModel,
      InventoryEntryModel,
      DailySnapshotModel,
      UserModel,
      OwnerWriteVersion,
    ].map((m) => m.init()),
  );
});
after(async () => {
  await mongoose.disconnect();
});
const today = getCurrentBusinessDate(6, 300);
async function owner(): Promise<AuthUser> {
  const u = await UserModel.create({
    username: randomUUID(),
    password: "local-test-password",
    phone_number: "998901234567",
    role: "admin",
    isActive: true,
    isPayed: true,
  });
  return {
    userId: u._id.toString(),
    username: u.username,
    phone_number: u.phone_number,
    role: "admin",
    isPayed: true,
    tier: "pro",
    businessDayStartHour: 6,
  };
}
async function batch(
  a: AuthUser,
  date: string,
  supplier: string,
  items: any[],
) {
  return ProcurementModel.create({
    ownerAdminId: a.userId,
    localId: randomUUID(),
    date,
    supplier,
    items,
    totalCost: items.reduce((s, i) => s + i.lineCost, 0),
    createdByScope: "full",
    createdByUserId: a.userId,
  });
}
const line = (
  productId: string,
  unit: "dona" | "kg",
  quantity: number,
  buyPrice: number,
) => ({
  productId,
  name: productId,
  unit,
  quantity,
  buyPrice,
  lineCost: Math.round(quantity * buyPrice * 100) / 100,
  isNewProduct: false,
});
test("period boundaries include leap days and Monday weeks; custom validates actual dates and limits", () => {
  assert.deepEqual(
    procurementRange({ period: "week", from: "2026-10-04" }, today),
    {
      from: "2026-09-28",
      to: "2026-10-04",
      period: "week",
      granularity: "day",
    },
  );
  assert.equal(
    procurementRange({ period: "month", from: "2024-02-15" }, today).to,
    "2024-02-29",
  );
  for (const q of [
    { period: "custom" },
    { period: "custom", from: "2026-02-30", to: "2026-03-01" },
    { period: "custom", from: "2000-01-01", to: "2026-01-01" },
    { period: "custom", from: "2026-10-04", to: "2026-10-01" },
    { period: "month", supplier: { $ne: "" } },
  ])
    assert.equal(procurementAnalyticsQuerySchema.safeParse(q).success, false);
});
test("tenant and supplier boundaries, zero buckets, mixed units and chronological price trends are exact", async () => {
  const a = await owner(),
    b = await owner();
  await batch(a, "2026-10-01", "A", [
    line("apple", "kg", 0.333, 12.34),
    line("milk", "dona", 2, 10),
  ]);
  await batch(a, "2026-10-03", "A", [
    { ...line("milk", "dona", 3, 12), previousBuyPrice: 10 },
  ]);
  await batch(a, "2026-10-03", "B", [line("milk", "dona", 1, 50)]);
  await batch(b, "2026-10-01", "A", [line("foreign", "dona", 999, 999)]);
  const r = await procurementAnalytics(a, {
    period: "custom",
    from: "2026-10-01",
    to: "2026-10-03",
    supplier: "A",
  });
  assert.equal(r.totalProcurementSpend, 60.11);
  assert.equal(r.totalBatchesCount, 2);
  assert.equal(r.averageBatchValue, 30.06);
  assert.deepEqual(r.totalItemsProcured, { dona: 5, kg: 0.333 });
  assert.equal(r.costTrends.length, 3);
  assert.equal(r.costTrends[1].spend, 0);
  assert.equal(r.topCostProducts[0].quantity, 5);
  assert.equal(r.topCostProducts[0].latestBuyPrice, 12);
  assert.equal(r.topCostProducts[0].priceChangePercent, 20);
  const version = await OwnerWriteVersion.findById(a.userId).lean();
  assert.equal(version, null);
});
test("procurement changes current valuation without revaluing previously sold goods; metadata is transactional", async () => {
  const a = await owner();
  await ProductModel.create({
    ownerAdminId: a.userId,
    localId: "p",
    deviceId: "test",
    name: "Product",
    unit: "dona",
    quantity: 10,
    buyPrice: 10,
    sellPrice: 20,
    displayIndex: 1,
  });
  await InventoryEntryModel.create({
    ownerAdminId: a.userId,
    localId: today + "-p",
    productId: "p",
    productName: "Product",
    deviceId: "test",
    date: today,
    unit: "dona",
    startQuantity: 10,
    currentQuantity: 10,
    buyPrice: 10,
    sellPrice: 20,
    lockedSold: 2,
    lockedRevenue: 40,
    lockedProfit: 20,
  });
  const receipt: any = await procurementService.submitBatch(
    a,
    [
      { productId: "p", name: "Product", quantity: 2, buyPrice: 12 },
      {
        name: "Honey",
        unit: "kg",
        quantity: 0.5,
        buyPrice: 20,
        barcodes: ["HONEY-001"],
      },
    ],
    "Supplier A",
  );
  assert.equal(receipt.supplier, "Supplier A");
  assert.equal(receipt.createdByUsername, a.username);
  assert.equal(receipt.items[0].previousBuyPrice, 10);
  assert.deepEqual(
    (await ProductModel.findOne({ ownerAdminId: a.userId, name: "Honey" }))!
      .barcodes,
    ["HONEY-001"],
  );
  const r = await procurementAnalytics(a, { period: "day" });
  assert.equal(r.totalRevenue, 40);
  assert.equal(r.grossProfit, 20);
  assert.equal(r.costOfGoodsSold, 20);
  assert.equal(r.inventoryValue, 154);
  assert.equal(r.cashFlowBalance, 6);
  const summary = await procurementSummary({ ...a, scope: "procurement" });
  assert.equal(summary.todaySpend, 34);
  assert.deepEqual(summary.lastBatch!.quantities, { dona: 2, kg: 0.5 });
  const fence = await OwnerWriteVersion.findById(a.userId).lean();
  assert.ok(fence && (fence as any).revision > 0);
  const before = JSON.stringify(
    await OwnerWriteVersion.findById(a.userId).lean(),
  );
  await procurementAnalytics(a, { period: "day" });
  assert.equal(
    JSON.stringify(await OwnerWriteVersion.findById(a.userId).lean()),
    before,
  );
});
test("agents and free accounts cannot read finance analytics even by direct service calls", async () => {
  const a = await owner();
  await assert.rejects(
    procurementAnalytics({ ...a, scope: "procurement" }, { period: "day" }),
    (e: any) => e.statusCode === 403 || e.status === 403,
  );
  await assert.rejects(
    procurementAnalytics({ ...a, tier: "tekin" }, { period: "day" }),
    (e: any) => e.statusCode === 402 || e.status === 402,
  );
});
test("CSV neutralizes formulas; Excel and PDF exports contain real, readable files", async () => {
  const a = await owner();
  await batch(a, today, "A", [
    { ...line("formula", "dona", 1, 10), name: '=HYPERLINK("bad")' },
  ]);
  const r = await procurementAnalytics(a, { period: "day" });
  assert.match(procurementCsv(r), /"'=HYPERLINK/);
  const x = await procurementExport(r, "xlsx");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(x.body as any);
  assert.equal(
    book.worksheets[0].getCell("A1").value,
    "Ta’minot va Kirimlar Tahlili",
  );
  const pdf = await procurementExport(r, "pdf");
  assert.equal(pdf.body.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.body.length > 2000);
});
