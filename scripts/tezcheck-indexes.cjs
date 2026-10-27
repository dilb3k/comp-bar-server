// Run once before deploying TezCheck support. Adds only three partial unique indexes.
// MONGODB_URL must be supplied through the hosting secret environment; never printed.
const {MongoClient}=require('mongodb');
(async()=>{
 if(!process.env.MONGODB_URL)throw Error('MONGODB_URL is required');
 const client=new MongoClient(process.env.MONGODB_URL);
 try{await client.connect();for(const field of ['tezcheckRequestKey','tezcheckBillId','tezcheckPaymentId']){
  await client.db().collection('payments').createIndex({[field]:1},{unique:true,partialFilterExpression:{[field]:{$type:'string'}}});
  console.log('Verified index '+field);
 }}finally{await client.close();}
})().catch(e=>{console.error('TezCheck index setup failed: '+(e.code??e.name));process.exitCode=1;});
