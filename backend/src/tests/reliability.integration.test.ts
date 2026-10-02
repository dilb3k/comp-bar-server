import { syncService } from "../modules/sync/sync.service";
import { pullChanges } from "../modules/sync/sync.pull";
import { productService } from "../modules/products/product.service";
import { ProductTombstoneModel } from "../modules/products/product-tombstone.model";
import { applyInventoryOperation } from "../modules/inventory/operation.service";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { withIdempotency } from "../modules/idempotency/idempotency.service";
import { IdempotencyKeyModel } from "../modules/idempotency/idempotency.model";
import { OwnerWriteVersion, withOwnerTransaction } from "../lib/transaction";
import { ProductModel } from "../modules/products/product.model";
import { InventoryEntryModel } from "../modules/inventory/inventory.model";
import { DailySnapshotModel } from "../modules/snapshots/snapshot.model";
import { AuditEventModel } from "../modules/audit/audit.model";
import { inventoryService } from "../modules/inventory/inventory.service";
import { snapshotService } from "../modules/snapshots/snapshot.service";
import { getCurrentBusinessDate } from "../utils/business-day";
import type { AuthUser } from "../modules/auth/auth.types";

const today = getCurrentBusinessDate(6, 300);
function actor(owner = randomUUID()): AuthUser { return { userId: owner, username: 'test', phone_number: '000', role: 'admin', isPayed: true, tier: 'pro', businessDayStartHour: 6 }; }
async function fixture(owner = actor(), count = 1) {
  const products = Array.from({length: count}, (_, i) => ({ ownerAdminId: owner.userId, localId: `p${i}`, deviceId: 'test', name: `Product ${i}`, quantity: 100, buyPrice: 10, sellPrice: 20, unit: 'dona', displayIndex: i + 1 }));
  await ProductModel.insertMany(products);
  await InventoryEntryModel.insertMany(products.map(p => ({ ownerAdminId: owner.userId, localId: `${today}-${p.localId}`, deviceId: 'test', productId: p.localId, productName: p.name, unit: p.unit, date: today, startQuantity: 100, currentQuantity: 100, buyPrice: 10, sellPrice: 20 })));
  return owner;
}
function sell(owner: AuthUser, key: string, quantity = 1) {
  const payload = { deviceId: 'test', date: today, lines: [{ productId: 'p0', quantity }] };
  return withIdempotency(owner.userId, key, async () => ({ status: 200, data: await inventoryService.sales(owner, payload) }), { operation: 'inventory.sales', payload });
}
async function state(owner: AuthUser) {
  const filter = { ownerAdminId: owner.userId };
  const p: any = await ProductModel.findOne({...filter, localId: 'p0'}).lean();
  const i: any = await InventoryEntryModel.findOne({...filter, productId: 'p0', date: today}).lean();
  const snapshot: any = await DailySnapshotModel.findOne({...filter, date: today}).lean();
  return { product: p.quantity, inventory: i.currentQuantity, revenue: snapshot?.totalRevenue ?? 0, profit: snapshot?.totalProfit ?? 0 };
}
before(async () => {
  const uri = process.env.MONGODB_URL ?? '';
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
  await mongoose.connect(uri, { maxPoolSize: 30 });
  await Promise.all([OwnerWriteVersion, IdempotencyKeyModel, ProductTombstoneModel, ProductModel, InventoryEntryModel, DailySnapshotModel, AuditEventModel].map(model => model.init()));
});
after(async () => { await mongoose.disconnect(); });

