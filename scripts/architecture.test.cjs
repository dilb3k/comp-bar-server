const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.MONGODB_URL='mongodb://127.0.0.1:27017/bar-test';process.env.JWT_SECRET='test_secret_min_16_chars';
const {ReadCache}=require('../backend/dist/lib/read-cache');
const {WindowBuckets}=require('../backend/dist/lib/rate-limit-store');
const {WorkGate}=require('../backend/dist/lib/work-gate');
const {poolBudget}=require('../backend/dist/lib/runtime-capacity');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Mongo pool budget accounts for workers, deployment replicas and monitoring sockets',()=>{
 assert.equal(poolBudget(1).maxPoolSize,100);assert.equal(poolBudget(1).minPoolSize,10);
 for(const workers of [1,2,4,8]){const options=poolBudget(workers);assert.ok((options.maxPoolSize+2)*workers*2*3+24<=660);assert.ok(options.minPoolSize<=options.maxPoolSize);assert.equal(options.socketTimeoutMS,45000);assert.equal(options.waitQueueTimeoutMS,5000)}
 assert.throws(()=>poolBudget(200));
});
test('rate windows expire without evicting live brute-force counters under IP spray',()=>{
 const buckets=new WindowBuckets(2);assert.equal(buckets.apply('increment','auth:a',100,0).totalHits,1);
 buckets.apply('increment','auth:b',100,0);assert.throws(()=>buckets.apply('increment','auth:c',100,0));
 assert.equal(buckets.apply('increment','auth:a',100,10).totalHits,2);
 assert.equal(buckets.apply('increment','auth:c',100,101).totalHits,1);assert.ok(buckets.size<=2);
});
test('cache coalesces misses, respects revision and tenant keys, expires and retries failed loads',async()=>{
 const cache=new ReadCache(1000,20,3);let calls=0;
 const load=async()=>{calls++;await delay(5);return 'value'};
 assert.deepEqual(await Promise.all(Array.from({length:50},()=>cache.get('owner:revision1',load))),Array(50).fill('value'));assert.equal(calls,1);
 await cache.get('owner:revision1',load);assert.equal(calls,1);
 await cache.get('other:revision1',load);await cache.get('owner:revision2',load);assert.equal(calls,3);
 await delay(25);await cache.get('owner:revision1',load);assert.equal(calls,4);
 await assert.rejects(cache.get('fail',async()=>{throw Error('DB failed')}));assert.equal(await cache.get('fail',async()=>'retry'),'retry');
 for(let i=0;i<20;i++)await cache.get(String(i),async()=>'x'.repeat(200));assert.ok(cache.metrics.bytes<=1000);assert.ok(cache.metrics.entries<=3);assert.equal(cache.metrics.inflight,0);
});
test('expensive work queue rejects overload, times out waiting work and releases slots on failure',async()=>{
 const gate=new WorkGate(1,1,20);let release;const first=gate.run(()=>new Promise(resolve=>release=resolve));
 const queued=gate.run(async()=>1);const expired=assert.rejects(queued,/busy/);
 await assert.rejects(gate.run(async()=>2),/busy/);await expired;release();await first;
 await assert.rejects(gate.run(async()=>{throw Error('failure')}));assert.equal(await gate.run(async()=>3),3);
});
test('lean serializers match hydrated API contracts, including legacy missing defaults',()=>{
 const {Types}=require('mongoose');const id=new Types.ObjectId();
 for(const [module,model,serialize,extra] of [
 ['products/product.model','ProductModel','serializeProduct',{}],
 ['inventory/inventory.model','InventoryEntryModel','serializeInventory',{}],
 ['snapshots/snapshot.model','DailySnapshotModel','serializeSnapshot',{items:[{productId:'p0',sold:1}]}],
 ['procurements/procurement.model','ProcurementModel','serializeProcurement',{items:[],totalCost:10}],
 ]){const m=require('../backend/dist/modules/'+module);const row={_id:id,ownerAdminId:'private',localId:'p0',name:'test',createdAt:new Date(),...extra};assert.deepEqual(JSON.parse(JSON.stringify(m[serialize](row))),JSON.parse(JSON.stringify(m[model].hydrate(row))));}
});
test('CSV/XLSX formatting worker returns usable bytes without blocking API timers',async()=>{
 const {exportReport,closeReportWorker}=require('../backend/dist/lib/report-worker');const ExcelJS=require('exceljs');
 try{let ticks=0;const timer=setInterval(()=>ticks++,5);const data={kind:'receipts',from:'2026-01-01',to:'2026-01-01',rows:[['Kirimlar'],['Davr'],[],['Mahsulot','Jami'],...Array.from({length:2000},(_,i)=>['item'+i,i])]};
 const result=await exportReport(data,'xlsx');clearInterval(timer);assert.ok(ticks>2);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(result.body);assert.equal(workbook.worksheets[0].getCell('B2004').value,1999);
 const csv=await exportReport(data,'csv');assert.match(csv.body.toString(),/item1999/);
 }finally{await closeReportWorker()}
});
