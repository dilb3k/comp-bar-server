// Only started by the disposable local replica-set test harness.
const assert=require('node:assert/strict');
assert.equal(process.env.NODE_ENV,'test');
assert.match(process.env.MONGODB_URL??'',/^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
const mongoose=require('mongoose');
const {monitorEventLoopDelay}=require('node:perf_hooks');
const {createApp}=require('../backend/dist/app');
const loop=monitorEventLoopDelay({resolution:20});loop.enable();
(async()=>{
 await mongoose.connect(process.env.MONGODB_URL,{maxPoolSize:50,autoIndex:false});
 const server=createApp().listen(0,'127.0.0.1',()=>process.send({ready:true,port:server.address().port}));
 process.on('message',async message=>{
   if(message==='pause-before-commit'){
     const {snapshotService}=require('../backend/dist/modules/snapshots/snapshot.service');
     const original=snapshotService.recompute;
     snapshotService.recompute=async function(...args){const result=await original.apply(this,args);process.send({pausedBeforeCommit:true});await new Promise(()=>{});return result};
     process.send({pauseArmed:true});
   }
   if(message==='metrics') process.send({metrics:{rssMB:Math.round(process.memoryUsage().rss/1048576),heapMB:Math.round(process.memoryUsage().heapUsed/1048576),eventLoopP99ms:Math.round(loop.percentile(99)/1e6)}});
   if(message==='stop'){server.closeAllConnections();server.close();await mongoose.disconnect();process.exit(0)}
 });
})().catch(error=>{console.error(error);process.exit(1)});
