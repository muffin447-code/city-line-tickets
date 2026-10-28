import { randomUUID } from 'node:crypto';
import { BridgeError } from './errors.mjs';
import { validateResume,publicTask } from './validation.mjs';

const statuses=new Set(['needs_input','needs_confirmation','awaiting_email','completed','blocked','failed']);
const kinds=new Set(['otp','captcha','terms','password','create_account','submit_ballot','email_confirmation']);
export class Engine {
  constructor({store,driverFactory,allowLive=false}) {this.store=store;this.driverFactory=driverFactory;this.allowLive=allowLive;this.drivers=new Map();this.jobs=new Map();}
  async create(input) {
    if(input.mode==='live'&&!this.allowLive) throw new BridgeError(409,'LIVE_DISABLED','真实模式尚未由本机维护者启用；演示模式可立即测试。');
    return publicTask(await this.store.create(input));
  }
  get(id){return publicTask(this.store.get(id));}
  async start(id) {
    const task=await this.store.update(id,t=>{
      if(t.mode==='live'&&!this.allowLive) throw new BridgeError(409,'LIVE_DISABLED','真实模式当前已关闭，任务不会执行。');
      if(t.status==='running') return t;
      if(t.status!=='created'&&!(t.status==='blocked'&&t.stage==='configuration_required')) throw new BridgeError(409,'INVALID_STATE','任务已执行过，请读取当前步骤并按提示续跑。');
      t.status='running';t.message='正在执行当前步骤。';delete t.challenge;return t;
    });
    this.enqueue(task,{});return publicTask(task);
  }
  async resume(id,body) {
    let input;
    const task=await this.store.update(id,t=>{
      if(t.mode==='live'&&!this.allowLive) throw new BridgeError(409,'LIVE_DISABLED','真实模式当前已关闭，任务不会续跑。');
      if(!['needs_input','needs_confirmation','awaiting_email'].includes(t.status)) throw new BridgeError(409,'INVALID_STATE','当前任务没有可续跑的确认步骤。');
      input=validateResume(body,t);
      t.status='running';t.message='正在继续当前步骤。';delete t.challenge;return t;
    });
    this.enqueue(task,input);return publicTask(task);
  }
  enqueue(task,input) {
    if(this.jobs.has(task.id)) return;
    const job=(async()=>{
      try {
        let driver=this.drivers.get(task.id);
        if(!driver){driver=await this.driverFactory(task);this.drivers.set(task.id,driver);}
        const transition=await driver.advance(task,input);
        if(!transition||!statuses.has(transition.status)||typeof transition.stage!=='string'||typeof transition.message!=='string') throw new Error('Invalid driver transition.');
        if(transition.challenge&&!kinds.has(transition.challenge.kind)) throw new Error('Unknown challenge.');
        if(['needs_input','needs_confirmation','awaiting_email'].includes(transition.status)&&!transition.challenge) throw new Error('Missing checkpoint.');
        if(transition.status==='completed'&&(!transition.evidence||!['user_reported','verified_email'].includes(transition.evidence.source))) throw new Error('Completion requires provenance.');
        await this.store.update(task.id,t=>{
          const allowed={status:transition.status,stage:transition.stage,message:transition.message};
          if(transition.challenge) allowed.challenge={id:randomUUID(),kind:transition.challenge.kind,prompt:String(transition.challenge.prompt||'请按当前页面提示完成。')};
          if(transition.evidence) allowed.evidence={source:transition.evidence.source,confirmationNumber:String(transition.evidence.confirmationNumber||'')};
          return {...t,...allowed};
        });
      } catch {
        await this.store.update(task.id,t=>{
          t.status='blocked';t.stage='recovery_required';t.message='执行未能确认完成，请在本机核对浏览器和邮件。系统不会自动重复注册或提交。';delete t.challenge;return t;
        }).catch(()=>{});
      } finally {
        // Codes are not retained in task state, logs, or journal.
        if(input.code) input.code='';
        this.jobs.delete(task.id);
      }
    })();
    this.jobs.set(task.id,job);
  }
  async idle(id) { const job=this.jobs.get(id);if(job) await job; }
  async close() {await Promise.allSettled([...this.jobs.values()]);await Promise.allSettled([...this.drivers.values()].map(d=>d.close()));}
}
