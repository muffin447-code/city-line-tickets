import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import { createHandler, readConfig, runStdio, TOOLS } from './mcp.mjs';

const secret = 'private-test-token-' + 'x'.repeat(48);
const env = { CITYLINE_BRIDGE_TOKEN: secret };
const taskId = '11111111-1111-4111-8111-111111111111';
const challengeId = '22222222-2222-4222-8222-222222222222';
const req = (name,args,id=1) => ({ jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args} });
const ok = value => new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});

test('MCP initializes and advertises exactly the four intended tools', async () => {
  const handler = createHandler({env,fetchImpl:()=>{throw new Error('No request expected');}});
  const init = await handler({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});
  assert.equal(init.result.protocolVersion,'2025-06-18');
  const list = await handler({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.equal(list.result.tools.length,4);
  assert.equal(TOOLS.find(t=>t.name==='get_cityline_task').annotations.readOnlyHint,true);
});
test('forwards task calls with a private bearer token, without putting it in results', async () => {
  let request;
  const handler=createHandler({env,fetchImpl:async(url,options)=>{request={url,options};return ok({id:taskId,status:'created'});}});
  const result=await handler(req('get_cityline_task',{taskId}));
  assert.equal(request.url,'http://127.0.0.1:8787/v1/tasks/'+taskId);
  assert.equal(request.options.headers.Authorization,'Bearer '+secret);
  assert.equal(request.options.redirect,'error');
  assert.equal(JSON.stringify(result).includes(secret),false);
});
test('rejects arbitrary URLs, unknown arguments, and multiple challenge answers', async () => {
  for(const url of ['http://remote.example/','https://user:pass@example.com/','http://localhost:8787/private?token=x']) assert.throws(()=>readConfig({...env,CITYLINE_BRIDGE_URL:url}));
  const handler=createHandler({env,fetchImpl:()=>{throw new Error('No request expected');}});
  assert.equal((await handler(req('get_cityline_task',{taskId,url:'https://evil.invalid/'}))).error.code,-32602);
  assert.equal((await handler(req('resume_cityline_task',{taskId,challengeId,confirmed:true,code:'123456'}))).error.code,-32602);
});
test('HTTP error bodies and transport secrets are not echoed', async () => {
  const handler=createHandler({env,fetchImpl:async()=>new Response('secret OTP 123456 '+secret,{status:401})});
  const result=await handler(req('get_cityline_task',{taskId}));
  assert.equal(result.result.isError,true);
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.equal(JSON.stringify(result).includes('123456'),false);
});
test('stdio uses newline JSON-RPC only, and ignores notifications', async () => {
  const input=new PassThrough(),output=new PassThrough();let captured='';output.on('data',x=>captured+=x);
  const done=runStdio({input,output,env,fetchImpl:()=>{throw new Error('No request expected');}});
  input.end('{broken\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:3,method:'ping'})+'\n');
  await done;
  const lines=captured.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length,2);assert.equal(lines[0].error.code,-32700);assert.equal(lines[1].id,3);
  assert.equal(captured.includes(secret),false);
});
test('Actions schema keeps private bearer authentication and explicit mutation confirmation', () => {
  const spec=JSON.parse(fs.readFileSync(new URL('./openapi.json',import.meta.url),'utf8'));
  assert.deepEqual(spec.security,[{BridgeBearer:[]}]);
  assert.match(spec.servers[0].url,/\.invalid$/);
  for(const methods of Object.values(spec.paths)) for(const [method,operation] of Object.entries(methods)) {
    if(method!=='get') assert.equal(operation['x-openai-isConsequential'],true);
    assert.ok((operation.description||'').length<=300);
  }
  assert.equal(Object.keys(spec.paths).length,4);
});
