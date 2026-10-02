import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

import { UserModel } from "../modules/auth/user.model";
import { authService } from "../modules/auth/auth.service";
import { authenticate } from "../modules/auth/auth.middleware";
import { signAccessToken } from "../modules/auth/auth.utils";
import { withIdempotency } from "../modules/idempotency/idempotency.service";
import { IdempotencyKeyModel } from "../modules/idempotency/idempotency.model";
import { OwnerWriteVersion } from "../lib/transaction";
import { ProductModel } from "../modules/products/product.model";
import { InventoryEntryModel } from "../modules/inventory/inventory.model";
import { DailySnapshotModel } from "../modules/snapshots/snapshot.model";
import { AuditEventModel } from "../modules/audit/audit.model";
import { ProcurementModel } from "../modules/procurements/procurement.model";
import { procurementService } from "../modules/procurements/procurement.service";
import { snapshotService } from "../modules/snapshots/snapshot.service";
import { getCurrentBusinessDate } from "../utils/business-day";
import type { AuthUser } from "../modules/auth/auth.types";

const today = getCurrentBusinessDate(6, 300);

before(async () => {
  assert.match(process.env.MONGODB_URL ?? "", /^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
  await mongoose.connect(process.env.MONGODB_URL!, { maxPoolSize: 30 });
  await Promise.all(
    [UserModel, OwnerWriteVersion, IdempotencyKeyModel, ProductModel, InventoryEntryModel, DailySnapshotModel, AuditEventModel, ProcurementModel].map(
      (m) => m.init(),
    ),
  );
});
after(async () => {
  await mongoose.disconnect();
});

async function user(extra: Record<string, unknown> = {}) {
  return UserModel.create({
    username: randomUUID(),
    password: "test-password-123",
    phone_number: `99890${Math.floor(Math.random() * 1e7)}`,
    role: "admin",
    isActive: true,
    activeSessionId: randomUUID(),
    ...extra,
  });
}
function actor(u: any): AuthUser {
  return { userId: u._id.toString(), username: u.username, phone_number: u.phone_number, role: u.role, isPayed: true, tier: "pro", businessDayStartHour: 6, sessionId: u.activeSessionId };
}
async function fixtureProduct(owner: AuthUser, localId = "p0", quantity = 100, buyPrice = 10) {
  await ProductModel.create({ ownerAdminId: owner.userId, localId, deviceId: "test", name: `Product ${localId}`, quantity, buyPrice, sellPrice: 20, unit: "dona", displayIndex: 1 });
  await InventoryEntryModel.create({ ownerAdminId: owner.userId, localId: `${today}-${localId}`, deviceId: "test", productId: localId, productName: `Product ${localId}`, unit: "dona", date: today, startQuantity: quantity, currentQuantity: quantity, buyPrice, sellPrice: 20 });
}
async function runMiddleware(req: any) {
  let error: any;
  await authenticate()(req, {} as any, (e: any) => { error = e; });
  return error;
}

test("a procurement-scope login never touches activeSessionId, and the real session keeps working", async () => {
  const u = await user();
  const before = (await UserModel.findById(u._id))!.activeSessionId;

  const result = await authService.loginAsProcurementAgent(u.username, "test-password-123");
  assert.equal(result.user.scope, "procurement");

  const after = (await UserModel.findById(u._id))!.activeSessionId;
  assert.equal(after, before);

  // The real device's own token (bound to the real activeSessionId) still authenticates.
  const realReq: any = { headers: { authorization: `Bearer ${signAccessToken(actor(u))}` }, method: "GET", baseUrl: "/api/products" };
  assert.equal(await runMiddleware(realReq), undefined);
});

test("a procurement-scope token is allowed on products/procurements and rejected everywhere else", async () => {
  const u = await user();
  const { token } = await authService.loginAsProcurementAgent(u.username, "test-password-123");

  const allowed = [
    { method: "GET", baseUrl: "/api/products" },
    { method: "POST", baseUrl: "/api/products" },
    { method: "GET", baseUrl: "/api/procurements" },
    { method: "POST", baseUrl: "/api/procurements" },
  ];
  for (const { method, baseUrl } of allowed) {
    const req: any = { headers: { authorization: `Bearer ${token}` }, method, baseUrl };
    assert.equal(await runMiddleware(req), undefined, `${method} ${baseUrl} should be allowed`);
  }

  const blocked = [
    { method: "GET", baseUrl: "/api/debtors" },
    { method: "GET", baseUrl: "/api/stats" },
    { method: "GET", baseUrl: "/api/snapshots" },
    { method: "PUT", baseUrl: "/api/products" },
    { method: "DELETE", baseUrl: "/api/products" },
  ];
  for (const { method, baseUrl } of blocked) {
    const req: any = { headers: { authorization: `Bearer ${token}` }, method, baseUrl };
    const error = await runMiddleware(req);
    assert.equal(error?.statusCode, 403, `${method} ${baseUrl} should be forbidden`);
  }
});

test("a batched procurement increments stock, updates buyPrice/stockEpoch, and records totalProcurementCost atomically", async () => {
  const u = await user();
  const owner = actor(u);
  await fixtureProduct(owner, "p0", 100, 10);

  const procurement = await procurementService.submitBatch(owner, [
    { productId: "p0", name: "Product p0", quantity: 5, buyPrice: 12 },
    { name: "Brand new item", unit: "dona", quantity: 3, buyPrice: 7 },
  ]);

  const product = await ProductModel.findOne({ ownerAdminId: owner.userId, localId: "p0" }).lean<any>();
  assert.equal(product.quantity, 105);
  assert.equal(product.buyPrice, 12);
  assert.ok(product.stockEpoch > 0);

  const inventory = await InventoryEntryModel.findOne({ ownerAdminId: owner.userId, productId: "p0", date: today }).lean<any>();
  assert.equal(inventory.currentQuantity, 105);

  const newProduct = await ProductModel.findOne({ ownerAdminId: owner.userId, name: "Brand new item" }).lean<any>();
  assert.ok(newProduct);
  assert.equal(newProduct.quantity, 3);
  assert.equal(newProduct.buyPrice, 7);
  assert.equal(newProduct.sellPrice, 7); // defaults to buyPrice when the agent doesn't set one

  assert.equal((procurement as any).totalCost, 5 * 12 + 3 * 7);

  const snapshot = await DailySnapshotModel.findOne({ ownerAdminId: owner.userId, date: today }).lean<any>();
  assert.equal(snapshot.totalProcurementCost, 5 * 12 + 3 * 7);
});

test("a second procurement batch the same day accumulates totalProcurementCost instead of overwriting it", async () => {
  const u = await user();
  const owner = actor(u);
  await fixtureProduct(owner, "p0", 50, 10);

  await procurementService.submitBatch(owner, [{ productId: "p0", name: "Product p0", quantity: 2, buyPrice: 11 }]);
  await procurementService.submitBatch(owner, [{ productId: "p0", name: "Product p0", quantity: 3, buyPrice: 13 }]);

  const product = await ProductModel.findOne({ ownerAdminId: owner.userId, localId: "p0" }).lean<any>();
  assert.equal(product.quantity, 55);
  assert.equal(product.buyPrice, 13);

  const snapshot = await DailySnapshotModel.findOne({ ownerAdminId: owner.userId, date: today }).lean<any>();
  assert.equal(snapshot.totalProcurementCost, 2 * 11 + 3 * 13);
  assert.equal(await ProcurementModel.countDocuments({ ownerAdminId: owner.userId }), 2);
});

test("idempotent resubmission of the same procurement batch applies stock once", async () => {
  const u = await user();
  const owner = actor(u);
  await fixtureProduct(owner, "p0", 20, 10);

  const items = [{ productId: "p0", name: "Product p0", quantity: 4, buyPrice: 15 }];
  const submit = (key: string) => withIdempotency(owner.userId, key, async () => ({ status: 201, data: await procurementService.submitBatch(owner, items) }), { operation: "procurement.submit", payload: { items } });

  const first = await submit("batch-1");
  const duplicate = await submit("batch-1");
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(duplicate)));

  const product = await ProductModel.findOne({ ownerAdminId: owner.userId, localId: "p0" }).lean<any>();
  assert.equal(product.quantity, 24);
  assert.equal(await ProcurementModel.countDocuments({ ownerAdminId: owner.userId }), 1);
});

