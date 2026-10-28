import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const INITIAL_STAGES = new Set(['created', 'configuration_required']);
const SELECTOR_KEYS = [
  'accountFullName', 'accountEmail', 'accountPhone', 'accountCountryCode', 'accountInitialEmail',
  'accountSendOtp', 'accountOtp', 'accountVerifyOtp', 'accountVerified', 'accountIdentity', 'accountPassword', 'accountCaptcha',
  'accountCaptchaComplete', 'accountTerms', 'accountSubmit', 'accountSuccess',
  'ballotFullName', 'ballotEmail', 'ballotPhone', 'ballotCountryCode',
  'ballotCaptcha', 'ballotCaptchaComplete', 'ballotTerms', 'ballotSubmit',
  'ballotSuccess', 'ballotConfirmationNumber'
];

export function isCitylineHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') && ['cityline.com', 'cityline.com.hk'].some(
        domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch { return false; }
}

export function validateLiveProfile(profile, registerAccount = true) {
  const errors = [];
  if (!profile || profile.verified !== true) errors.push('本地页面配置尚未核实。');
  if (!profile || typeof profile.revision !== 'string' || !profile.revision.trim()) errors.push('缺少配置版本标记 revision。');
  if (!isCitylineHttps(profile?.ballotUrl)) errors.push('需要核实 Cityline HTTPS 报名页面地址 ballotUrl。');
  if (registerAccount && !isCitylineHttps(profile?.accountUrl)) errors.push('需要核实 Cityline HTTPS 账号页面地址 accountUrl。');
  if (!['national', 'e164'].includes(profile?.phoneFormat)) errors.push('需要配置 phoneFormat。');
  if (profile?.browserChannel && !['chromium', 'chrome'].includes(profile.browserChannel)) errors.push('browserChannel 仅支持 chromium 或 chrome。');
  const selectors = profile?.selectors || {};
  const required = ['ballotFullName', 'ballotEmail', 'ballotPhone', 'ballotSubmit', 'ballotSuccess'];
  if (registerAccount) required.push('accountEmail', 'accountSubmit', 'accountSuccess');
  for (const key of required) if (typeof selectors[key] !== 'string' || !selectors[key].trim()) errors.push(`缺少已核实的页面字段：selectors.${key}。`);
  for (const key of SELECTOR_KEYS) {
    const value = selectors[key];
    if (value === undefined || value === '') continue;
    const list = key.endsWith('Terms') && Array.isArray(value) ? value : [value];
    if (!list.length || list.length > 20 || list.some(item => typeof item !== 'string' || !item.trim() || item.length > 500)) errors.push(`页面字段格式不正确：selectors.${key}。`);
  }
  if (registerAccount) {
    if (profile?.accountCreationTrigger !== 'accountSubmit') errors.push('必须先核实账号只会由 accountSubmit 创建，并配置 accountCreationTrigger="accountSubmit"。');
    for (const [key, flag] of [
      ['accountSendOtp', 'accountSendOtpIsNonConsequential'],
      ['accountOtp', 'accountOtpInputIsNonConsequential'],
      ['accountVerifyOtp', 'accountVerifyOtpIsNonConsequential']
    ]) if (selectors[key] && profile?.[flag] !== true) errors.push(`必须先核实 ${key} 不会创建账号或接受条款，并将 ${flag} 设为 true。`);
    if (selectors.accountVerifyOtp && (!selectors.accountOtp || !selectors.accountVerified)) errors.push('独立账号验证码验证需要 accountOtp 和 accountVerified 字段。');
    if (selectors.accountVerifyOtp && selectors.accountVerifyOtp === selectors.accountSubmit) errors.push('独立验证码验证按钮不能同时作为最终账号创建按钮。');
    if (selectors.accountVerified && selectors.accountVerified === selectors.accountSuccess) errors.push('验证码已验证标记与账号创建成功标记必须分开核实。');
    if (profile?.accountDetailsUrl && (!isCitylineHttps(profile.accountDetailsUrl) || !selectors.accountVerifyOtp)) errors.push('账号资料补全页需要已核实的 Cityline HTTPS accountDetailsUrl 及独立 accountVerifyOtp。');
    if (selectors.accountInitialEmail && !selectors.accountVerifyOtp) errors.push('独立账号初始邮箱字段需要已核实的 accountVerifyOtp 与后续资料阶段。');
  }
  const timeout = profile?.timeoutMs ?? 15000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 60000) errors.push('timeoutMs 必须为 1000–60000 毫秒。');
  return errors;
}

