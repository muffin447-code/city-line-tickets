import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Local administrator recovery only; never exposed through GPT, HTTP, or MCP.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.resolve(process.env.CITYLINE_DATA_DIR||path.join(root,'.data'));
if(!process.argv.includes('--reviewed')) {console.error('请先核对浏览器及邮件，确认旧服务已停止，再运行 npm run unlock -- --reviewed。此操作不会重新提交任务。');process.exitCode=1;}
else {
  await mkdir(dir,{recursive:true,mode:0o700});
  const guardFile=path.join(dir,'recovery.lock');
  let guard;
  try {
    guard=await open(guardFile,'wx',0o600);
    const owner=JSON.parse(await readFile(path.join(dir,'process.lock'),'utf8'));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw new Error('Invalid owner.');
    try{process.kill(owner.pid,0);throw new Error('Process still active.');}catch(error){if(error.code!=='ESRCH')throw error;}
    await unlink(path.join(dir,'process.lock'));
    console.log('已解除已停止进程的锁。下次启动仍会把中断任务标为待核对，不会自动重跑。');
  }catch{console.error('无法解除锁：进程可能仍在运行、锁不存在，或恢复操作已在进行。请在本机核对。');process.exitCode=1;}
  finally{if(guard){await guard.close();await unlink(guardFile);}}
}
