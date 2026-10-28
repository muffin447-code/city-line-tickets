import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {request} from 'node:http';
import {createBridge} from '../src/server.mjs';
import {TaskStore} from '../src/store.mjs';
import {Engine} from '../src/engine.mjs';
import {validateCreate} from '../src/validation.mjs';

const body=()=>({mode:'demo',registerAccount:true,participant:{fullName:'CHAN TAI MAN',email:'participant@example.com',countryCode:'1',phone:'2025550123',provider:'Demo'}});
const token=()=>randomBytes(32).toString('base64url');
const fakeDriver=()=>({advance:async(task,input)=> task.stage==='created'?{status:'needs_input',stage:'account_otp',message:'等待验证码。',challenge:{kind:'otp',prompt:'请输入当前验证码。'}}:{status:'needs_confirmation',stage:'submit_ballot',message:'等待当前确认。',challenge:{kind:'submit_ballot',prompt:'是否提交当前登记？'}},close:async()=>{}});
async function privateTemp(t){const dir=await mkdtemp(path.join(tmpdir(),'cityline-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function setup(t){
  const secret=token();const dir=await privateTemp(t);
  const bridge=await createBridge({token:secret,dataDir:dir,driverFactory:async()=>fakeDriver()});
  const {port}=await bridge.listen(0);t.after(()=>bridge.close());
  const base='http://127.0.0.1:'+port;
  const call=async(route,value,auth=secret)=>{
    const response=await fetch(base+route,{method:value===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},...(value===undefined?{}:{body:JSON.stringify(value)}),redirect:'error'});
    return {status:response.status,value:await response.json(),headers:response.headers};
  };
  return {bridge,dir,secret,base,port,call};
}

test('health reveals no task; all task data requires bearer auth',async t=>{
  const c=await setup(t);
  const health=await c.call('/health',undefined,'');assert.equal(health.status,200);assert.deepEqual(Object.keys(health.value).sort(),['ok','version']);
  assert.equal((await c.call('/v1/tasks',body(),'')).status,401);
  assert.equal((await c.call('/v1/tasks',body(),'wrong')).status,401);
  const created=await c.call('/v1/tasks',body());assert.equal(created.status,201);
  const text=JSON.stringify(created.value);
  assert.equal(text.includes('participant@example.com'),false);assert.equal(text.includes('2025550123'),false);assert.equal(text.includes('CHAN TAI MAN'),false);
  assert.equal(created.headers.get('cache-control'),'no-store');
});

test('duplicate creation is idempotent and different participant is rejected',async t=>{
  const c=await setup(t);
  const [a,b]=await Promise.all([c.call('/v1/tasks',body()),c.call('/v1/tasks',body())]);
  assert.equal(a.value.id,b.value.id);
  const other=body();other.participant.email='other@example.com';
  assert.equal((await c.call('/v1/tasks',other)).status,409);
  assert.equal((await c.call('/v1/tasks',{...body(),registerAccount:false})).status,409);
});

test('single-use checkpoint prevents concurrent replay and does not journal OTP',async t=>{
  const c=await setup(t);let task=(await c.call('/v1/tasks',body())).value;
  assert.equal((await c.call('/v1/tasks/'+task.id+'/start',{})).status,202);
  await c.bridge.engine.idle(task.id);task=(await c.call('/v1/tasks/'+task.id)).value;
  const challengeId=task.challenge.id;
  const replies=await Promise.all([c.call('/v1/tasks/'+task.id+'/resume',{challengeId,code:'SECRET-728941'}),c.call('/v1/tasks/'+task.id+'/resume',{challengeId,code:'SECRET-728941'})]);
  assert.equal(replies.filter(r=>r.status===202).length,1);
  await c.bridge.engine.idle(task.id);
  task=(await c.call('/v1/tasks/'+task.id)).value;
  assert.notEqual(task.challenge.id,challengeId);
  assert.equal((await c.call('/v1/tasks/'+task.id+'/resume',{challengeId,code:'SECRET-728941'})).status,400);
  const journal=await readFile(path.join(c.dir,'tasks.json'),'utf8');assert.equal(journal.includes('SECRET-728941'),false);
  assert.equal((await stat(path.join(c.dir,'tasks.json'))).mode&0o777,0o600);
  assert.equal((await stat(c.dir)).mode&0o777,0o700);
});

test('rejects unknown fields, credential uploads, unconfirmed resumes and URL tokens',async t=>{
  const c=await setup(t);
  assert.equal((await c.call('/v1/tasks',{...body(),password:'do-not-save'})).status,400);
  const p=body();p.participant.apiKey='do-not-save';assert.equal((await c.call('/v1/tasks',p)).status,400);
  assert.equal((await c.call('/v1/tasks?token=not-a-real-secret',body())).status,400);
  const task=(await c.call('/v1/tasks',body())).value;await c.call('/v1/tasks/'+task.id+'/start',{});await c.bridge.engine.idle(task.id);
  const current=(await c.call('/v1/tasks/'+task.id)).value;
  assert.equal((await c.call('/v1/tasks/'+task.id+'/resume',{challengeId:current.challenge.id,confirmed:true})).status,400);
});

test('cross-origin browsers and DNS rebinding Host are rejected',async t=>{
  const c=await setup(t);
  const response=await fetch(c.base+'/v1/tasks',{method:'POST',headers:{Origin:'https://unrelated.invalid',Authorization:'Bearer '+c.secret,'Content-Type':'application/json'},body:JSON.stringify(body())});
  assert.equal(response.status,403);
  const badHost=await new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:c.port,path:'/health',headers:{Host:'unrelated.invalid'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();
  });assert.equal(badHost,403);
});