function checkpoint(stage, kind, prompt) {
  return {
    status: kind === 'email_confirmation' ? 'awaiting_email' :
      ['create_account', 'submit_ballot'].includes(kind) ? 'needs_confirmation' : 'needs_input',
    stage, message: prompt, challenge: { kind, prompt }
  };
}

function completed(number) {
  return { status: 'completed', stage: 'completed',
    message: '已根据你提供的登记确认邮件编号记录完成；系统未独立核验邮件。',
    evidence: { source: 'user_reported', confirmationNumber: number } };
}

function receipt(input) {
  return typeof input.confirmationNumber === 'string' && input.confirmationNumber.trim().length > 0 &&
    input.confirmationNumber.trim().length <= 120 ? input.confirmationNumber.trim() : null;
}

class DemoDriver {
  async advance(task, input = {}) {
    const stage = task.stage || 'created';
    if (INITIAL_STAGES.has(stage)) return task.registerAccount === false ?
      checkpoint('ballot_captcha', 'captcha', '演示：报名资料已填入。请模拟在本地浏览器完成人工图形验证后继续。') :
      checkpoint('account_otp', 'otp', '演示：账号资料已填入。提交任意 6 位数字作为示例邮箱验证码；不会发送真实邮件。');
    if (stage === 'account_otp') {
      if (!/^\d{6}$/.test(input.code || '')) return checkpoint(stage, 'otp', '演示：请输入 6 位数字示例验证码。');
      return checkpoint('account_terms', 'terms', '演示：请模拟在本地账号页面阅读并手动确认条款，再继续。');
    }
    if (stage === 'account_terms') return input.confirmed === true ?
      checkpoint('account_create', 'create_account', '演示：是否确认提交创建这个参与者的账号？这是单次创建确认。') :
      checkpoint(stage, 'terms', '演示：请先在本地页面手动确认条款。');
    if (stage === 'account_create') return input.confirmed === true ?
      checkpoint('ballot_captcha', 'captcha', '演示：账号创建已模拟完成，报名资料已填入。请模拟在本地浏览器完成人工图形验证。') :
      checkpoint(stage, 'create_account', '演示：需要这一次创建账号的明确确认。');
    if (stage === 'ballot_captcha') return input.confirmed === true ?
      checkpoint('ballot_terms', 'terms', '演示：请模拟在本地报名页面阅读并手动确认本次登记条款。') :
      checkpoint(stage, 'captcha', '演示：请先在本地浏览器完成人工图形验证。');
    if (stage === 'ballot_terms') return input.confirmed === true ?
      checkpoint('ballot_submit', 'submit_ballot', '演示：是否确认提交这位参与者的一份抽签登记？') :
      checkpoint(stage, 'terms', '演示：请先手动确认本次登记条款。');
    if (stage === 'ballot_submit') return input.confirmed === true ?
      checkpoint('awaiting_email', 'email_confirmation', '演示：已模拟提交。请提供示例登记确认邮件编号；这不会产生真实登记。') :
      checkpoint(stage, 'submit_ballot', '演示：需要这一次抽签登记提交的明确确认。');
    if (stage === 'awaiting_email') return receipt(input) ? completed(receipt(input)) :
      checkpoint(stage, 'email_confirmation', '请提供登记确认邮件中的确认编号。系统将注明该编号由你提供。');
    if (stage === 'completed') return { status: 'completed', stage, message: '此任务已记录完成，不会重新登记。', evidence: task.evidence };
    return { status: 'blocked', stage: 'manual_recovery_required', message: '无法识别当前演示阶段，请核对任务记录。' };
  }
  async close() {}
}

