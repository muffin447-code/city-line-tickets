import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBridge} from './server.mjs';

const token=randomBytes(32).toString('base64url');
const dataDir=await mkdtemp(path.join(os.tmpdir(),'cityline-gpt-demo-'));
let bridge;
try {
  bridge=await createBridge({token,dataDir});
  const address=await bridge.listen(0);
  const base='http://127.0.0.1:'+address.port;
  const call=async(route,body)=>{
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error'});
    const value=await response.json();if(!response.ok)throw new Error(value.error?.code||'Demo request failed.');return value;
  };
  let task=await call('/v1/tasks',{mode:'demo',registerAccount:true,participant:{fullName:'CHAN TAI MAN',email:'participant@example.com',countryCode:'1',phone:'2025550123',provider:'Demo'}});
  await call('/v1/tasks/'+task.id+'/start',{});
  await bridge.engine.idle(task.id);
  task=await call('/v1/tasks/'+task.id);
  for(let step=0;step<12&&task.status!=='completed';step++){
    console.log('DEMO | '+task.stage+' | '+task.status+' | '+task.message);
    if(!task.challenge)throw new Error('Demo paused unexpectedly.');
    const c=task.challenge;
    const answer=c.kind==='otp'?{code:'123456'}:c.kind==='email_confirmation'?{confirmationNumber:'DEMO-2026-0001'}:{confirmed:true};
    await call('/v1/tasks/'+task.id+'/resume',{challengeId:c.id,...answer});
    await bridge.engine.idle(task.id);task=await call('/v1/tasks/'+task.id);
  }
  if(task.status!=='completed'||task.evidence?.source!=='user_reported')throw new Error('Demo did not finish.');
  console.log('DEMO | completed | 完整演示已通过；确认编号为演示输入，未验证官方邮件。');
  console.log('没有访问 Cityline、注册真实账号或提交真实抽签。');
}finally{if(bridge)await bridge.close();await rm(dataDir,{recursive:true,force:true});}
