import { mkdir,readFile,writeFile,rename,chmod,lstat,open,unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BridgeError } from './errors.mjs';
import { identityOf } from './validation.mjs';

export class TaskStore {
  constructor(dataDir) { this.dir=path.resolve(dataDir);this.file=path.join(this.dir,'tasks.json');this.ownerFile=path.join(this.dir,'process.lock');this.owner=null;this.ownerNonce=randomUUID();this.tasks=new Map();this.tail=Promise.resolve(); }
  async init() {
    await mkdir(this.dir,{recursive:true,mode:0o700});
    if ((await lstat(this.dir)).isSymbolicLink()) throw new Error('Private data directory must not be a symlink.');
    await chmod(this.dir,0o700);
    try {
      this.owner=await open(this.ownerFile,'wx',0o600);
      await this.owner.writeFile(JSON.stringify({pid:process.pid,nonce:this.ownerNonce}));
    } catch(error) {
      if(this.owner) await this.close();
      if(error.code==='EEXIST') throw new Error('Private data directory is already locked. Verify the prior process before local recovery.');
      throw error;
    }
    let rows=[];
    try {
      if ((await lstat(this.file)).isSymbolicLink()) throw new Error('Private journal must not be a symlink.');
      rows=JSON.parse(await readFile(this.file,'utf8'));
      if (!Array.isArray(rows)) throw new Error('Invalid private journal.');
      await chmod(this.file,0o600);
    } catch(e) { if(e.code!=='ENOENT') {await this.close();throw e;} }
    let recovered=false;
    for(const row of rows) {
      if(row.status==='running') {
        row.status='blocked';row.stage='recovery_required';row.message='执行中断，结果尚不明确。请核对浏览器及确认邮件，再由本地维护者处理；不会自动重新提交。';delete row.challenge;recovered=true;
      }
      this.tasks.set(row.id,row);
    }
    if(recovered) await this.flush();
    return this;
  }
  async close() {
    if(!this.owner)return;
    await this.owner.close();this.owner=null;
    try {const record=JSON.parse(await readFile(this.ownerFile,'utf8'));if(record.nonce===this.ownerNonce)await unlink(this.ownerFile);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async lock(fn) {
    const previous=this.tail;
    let release;this.tail=new Promise(r=>{release=r;});
    await previous;
    try{return await fn();}finally{release();}
  }
  async flush() {
    const tmp=path.join(this.dir,'.tasks-'+randomUUID()+'.tmp');
    await writeFile(tmp,JSON.stringify([...this.tasks.values()],null,2),{mode:0o600,flag:'wx'});
    await rename(tmp,this.file);await chmod(this.file,0o600);
  }
  get(id) {
    const task=this.tasks.get(id);
    if(!task) throw new BridgeError(404,'NOT_FOUND','没有找到这个任务。');
    return structuredClone(task);
  }
  async create(input) {
    return this.lock(async()=>{
      const identity=identityOf(input);
      const same=[...this.tasks.values()].find(t=>t.identity===identity);
      if(same) {
        if(same.registerAccount!==input.registerAccount) throw new BridgeError(409,'TASK_OPTIONS_CONFLICT','已有同一位参与者的任务，账号注册选项不同，请先核对原任务。');
        return this.get(same.id);
      }
      if([...this.tasks.values()].some(t=>t.mode===input.mode)) throw new BridgeError(409,'SINGLE_PARTICIPANT','此安装为单人模式，已有该模式的参与者资料。');
      const now=new Date().toISOString();
      const task={...input,id:randomUUID(),identity,status:'created',stage:'created',message:'任务已创建，尚未操作网站。',createdAt:now,updatedAt:now};
      this.tasks.set(task.id,task);
      try{await this.flush();}catch(e){this.tasks.delete(task.id);throw e;}
      return this.get(task.id);
    });
  }
  async update(id,fn) {
    return this.lock(async()=>{
      const before=this.get(id);const after=await fn(structuredClone(before));
      after.updatedAt=new Date().toISOString();this.tasks.set(id,after);
      try{await this.flush();}catch(e){this.tasks.set(id,before);throw e;}
      return this.get(id);
    });
  }
}