class ConfigurationError extends Error {}
class ManualRecoveryError extends Error {}

class LiveDriver {
  constructor(options) { this.options = options; this.sessions = new Map(); }

  async loadProfile(task) {
    let profile;
    try { profile = JSON.parse(await fs.readFile(this.options.profilePath, 'utf8')); }
    catch { throw new ConfigurationError('尚未提供可读取的本地 Cityline 页面配置。'); }
    const errors = validateLiveProfile(profile, task.registerAccount !== false);
    if (errors.length) throw new ConfigurationError(errors.join(' '));
    const s = profile.selectors;
    const countryCode = String(task.participant.countryCode).replace(/^\+/, '');
    for (const key of [s.ballotCountryCode, task.registerAccount !== false && s.accountCountryCode].filter(Boolean)) {
      if (!profile.countryOptions || typeof profile.countryOptions[countryCode] !== 'string' || !profile.countryOptions[countryCode]) throw new ConfigurationError('需要先核实并配置这位参与者的网页区号选项 countryOptions。');
    }
    if (profile.phoneFormat === 'national' && !s.ballotCountryCode && profile.fixedCountryCode !== countryCode) throw new ConfigurationError('本地号码格式需要已核实的区号字段或 fixedCountryCode。');
    if (profile.phoneFormat === 'national' && task.registerAccount !== false && s.accountPhone && !s.accountCountryCode && profile.fixedCountryCode !== countryCode) throw new ConfigurationError('账号电话使用本地号码格式时，需要已核实的账号区号字段或 fixedCountryCode。');
    return structuredClone(profile);
  }

