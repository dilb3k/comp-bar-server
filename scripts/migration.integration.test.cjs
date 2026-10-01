const {test}=require('node:test'),assert=require('node:assert/strict'),mongoose=require('mongoose');
const {inspect,apply}=require('./reliability-migration.cjs');
test('migration dry-run is read-only; TTL removal and null cleanup are explicit, restartable, and duplicates block apply',async t=>{
 assert.match(process.env.MONGODB_URL??'',/^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
 await mongoose.connect(process.env.MONGODB_URL,{autoIndex:false});t.after(()=>mongoose.disconnect());
 // Separate local database so the normal integration suites keep running.
 const db=mongoose.connection.getClient().db('hisvex_migration_test');
 const schema=new mongoose.Schema({ownerAdminId:String,key:String},{collection:'idempotency_keys'});schema.index({ownerAdminId:1,key:1},{unique:true});
 const model=mongoose.model('MigrationReceiptFixture',schema);
 await db.collection('idempotency_keys').createIndex({createdAt:1},{name:'legacy_ttl',expireAfterSeconds:86400});
 await db.collection('idempotency_keys').insertOne({ownerAdminId:'A',key:'same',createdAt:new Date()});
 await db.collection('payments').insertOne({receiptHash:null,status:'pending'});
 const dry=await inspect(db,[model]);assert.equal(dry.dropTTL.length,1);assert.equal(dry.review.explicitNullReceiptHashes,1);
 assert.equal((await db.collection('idempotency_keys').indexes()).some(i=>i.name==='legacy_ttl'),true);
 assert.equal(await db.collection('payments').countDocuments({receiptHash:{$type:10}}),1);
 await apply(db,dry);const after=await inspect(db,[model]);assert.equal(after.dropTTL.length,0);assert.equal(after.indexes.length,0);assert.equal(after.review.explicitNullReceiptHashes,0);
 await apply(db,after);assert.equal(await db.collection('idempotency_keys').countDocuments(),1);
 await assert.rejects(db.collection('idempotency_keys').insertOne({ownerAdminId:'A',key:'same'}),e=>e.code===11000);
 await db.collection('idempotency_keys').dropIndex('ownerAdminId_1_key_1');await db.collection('idempotency_keys').insertOne({ownerAdminId:'A',key:'same'});
 const blocked=await inspect(db,[model]);assert.equal(blocked.blocking[0].duplicateGroups,1);await assert.rejects(apply(db,blocked),/blocked/);
 assert.equal(await db.collection('idempotency_keys').countDocuments(),2);
 await db.dropDatabase();
});
