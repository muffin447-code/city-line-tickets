import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import readline from 'node:readline';
import {createBridge} from '../src/server.mjs';

test('real MCP process drives local HTTP demo through signup and ballot receipt checkpoints',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cityline-mcp-e2e-'));
  const token=randomBytes(32).toString('base64url');
  const bridge=await createBridge({token,dataDir:dir});
  const {port}=await bridge.listen(0);
  const script=fileURLToPath(new URL('../integrations/mcp.mjs',import.meta.url));
  const child=spawn(process.execPath,[script],{env:{...process.env,CITYLINE_BRIDGE_TOKEN:token,CITYLINE_BRIDGE_URL:'http://127.0.0.1:'+port},stdio:['pipe','pipe','pipe']});
  const lines=readline.createInterface({input:child.stdout});
  const waiting=new Map();let sequence=0,output='',stderr='';
  child.stdout.on('data',c=>{output+=c;});child.stderr.on('data',c=>{stderr+=c;});
  lines.on('line',line=>{const response=JSON.parse(line);const entry=waiting.get(response.id);if(entry){clearTimeout(entry.timer);waiting.delete(response.id);entry.resolve(response);}});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('MCP response timed out.'));},5000);waiting.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  const call=async(name,args)=>{const response=await rpc('tools/call',{name,arguments:args});assert.equal(response.result?.isError,false);return response.result.structuredContent;};
  t.after(async()=>{child.stdin.end();if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}lines.close();for(const item of waiting.values())clearTimeout(item.timer);await bridge.close();await rm(dir,{recursive:true,force:true});});
  const initialized=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'offline-test',version:'1'}});
  assert.equal(initialized.result.serverInfo.name,'cityline-gpt-bridge');
  let task=await call('create_cityline_task',{mode:'demo',registerAccount:true,participant:{fullName:'CHAN TAI MAN',email:'participant@example.com',countryCode:'1',phone:'2025550123'}});
  await call('start_cityline_task',{taskId:task.id});await bridge.engine.idle(task.id);
  task=await call('get_cityline_task',{taskId:task.id});
  const seen=[];
  for(let i=0;i<12&&task.status!=='completed';i++){
    assert.ok(task.challenge);seen.push(task.challenge.kind);
    const answer=task.challenge.kind==='otp'?{code:'123456'}:task.challenge.kind==='email_confirmation'?{confirmationNumber:'DEMO-REFERENCE'}:{confirmed:true};
    await call('resume_cityline_task',{taskId:task.id,challengeId:task.challenge.id,...answer});
    await bridge.engine.idle(task.id);task=await call('get_cityline_task',{taskId:task.id});
  }
  assert.equal(task.status,'completed');assert.equal(task.mode,'demo');assert.equal(task.evidence.source,'user_reported');
  assert.deepEqual(seen,['otp','terms','create_account','captcha','terms','submit_ballot','email_confirmation']);
  assert.equal(output.includes(token),false);assert.equal(output.includes('participant@example.com'),false);assert.equal(output.includes('2025550123'),false);assert.equal(output.includes('123456'),false);assert.equal(stderr,'');
});