  async launch(task, profile) {
    let playwright;
    try {
      if (this.options.playwrightModulePath) playwright = createRequire(import.meta.url)(this.options.playwrightModulePath);
      else playwright = await import('playwright');
    } catch { throw new ConfigurationError('Playwright 尚未安装或不能读取，请先完成本地依赖安装。'); }
    const root = path.resolve(this.options.dataDir, 'browser-profiles');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await fs.chmod(root, 0o700);
    const directory = path.join(root, createHash('sha256').update(task.id).digest('hex'));
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const context = await playwright.chromium.launchPersistentContext(directory, {
      headless: false, acceptDownloads: false, serviceWorkers: 'block',
      ...(profile.browserChannel === 'chrome' ? { channel: 'chrome' } : {})
    });
    const session = { context, page: null, profile, participant: structuredClone(task.participant), otpSent: false, otpVerified: false, captchaAcknowledged: new Set(), guard: null };
    // All HTTP requests stay on Cityline. Navigation to local/private or third-party targets is blocked.
    await context.route('**/*', async route => {
      if (isCitylineHttps(route.request().url())) await route.continue();
      else await route.abort('blockedbyclient');
    });
    if (typeof context.routeWebSocket === 'function') await context.routeWebSocket('**/*', route => route.close());
    context.on('page', page => page.on('framenavigated', frame => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank' && !isCitylineHttps(frame.url())) page.close().catch(() => {});
    }));
    session.page = context.pages()[0] || await context.newPage();
    session.page.setDefaultTimeout(profile.timeoutMs ?? 15000);
    this.sessions.set(task.id, session);
    return session;
  }

  assertPage(session) {
    if (!session.page || session.page.isClosed() || !isCitylineHttps(session.page.url())) throw new ManualRecoveryError('当前浏览器页面无法继续。');
  }

  async goto(session, url, markers = []) {
    if (!isCitylineHttps(url)) throw new ConfigurationError('仅允许已核实的 Cityline HTTPS 页面地址。');
    await session.page.goto(url, { waitUntil: 'domcontentloaded' });
    this.assertPage(session);
    if (markers.filter(Boolean).length) await this.waitAnyVisible(session, markers);
  }

  async waitAnyVisible(session, selectors) {
    this.assertPage(session);
    const candidates = [...new Set(selectors.filter(Boolean))];
    if (!candidates.length) throw new ConfigurationError('缺少当前页面阶段的已核实状态标记。');
    const timeout = session.profile.timeoutMs ?? 15000;
    try {
      return await Promise.any(candidates.map(async selector => {
        const loc = session.page.locator(selector);
        await loc.waitFor({ state: 'visible', timeout });
        this.assertPage(session);
        if (await loc.count() !== 1 || !await loc.isVisible()) throw new ManualRecoveryError('页面状态标记不唯一。');
        return selector;
      }));
    } catch { throw new ManualRecoveryError('页面尚未显示已核实的下一阶段，请先核对浏览器。'); }
  }

  async locator(session, selector) {
    this.assertPage(session);
    if (typeof selector !== 'string' || !selector.trim()) throw new ConfigurationError('缺少所需的已核实页面字段。');
    const locator = session.page.locator(selector);
    const timeout = session.profile.timeoutMs ?? 15000;
    const deadline = Date.now() + timeout;
    await locator.waitFor({ state: 'visible', timeout });
    this.assertPage(session);
    if (await locator.count() !== 1 || !await locator.isVisible()) throw new ManualRecoveryError('页面字段已变化或不能操作。');
    while (!await locator.isEnabled()) {
      this.assertPage(session);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ManualRecoveryError('页面字段在等待时间内仍不可用。');
      await delay(Math.min(50, remaining));
    }
    return locator;
  }

  async visible(session, selector) {
    this.assertPage(session);
    if (!selector) return false;
    const loc = session.page.locator(selector);
    return await loc.count() === 1 && await loc.isVisible();
  }

  async checked(session, selector) {
    if (!await this.visible(session, selector)) return false;
    const loc = await this.locator(session, selector);
    const type = await loc.getAttribute('type');
    if (['checkbox', 'radio'].includes(type)) return loc.isChecked();
    return await loc.getAttribute('aria-checked') === 'true';
  }

  async termsChecked(session, prefix) {
    const value = session.profile.selectors[prefix + 'Terms'];
    const selectors = Array.isArray(value) ? value : value ? [value] : [];
    for (const selector of selectors) if (!await this.checked(session, selector)) return false;
    return true;
  }

  async fillFields(session, participant, prefix, { initialEmailOnly = false } = {}) {
    const s = session.profile.selectors;
    const code = String(participant.countryCode).replace(/^\+/, '');
    const phone = String(participant.phone);
    const normalized = phone.startsWith('+') ? phone.slice(1 + code.length) : phone;
    const entries = (initialEmailOnly ? [
      [s.accountInitialEmail || s.accountEmail, participant.email]
    ] : [
      [s[prefix + 'FullName'], participant.fullName],
      [s[prefix + 'Email'], participant.email],
      [s[prefix + 'Phone'], session.profile.phoneFormat === 'e164' ? '+' + code + normalized : normalized]
    ]).filter(([selector]) => selector);
    if (new Set(entries.map(([selector]) => selector)).size !== entries.length) throw new ConfigurationError('已核实字段配置有重复，不能安全填写。');
    const targets = [];
    for (const [selector, value] of entries) targets.push([await this.locator(session, selector), value]);
    let country;
    if (!initialEmailOnly && s[prefix + 'CountryCode']) {
      country = await this.locator(session, s[prefix + 'CountryCode']);
      const option = session.profile.countryOptions[code];
      const count = await country.locator('option').evaluateAll((options, expected) => options.filter(o => o.value === expected && !o.disabled).length, option);
      if (count !== 1) throw new ManualRecoveryError('区号选项已变化，请先核对页面。');
      await country.selectOption({ value: option });
    }
    for (const [loc, value] of targets) {
      this.assertPage(session);
      if (await loc.getAttribute('readonly') !== null) {
        if (await loc.inputValue() !== String(value)) throw new ManualRecoveryError('只读字段与参与者资料不一致。');
      } else await loc.fill(String(value));
      if (await loc.inputValue() !== String(value)) throw new ManualRecoveryError('页面修改了填写值，请先核对。');
    }
  }

  async captcha(session, prefix, stage, next) {
    const selector = session.profile.selectors[prefix + 'Captcha'];
    if (!await this.visible(session, selector)) return next();
    const complete = session.profile.selectors[prefix + 'CaptchaComplete'];
    if (complete && await this.visible(session, complete)) return next();
    if (!complete && session.captchaAcknowledged.has(prefix)) return next();
    session.afterCaptcha = next;
    return checkpoint(stage, 'captcha', '请在本地浏览器手动完成图形验证，然后明确告诉我继续。程序不会自动解决验证。');
  }

  async captureGuard(session, stage, selector) {
    const loc = await this.locator(session, selector);
    const shape = await loc.evaluate(e => ({ tag: e.tagName, type: e.getAttribute('type'), text: (e.textContent || '').trim().slice(0, 200) }));
    const s = session.profile.selectors;
    const p = session.participant;
    const prefix = stage === 'account_create' ? 'account' : 'ballot';
    const code = String(p.countryCode).replace(/^\+/, '');
    const national = String(p.phone).startsWith('+') ? String(p.phone).slice(1 + code.length) : String(p.phone);
    const fields = [
      [s[prefix + 'FullName'], p.fullName], [s[prefix + 'Email'], p.email],
      [s[prefix + 'Phone'], session.profile.phoneFormat === 'e164' ? '+' + code + national : national],
      [s[prefix + 'CountryCode'], session.profile.countryOptions?.[code]]
    ].filter(([field]) => field);
    const fieldValues = [];
    for (const [field, expected] of fields) {
      const actual = await (await this.locator(session, field)).inputValue();
      if (actual !== String(expected)) throw new ManualRecoveryError('参与者资料在确认前后发生了变化。');
      fieldValues.push([field, actual]);
    }
    session.guard = { stage, url: session.page.url(), digest: createHash('sha256').update(JSON.stringify({ shape, fieldValues })).digest('hex') };
  }

  async checkGuard(session, stage, selector) {
    const saved = session.guard;
    if (!saved || saved.stage !== stage || saved.url !== session.page.url()) throw new ManualRecoveryError('确认所对应的页面已变化。');
    await this.captureGuard(session, stage, selector);
    if (session.guard.digest !== saved.digest) throw new ManualRecoveryError('确认所对应的提交按钮已变化。');
    session.guard = null;
  }

  async accountReady(session, task) {
    const s = session.profile.selectors;
    if (s.accountPassword && await this.visible(session, s.accountPassword)) {
      const populated = await (await this.locator(session, s.accountPassword)).evaluate(e => Boolean(e.value));
      if (!populated) return checkpoint('account_password', 'password', '此页面需要密码。请在本地浏览器亲自输入并确认密码，不要在 GPT 中发送密码，然后继续。');
    }
    return this.captcha(session, 'account', 'account_captcha', async () => {
      if (session.otpVerified) return this.accountTerms(session);
      if (s.accountSendOtp && !session.otpSent) {
        session.otpSent = true;
        await (await this.locator(session, s.accountSendOtp)).click();
        this.assertPage(session);
      }
      if (s.accountOtp) {
        const marker = await this.waitAnyVisible(session, [s.accountOtp, s.accountSuccess]);
        if (marker === s.accountSuccess || await this.visible(session, s.accountSuccess)) throw new ManualRecoveryError('账号成功标记在已确认建号动作之前出现，不能继续按当前语义执行。');
        return checkpoint('account_otp', 'otp', '请提交官方发送的账号验证码。验证码只在本次操作中使用，不保存到任务记录。');
      }
      return this.accountTerms(session);
    });
  }

  async accountTerms(session) {
    if (!await this.termsChecked(session, 'account')) return checkpoint('account_terms', 'terms', '请在本地账号页面阅读并手动确认显示的条款，然后继续。');
    await this.captureGuard(session, 'account_create', session.profile.selectors.accountSubmit);
    return checkpoint('account_create', 'create_account', '请查看当前 Cityline 账号页面。是否确认这一次创建账号提交，以及页面明确说明随提交接受的条款？');
  }

  async ballotReady(session) {
    return this.captcha(session, 'ballot', 'ballot_captcha', () => this.ballotTerms(session));
  }

  async ballotTerms(session) {
    if (!await this.termsChecked(session, 'ballot')) return checkpoint('ballot_terms', 'terms', '请在本地报名页面阅读并手动确认本次登记条款，然后继续。');
    await this.captureGuard(session, 'ballot_submit', session.profile.selectors.ballotSubmit);
    return checkpoint('ballot_submit', 'submit_ballot', '请查看当前 Cityline 报名资料。是否确认提交这位参与者的一份抽签登记？');
  }

  async openBallot(session, task) {
    await this.goto(session, session.profile.ballotUrl, [session.profile.selectors.ballotFullName]);
    await this.fillFields(session, task.participant, 'ballot');
    return this.ballotReady(session);
  }

  async advance(task, input = {}) {
    const stage = task.stage || 'created';
    if (stage === 'completed') return { status: 'completed', stage, message: '此任务已记录完成，不会再次提交。', evidence: task.evidence };
    if (stage === 'awaiting_email') return receipt(input) ? completed(receipt(input)) : checkpoint(stage, 'email_confirmation', '收到官方登记确认邮件后，请提供其中的确认编号。系统只记录由你提供的结果。');
    let session = this.sessions.get(task.id);
    if (!session && !INITIAL_STAGES.has(stage)) return { status: 'blocked', stage: 'manual_recovery_required', message: '浏览器会话已中断。任务可能已产生页面操作，请先人工核查，不会自动重放注册或登记。' };
    try {
      if (!session) {
        const profile = await this.loadProfile(task);
        session = await this.launch(task, profile);
        if (task.registerAccount === false) return await this.openBallot(session, task);
        const initialEmail = profile.selectors.accountInitialEmail || profile.selectors.accountEmail;
        await this.goto(session, profile.accountUrl, [profile.selectors.accountSuccess, initialEmail]);
        if (await this.visible(session, profile.selectors.accountSuccess)) {
          if (!profile.selectors.accountIdentity) throw new ManualRecoveryError('已有登录状态，但没有核实该账号属于此参与者。');
          const identity = await this.locator(session, profile.selectors.accountIdentity);
          const text = (await identity.innerText()).trim().toLowerCase();
          if (text !== task.participant.email.trim().toLowerCase()) throw new ManualRecoveryError('已有登录账号与参与者不一致。');
          return await this.openBallot(session, task);
        }
        await this.fillFields(session, task.participant, 'account', { initialEmailOnly: Boolean(profile.accountDetailsUrl || profile.selectors.accountInitialEmail) });
        return await this.accountReady(session, task);
      }
      this.assertPage(session);
      if (stage === 'account_password') {
        if (input.confirmed !== true) return checkpoint(stage, 'password', '请先在本地浏览器亲自完成密码输入，再明确继续。');
        return await this.accountReady(session, task);
      }
      if (['account_captcha', 'ballot_captcha'].includes(stage)) {
        const prefix = stage.startsWith('account') ? 'account' : 'ballot';
        if (input.confirmed !== true) return checkpoint(stage, 'captcha', '请先在本地浏览器完成人工图形验证。');
        const complete = session.profile.selectors[prefix + 'CaptchaComplete'];
        if (complete && !await this.visible(session, complete)) return checkpoint(stage, 'captcha', '页面尚未显示验证完成，请先核对本地浏览器。');
        session.captchaAcknowledged.add(prefix);
        if (!session.afterCaptcha) throw new ManualRecoveryError('验证后续页面状态已丢失。');
        return await session.afterCaptcha();
      }
      if (stage === 'account_otp') {
        if (typeof input.code !== 'string' || !/^[A-Za-z0-9-]{4,16}$/.test(input.code)) return checkpoint(stage, 'otp', '请输入当前官方账号验证码。');
        await (await this.locator(session, session.profile.selectors.accountOtp)).fill(input.code);
        if (session.profile.selectors.accountVerifyOtp) {
          await (await this.locator(session, session.profile.selectors.accountVerifyOtp)).click();
          await this.waitAnyVisible(session, [session.profile.selectors.accountVerified]);
          if (await this.visible(session, session.profile.selectors.accountSuccess)) throw new ManualRecoveryError('账号已在独立验证动作后出现成功标记，当前建号语义需要重新核实。');
          session.otpVerified = true;
          if (session.profile.accountDetailsUrl || session.profile.selectors.accountInitialEmail) {
            const markers = [session.profile.selectors.accountFullName || session.profile.selectors.accountEmail];
            if (session.profile.accountDetailsUrl) await this.goto(session, session.profile.accountDetailsUrl, markers);
            else await this.waitAnyVisible(session, markers);
            await this.fillFields(session, task.participant, 'account');
            session.captchaAcknowledged.delete('account');
          }
          return await this.accountReady(session, task);
        }
        return await this.accountTerms(session);
      }
      if (stage === 'account_terms') {
        if (input.confirmed !== true || !await this.termsChecked(session, 'account')) return checkpoint(stage, 'terms', '请先在本地账号页面阅读并手动确认条款。');
        return await this.accountTerms(session);
      }
      if (stage === 'account_create') {
        if (input.confirmed !== true) return checkpoint(stage, 'create_account', '需要当前这一次账号创建提交的明确确认。');
        if (!await this.termsChecked(session, 'account')) return checkpoint('account_terms', 'terms', '页面条款状态已变化，请重新核对并手动确认。');
        await this.checkGuard(session, stage, session.profile.selectors.accountSubmit);
        await (await this.locator(session, session.profile.selectors.accountSubmit)).click();
        await this.waitAnyVisible(session, [session.profile.selectors.accountSuccess]);
        return await this.openBallot(session, task);
      }
      if (stage === 'ballot_terms') {
        if (input.confirmed !== true || !await this.termsChecked(session, 'ballot')) return checkpoint(stage, 'terms', '请先在本地报名页面阅读并手动确认条款。');
        return await this.ballotTerms(session);
      }
      if (stage === 'ballot_submit') {
        if (input.confirmed !== true) return checkpoint(stage, 'submit_ballot', '需要当前这一次抽签登记提交的明确确认。');
        if (!await this.termsChecked(session, 'ballot')) return checkpoint('ballot_terms', 'terms', '页面条款状态已变化，请重新核对并手动确认。');
        const captchaComplete = session.profile.selectors.ballotCaptchaComplete;
        if (captchaComplete && !await this.visible(session, captchaComplete)) return await this.ballotReady(session);
        await this.checkGuard(session, stage, session.profile.selectors.ballotSubmit);
        await (await this.locator(session, session.profile.selectors.ballotSubmit)).click();
        await this.waitAnyVisible(session, [session.profile.selectors.ballotSuccess]);
        this.assertPage(session);
        return checkpoint('awaiting_email', 'email_confirmation', '网页显示提交结果。按官方说明，请以收到登记确认邮件为完成依据；收到后提供确认编号。');
      }
      throw new ManualRecoveryError('无法识别当前页面阶段。');
    } catch (error) {
      if (error instanceof ConfigurationError && !session) return { status: 'blocked', stage: 'configuration_required', message: error.message };
      // Playwright errors can include fill values. Never expose their raw messages or stack traces.
      return { status: 'blocked', stage: 'manual_recovery_required', message: '浏览器操作未确认完成。请查看本地浏览器和官方登记状态；程序不会自动重放可能已提交的操作。' };
    }
  }

  async close() {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map(session => session.context.close()));
  }
}

export async function createDriver(options = {}) {
  if (options.mode === 'demo') return new DemoDriver();
  if (options.mode !== 'live') throw new Error('Unsupported driver mode.');
  return new LiveDriver(options);
}
