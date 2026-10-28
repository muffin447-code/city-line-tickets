import { createHash } from 'node:crypto';
import { exactObject, invalid } from './errors.mjs';

const string = (value, name, max) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) throw invalid(name + '格式不正确。');
  return value.trim();
};
export function validateCreate(body) {
  exactObject(body, ['participant','mode','registerAccount'], ['participant','mode','registerAccount']);
  if (!['demo','live'].includes(body.mode) || typeof body.registerAccount !== 'boolean') throw invalid('请明确指定演示或真实模式及是否注册账号。');
  const raw = body.participant;
  exactObject(raw,['fullName','email','countryCode','phone','provider'],['fullName','email','countryCode','phone']);
  const fullName = string(raw.fullName,'英文姓名',120).replace(/\s+/g,' ');
  const email = string(raw.email,'邮箱',254);
  const countryCode = string(raw.countryCode,'国家区号',4).replace(/^\+/,'');
  let phone = string(raw.phone,'电话',40).replace(/[ ().-]/g,'');
  const provider = raw.provider === undefined ? '' : string(raw.provider,'号码来源',80);
  if (!/^[\p{Script=Latin}][\p{Script=Latin}\p{M} .,'’\-]+$/u.test(fullName)) throw invalid('请填写与证件一致的英文全名。');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('邮箱格式不正确。');
  if (!/^[1-9]\d{0,2}$/.test(countryCode)) throw invalid('国家区号格式不正确。');
  if (phone.startsWith('+')) {
    if (!phone.startsWith('+'+countryCode)) throw invalid('电话号码前缀与国家区号不一致。');
    phone=phone.slice(countryCode.length+1);
  }
  if (countryCode==='1' && phone.length===11 && phone.startsWith('1')) phone=phone.slice(1);
  if (!/^\d{4,14}$/.test(phone) || phone.length+countryCode.length>15 || (countryCode==='1'&&!/^[2-9]\d{2}[2-9]\d{6}$/.test(phone))) throw invalid('电话号码格式不正确。');
  const example=/@(example\.(com|net|org)|[^@]*\.invalid)$/i.test(email) || (countryCode==='1'&&/^\d{3}55501\d{2}$/.test(phone));
  if (body.mode==='live' && example) throw invalid('真实模式不能使用示例邮箱或保留的示例号码。');
  if (body.mode==='demo' && !example) throw invalid('演示模式请使用示例邮箱或保留的示例号码，避免录入真实资料。');
  return { participant:{fullName,email,countryCode,phone,provider},mode:body.mode,registerAccount:body.registerAccount };
}
export function identityOf(task) {
  const p=task.participant;
  return createHash('sha256').update(JSON.stringify([task.mode,p.fullName.toLowerCase(),p.email.toLowerCase(),p.countryCode,p.phone])).digest('hex');
}
export function publicTask(task) {
  const p=task.participant;
  const at=p.email.lastIndexOf('@');
  return {
    id:task.id,mode:task.mode,status:task.status,stage:task.stage,message:task.message,
    participant:{fullNameMasked:p.fullName.split(' ').map(n=>n[0]+'***').join(' '), emailMasked:p.email[0]+'***'+p.email.slice(at), phoneMasked:'+'+p.countryCode+' …'+p.phone.slice(-4)},
    ...(task.challenge?{challenge:{id:task.challenge.id,kind:task.challenge.kind,prompt:task.challenge.prompt}}:{}),
    ...(task.evidence?{evidence:task.evidence}:{}),updatedAt:task.updatedAt
  };
}
export function validateResume(body, task) {
  exactObject(body,['challengeId','code','confirmed','confirmationNumber'],['challengeId']);
  if (!task.challenge || typeof body.challengeId!=='string' || body.challengeId!==task.challenge.id) throw invalid('确认请求已过期或不属于当前步骤，请重新读取任务。');
  if (task.challenge.kind==='otp') {
    exactObject(body,['challengeId','code'],['challengeId','code']);
    const code=string(body.code,'验证码',32);
    if (!/^[a-zA-Z0-9 -]{3,32}$/.test(code)) throw invalid('验证码格式不正确。');
    return {code};
  }
  if (task.challenge.kind==='email_confirmation') {
    exactObject(body,['challengeId','confirmationNumber'],['challengeId','confirmationNumber']);
    const confirmationNumber=string(body.confirmationNumber,'确认编号',120);
    if (!confirmationNumber) throw invalid('请提供登记确认邮件中的编号。');
    return {confirmationNumber};
  }
  exactObject(body,['challengeId','confirmed'],['challengeId','confirmed']);
  if (body.confirmed!==true) throw invalid('当前步骤需要明确确认后继续。');
  return {confirmed:true};
}