test('normal sale, duplicate and lost-response retry apply once', async () => {
  const owner = await fixture();
  const first = await sell(owner, 'sale-1', 2);
  const duplicate = await sell(owner, 'sale-1', 2);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(duplicate)));
  assert.deepEqual(await state(owner), { product: 98, inventory: 98, revenue: 40, profit: 20 });
  assert.equal(await IdempotencyKeyModel.countDocuments({ownerAdminId: owner.userId}), 1);
});
test('same key parallel requests are atomic, including first ever tenant writes', async () => {
  const owner = await fixture();
  await Promise.all(Array.from({length: 20}, () => sell(owner, 'same-key')));
  assert.deepEqual(await state(owner), { product: 99, inventory: 99, revenue: 20, profit: 10 });
  assert.equal(await AuditEventModel.countDocuments({ownerAdminId: owner.userId}), 1);
});
test('different sales in one account serialize without losing increments', async () => {
  const owner = await fixture();
  await Promise.all(Array.from({length: 20}, (_, i) => sell(owner, `sale-${i}`)));
  assert.deepEqual(await state(owner), { product: 80, inventory: 80, revenue: 400, profit: 200 });
});
test('key reuse with changed payload is rejected without mutation', async () => {
  const owner = await fixture(); await sell(owner, 'stable-key');
  await assert.rejects(sell(owner, 'stable-key', 5), (e: any) => e.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal((await state(owner)).product, 99);
});
test('same key in different accounts stays isolated under concurrency', async () => {
  const owners = await Promise.all(Array.from({length: 8}, () => fixture()));
  await Promise.all(owners.map(o => sell(o, 'shared-key')));
  for (const owner of owners) assert.deepEqual(await state(owner), {product: 99, inventory: 99, revenue: 20, profit: 10});
});
test('failure after snapshot write rolls back stock, report, audit and claim; retry succeeds', async () => {
  const owner = await fixture();
  const original = snapshotService.recompute;
  snapshotService.recompute = async function(...args: Parameters<typeof original>) { await original.apply(this, args); throw Error('simulated failure before commit'); };
  try { await assert.rejects(sell(owner, 'retryable'), /simulated failure/); }
  finally { snapshotService.recompute = original; }
  assert.deepEqual(await state(owner), {product: 100, inventory: 100, revenue: 0, profit: 0});
  assert.equal(await IdempotencyKeyModel.countDocuments({ownerAdminId: owner.userId}), 0);
  assert.equal(await AuditEventModel.countDocuments({ownerAdminId: owner.userId}), 0);
  await sell(owner, 'retryable'); assert.equal((await state(owner)).product, 99);
});
test('deleted product revenue remains after a later snapshot projection', async () => {
  const owner = await fixture(actor(), 2); await sell(owner, 'before-delete');
  await ProductModel.deleteOne({ownerAdminId: owner.userId, localId: 'p0'});
  const snapshot: any = await snapshotService.recompute(owner, today, 'test');
  assert.equal(snapshot.totalRevenue, 20);
  assert.equal(snapshot.items.find((i: any) => i.productId === 'p0').sold, 1);
});
test('1,000-product account: snapshot initialization and incremental sale agree', async () => {
  const owner = await fixture(actor(), 1000);
  await sell(owner, 'first'); await sell(owner, 'second');
  const incremental: any = await DailySnapshotModel.findOne({ownerAdminId: owner.userId, date: today});
  const rebuilt: any = await snapshotService.recompute(owner, today, 'test');
  assert.equal(incremental.items.length, 1000);
  assert.equal(incremental.totalRevenue, 40);
  assert.equal(rebuilt.totalRevenue, incremental.totalRevenue);
  assert.equal(rebuilt.totalProfit, incremental.totalProfit);
});

test('v2 rejects stale state and legacy inventory without changing stock', async () => {
  const owner = await fixture();
  const initial: any = await ProductModel.findOne({ownerAdminId: owner.userId, localId: 'p0'});
  await sell(owner, 'new-state');
  const result = await syncService.sync(owner, { protocolVersion: 2,
    products: [{...initial.toJSON(), baseVersion: 0, updatedAt: new Date().toISOString()}],
    inventory: [{ localId: `${today}-p0`, deviceId: 'old', productId: 'p0', date: today, startQuantity: 100, currentQuantity: 90, note: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  });
  assert.deepEqual(result.rejected.map(item => item.reason), ['STALE_VERSION', 'LEGACY_RECONCILIATION_REQUIRED']);
  assert.equal(result.acknowledged.length, 0);
  assert.deepEqual(await state(owner), { product: 99, inventory: 99, revenue: 20, profit: 10 });
});

test('v2 keyset pagination returns >1,000 products and inventory with stable retry', async () => {
  const owner = await fixture(actor(), 1205);
  let cursor: string | undefined; let checkpoint: string | null = null;
  const products = new Set<string>(); const inventory = new Set<string>();
  let pages = 0;
  do {
    const page = await pullChanges(owner, { cursor, limit: 200 });
    const repeated = await pullChanges(owner, { cursor, limit: 200 });
    assert.deepEqual(JSON.parse(JSON.stringify(page)), JSON.parse(JSON.stringify(repeated)));
    page.products.forEach(p => products.add(p.localId));
    page.inventory.forEach(i => inventory.add(i.localId));
    pages++; cursor = page.nextCursor ?? undefined; checkpoint = page.checkpoint;
    assert.equal(page.hasMore, Boolean(cursor));
    assert.equal(Boolean(checkpoint), !page.hasMore);
  } while (cursor);
  assert.equal(pages, 7); assert.equal(products.size, 1205); assert.equal(inventory.size, 1205);
  const empty = await pullChanges(owner, { checkpoint: checkpoint! });
  assert.equal(empty.products.length + empty.inventory.length + empty.daily.length, 0);
});

test('write between pages is returned in the next revision window; foreign/tampered cursors fail', async () => {
  const owner = await fixture(actor(), 3);
  const first = await pullChanges(owner, { limit: 1 });
  assert.ok(first.nextCursor);
  const firstId = first.products[0].localId;
  await productService.restock(owner, firstId, 2);
  const other = actor();
  await assert.rejects(pullChanges(other, { cursor: first.nextCursor! }), (e: any) => e.code === 'INVALID_SYNC_CURSOR');
  await assert.rejects(pullChanges(owner, { cursor: first.nextCursor! + 'x' }), (e: any) => e.code === 'INVALID_SYNC_CURSOR');
  let page = first;
  while (page.nextCursor) page = await pullChanges(owner, { cursor: page.nextCursor, limit: 1 });
  const delta = await pullChanges(owner, { checkpoint: page.checkpoint! });
  assert.equal(delta.products.length, 1);
  assert.equal(delta.products[0].localId, firstId);
  assert.equal(delta.products[0].quantity, 102);
});

test('tombstone survives deletion and prevents stale create from resurrecting the product', async () => {
  const owner = await fixture();
  await sell(owner, 'sold-before-delete');
  const baseline = await pullChanges(owner, {});
  const old: any = await ProductModel.findOne({ownerAdminId: owner.userId, localId: 'p0'});
  await productService.remove(owner, 'p0');
  const delta = await pullChanges(owner, { checkpoint: baseline.checkpoint! });
  assert.equal(delta.deletedProducts.length, 1);
  assert.equal(delta.deletedProducts[0].localId, 'p0');
  const sync = await syncService.sync(owner, {protocolVersion:2, products: [{...old.toJSON(), baseVersion: 0,operationId:randomUUID()}] });
  assert.equal(sync.rejected[0].reason, 'ENTITY_DELETED');
  assert.equal(await ProductModel.countDocuments({ownerAdminId: owner.userId}), 0);
  const rebuilt: any = await snapshotService.recompute(owner, today, 'test');
  assert.equal(rebuilt.totalRevenue, 20);
});

test('immutable offline sales from two devices both apply, duplicate retries do not', async () => {
  const owner = await fixture();
  const operations = ['phone', 'desktop'].map(deviceId => ({ kind: 'sale' as const, id: randomUUID(), deviceId, date: today, occurredAt: new Date().toISOString(), lines: [{productId: 'p0', quantity: 2, lineRevenue: 35,expectedBuyPrice:10,expectedUnit:'dona' as const,expectedStockEpoch:0}] }));
  await Promise.all(operations.flatMap(operation => [applyInventoryOperation(owner, operation), applyInventoryOperation(owner, operation)]));
  assert.deepEqual(await state(owner), {product: 96, inventory: 96, revenue: 70, profit: 30});
});

test('late offline sale updates historical and current balances without moving revenue to today', async () => {
  const owner = await fixture();
  const prior = new Date(`${today}T12:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
  const yesterday = prior.toISOString().slice(0, 10);
  await InventoryEntryModel.create({ownerAdminId: owner.userId, localId: `${yesterday}-p0`, productId: 'p0', productName: 'Product 0', deviceId: 'test', date: yesterday, startQuantity: 100, currentQuantity: 100, buyPrice: 10, sellPrice: 20});
  const operation = {kind: 'sale' as const, id: randomUUID(), deviceId: 'offline', date: yesterday, occurredAt: prior.toISOString(), lines: [{productId: 'p0', quantity: 2, lineRevenue: 35,expectedBuyPrice:10,expectedUnit:'dona' as const,expectedStockEpoch:0}]};
  await applyInventoryOperation(owner, operation);
  await applyInventoryOperation(owner, operation);
  assert.deepEqual(await state(owner), {product: 98, inventory: 98, revenue: 0, profit: 0});
  const yesterdayState: any = await DailySnapshotModel.findOne({ownerAdminId: owner.userId, date: yesterday});
  assert.equal(yesterdayState.totalRevenue, 35); assert.equal(yesterdayState.totalProfit, 15);
});

test('a historical day with no baseline at all still applies, shifting every later day back by the same amount', async () => {
  const owner = await fixture();
  const operation = {kind: 'sale' as const, id: randomUUID(), deviceId: 'offline', date: '2020-01-01', occurredAt: '2020-01-01T10:00:00.000Z', lines: [{productId: 'p0', quantity: 2, lineRevenue: 35,expectedBuyPrice:10,expectedUnit:'dona' as const,expectedStockEpoch:0}]};
  const result = await syncService.sync(owner, { protocolVersion: 2, operations: [operation] });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.acknowledged[0].localId, operation.id);
  // The sale's own revenue/profit land on 2020-01-01, exactly like the
  // already-synced-baseline case above — today only absorbs the quantity
  // shift, not the sale itself.
  assert.deepEqual(await state(owner), {product: 98, inventory: 98, revenue: 0, profit: 0});
  const backdated: any = await DailySnapshotModel.findOne({ownerAdminId: owner.userId, date: '2020-01-01'});
  assert.equal(backdated.totalRevenue, 35); assert.equal(backdated.totalProfit, 15);
  const historicalEntry: any = await InventoryEntryModel.findOne({ownerAdminId: owner.userId, productId: 'p0', date: '2020-01-01'});
  assert.equal(historicalEntry.startQuantity, 98); assert.equal(historicalEntry.currentQuantity, 98);
});
test('a historical sale that would drive an intermediate day negative is still rejected for reconciliation', async () => {
  const owner = await fixture();
  // By mid-2020 stock had genuinely dropped to 1 (recorded), then a later
  // restock brought today's live total back up to 100 — the live total
  // alone can't tell these two facts apart, so the historical trail itself
  // (the intermediate day's own recorded entry) is what must stay honest.
  await InventoryEntryModel.create({ownerAdminId: owner.userId, localId: '2020-06-15-p0', productId: 'p0', productName: 'Product 0', deviceId: 'test', date: '2020-06-15', startQuantity: 1, currentQuantity: 1, buyPrice: 10, sellPrice: 20});
  const operation = {kind: 'sale' as const, id: randomUUID(), deviceId: 'offline', date: '2020-01-01', occurredAt: '2020-01-01T10:00:00.000Z', lines: [{productId: 'p0', quantity: 2, lineRevenue: 35,expectedBuyPrice:10,expectedUnit:'dona' as const,expectedStockEpoch:0}]};
  const result = await syncService.sync(owner, { protocolVersion: 2, operations: [operation] });
  assert.equal(result.acknowledged.length, 0);
  assert.equal(result.rejected[0].reason, 'RECONCILIATION_REQUIRED');
  assert.equal(await IdempotencyKeyModel.countDocuments({ownerAdminId: owner.userId, key: operation.id}), 0);
  assert.deepEqual(await state(owner), {product: 100, inventory: 100, revenue: 0, profit: 0});
  assert.equal(await InventoryEntryModel.countDocuments({ownerAdminId: owner.userId, date: '2020-01-01'}), 0);
});

test('conditional stock adjustment rejects stale clients; duplicate operation replays once', async () => {
  const owner = await fixture();
  const operation = {kind: 'adjustment' as const, id: randomUUID(), deviceId: 'test', date: today, occurredAt: new Date().toISOString(), items: [{productId: 'p0', currentQuantity: 95, baseVersion: 0, lineRevenue: 90}]};
  await Promise.all([applyInventoryOperation(owner, operation), applyInventoryOperation(owner, operation)]);
  assert.deepEqual(await state(owner), {product:95,inventory:95,revenue:90,profit:40});
  await assert.rejects(applyInventoryOperation(owner, {...operation,id:randomUUID(),items:[{productId:'p0',currentQuantity:94,baseVersion:0,lineRevenue:100}]}), (e: any) => e.code === 'STALE_VERSION');
  assert.equal((await state(owner)).product,95);
});

test('duplicate product lines accumulate correctly and oversized parallel sales never oversell', async () => {
  const owner = await fixture();
  await applyInventoryOperation(owner,{kind:'sale',id:randomUUID(),deviceId:'test',date:today,occurredAt:new Date().toISOString(),lines:[{productId:'p0',quantity:1,lineRevenue:15,expectedBuyPrice:10,expectedUnit:'dona' as const,expectedStockEpoch:0},{productId:'p0',quantity:2,lineRevenue:30,expectedBuyPrice:10,expectedUnit:'dona' as const,expectedStockEpoch:0}]});
  assert.deepEqual(await state(owner),{product:97,inventory:97,revenue:45,profit:15});
  const result=await Promise.allSettled([sell(owner,'large-a',60),sell(owner,'large-b',60)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await state(owner)).product,37);
});

test('same revision across many records pages correctly; paid scope never leaks to a free pull', async () => {
  const owner=await fixture(actor(),8);
  await withOwnerTransaction(owner.userId, async session => {
    await ProductModel.updateMany({ownerAdminId:owner.userId},{$set:{name:'Changed'}},{session});
  });
  let page=await pullChanges(owner,{limit:3}); const ids=new Set(page.products.map(p=>p.localId));
  while(page.nextCursor) {page=await pullChanges(owner,{cursor:page.nextCursor,limit:3});page.products.forEach(p=>ids.add(p.localId))}
  assert.equal(ids.size,8);
  await InventoryEntryModel.create({ownerAdminId:owner.userId,localId:'old-p0',productId:'p0',deviceId:'test',date:'2020-01-01',startQuantity:100,currentQuantity:100});
  const free=await pullChanges({...owner,tier:'tekin'},{checkpoint:page.checkpoint!});
  assert.equal(free.inventory.some(i=>i.date==='2020-01-01'),false);
  assert.equal(free.inventory.length,8);
});

test('offline sale never crosses an absolute count or silently uses a new cost/unit',async()=>{
  const owner=await fixture();const stale={kind:'sale' as const,id:randomUUID(),deviceId:'offline',date:today,occurredAt:new Date().toISOString(),lines:[{productId:'p0',quantity:1,lineRevenue:20,expectedBuyPrice:10,expectedUnit:'dona' as const,expectedStockEpoch:0}]};
  await applyInventoryOperation(owner,{kind:'adjustment',id:randomUUID(),deviceId:'count',date:today,occurredAt:new Date().toISOString(),items:[{productId:'p0',currentQuantity:97,baseVersion:0}]});
  const before=await state(owner);await assert.rejects(applyInventoryOperation(owner,stale),(e:any)=>e.code==='RECONCILIATION_REQUIRED');
  assert.deepEqual(await state(owner),before);assert.equal(await IdempotencyKeyModel.countDocuments({ownerAdminId:owner.userId,key:stale.id}),0);
  const product:any=await ProductModel.findOne({ownerAdminId:owner.userId,localId:'p0'});assert.ok(product.stockEpoch>0);
  await assert.rejects(applyInventoryOperation(owner,{...stale,id:randomUUID(),lines:[{...stale.lines[0],expectedStockEpoch:product.stockEpoch,expectedBuyPrice:9}]}),(e:any)=>e.code==='RECONCILIATION_REQUIRED');
  await applyInventoryOperation(owner,{...stale,id:randomUUID(),lines:[{...stale.lines[0],expectedStockEpoch:product.stockEpoch}]});assert.equal((await state(owner)).product,96);
});
test('legacy financial writes without a stable operation ID are refused before mutation',async()=>{
  const owner=await fixture();let executed=false;
  await assert.rejects(withIdempotency(owner.userId,undefined,async()=>{executed=true;return {status:200,data:{}}}),(e:any)=>e.code==='IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(executed,false);assert.equal((await state(owner)).product,100);
});
test('same-key product creation, failure rollback, opening and tenant-owned deletion are replay safe',async()=>{
  const owner=actor();const payload={ownerAdminId:owner.userId,localId:'created-product',deviceId:'test',name:'Product',quantity:5,buyPrice:10,sellPrice:20,unit:'kg' as const,image:'',displayIndex:1};const key=randomUUID();
  const create=()=>withIdempotency(owner.userId,key,async()=>({status:201,data:await productService.create(owner,payload)}),{operation:'product.create',payload});
  await Promise.all([create(),create()]);assert.equal(await ProductModel.countDocuments({ownerAdminId:owner.userId}),1);
  const entry:any=await InventoryEntryModel.findOne({ownerAdminId:owner.userId,productId:payload.localId});
  const opening={kind:'opening' as const,id:randomUUID(),deviceId:'test',date:today,occurredAt:new Date().toISOString(),items:[{productId:payload.localId,startQuantity:8,currentQuantity:8,baseVersion:entry.serverVersion}]};
  await applyInventoryOperation(owner,opening);await applyInventoryOperation(owner,opening);
  const product:any=await ProductModel.findOne({ownerAdminId:owner.userId});assert.equal(product.quantity,8);
  const deletion={localId:payload.localId,operationId:randomUUID(),baseVersion:product.serverVersion};
  const other=await syncService.sync(actor(),{protocolVersion:2,deletions:[deletion]});assert.equal(other.acknowledged.length,0);
  const result=await syncService.sync(owner,{protocolVersion:2,deletions:[deletion]});assert.equal(result.acknowledged[0].entity,'deletion');
  const retry=await syncService.sync(owner,{protocolVersion:2,deletions:[deletion]});assert.equal(retry.acknowledged.length,1);
  assert.equal(await ProductTombstoneModel.countDocuments({ownerAdminId:owner.userId,localId:payload.localId}),1);
});
test('restock refuses inconsistent legacy projections instead of preserving silent corruption',async()=>{
  const owner=await fixture();await ProductModel.updateOne({ownerAdminId:owner.userId,localId:'p0'},{$set:{quantity:90}});
  await assert.rejects(applyInventoryOperation(owner,{kind:'restock',id:randomUUID(),deviceId:'test',productId:'p0',quantity:2,occurredAt:new Date().toISOString()}),(e:any)=>e.code==='RECONCILIATION_REQUIRED');
  assert.equal((await state(owner)).product,90);assert.equal((await state(owner)).inventory,100);
});
test('ambiguous old receipts and pre-v2 product creation are retained for reconciliation',async()=>{
  const owner=await fixture();await IdempotencyKeyModel.create({ownerAdminId:owner.userId,key:'legacy',state:'COMPLETED',responseStatus:200,responseBody:{}});
  await assert.rejects(sell(owner,'legacy'),(e:any)=>e.code==='LEGACY_RECEIPT_RECONCILIATION_REQUIRED');
  const product:any=await ProductModel.findOne({ownerAdminId:owner.userId});
  const result=await syncService.sync(owner,{products:[{...product.toJSON(),localId:'unknown-old-id'}]});
  assert.equal(result.rejected[0].reason,'LEGACY_RECONCILIATION_REQUIRED');assert.equal(result.acknowledged.length,0);assert.equal((await state(owner)).product,100);
});
