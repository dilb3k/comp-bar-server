// Only started by the disposable local replica-set test harness.
const assert=require('node:assert/strict');
assert.equal(process.env.NODE_ENV,'test');
assert.match(process.env.MONGODB_URL??'',/^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
const mongoose=require('mongoose');
const {monitorEventLoopDelay,performance}=require('node:perf_hooks');
const {connectDatabase}=require('../backend/dist/lib/mongoose');
const {poolBudget}=require('../backend/dist/lib/runtime-capacity');
const {readCache}=require('../backend/dist/lib/read-cache');
const {createApp}=require('../backend/dist/app');
const loop=monitorEventLoopDelay({resolution:20});loop.enable();
(async()=>{
 await connectDatabase();
 await Promise.all(Object.values(mongoose.models).map(model=>model.init()));
 const client=mongoose.connection.getClient();const pool={created:0,closed:0,checkedOut:0,peakCheckedOut:0,checkoutFailures:0};
 client.on('connectionCreated',()=>pool.created++);client.on('connectionClosed',()=>pool.closed++);
 client.on('connectionCheckedOut',()=>{pool.checkedOut++;pool.peakCheckedOut=Math.max(pool.peakCheckedOut,pool.checkedOut)});
 client.on('connectionCheckedIn',()=>pool.checkedOut--);client.on('connectionCheckOutFailed',()=>pool.checkoutFailures++);
 let utilization=performance.eventLoopUtilization();
 const server=require('../backend/dist/lib/http-server').createHttpServer(createApp()).listen({port:0,host:'127.0.0.1',backlog:4096},()=>process.send({ready:true,port:server.address().port}));
 process.on('message',async message=>{
   if(message==='pause-before-commit'){
     const {snapshotService}=require('../backend/dist/modules/snapshots/snapshot.service');
     const original=snapshotService.recompute;
     snapshotService.recompute=async function(...args){const result=await original.apply(this,args);process.send({pausedBeforeCommit:true});await new Promise(()=>{});return result};
     process.send({pauseArmed:true});
   }
   if(message==='metrics') {const current=performance.eventLoopUtilization(utilization);utilization=performance.eventLoopUtilization();process.send({metrics:{rssMB:Math.round(process.memoryUsage().rss/1048576),heapMB:Math.round(process.memoryUsage().heapUsed/1048576),eventLoopP99ms:Math.round(loop.percentile(99)/1e6),eventLoopMaxMs:Math.round(loop.max/1e6),eventLoopUtilization:current.utilization,pool:{...pool,options:poolBudget(1)},cache:readCache.metrics}});loop.reset();}
   if(message==='stop'){server.closeAllConnections();server.close();await require('../backend/dist/lib/report-worker').closeReportWorker();await mongoose.disconnect();process.exit(0)}
 });
})().catch(error=>{console.error(error);process.exit(1)});
