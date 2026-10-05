const assert=require('node:assert/strict'),{fork}=require('node:child_process'),path=require('node:path'),{randomUUID}=require('node:crypto');
const mongoose=require('mongoose');
const http=require('node:http');
// Capacity runs configure 500–1000 real keep-alive sockets.
const agent=new http.Agent({keepAlive:true,maxSockets:100,maxFreeSockets:100,maxTotalSockets:200});
const sockets=new Set();let peakSockets=0,createdSockets=0;
const createConnection=agent.createConnection.bind(agent);
let connectLimit=Infinity,connecting=0;const connectingQueue=[];
function openQueuedSockets(){while(connecting<connectLimit&&connectingQueue.length){const [options,callback]=connectingQueue.shift();connecting++;const socket=createConnection(options);sockets.add(socket);createdSockets++;peakSockets=Math.max(peakSockets,sockets.size);socket.once('close',()=>sockets.delete(socket));let done=false;const finish=error=>{if(done)return;done=true;callback(error,socket);setTimeout(()=>{connecting--;openQueuedSockets()},connectLimit===Infinity?0:100)};socket.once('connect',()=>finish(null));socket.once('error',finish)}}
agent.createConnection=(options,callback)=>{connectingQueue.push([options,callback]);openQueuedSockets()};
const socketMetrics=()=>({open:sockets.size,peak:peakSockets,created:createdSockets});
const {signAccessToken}=require('../backend/dist/modules/auth/auth.utils');
const {getCurrentBusinessDate}=require('../backend/dist/utils/business-day');
const models={
 users:require('../backend/dist/modules/auth/user.model').UserModel,
 products:require('../backend/dist/modules/products/product.model').ProductModel,
 inventory:require('../backend/dist/modules/inventory/inventory.model').InventoryEntryModel,
 snapshots:require('../backend/dist/modules/snapshots/snapshot.model').DailySnapshotModel,
 receipts:require('../backend/dist/modules/idempotency/idempotency.model').IdempotencyKeyModel,
 fences:require('../backend/dist/lib/transaction').OwnerWriteVersion,
 tombstones:require('../backend/dist/modules/products/product-tombstone.model').ProductTombstoneModel,
 subscriptions:require('../backend/dist/modules/subscriptions/subscription.model').SubscriptionModel,
 audit:require('../backend/dist/modules/audit/audit.model').AuditEventModel,
 debtors:require('../backend/dist/modules/debtors/debtor.model').DebtorModel,
};
const today=getCurrentBusinessDate(6,300);
async function start(t,{connections=200,connectionRamp=Infinity}={}){
 connectLimit=connectionRamp;
 agent.maxSockets=Math.ceil(connections/2);agent.maxTotalSockets=connections;agent.maxFreeSockets=Math.ceil(connections/2);
 assert.match(process.env.MONGODB_URL??'',/^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
 await mongoose.connect(process.env.MONGODB_URL,{maxPoolSize:30});
 await Promise.all(Object.values(models).map(m=>m.init()));
 const workers=[];t.after(async()=>{agent.destroy();await Promise.all(workers.map(w=>new Promise(resolve=>{if(w.child.exitCode!==null||w.child.signalCode!==null)return resolve();w.child.once('exit',resolve);w.child.send('stop')})));await mongoose.disconnect()});
 for(let i=0;i<2;i++) {
  const child=fork(path.join(__dirname,'test-api-worker.cjs'),[],{env:process.env,execArgv:['--max-old-space-size=450'],stdio:['ignore','ignore','pipe','ipc']});
  child.stderr.on('data',data=>process.stderr.write(data));
  const port=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>reject(Error(`API worker exited ${code}`)));child.once('message',m=>resolve(m.port))});
  workers.push({child,url:`http://127.0.0.1:${port}/api`});
 }
 return workers;
}
async function fixture(index,count=1){
 const _id=new mongoose.Types.ObjectId(),owner=_id.toString(),sessionId=randomUUID(),now=new Date();
 await models.users.collection.insertOne({_id,username:`http-${owner}`,password:'unused-test-only',role:'admin',isActive:true,activeSessionId:sessionId,activeSessionLastSeenAt:now,securityVersion:0,businessDayStartHour:6,lastActionAt:now,createdAt:now,updatedAt:now});
 const products=Array.from({length:count},(_,i)=>({ownerAdminId:owner,localId:`p${i}`,deviceId:'test',name:`Product ${i}`,quantity:100,stockEpoch:0,buyPrice:10,sellPrice:20,unit:'dona',displayIndex:i+1,serverVersion:0,createdAt:now,updatedAt:now}));
 await models.products.collection.insertMany(products);
 await models.inventory.collection.insertMany(products.map(p=>({ownerAdminId:owner,localId:`${today}-${p.localId}`,productId:p.localId,productName:p.name,deviceId:'test',date:today,startQuantity:100,currentQuantity:100,buyPrice:10,sellPrice:20,unit:'dona',lockedSold:0,lockedRevenue:0,lockedProfit:0,serverVersion:0,createdAt:now,updatedAt:now})));
 // Seed a normal already-open day; the separate cold-start projection test
 // exercises creation of this 1,000-item snapshot from inventory.
 await models.snapshots.collection.insertOne({ownerAdminId:owner,localId:`snapshot-${today}`,deviceId:'test',date:today,items:products.map(p=>({productId:p.localId,productName:p.name,unit:'dona',sold:0,buyPrice:10,sellPrice:20,revenue:0,profit:0})),totalRevenue:0,totalProfit:0,totalSoldItems:0,serverVersion:0,createdAt:now,updatedAt:now});
 return {owner,token:signAccessToken({userId:owner,username:`http-${owner}`,phone_number:'',role:'admin',isPayed:false,sessionId,securityVersion:0}),ip:`10.${Math.floor(index/65025)%250}.${Math.floor(index/255)%255}.${index%255+1}`};
}
function sale(id=randomUUID(),quantity=1){return {kind:'sale',id,deviceId:'test',date:today,occurredAt:new Date().toISOString(),lines:[{productId:'p0',quantity,lineRevenue:quantity*20,expectedBuyPrice:10,expectedUnit:'dona',expectedStockEpoch:0}]}}
async function request(worker,owner,route,body,options={}){
 return new Promise((resolve,reject)=>{
  const data=body?JSON.stringify(body):undefined;
  const req=http.request(worker.url+route,{agent,method:options.method??(body?'POST':'GET'),headers:{Authorization:`Bearer ${owner.token}`,'X-Account-ID':owner.owner,'X-Forwarded-For':owner.ip,'X-Client-Protocol':'2','Content-Type':'application/json',...(data?{'Content-Length':Buffer.byteLength(data)}:{}),...options.headers},signal:AbortSignal.timeout(180000)},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())})}catch(error){reject(error)}});
  });req.on('error',reject);req.end(data);
 });
}
async function assertState(owner,quantity=99,revenue=20){
 const p=await models.products.findOne({ownerAdminId:owner.owner,localId:'p0'}).lean(),i=await models.inventory.findOne({ownerAdminId:owner.owner,productId:'p0',date:today}).lean(),s=await models.snapshots.findOne({ownerAdminId:owner.owner,date:today}).lean();
 assert.equal(p.quantity,quantity);assert.equal(i.currentQuantity,quantity);assert.equal(s.totalRevenue,revenue);assert.equal(s.totalProfit,revenue/2);
}
module.exports={start,socketMetrics,fixture,sale,request,assertState,models,today,mongoose};