test("rejecting a nonexistent product fails the whole batch atomically (no partial stock change)", async () => {
  const u = await user();
  const owner = actor(u);
  await fixtureProduct(owner, "p0", 30, 10);

  await assert.rejects(
    procurementService.submitBatch(owner, [
      { productId: "p0", name: "Product p0", quantity: 2, buyPrice: 11 },
      { productId: "does-not-exist", name: "Ghost", quantity: 1, buyPrice: 5 },
    ]),
    (e: any) => e.statusCode === 404,
  );

  const product = await ProductModel.findOne({ ownerAdminId: owner.userId, localId: "p0" }).lean<any>();
  assert.equal(product.quantity, 30);
  assert.equal(await ProcurementModel.countDocuments({ ownerAdminId: owner.userId }), 0);
});

// Guards the snapshot.service.ts change itself, independent of the
// procurement module — recompute() must not blow up or misbehave for an
// owner/date with zero Procurement documents (the overwhelming majority of
// snapshot recomputes, triggered by ordinary sales/restocks that have
// nothing to do with this feature).
test("recompute() reports totalProcurementCost 0 when no procurement happened that day", async () => {
  const u = await user();
  const owner = actor(u);
  await fixtureProduct(owner, "p0", 10, 10);
  await snapshotService.recompute(owner, today, "server", ["p0"]);
  const snapshot = await DailySnapshotModel.findOne({ ownerAdminId: owner.userId, date: today }).lean<any>();
  assert.equal(snapshot.totalProcurementCost, 0);
});
