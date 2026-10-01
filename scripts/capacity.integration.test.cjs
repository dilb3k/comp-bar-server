// Explicit run only: creates 1M products + 1M stock rows in the disposable DB.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const {start,fixture,sale,request,models,today}=require('./http-test-support.cjs');
test('1,000 concurrent stores, 1,000 products per store; 2 API processes',{timeout:900000},async t=>{
 const workers=await start(t),owners=[];const setup=performance.now();
 for(let offset=0;offset<1000;offset+=10){owners.push(...await Promise.all(Array.from({length:10},(_,j)=>fixture(offset+j,1000))));if(offset%100===0)console.log(`Seeded ${offset+10}/1000 stores`)}
 const operations=owners.map(()=>sale());const waves=[];
 async function wave(name,method){const started=performance.now(),latencies=[],statuses={};await Promise.all(owners.map(async(owner,i)=>{const at=performance.now();const result=await method(owner,i);latencies.push(performance.now()-at);statuses[result.status]=(statuses[result.status]??0)+1}));latencies.sort((a,b)=>a-b);const durationMs=performance.now()-started;waves.push({name,concurrency:1000,durationMs:Math.round(durationMs),requestsPerSecond:Math.round(1000000/durationMs),p50ms:Math.round(latencies[499]),p95ms:Math.round(latencies[949]),p99ms:Math.round(latencies[989]),statuses});console.log(JSON.stringify(waves.at(-1)))}
 await wave('sale', (owner,i)=>request(workers[i%2],owner,'/inventory/operations',operations[i]));
 // Responses may have been lost at the client; replay via the other instance.
 await wave('replay-other-instance',(owner,i)=>request(workers[(i+1)%2],owner,'/inventory/operations',operations[i]));
 await wave('product-read',(owner,i)=>request(workers[i%2],owner,'/products/p0'));
 const scope={ownerAdminId:{$in:owners.map(o=>o.owner)}};
 const quantities=await models.products.countDocuments({...scope,localId:'p0',quantity:99});
 const inventories=await models.inventory.countDocuments({...scope,productId:'p0',date:today,currentQuantity:99});
 const reports=await models.snapshots.countDocuments({...scope,date:today,totalRevenue:20,totalProfit:10,totalSoldItems:1});
 const receipts=await models.receipts.countDocuments(scope);
 const metrics=await Promise.all(workers.map(w=>new Promise(resolve=>{w.child.once('message',m=>resolve(m.metrics));w.child.send('metrics')})));
 const explain=await models.products.find({ownerAdminId:owners[0].owner,localId:'p0'}).explain('executionStats');
 const report={generatedAt:new Date().toISOString(),runtime:process.version,platform:os.platform(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,stores:1000,productsPerStore:1000,apiProcesses:2,apiHeapLimitMB:450,mongoPoolPerProcess:50,setupSeconds:Math.round((performance.now()-setup)/1000-waves.reduce((n,w)=>n+w.durationMs/1000,0)),waves,metrics,correctness:{quantities,inventories,reports,receipts},query:{totalDocsExamined:explain.executionStats.totalDocsExamined,totalKeysExamined:explain.executionStats.totalKeysExamined},limitations:'Local single-host Mongo replica set; no WAN/TLS/Atlas resource limits or production failover. This is a synchronized burst, not a sustained production capacity guarantee.'};
 fs.mkdirSync('docs/evidence',{recursive:true});fs.writeFileSync('docs/evidence/local-capacity.json',JSON.stringify(report,null,2)+'\n');
 assert.deepEqual({quantities,inventories,reports,receipts},{quantities:1000,inventories:1000,reports:1000,receipts:1000});
 waves.forEach(w=>assert.deepEqual(w.statuses,{200:1000}));assert.equal(explain.executionStats.totalDocsExamined,1);
});