test('crash recovery never silently replays a running operation',async t=>{
  const dir=await privateTemp(t);const store=await new TaskStore(dir).init();const task=await store.create(validateCreate(body()));
  await store.update(task.id,t=>({...t,status:'running',stage:'ballot_submit'}));
  await store.close();
  const recovered=await new TaskStore(dir).init();assert.equal(recovered.get(task.id).status,'blocked');assert.equal(recovered.get(task.id).stage,'recovery_required');
  const engine=new Engine({store:recovered,driverFactory:async()=>fakeDriver()});await assert.rejects(engine.start(task.id),e=>e.code==='INVALID_STATE');
  await recovered.close();
});

test('completion without evidence is blocked instead of fabricating success',async t=>{
  const dir=await privateTemp(t);const store=await new TaskStore(dir).init();const task=await store.create(validateCreate(body()));
  const engine=new Engine({store,driverFactory:async()=>({advance:async()=>({status:'completed',stage:'completed',message:'Done'}),close:async()=>{}})});
  await engine.start(task.id);await engine.idle(task.id);assert.equal(engine.get(task.id).status,'blocked');await engine.close();await store.close();
});

test('unapproved live mode and short/placeholder tokens cannot be enabled accidentally',async t=>{
  const dir=await privateTemp(t);
  await assert.rejects(createBridge({token:'short',dataDir:dir}));
  const store=await new TaskStore(dir).init();const engine=new Engine({store,driverFactory:async()=>fakeDriver()});
  await assert.rejects(engine.create({...validateCreate(body()),mode:'live'}),e=>e.code==='LIVE_DISABLED');
  await store.close();
});

test('a second process owner cannot recover or execute the same data directory',async t=>{
  const dir=await privateTemp(t);const first=await new TaskStore(dir).init();
  await assert.rejects(new TaskStore(dir).init(),/locked/);
  await first.close();const replacement=await new TaskStore(dir).init();await replacement.close();
});

test('disabling live mode also blocks pre-existing live start and resume',async t=>{
  const dir=await privateTemp(t);const store=await new TaskStore(dir).init();
  const task=await store.create({...validateCreate(body()),mode:'live'});
  const engine=new Engine({store,driverFactory:async()=>fakeDriver(),allowLive:false});
  await assert.rejects(engine.start(task.id),e=>e.code==='LIVE_DISABLED');
  await store.update(task.id,t=>({...t,status:'needs_confirmation',stage:'account_create',challenge:{id:'test-gate',kind:'create_account',prompt:'Current account'}}));
  await assert.rejects(engine.resume(task.id,{challengeId:'test-gate',confirmed:true}),e=>e.code==='LIVE_DISABLED');
  await engine.close();await store.close();
});
