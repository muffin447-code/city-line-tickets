const $=id=>document.getElementById(id);
let current=null,busy=false;
async function api(route,body){
  const token=$('token').value.trim();if(!token)throw new Error('请先输入本机服务密钥。');
  const response=await fetch(route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error'});
  const value=await response.json();if(!response.ok)throw new Error(value.error?.message||'请求未完成。');return value;
}
function show(task){
  current=task;$('taskId').value=task.id;
  $('status').textContent=[task.mode==='demo'?'演示模式':'真实模式',task.status+' / '+task.stage,task.message,...(task.evidence?['确认编号来源：'+task.evidence.source,'编号：'+task.evidence.confirmationNumber]:[])].join('\n');
  $('start').disabled=!['created'].includes(task.status)&&!(task.status==='blocked'&&task.stage==='configuration_required');
  $('resumeForm').hidden=!task.challenge;
  if(task.challenge){
    $('challengePrompt').textContent=task.challenge.prompt;
    $('codeLabel').hidden=task.challenge.kind!=='otp';
    $('referenceLabel').hidden=task.challenge.kind!=='email_confirmation';
    $('confirmLabel').hidden=['otp','email_confirmation'].includes(task.challenge.kind);
    $('confirmed').checked=false;$('code').value='';$('confirmationNumber').value='';
  }
}
const run=fn=>async event=>{event?.preventDefault();if(busy)return;busy=true;try{await fn();$('feedback').textContent='状态已更新。'}catch(e){$('feedback').textContent=e.message;}finally{busy=false;}};
async function refresh(){const id=$('taskId').value.trim();if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('请填写有效的任务编号。');show(await api('/v1/tasks/'+id));}
$('createForm').addEventListener('submit',run(async()=>show(await api('/v1/tasks',{mode:$('mode').value,registerAccount:$('registerAccount').checked,participant:{fullName:$('fullName').value,email:$('email').value,countryCode:$('countryCode').value,phone:$('phone').value,provider:$('provider').value}}))));
$('refresh').addEventListener('click',run(refresh));
$('start').addEventListener('click',run(async()=>{if(!current)throw new Error('请先读取任务。');show(await api('/v1/tasks/'+current.id+'/start',{}));}));
$('resumeForm').addEventListener('submit',run(async()=>{
  if(!current?.challenge)throw new Error('请重新读取当前步骤。');
  const c=current.challenge;const body={challengeId:c.id};
  if(c.kind==='otp')body.code=$('code').value;else if(c.kind==='email_confirmation')body.confirmationNumber=$('confirmationNumber').value;else{if(!$('confirmed').checked)throw new Error('请先完成或明确同意当前步骤。');body.confirmed=true;}
  show(await api('/v1/tasks/'+current.id+'/resume',body));
}));
