/** Explicit maintenance command. No .env loading, no business data deduplication.
 * REMEDIATION_MONGODB_URL must be set by the operator. Default is read-only.
 * Apply only with --apply --writers-stopped after backup and dry-run review.
 */
const mongoose=require('mongoose');
function getModels(){return [
 ['products','ProductModel'],['inventory','InventoryEntryModel'],['snapshots','DailySnapshotModel'],
].map(([module,exportName])=>require(`../backend/dist/modules/${module}/${({products:'product',inventory:'inventory',snapshots:'snapshot'})[module]}.model`)[exportName]).concat([
 require('../backend/dist/modules/idempotency/idempotency.model').IdempotencyKeyModel,
 require('../backend/dist/modules/products/product-tombstone.model').ProductTombstoneModel,
 require('../backend/dist/modules/payments/payment.model').PaymentModel,
 require('../backend/dist/modules/payments/payment-receipt.model').PaymentReceiptModel,
 require('../backend/dist/modules/subscriptions/subscription.model').SubscriptionModel,
 require('../backend/dist/modules/subscriptions/subscription-grant.model').SubscriptionGrantModel,
 require('../backend/dist/modules/auth/user.model').UserModel,
 require('../backend/dist/modules/debtors/debtor.model').DebtorModel,
 require('../backend/dist/lib/transaction').OwnerWriteVersion,
]);}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function inspect(db,models=getModels()){
 const result={blocking:[],dropTTL:[],indexes:[],review:{}};
 for(const model of models){
  const collection=db.collection(model.collection.name);
  const actual=await collection.listIndexes().toArray().catch(e=>{if(e.code===26)return [];throw e});
  if(['idempotency_keys','product_tombstones'].includes(collection.collectionName)) {
   for(const i of actual) if(i.expireAfterSeconds!==undefined)result.dropTTL.push({collection:collection.collectionName,name:i.name});
  }
  for(const [key,options] of model.schema.indexes()){
   if(options.unique){
    const match=options.partialFilterExpression??(options.sparse?Object.fromEntries(Object.keys(key).map(k=>[k,{$exists:true,$ne:null}])):{});
    const duplicates=await collection.aggregate([{$match:match},{$group:{_id:Object.fromEntries(Object.keys(key).map(k=>[k,`$${k}`])),count:{$sum:1}}},{$match:{count:{$gt:1}}},{$count:'groups'}],{allowDiskUse:true}).toArray();
    if(duplicates.length)result.blocking.push({collection:collection.collectionName,key,duplicateGroups:duplicates[0].groups});
   }
   const equivalent=actual.find(i=>equal(i.key,key)&&!!i.unique===!!options.unique&&!!i.sparse===!!options.sparse&&equal(i.partialFilterExpression,options.partialFilterExpression));
   if(!equivalent){
    const conflict=actual.find(i=>i.name===options.name);
    if(conflict)result.blocking.push({collection:collection.collectionName,index:conflict.name,reason:'Index definition differs; review explicit replacement'});
    result.indexes.push({collection:collection.collectionName,key,options});
   }
  }
 }
 result.review.legacyReceipts=await db.collection('idempotency_keys').countDocuments({fingerprint:{$exists:false}});
 result.review.explicitNullReceiptHashes=await db.collection('payments').countDocuments({receiptHash:{$type:10}});
 result.review.legacyProvisionalPayments=await db.collection('payments').countDocuments({$or:[{status:'provisioned'},{needsReconciliation:true}]});
 result.review.publicReceiptURLs=await db.collection('payments').countDocuments({receiptImageUrl:{$type:'string'}});
 result.review.ownerlessProducts=await db.collection('products').countDocuments({$or:[{ownerAdminId:{$exists:false}},{ownerAdminId:null},{ownerAdminId:''}]});
 if(result.review.ownerlessProducts) result.blocking.push({reason:'Unowned products require verified ownership, never guess'});
 const legacyPaid=await db.collection('users').aggregate([{$match:{isPayed:true,role:'admin'}},{$lookup:{from:'subscriptions',let:{owner:{$toString:'$_id'}},pipeline:[{$match:{$expr:{$and:[{$eq:['$userId','$$owner']},{$eq:['$isActive',true]},{$gt:['$endDate',new Date()]}]}}},{$limit:1}],as:'active'}},{$match:{active:{$size:0}}},{$count:'count'}]).toArray();
 result.review.paidFlagsWithoutActiveGrant=legacyPaid[0]?.count??0;
 return result;
}
async function apply(db,plan){
 if(plan.blocking.length)throw Error('Migration blocked: repair reviewed source data/index conflicts first');
 // Hash:null is absence, not a paid transaction. Removing only the null
 // sentinel permits the existing unique sparse index to work as intended.
 await db.collection('payments').updateMany({receiptHash:{$type:10}},{$unset:{receiptHash:''}});
 for(const item of plan.dropTTL)await db.collection(item.collection).dropIndex(item.name);
 for(const item of plan.indexes)await db.collection(item.collection).createIndex(item.key,item.options);
}
module.exports={inspect,apply,getModels};
if(require.main===module)(async()=>{
 const uri=process.env.REMEDIATION_MONGODB_URL;if(!uri)throw Error('Set REMEDIATION_MONGODB_URL explicitly; the app .env is never read');
 process.env.NODE_ENV='test';process.env.MONGODB_URL=uri;process.env.JWT_SECRET='migration_does_not_issue_tokens';
 mongoose.set('autoIndex',false);await mongoose.connect(uri,{autoIndex:false});
 try{const db=mongoose.connection.db,plan=await inspect(db);console.log(JSON.stringify(plan,null,2));
  if(process.argv.includes('--apply')){if(!process.argv.includes('--writers-stopped'))throw Error('Stop all writers and pass --writers-stopped after backup/review');await apply(db,plan);console.log(JSON.stringify({after:await inspect(db)},null,2))}
 }finally{await mongoose.disconnect()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
