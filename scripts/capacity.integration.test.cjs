// Explicit run only, against the harness's disposable loopback replica set.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const {start,fixture,sale,request,models,today,socketMetrics}=require('./http-test-support.cjs');
const connections=Number(process.env.CAPACITY_CONNECTIONS||1000),total=Number(process.env.CAPACITY_REQUESTS||12000),productsPerStore=Number(process.env.CAPACITY_PRODUCTS_PER_STORE||100);
assert.ok(Number.isInteger(connections)&&connections>=500&&connections<=1000);
assert.ok(Number.isInteger(total)&&total>=10000);assert.ok(Number.isInteger(productsPerStore)&&productsPerStore>=1&&productsPerStore<=1000);
const metrics=workers=>Promise.all(workers.map(w=>new Promise(resolve=>{const listener=m=>{if(m.metrics){w.child.off('message',listener);resolve(m.metrics)}};w.child.on('message',listener);w.child.send('metrics')})));
test('10,000+ authenticated mixed requests through 500–1000 actual sockets',{timeout:900000},async t=>{
 const workers=await start(t,{connections,connectionRamp:32}),owners=[],stores=1000;const setup=performance.now();
 for(let offset=0;offset<stores;offset+=20){owners.push(...await Promise.all(Array.from({length:20},(_,j)=>fixture(offset+j,productsPerStore))));if(offset%200===0)console.log(`Seeded ${offset+20}/${stores} stores`)}
 await models.subscriptions.collection.insertMany(owners.map(owner=>({userId:owner.owner,tier:'pro',startDate:new Date(),endDate:new Date(Date.now()+86400000),isActive:true,activatedBy:owner.owner,createdAt:new Date(),updatedAt:new Date()})));
 const setupSeconds=(performance.now()-setup)/1000;await metrics(workers);
 const operations=owners.map(()=>sale()),waves=[];let samples=[];
 async function wave(name,count,method){
  const started=performance.now(),latencies=[],statuses={},errors=[];let next=0;
  await Promise.all(Array.from({length:Math.min(connections,count)},async()=>{
   while(next<count){const i=next++,at=performance.now();try{const result=await method(owners[i%stores],i);statuses[result.status]=(statuses[result.status]??0)+1;if(result.status!==200&&errors.length<3)errors.push(result.body)}catch(error){statuses.transportError=(statuses.transportError??0)+1;if(errors.length<3)errors.push(error.message)}latencies.push(performance.now()-at)}
  }));
  latencies.sort((a,b)=>a-b);samples.push(...latencies);const durationMs=performance.now()-started;
  const percentile=p=>Math.round(latencies[Math.ceil(latencies.length*p)-1]);
  waves.push({name,requests:count,concurrency:Math.min(connections,count),durationMs:Math.round(durationMs),requestsPerSecond:Math.round(count*1000/durationMs),p50ms:percentile(.5),p95ms:percentile(.95),p99ms:percentile(.99),maxMs:percentile(1),statuses,errors,metrics:await metrics(workers)});console.log(JSON.stringify({...waves.at(-1),metrics:undefined}));
 }
 await wave('sale',stores,(owner,i)=>request(workers[i%2],owner,'/inventory/operations',operations[i]));
 await wave('replay-other-instance',stores,(owner,i)=>request(workers[(i+1)%2],owner,'/inventory/operations',operations[i]));
 await wave('mixed-catalog-read',total-2*stores-1000,(owner,i)=>request(workers[i%2],owner,i%4===0?'/products':'/products/p0'));
 // Repeated analytics across 20 stores tests single-flight cache sharing;
 // all 1,000 distinct owners were exercised by reads/writes above.
 await wave('analytics-read',1000,(_owner,i)=>request(workers[i%2],owners[i%20],'/procurements/analytics?period=month'));
 const scope={ownerAdminId:{$in:owners.map(o=>o.owner)}};
 const quantities=await models.products.countDocuments({...scope,localId:'p0',quantity:99});
 const inventories=await models.inventory.countDocuments({...scope,productId:'p0',date:today,currentQuantity:99});
 const reports=await models.snapshots.countDocuments({...scope,date:today,totalRevenue:20,totalProfit:10,totalSoldItems:1});
 const receipts=await models.receipts.countDocuments(scope);
 const after=await metrics(workers);const explain=await models.products.find({ownerAdminId:owners[0].owner,localId:'p0'}).explain('executionStats');
 samples.sort((a,b)=>a-b);const durationMs=waves.reduce((n,w)=>n+w.durationMs,0);
 const report={generatedAt:new Date().toISOString(),runtime:process.version,platform:os.platform(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,stores,productsPerStore,totalRequests:total,connections,connectionRamp:{maxHandshakes:32,releaseDelayMs:100},sockets:socketMetrics(),apiProcesses:2,apiHeapLimitMB:450,setupSeconds:Math.round(setupSeconds),durationMs,requestsPerSecond:Math.round(total*1000/durationMs),p50ms:Math.round(samples[Math.ceil(total*.5)-1]),p95ms:Math.round(samples[Math.ceil(total*.95)-1]),p99ms:Math.round(samples[Math.ceil(total*.99)-1]),waves,after,correctness:{quantities,inventories,reports,receipts},query:{totalDocsExamined:explain.executionStats.totalDocsExamined,totalKeysExamined:explain.executionStats.totalKeysExamined},limitations:'Two independent API instances using production connection/cache/HTTP policies. Cluster IPC and worker restart are separately tested. Local single-host replica set, 1,000 tenants and up to 1,000 in-flight requests, NOT 10,000 simultaneous users or a sustained Atlas/WAN/TLS capacity guarantee.'};
 fs.mkdirSync('docs/evidence',{recursive:true});fs.writeFileSync('docs/evidence/local-capacity.json',JSON.stringify(report,null,2)+'\n');
 assert.deepEqual({quantities,inventories,reports,receipts},{quantities:stores,inventories:stores,reports:stores,receipts:stores});
 for(const wave of waves)assert.deepEqual(wave.statuses,{200:wave.requests});assert.equal(explain.executionStats.totalDocsExamined,1);
 assert.equal(socketMetrics().peak,connections);for(const value of after){assert.equal(value.pool.checkedOut,0);assert.equal(value.pool.checkoutFailures,0);assert.ok(value.pool.peakCheckedOut<=value.pool.options.maxPoolSize)}
});
