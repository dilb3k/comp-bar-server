const {test}=require('node:test'),assert=require('node:assert/strict'),{fork}=require('node:child_process'),net=require('node:net');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('production cluster entry shares auth limits, replaces a crashed worker and drains all pools',{timeout:60000},async t=>{
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const child=fork('backend/dist/cluster.js',[],{env:{...process.env,PORT:String(port),WEB_CONCURRENCY:'2',RUN_SCHEDULED_JOBS:'false'},stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();const workers=new Map(),pids=new Set();
 child.on('message',message=>{if(message.type==='cluster-worker-ready'){workers.set(message.slot,message.pid);pids.add(message.pid)}});
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exited}});
 async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;if(child.exitCode!==null)throw Error(stderr);await delay(50)}throw Error('Cluster readiness timeout: '+stderr)}
 await until(()=>workers.size===2);
 async function login(){return fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'10.241.1.1',Connection:'close'},body:'{}'})}
 for(let i=0;i<10;i++)assert.equal((await login()).status,422);
 assert.equal((await login()).status,429);
 const crashed=workers.get(1);process.kill(crashed,'SIGKILL');await until(()=>workers.get(1)!==crashed);
 assert.equal((await login()).status,429,'worker restart must not reset brute-force counters');
 assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status,200);
 child.kill('SIGTERM');assert.deepEqual(await exited,{code:0,signal:null});
 for(const pid of pids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
