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
import { inventoryService } from "../modules/inventory/inventory.service";
import { procurementController } from "../modules/procurements/procurement.controller";
import { submitProcurementSchema, listProcurementsQuerySchema } from "../modules/procurements/procurement.validation";
import { authController } from "../modules/auth/auth.controller";
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
  const u = await user({ verifiedDeviceIds: ["private-trusted-device"], blockCode: "9876" });
  const before = (await UserModel.findById(u._id))!.activeSessionId;

  const result = await authService.loginAsProcurementAgent(u.username, "test-password-123");
  assert.equal(result.user.scope, "procurement");
  assert.equal(result.user.capabilityRole, "PROCUREMENT_AGENT");
  assert.equal(result.user.verifiedDeviceIds, undefined);
  assert.equal(result.user.activeSessionId, undefined);
  assert.equal(result.user.blockCode, null);

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
    { method: "GET", baseUrl: "/api/procurements" },
    { method: "POST", baseUrl: "/api/procurements" },
  ];
  for (const { method, baseUrl } of allowed) {
    const req: any = { headers: { authorization: `Bearer ${token}` }, method, baseUrl };
    assert.equal(await runMiddleware(req), undefined, `${method} ${baseUrl} should be allowed`);
  }

  const blocked = [
    { method: "POST", baseUrl: "/api/products" },
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

test("procurement rejects mismatched projections and preserves the entire batch, fence and audit", async () => {
  const owner = actor(await user());
  await fixtureProduct(owner, "p0", 30, 10);
  await InventoryEntryModel.updateOne({ ownerAdminId: owner.userId }, { $set: { currentQuantity: 29 } });
  await assert.rejects(procurementService.submitBatch(owner, [{productId:"p0", name:"p0", quantity:2, buyPrice:12}]), (e:any) => e.code === "RECONCILIATION_REQUIRED");
  assert.equal((await ProductModel.findOne({ownerAdminId:owner.userId}))!.quantity, 30);
  assert.equal(await ProcurementModel.countDocuments({ownerAdminId:owner.userId}), 0);
  assert.equal(await AuditEventModel.countDocuments({ownerAdminId:owner.userId}), 0);
  assert.equal((await OwnerWriteVersion.findById(owner.userId).lean<any>()).revision, 0);
});

test("procurement cost rollover preserves prior profit and values subsequent sales at the new cost", async () => {
  const owner=actor(await user()); await fixtureProduct(owner,"p0",30,10);
  await inventoryService.sales(owner,{date:today,deviceId:"test",lines:[{productId:"p0",quantity:2,lineRevenue:40}]});
  await procurementService.submitBatch(owner,[{productId:"p0",name:"p0",quantity:5,buyPrice:12}]);
  let report=await DailySnapshotModel.findOne({ownerAdminId:owner.userId,date:today}).lean<any>();
  assert.equal(report.totalRevenue,40); assert.equal(report.totalProfit,20);
  const inventory=await InventoryEntryModel.findOne({ownerAdminId:owner.userId,date:today}).lean<any>();
  assert.equal(inventory.buyPrice,12); assert.equal(inventory.currentQuantity,33); assert.equal(inventory.lockedSold,2);
  await inventoryService.sales(owner,{date:today,deviceId:"test",lines:[{productId:"p0",quantity:1,lineRevenue:20,expectedBuyPrice:12}]});
  report=await DailySnapshotModel.findOne({ownerAdminId:owner.userId,date:today}).lean<any>();
  assert.equal(report.totalRevenue,60); assert.equal(report.totalProfit,28); assert.equal(report.totalSoldItems,3);
});

test("concurrent sale and procurement serialize stock, cost and daily accounting", async () => {
  const owner=actor(await user()); await fixtureProduct(owner,"p0",30,10);
  await Promise.all([
    inventoryService.sales(owner,{date:today,deviceId:"test",lines:[{productId:"p0",quantity:3,lineRevenue:60}]}),
    procurementService.submitBatch(owner,[{productId:"p0",name:"p0",quantity:5,buyPrice:12}]),
  ]);
  const product=await ProductModel.findOne({ownerAdminId:owner.userId}).lean<any>();
  const entry=await InventoryEntryModel.findOne({ownerAdminId:owner.userId,date:today}).lean<any>();
  const report=await DailySnapshotModel.findOne({ownerAdminId:owner.userId,date:today}).lean<any>();
  assert.equal(product.quantity,32); assert.equal(entry.currentQuantity,32);
  assert.equal(report.totalRevenue,60); assert.equal(report.totalSoldItems,3); assert.equal(report.totalProcurementCost,60);
  assert.ok([24,30].includes(report.totalProfit));
});

test("many concurrent duplicate procurement receipts commit only one batch", async () => {
  const owner=actor(await user());await fixtureProduct(owner,"p0",20,10);
  const items=[{productId:"p0",name:"p0",quantity:4,buyPrice:15}];
  const submit=()=>withIdempotency(owner.userId,"parallel-batch",async()=>({status:201,data:await procurementService.submitBatch(owner,items)}),{operation:"procurement.submit",payload:{items}});
  await Promise.all(Array.from({length:12},submit));
  assert.equal((await ProductModel.findOne({ownerAdminId:owner.userId}))!.quantity,24);
  assert.equal(await ProcurementModel.countDocuments({ownerAdminId:owner.userId}),1);
  await assert.rejects(withIdempotency(owner.userId,"parallel-batch",async()=>({status:201,data:null}),{operation:"procurement.submit",payload:{items:[]}}),(e:any)=>e.statusCode===409);
});

test("procurement snapshot failure rolls back stock, cost, batch, audit and receipt", async () => {
  const owner=actor(await user());await fixtureProduct(owner,"p0",20,10);
  const original=snapshotService.recompute;
  const items=[{productId:"p0",name:"p0",quantity:2,buyPrice:15}];
  snapshotService.recompute=async()=>{throw Error("injected projection failure")};
  try {await assert.rejects(withIdempotency(owner.userId,"crash-batch",async()=>({status:201,data:await procurementService.submitBatch(owner,items)}),{operation:"procurement.submit",payload:{items}}),/injected/);}
  finally{snapshotService.recompute=original;}
  assert.equal((await ProductModel.findOne({ownerAdminId:owner.userId}))!.quantity,20);
  assert.equal(await ProcurementModel.countDocuments({ownerAdminId:owner.userId}),0);
  assert.equal(await IdempotencyKeyModel.countDocuments({ownerAdminId:owner.userId,key:"crash-batch"}),0);
  assert.equal(await AuditEventModel.countDocuments({ownerAdminId:owner.userId}),0);
});

test("foreign products, fractional pieces and invalid dates/batch sizes cannot enter procurement", async () => {
  const a=actor(await user()),b=actor(await user());await fixtureProduct(b,"foreign",10,10);
  await assert.rejects(procurementService.submitBatch(a,[{productId:"foreign",name:"foreign",quantity:1,buyPrice:2}]),(e:any)=>e.statusCode===404);
  await assert.rejects(procurementService.submitBatch(a,[{name:"fraction",unit:"dona",quantity:1.5,buyPrice:2}]),(e:any)=>e.statusCode===422);
  assert.equal(submitProcurementSchema.safeParse({items:Array.from({length:501},()=>({name:"p",quantity:1,buyPrice:1}))}).success,false);
  assert.equal(listProcurementsQuerySchema.safeParse({from:"2026-02-30"}).success,false);
  assert.equal(listProcurementsQuerySchema.safeParse({from:"2026-05-03",to:"2026-05-02"}).success,false);
});

test("weighted procurement rounds money to cents rather than quantity precision", async () => {
  const owner=actor(await user());
  const result=await procurementService.submitBatch(owner,[{name:"Weighted",unit:"kg",quantity:0.333,buyPrice:12.34}]);
  assert.equal(result.items[0].lineCost,4.11);assert.equal(result.totalCost,4.11);
  assert.equal((await DailySnapshotModel.findOne({ownerAdminId:owner.userId,date:today}))!.totalProcurementCost,4.11);
});

test("limited session can revalidate and logout but cannot mutate auth or existing product images", async () => {
  const u=await user();const {token}=await authService.loginAsProcurementAgent(u.username,"test-password-123");
  for(const [method,path,allowed] of [["GET","/me",true],["POST","/logout",true],["PUT","/me",false],["GET","/admins",false]] as const){
    const req:any={headers:{authorization:`Bearer ${token}`},method,path,baseUrl:"/api/auth"};
    assert.equal((await runMiddleware(req))?.statusCode,allowed?undefined:403);
    if(path==="/me"&&allowed){let data:any;await authController.me(req,{status:()=>({json:(body:any)=>{data=body.data}})} as any);assert.equal(data.scope,"procurement");assert.equal(data.blockCode,null);}
  }
  const req:any={headers:{authorization:`Bearer ${token}`},method:"POST",path:"/p0/image",baseUrl:"/api/products"};
  assert.equal((await runMiddleware(req))?.statusCode,403);
  const createReq:any={headers:{authorization:`Bearer ${token}`},method:"POST",path:"/",baseUrl:"/api/products"};
  assert.equal((await runMiddleware(createReq))?.statusCode,403);
});
