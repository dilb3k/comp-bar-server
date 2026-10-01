const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {start,fixture,sale,request,assertState,models,today}=require('./http-test-support.cjs');
test('two API processes share atomic operation ownership, tenant isolation and retry results',{timeout:120000},async t=>{
 const workers=await start(t),a=await fixture(1,5),b=await fixture(2,5),operation=sale();
 const responses=await Promise.all(Array.from({length:30},(_,i)=>request(workers[i%2],a,'/inventory/operations',operation)));
 for(const r of responses)assert.equal(r.status,200,JSON.stringify(r.body));
 await assertState(a);assert.equal(await models.receipts.countDocuments({ownerAdminId:a.owner,key:operation.id}),1);
 assert.deepEqual((await request(workers[1],a,'/inventory/operations',operation)).body,responses[0].body);
 assert.equal((await request(workers[1],a,'/inventory/operations',{...operation,lines:[{...operation.lines[0],quantity:2}]})).status,409);
 assert.equal((await request(workers[0],a,'/inventory/operations',sale(),{headers:{'X-Account-ID':b.owner}})).status,409);
 assert.equal((await request(workers[1],b,'/inventory/operations',operation)).status,200);await assertState(b);
 // Independent intents in the same account race; all deltas must survive.
 const distinct=await Promise.all(Array.from({length:20},(_,i)=>request(workers[i%2],a,'/inventory/operations',sale())));
 distinct.forEach(r=>assert.equal(r.status,200,JSON.stringify(r.body)));await assertState(a,79,420);
 const stale=await request(workers[0],a,'/products/p0',{name:'stale',baseVersion:0},{method:'PUT',headers:{'Idempotency-Key':randomUUID()}});assert.equal(stale.status,409);
 // A read during writes must represent one transaction snapshot.
 const reads=await Promise.all(Array.from({length:8},(_,i)=>request(workers[i%2],a,'/inventory/dashboard')));
 for(const r of reads){assert.equal(r.status,200);const d=r.body.data;assert.equal(d.products.find(p=>p.localId==='p0').quantity,79)}
 await assertState(a,79,420);
 const missingVersion=await request(workers[0],a,'/products/p0',{}, {method:'DELETE',headers:{'Idempotency-Key':randomUUID()}});assert.equal(missingVersion.status,409);
 const wrongOwnerProduct=await models.products.findOne({ownerAdminId:b.owner,localId:'p1'});
 assert.equal((await request(workers[0],a,`/products/${wrongOwnerProduct._id}`,{baseVersion:0},{method:'DELETE',headers:{'Idempotency-Key':randomUUID()}})).status,404);
 // Debt subtraction and receipt creation share one transaction, including
 // duplicate delivery to the second API instance and concurrent overdraws.
 const createKey=randomUUID(),create=()=>request(workers[0],a,'/debtors',{name:'Test debt',amount:1},{headers:{'Idempotency-Key':createKey}});
 const debt=await create();assert.equal(debt.status,201);const debtorId=debt.body.data.id??debt.body.data._id;
 assert.equal((await create()).body.data.id,debtorId);
 const debtKey=randomUUID(),adjust=i=>request(workers[i%2],a,`/debtors/${debtorId}/adjust`,{amount:0.1,type:'subtract'},{headers:{'Idempotency-Key':debtKey}});
 (await Promise.all(Array.from({length:12},(_,i)=>adjust(i)))).forEach(r=>assert.equal(r.status,200));
 assert.equal((await models.debtors.findById(debtorId)).amount,0.9);
 const debits=await Promise.all(Array.from({length:12},(_,i)=>request(workers[i%2],a,`/debtors/${debtorId}/adjust`,{amount:0.1,type:'subtract',note:'$literal'},{headers:{'Idempotency-Key':randomUUID()}})));
 assert.equal(debits.filter(r=>r.status===200).length,9);assert.equal(debits.filter(r=>r.status===422).length,3);
 assert.equal((await models.debtors.findById(debtorId)).amount,0);
 assert.equal((await request(workers[0],b,`/debtors/${debtorId}/adjust`,{amount:1,type:'add'},{headers:{'Idempotency-Key':randomUUID()}})).status,422);
 // Form URL encoding reaches the Click controller (disabled in local env), not a JSON parse error.
 const click=await fetch(workers[0].url+'/payments/click/prepare',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Forwarded-For':a.ip},body:'action=0&amount=100'});
 assert.notEqual(click.status,500);
 // Hard process death after stock/report writes but before transaction commit.
 // The second process must apply the same intent once after Mongo releases it.
 const crashOperation=sale();
 const armed=new Promise(resolve=>workers[0].child.once('message',resolve));workers[0].child.send('pause-before-commit');await armed;
 const paused=new Promise(resolve=>workers[0].child.once('message',resolve));
 const unknown=request(workers[0],b,'/inventory/operations',crashOperation).catch(()=>null);await paused;
 const killed=new Promise(resolve=>workers[0].child.once('exit',resolve));workers[0].child.kill('SIGKILL');await killed;await unknown;
 assert.equal((await request(workers[1],b,'/inventory/operations',crashOperation)).status,200);
 await assertState(b,98,40);assert.equal(await models.receipts.countDocuments({ownerAdminId:b.owner,key:crashOperation.id}),1);
});
