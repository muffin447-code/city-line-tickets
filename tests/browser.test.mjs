import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createDriver, isCitylineHttps, isTurnstileResourceRequest, validateLiveProfile } from '../src/browser.mjs';

const participant = { fullName: 'CHAN TAI MAN', email: 'participant@example.com', countryCode: '1', phone: '2025550123' };
const task = (stage = 'created') => ({ id: 'browser-fixture-task', stage, participant, registerAccount: true });
const carry = (current, result) => ({ ...current, ...result });

function verifiedProfile() {
  return {
    verified: true, revision: 'offline-test-fixture',
    accountUrl: 'https://www.cityline.com/offline-fixture/account',
    ballotUrl: 'https://cultural.cityline.com/offline-fixture/ballot',
    accountCreationTrigger: 'accountSubmit',
    accountSendOtpIsNonConsequential: true,
    accountOtpInputIsNonConsequential: true,
    phoneFormat: 'e164', timeoutMs: 1000,
    selectors: {
      accountFullName: '#account-name', accountEmail: '#account-email', accountPhone: '#account-phone',
      accountSendOtp: '#account-send', accountOtp: '#account-otp',
      accountTerms: '#account-terms', accountSubmit: '#account-submit', accountSuccess: '#account-success',
      ballotFullName: '#ballot-name', ballotEmail: '#ballot-email', ballotPhone: '#ballot-phone',
      ballotCaptcha: '#ballot-captcha', ballotCaptchaComplete: '#ballot-captcha-complete',
      ballotTerms: '#ballot-terms', ballotSubmit: '#ballot-submit', ballotSuccess: '#ballot-success'
    }
  };
}

const fakePlaywright = `
const state = { url: 'about:blank', values: {}, clicked: [], terms: { account: false, ballot: false }, captcha: false, accountCaptchaSolved: false, accountCreated: false, ballotSubmitted: false, otpSent: false, buttonText: {}, closed: false, routeHandler: null, renderOnWait: {}, waits: [], disabledPolls: {}, enableChecks: {}, delayOtpOnSend: false, otpVerified: false, delayVerifiedOnClick: false, detailsRequired: false, detailsVisited: false, autoDetailsAfterVerify: false, navigations: [], hideEmailOnOtp: false, inputReads: [], otpEmailText: 'participant@example.com', hiddenSelectors: {}, dialogRequired: false, dialogOpen: false, events: [], matchVisibility: {} };
class Locator {
  constructor(selector) { this.selector = selector; }
  async count() { if(state.matchVisibility[this.selector])return state.matchVisibility[this.selector].length; return state.renderOnWait[this.selector] ? 0 : 1; }
  async isVisible() {
    if (state.matchVisibility[this.selector]?.length > 1) throw new Error('Strict duplicate selector');
    if (state.matchVisibility[this.selector]) return state.matchVisibility[this.selector][0] || false;
    if (state.hiddenSelectors[this.selector]) return false;
    if (this.selector === '#account-email' && state.dialogRequired && !state.dialogOpen) return false;
    if (state.renderOnWait[this.selector]) return false;
    if (this.selector === '#account-email' && state.hideEmailOnOtp && state.otpSent) return false;
    if (this.selector === '#account-name' && state.detailsRequired && !state.detailsVisited) return false;
    if (['#account-password', '#account-captcha'].includes(this.selector) && state.detailsRequired && !state.detailsVisited) return false;
    if (this.selector === '#account-captcha-complete') return state.accountCaptchaSolved;
    if (this.selector === '#account-verified') return state.otpVerified;
    if (this.selector === '#account-success') return state.accountCreated;
    if (this.selector === '#account-otp') return state.otpSent;
    if (this.selector === '#ballot-success') return state.ballotSubmitted;
    if (this.selector === '#ballot-captcha-complete') return state.captcha;
    return true;
  }
  async isEnabled() { state.enableChecks[this.selector] = (state.enableChecks[this.selector] || 0) + 1; if(state.disabledPolls[this.selector] > 0){ state.disabledPolls[this.selector]--; return false; } return true; }
  async getAttribute(name) { if(name === 'readonly' && this.selector === '#account-email' && state.detailsRequired && state.detailsVisited) return ''; return name === 'type' && this.selector.endsWith('-terms') ? 'checkbox' : null; }
  async isChecked() { return state.terms[this.selector.startsWith('#account') ? 'account' : 'ballot']; }
  async fill(value) { state.events.push('fill:'+this.selector); state.values[this.selector] = value; }
  async inputValue() { state.inputReads.push(this.selector); return state.values[this.selector] || ''; }
  async innerText() { if(this.selector === '#account-otp-email')return state.otpEmailText; return state.loginEmail || 'participant@example.com'; }
  async evaluate(fn) { return fn({ tagName:'BUTTON',value:state.values[this.selector] || '',textContent:state.buttonText[this.selector] || this.selector,getAttribute:()=> 'submit' }); }
  async click() {
    state.clicked.push(this.selector);
    state.events.push('click:'+this.selector);
    if(this.selector === '#account-open-dialog') state.dialogOpen = true;
    if(this.selector === '#account-send') { state.otpSent = true; if(state.delayOtpOnSend) state.renderOnWait['#account-otp'] = 1; }
    if(this.selector === '#account-verify') { state.otpVerified = true; if(state.delayVerifiedOnClick)state.renderOnWait['#account-verified']=1; if(state.autoDetailsAfterVerify){state.detailsVisited=true;state.values['#account-email']=state.values['#initial-email'] || '';state.url='https://www.cityline.com/offline-fixture/details';} }
    if(this.selector === '#account-submit') state.accountCreated = true;
    if(this.selector === '#ballot-submit') state.ballotSubmitted = true;
  }
  async waitFor(options) { state.waits.push({selector:this.selector,...options}); if(state.renderOnWait[this.selector]) { await new Promise(resolve=>setTimeout(resolve,5)); state.renderOnWait[this.selector] = 0; } if (!await this.isVisible()) throw new Error('Unconfirmed simulated page'); }
}
const mainFrame = {url:()=>state.url,parentFrame:()=>null,page:()=>page,isDetached:()=>false};
const page = { isClosed:()=>false,url:()=>state.url,setDefaultTimeout(){},locator:s=>new Locator(s),async goto(url){state.url=url;state.navigations.push(url);if(url.endsWith('/details')){state.detailsVisited=true;state.values['#account-email']=state.values['#initial-email'] || state.values['#account-email'] || '';}},mainFrame(){return mainFrame;},on(){},async close(){state.closed=true;} };
const context = {pages:()=>[page],async newPage(){return page;},async route(_pattern,handler){state.routeHandler=handler;},on(){},async close(){state.closed=true;}};
module.exports = { state, page, chromium:{async launchPersistentContext(){return context;}} };
`;

async function liveFixture(t, profile = verifiedProfile()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cityline-driver-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const profilePath = path.join(dir, 'profile.json');
  const modulePath = path.join(dir, 'fake-playwright.cjs');
  await fs.writeFile(profilePath, JSON.stringify(profile));
  await fs.writeFile(modulePath, fakePlaywright);
  const driver = await createDriver({ mode: 'live', profilePath, dataDir: dir, playwrightModulePath: modulePath });
  t.after(() => driver.close());
  const fixture = createRequire(import.meta.url)(modulePath);
  return { driver, state: fixture.state, page: fixture.page,
    writeProfile: value => fs.writeFile(profilePath, JSON.stringify(value)),
    newDriver: () => createDriver({ mode:'live',profilePath,dataDir:dir,playwrightModulePath:modulePath }) };
}

test('domain guard rejects credentials, private targets, lookalike hosts and nonstandard ports', () => {
  for (const value of ['https://cityline.com/', 'https://www.cityline.com/', 'https://cultural.cityline.com/x', 'https://www.cityline.com.hk/x']) assert.equal(isCitylineHttps(value), true);
  for (const value of ['http://cityline.com/', 'https://cityline.com.evil.test/', 'https://evilcityline.com/', 'https://cityline.com@evil.test/', 'https://user:pass@cityline.com/', 'https://127.0.0.1/', 'https://cityline.com:8443/', 'javascript:alert(1)']) assert.equal(isCitylineHttps(value), false);
});

test('unverified config never launches Playwright and supports safe configuration retry', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cityline-driver-config-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const profilePath = path.join(dir, 'profile.json');
  await fs.writeFile(profilePath, JSON.stringify({ verified: false }));
  const driver = await createDriver({ mode: 'live', profilePath, dataDir: dir, playwrightModulePath: '/nonexistent/should-not-load.cjs' });
  const result = await driver.advance(task());
  assert.equal(result.status, 'blocked');
  assert.equal(result.stage, 'configuration_required');
  assert.match(result.message, /尚未核实/);
  const retry = await driver.advance(task('configuration_required'));
  assert.equal(retry.stage, 'configuration_required');
});

test('profile validation requires only real configured selectors and verified HTTPS URLs', () => {
  assert.deepEqual(validateLiveProfile(verifiedProfile()), []);
  const profile = verifiedProfile();
  profile.ballotUrl = 'https://127.0.0.1/';
  profile.selectors.ballotEmail = '';
  assert.ok(validateLiveProfile(profile).some(e => e.includes('ballotUrl')));
  assert.ok(validateLiveProfile(profile).some(e => e.includes('ballotEmail')));
});

test('demo exercises every checkpoint and records user-reported receipt without actual registration', async () => {
  const driver = await createDriver({ mode: 'demo' });
  let current = task();
  for (const [input, kind, stage] of [
    [{}, 'otp', 'account_otp'],
    [{ code: '123456' }, 'terms', 'account_terms'],
    [{ confirmed: true }, 'create_account', 'account_create'],
    [{ confirmed: true }, 'captcha', 'ballot_captcha'],
    [{ confirmed: true }, 'terms', 'ballot_terms'],
    [{ confirmed: true }, 'submit_ballot', 'ballot_submit'],
    [{ confirmed: true }, 'email_confirmation', 'awaiting_email']
  ]) {
    const result = await driver.advance(current, input);
    assert.equal(result.challenge.kind, kind);
    assert.equal(result.stage, stage);
    current = carry(current, result);
  }
  const done = await driver.advance(current, { confirmationNumber: 'DEMO-ONLY-123' });
  assert.equal(done.status, 'completed');
  assert.equal(done.evidence.source, 'user_reported');
  assert.match(done.message, /未独立核验/);
});

test('demo does not accept missing or blanket confirmation and can omit account setup', async () => {
  const driver = await createDriver({ mode: 'demo' });
  assert.equal((await driver.advance(task('account_otp'), { code: 'bad' })).stage, 'account_otp');
  assert.equal((await driver.advance(task('account_create'), {})).stage, 'account_create');
  assert.equal((await driver.advance(task('ballot_submit'), {})).stage, 'ballot_submit');
  assert.equal((await driver.advance({ ...task(), registerAccount: false })).stage, 'ballot_captcha');
});

test('live adapter executes normal actions only between manual and single-action checkpoints', async t => {
  const { driver, state } = await liveFixture(t);
  let current = task();
  let result = await driver.advance(current);
  assert.equal(result.stage, 'account_otp');
  assert.deepEqual(state.clicked, ['#account-send']);
  assert.equal(state.values['#account-email'], participant.email);
  current = carry(current, result);
  result = await driver.advance(current, { code: '123456' });
  assert.equal(result.stage, 'account_terms');
  current = carry(current, result);
  assert.equal((await driver.advance(current, { confirmed: true })).stage, 'account_terms');
  assert.equal(state.clicked.includes('#account-terms'), false);
  state.terms.account = true;
  result = await driver.advance(current, { confirmed: true });
  assert.equal(result.stage, 'account_create');
  current = carry(current, result);
  assert.equal((await driver.advance(current, {})).stage, 'account_create');
  result = await driver.advance(current, { confirmed: true });
  assert.equal(result.stage, 'ballot_captcha');
  assert.equal(state.values['#ballot-phone'], '+12025550123');
  current = carry(current, result);
  assert.equal((await driver.advance(current, { confirmed: true })).stage, 'ballot_captcha');
  state.captcha = true;
  result = await driver.advance(current, { confirmed: true });
  assert.equal(result.stage, 'ballot_terms');
  current = carry(current, result);
  state.terms.ballot = true;
  result = await driver.advance(current, { confirmed: true });
  assert.equal(result.stage, 'ballot_submit');
  current = carry(current, result);
  const submittedStage = current;
  result = await driver.advance(current, { confirmed: true });
  assert.equal(result.stage, 'awaiting_email');
  assert.equal(state.clicked.filter(s => s === '#ballot-submit').length, 1);
  const repeated = await driver.advance(submittedStage, { confirmed: true });
  assert.equal(repeated.stage, 'manual_recovery_required');
  assert.equal(state.clicked.filter(s => s === '#ballot-submit').length, 1);
  const done = await driver.advance(carry(current, result), { confirmationNumber: 'USER-REPORTED-REF' });
  assert.equal(done.evidence.source, 'user_reported');
});

test('an approval cannot submit a changed page/button', async t => {
  const { driver, state } = await liveFixture(t);
  let current = carry(task(), await driver.advance(task()));
  current = carry(current, await driver.advance(current, { code: '123456' }));
  state.terms.account = true;
  current = carry(current, await driver.advance(current, { confirmed: true }));
  state.buttonText['#account-submit'] = 'Different action';
  const result = await driver.advance(current, { confirmed: true });
  assert.equal(result.stage, 'manual_recovery_required');
  assert.equal(state.clicked.includes('#account-submit'), false);
});

test('an approval cannot submit changed contact information at the same URL', async t => {
  const { driver, state } = await liveFixture(t);
  let current = carry(task(), await driver.advance(task()));
  current = carry(current, await driver.advance(current, { code: '123456' }));
  state.terms.account = true;
  current = carry(current, await driver.advance(current, { confirmed: true }));
  assert.equal(current.stage, 'account_create');
  state.values['#account-email'] = 'different-person@example.com';
  const result = await driver.advance(current, { confirmed: true });
  assert.equal(result.stage, 'manual_recovery_required');
  assert.equal(state.clicked.includes('#account-submit'), false);
  assert.equal(JSON.stringify(result).includes('different-person'), false);
});

test('national account phone without a verified country setting is blocked before browser launch', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cityline-driver-account-country-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const profile = verifiedProfile();
  profile.phoneFormat = 'national';
  profile.fixedCountryCode = '';
  profile.selectors.ballotCountryCode = '#ballot-country';
  profile.countryOptions = { '1': 'US' };
  const profilePath = path.join(dir, 'profile.json');
  await fs.writeFile(profilePath, JSON.stringify(profile));
  const driver = await createDriver({ mode:'live', profilePath, dataDir:dir, playwrightModulePath:'/must-not-load.cjs' });
  const result = await driver.advance(task());
  assert.equal(result.stage, 'configuration_required');
  assert.match(result.message, /账号电话/);
});

test('live network policy blocks external resources and private addresses', async t => {
  const { driver, state } = await liveFixture(t);
  await driver.advance(task());
  for (const [url, expected] of [['https://www.cityline.com/asset.js', 'continued'], ['https://evil.test/collect', 'aborted'], ['http://127.0.0.1/private', 'aborted']]) {
    let action;
    await state.routeHandler({ request: () => ({ url: () => url }), continue: async () => { action = 'continued'; }, abort: async () => { action = 'aborted'; } });
    assert.equal(action, expected);
  }
});

test('lost sessions never replay previously-mutating stages', async () => {
  const driver = await createDriver({ mode: 'live', profilePath: '/missing', dataDir: '/missing' });
  const result = await driver.advance(task('ballot_submit'), { confirmed: true });
  assert.equal(result.stage, 'manual_recovery_required');
});

test('required fields, temporarily disabled controls and delayed OTP are awaited', async t => {
  const { driver, state } = await liveFixture(t);
  state.renderOnWait['#account-email'] = 1;
  state.renderOnWait['#account-name'] = 1;
  state.disabledPolls['#account-send'] = 2;
  state.delayOtpOnSend = true;
  const result = await driver.advance(task());
  assert.equal(result.stage, 'account_otp');
  assert.equal(state.values['#account-name'], participant.fullName);
  assert.ok(state.waits.some(w => w.selector === '#account-email' && w.state === 'visible' && w.timeout === 1000));
  assert.ok(state.waits.some(w => w.selector === '#account-otp' && w.state === 'visible'));
  assert.ok(state.enableChecks['#account-send'] >= 3);
  assert.equal(state.clicked.filter(s => s === '#account-send').length, 1);
});

test('independent non-creating OTP verification can precede a configured details page', async t => {
  const profile = verifiedProfile();
  profile.accountVerifyOtpIsNonConsequential = true;
  profile.accountDetailsUrl = 'https://www.cityline.com/offline-fixture/details';
  Object.assign(profile.selectors, { accountInitialEmail:'#initial-email', accountVerifyOtp:'#account-verify', accountVerified:'#account-verified' });
  const { driver, state } = await liveFixture(t, profile);
  state.detailsRequired = true;
  state.delayVerifiedOnClick = true;
  let current = carry(task(), await driver.advance(task()));
  assert.equal(current.stage, 'account_otp');
  assert.equal(state.values['#initial-email'], participant.email);
  assert.equal(state.values['#account-name'], undefined);
  current = carry(current, await driver.advance(current, {code:'123456'}));
  assert.equal(current.stage, 'account_terms');
  assert.equal(state.clicked.includes('#account-verify'), true);
  assert.equal(state.clicked.includes('#account-submit'), false);
  assert.equal(state.values['#account-name'], participant.fullName);
  assert.equal(state.values['#account-email'], participant.email);
  assert.ok(state.navigations.includes(profile.accountDetailsUrl));
  assert.ok(state.waits.some(w => w.selector === '#account-verified'));
  state.terms.account = true;
  current = carry(current, await driver.advance(current, {confirmed:true}));
  assert.equal(current.stage, 'account_create');
  assert.equal(state.clicked.includes('#account-submit'), false);
});

test('a verified OTP action may automatically navigate to the separately configured details fields', async t => {
  const profile = verifiedProfile();
  profile.accountVerifyOtpIsNonConsequential = true;
  Object.assign(profile.selectors, { accountInitialEmail:'#initial-email', accountVerifyOtp:'#account-verify', accountVerified:'#account-verified' });
  const { driver, state } = await liveFixture(t, profile);
  state.detailsRequired = true;
  state.autoDetailsAfterVerify = true;
  let current = carry(task(), await driver.advance(task()));
  current = carry(current, await driver.advance(current, {code:'123456'}));
  assert.equal(current.stage, 'account_terms');
  assert.equal(state.values['#account-name'], participant.fullName);
  assert.equal(state.clicked.includes('#account-submit'), false);
});

test('unknown signup trigger and consequential-unknown OTP actions are blocked before launch', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cityline-driver-semantics-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const profiles = [
    {...verifiedProfile(),accountCreationTrigger:'unknown'},
    {...verifiedProfile(),accountSendOtpIsNonConsequential:false},
    {...verifiedProfile(),accountOtpInputIsNonConsequential:false},
    {...verifiedProfile(),accountVerifyOtpIsNonConsequential:false,selectors:{...verifiedProfile().selectors,accountVerifyOtp:'#account-verify',accountVerified:'#account-verified'}}
  ];
  for (let i=0;i<profiles.length;i++) {
    const profilePath = path.join(dir, 'profile-'+i+'.json');
    await fs.writeFile(profilePath,JSON.stringify(profiles[i]));
    const driver = await createDriver({mode:'live',profilePath,dataDir:dir,playwrightModulePath:'/must-not-load.cjs'});
    const result = await driver.advance(task());
    assert.equal(result.stage,'configuration_required');
    assert.equal(result.message.includes('Playwright'),false);
  }
});

test('pre-existing login must identify the same participant before skipping signup', async t => {
  const { driver, state } = await liveFixture(t);
  state.accountCreated = true;
  const result = await driver.advance(task());
  assert.equal(result.stage,'manual_recovery_required');
  assert.deepEqual(state.clicked,[]);
  assert.equal(state.values['#ballot-email'],undefined);
});

test('details-page password requires user-owned final submit without repeating OTP', async t => {
  const profile = verifiedProfile();
  profile.accountVerifyOtpIsNonConsequential = true;
  profile.accountDetailsUrl = 'https://www.cityline.com/offline-fixture/details';
  Object.assign(profile.selectors, {
    accountInitialEmail:'#initial-email', accountVerifyOtp:'#account-verify', accountVerified:'#account-verified',
    accountPassword:'#account-password', accountIdentity:'#account-identity', accountCaptcha:'#account-captcha', accountCaptchaComplete:'#account-captcha-complete'
  });
  const { driver, state } = await liveFixture(t, profile);
  state.detailsRequired = true;
  let current = carry(task(), await driver.advance(task()));
  assert.equal(current.stage,'account_otp');
  current = carry(current, await driver.advance(current,{code:'123456'}));
  assert.equal(current.stage,'account_password');
  assert.equal(state.clicked.filter(s=>s === '#account-send').length,1);
  assert.equal(state.clicked.filter(s=>s === '#account-verify').length,1);
  state.values['#account-password'] = 'fictional-locally-entered-password';
  current = carry(current, await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_password');
  // The user, rather than the driver, completes all remaining account-page actions.
  state.accountCaptchaSolved = true;
  state.terms.account = true;
  state.accountCreated = true;
  current = carry(current, await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'ballot_captcha');
  assert.equal(state.clicked.filter(s=>s === '#account-send').length,1);
  assert.equal(state.clicked.filter(s=>s === '#account-verify').length,1);
  assert.equal(state.clicked.includes('#account-submit'),false);
  assert.equal(state.inputReads.includes('#account-password'),false);
});

test('account profile validation is independent of an unconfigured ballot phase', () => {
  const profile = verifiedProfile();
  profile.ballotUrl = '';
  for (const key of Object.keys(profile.selectors)) if(key.startsWith('ballot')) delete profile.selectors[key];
  assert.deepEqual(validateLiveProfile(profile,true,'account'),[]);
  assert.ok(validateLiveProfile(profile,true,'ballot').some(error=>error.includes('ballotUrl')));
  assert.ok(validateLiveProfile(profile,true,'all').some(error=>error.includes('ballotFullName')));
});

test('completed account waits for ballot configuration and retry never recreates the account', async t => {
  const profile = verifiedProfile();
  profile.ballotUrl = '';
  for (const key of Object.keys(profile.selectors)) if(key.startsWith('ballot')) delete profile.selectors[key];
  const {driver,state,writeProfile}=await liveFixture(t,profile);
  let current=carry(task(),await driver.advance(task()));
  assert.equal(current.stage,'account_otp');
  current=carry(current,await driver.advance(current,{code:'123456'}));
  state.terms.account=true;
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_create');
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'configuration_required');
  assert.match(current.message,/账号阶段已完成/);
  assert.equal(state.clicked.filter(s=>s==='#account-submit').length,1);
  const unchanged=await driver.advance(current);
  assert.equal(unchanged.stage,'configuration_required');
  assert.equal(state.clicked.filter(s=>s==='#account-submit').length,1);
  await writeProfile(verifiedProfile());
  const resumed=await driver.advance(carry(current,unchanged));
  assert.equal(resumed.stage,'ballot_captcha');
  assert.equal(state.clicked.filter(s=>s==='#account-submit').length,1);
  assert.equal(state.clicked.filter(s=>s==='#account-send').length,1);
  assert.equal(state.navigations.filter(url=>url.endsWith('/account')).length,1);
});

test('lost session while waiting for ballot configuration does not recreate an account', async t => {
  const profile=verifiedProfile();profile.ballotUrl='';
  const {driver,state,newDriver}=await liveFixture(t,profile);
  let current=carry(task(),await driver.advance(task()));
  current=carry(current,await driver.advance(current,{code:'123456'}));
  state.terms.account=true;
  current=carry(current,await driver.advance(current,{confirmed:true}));
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'configuration_required');
  await driver.close();
  const replacement=await newDriver();t.after(()=>replacement.close());
  const result=await replacement.advance(current);
  assert.equal(result.stage,'manual_recovery_required');
  assert.equal(state.clicked.filter(s=>s==='#account-submit').length,1);
  assert.equal(state.navigations.filter(url=>url.endsWith('/account')).length,1);
});

test('static OTP-page email identity replaces the absent initial email input in submit guard', async t => {
  const profile=verifiedProfile();
  profile.selectors.accountFullName='';profile.selectors.accountPhone='';
  profile.selectors.accountEmailIdentity='#account-otp-email';
  const {driver,state}=await liveFixture(t,profile);
  state.hideEmailOnOtp=true;
  let current=carry(task(),await driver.advance(task()));
  assert.equal(current.stage,'account_otp');
  const initialReads=state.inputReads.filter(s=>s==='#account-email').length;
  current=carry(current,await driver.advance(current,{code:'123456'}));
  state.terms.account=true;
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_create');
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'ballot_captcha');
  assert.equal(state.inputReads.filter(s=>s==='#account-email').length,initialReads);
  assert.equal(state.clicked.filter(s=>s==='#account-submit').length,1);
});

test('changed static OTP-page email identity blocks the previously approved account action', async t => {
  const profile=verifiedProfile();
  profile.selectors.accountFullName='';profile.selectors.accountPhone='';
  profile.selectors.accountEmailIdentity='#account-otp-email';
  const {driver,state}=await liveFixture(t,profile);
  state.hideEmailOnOtp=true;
  let current=carry(task(),await driver.advance(task()));
  current=carry(current,await driver.advance(current,{code:'123456'}));
  state.terms.account=true;
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_create');
  state.otpEmailText='unrelated@example.invalid';
  const result=await driver.advance(current,{confirmed:true});
  assert.equal(result.stage,'manual_recovery_required');
  assert.equal(state.clicked.includes('#account-submit'),false);
  assert.equal(JSON.stringify(result).includes(state.otpEmailText),false);
});

test('exported profile validator rejects invalid account phase and non-boolean registration controls', () => {
  assert.ok(validateLiveProfile(verifiedProfile(),false,'account').some(error=>error.includes('registerAccount=true')));
  for (const value of ['true',null,0,{},[]]) assert.ok(validateLiveProfile(verifiedProfile(),value).some(error=>error.includes('布尔值')));
  assert.deepEqual(validateLiveProfile(verifiedProfile(),false,'ballot'),[]);
});

test('password profile requires an exact account identity marker', () => {
  const profile=verifiedProfile();
  profile.selectors.accountPassword='#account-password';
  assert.ok(validateLiveProfile(profile,true,'account').some(error=>error.includes('accountIdentity')));
  profile.selectors.accountIdentity='#account-identity';
  assert.deepEqual(validateLiveProfile(profile,true,'account'),[]);
});

test('even a populated password page remains manual until the user submits the matching account', async t => {
  const profile=verifiedProfile();
  Object.assign(profile.selectors,{accountPassword:'#account-password',accountIdentity:'#account-identity'});
  const {driver,state}=await liveFixture(t,profile);
  state.values['#account-password']='fictional-prefilled-password';
  let current=carry(task(),await driver.advance(task()));
  assert.equal(current.stage,'account_password');
  assert.deepEqual(state.clicked,[]);
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_password');
  state.accountCreated=true;
  state.loginEmail='wrong-participant@example.invalid';
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_password');
  assert.equal(JSON.stringify(current).includes(state.loginEmail),false);
  state.loginEmail=participant.email;
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'ballot_captcha');
  assert.deepEqual(state.clicked,[]);
  assert.equal(state.inputReads.includes('#account-password'),false);
});

test('password appearing after account approval checkpoint hands off instead of submitting', async t => {
  const profile=verifiedProfile();
  Object.assign(profile.selectors,{accountPassword:'#account-password',accountIdentity:'#account-identity'});
  const {driver,state}=await liveFixture(t,profile);
  state.hiddenSelectors['#account-password']=true;
  let current=carry(task(),await driver.advance(task()));
  current=carry(current,await driver.advance(current,{code:'123456'}));
  state.terms.account=true;
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_create');
  state.hiddenSelectors['#account-password']=false;
  current=carry(current,await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_password');
  assert.equal(state.clicked.includes('#account-submit'),false);
});

test('a visible account email form does not repeat the configured dialog opening action', async t => {
  const profile=verifiedProfile();
  profile.selectors.accountOpenDialog='#account-open-dialog';
  profile.accountOpenDialogIsNonConsequential=true;
  const {driver,state}=await liveFixture(t,profile);
  const result=await driver.advance(task());
  assert.equal(result.stage,'account_otp');
  assert.equal(state.clicked.includes('#account-open-dialog'),false);
  assert.equal(state.clicked.filter(selector=>selector==='#account-send').length,1);
});

test('verified dialog opening happens once before filling and never substitutes for OTP send', async t => {
  const profile=verifiedProfile();
  profile.selectors.accountOpenDialog='#account-open-dialog';
  assert.ok(validateLiveProfile(profile,true,'account').some(error=>error.includes('accountOpenDialogIsNonConsequential')));
  profile.accountOpenDialogIsNonConsequential=true;
  const {driver,state}=await liveFixture(t,profile);
  state.dialogRequired=true;
  const result=await driver.advance(task());
  assert.equal(result.stage,'account_otp');
  assert.equal(state.clicked.filter(selector=>selector==='#account-open-dialog').length,1);
  assert.equal(state.clicked.filter(selector=>selector==='#account-send').length,1);
  assert.equal(state.events[0],'click:#account-open-dialog');
  assert.ok(state.events.indexOf('fill:#account-email')>state.events.indexOf('click:#account-open-dialog'));
  assert.ok(state.events.indexOf('click:#account-send')>state.events.indexOf('fill:#account-email'));
});

function turnstileFixture(enabled = true) {
  const page = { url:()=> 'https://www.cityline.com/Events.html', isClosed:()=>false, mainFrame:()=>main };
  const frame = (url, parent = null, owner = page) => ({url:()=>url,parentFrame:()=>parent,page:()=>owner,isDetached:()=>false});
  const main = frame(page.url());
  const widget = frame('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/widget',main);
  const session = {profile:{allowTurnstileResources:enabled},page};
  const request = (url='https://challenges.cloudflare.com/turnstile/v0/api.js',origin=main,navigation=false) => ({url:()=>url,frame:()=>origin,isNavigationRequest:()=>navigation,serviceWorker:()=>null});
  return {session,page,main,widget,frame,request};
}

test('Turnstile origin stays denied by default and opt-in must be boolean', () => {
  const f=turnstileFixture(false);
  assert.equal(isTurnstileResourceRequest(f.request(),f.session),false);
  for (const value of ['true',1,null,{}]) {
    const profile={...verifiedProfile(),allowTurnstileResources:value};
    assert.ok(validateLiveProfile(profile).some(message=>message.includes('allowTurnstileResources')));
  }
  assert.deepEqual(validateLiveProfile({...verifiedProfile(),allowTurnstileResources:true}),[]);
});

test('opt-in allows exact-origin script and nested widget resources only under the owned Cityline page', () => {
  const f=turnstileFixture();
  assert.equal(isTurnstileResourceRequest(f.request(),f.session),true);
  assert.equal(isTurnstileResourceRequest(f.request('https://challenges.cloudflare.com/widget',f.widget),f.session),true);
  const initialChild=f.frame('about:blank',f.main);
  assert.equal(isTurnstileResourceRequest(f.request('https://challenges.cloudflare.com/widget',initialChild,true),f.session),true);
  const nested=f.frame('about:blank',f.widget);
  assert.equal(isTurnstileResourceRequest(f.request('https://challenges.cloudflare.com/resource',nested),f.session),true);
});

test('Turnstile rejects top-level navigation, different page, unavailable frame and worker ownership', () => {
  const f=turnstileFixture();
  assert.equal(isTurnstileResourceRequest(f.request(undefined,f.main,true),f.session),false);
  const otherPage={...f.page};
  const popup=f.frame('https://www.cityline.com/Events.html',null,otherPage);
  assert.equal(isTurnstileResourceRequest(f.request(undefined,popup,true),f.session),false);
  assert.equal(isTurnstileResourceRequest({...f.request(),frame:()=>{throw new Error('no frame');}},f.session),false);
  assert.equal(isTurnstileResourceRequest({...f.request(),frame:()=>null},f.session),false);
  assert.equal(isTurnstileResourceRequest({...f.request(),serviceWorker:()=>({})},f.session),false);
  assert.equal(isTurnstileResourceRequest({...f.request(),serviceWorker:undefined},f.session),false);
});

test('Turnstile rejects lookalikes, credentials, non-HTTPS and non-443 ports', () => {
  const f=turnstileFixture();
  for (const url of [
    'https://challenges.cloudflare.com.evil.invalid/script.js','https://extra.challenges.cloudflare.com/script.js',
    'https://challenges.cloudflare.com./script.js','http://challenges.cloudflare.com/script.js',
    'https://challenges.cloudflare.com:8443/script.js','https://user:secret@challenges.cloudflare.com/script.js',
    'https://127.0.0.1/script.js','wss://challenges.cloudflare.com/socket'
  ]) assert.equal(isTurnstileResourceRequest(f.request(url),f.session),false);
  assert.equal(isTurnstileResourceRequest(f.request('https://challenges.cloudflare.com:443/script.js'),f.session),true);
  assert.equal(isCitylineHttps('https://challenges.cloudflare.com/script.js'),false);
});

test('Turnstile ancestor chain must reach this current Cityline main frame without unknown origins or cycles', () => {
  const f=turnstileFixture();
  const foreign=f.frame('https://foreign.invalid/frame',f.main);
  assert.equal(isTurnstileResourceRequest(f.request(undefined,f.frame('https://challenges.cloudflare.com/widget',foreign)),f.session),false);
  const detachedRoot=f.frame('https://www.cityline.com/frame');
  assert.equal(isTurnstileResourceRequest(f.request(undefined,detachedRoot),f.session),false);
  const cyclic=f.frame('about:blank');cyclic.parentFrame=()=>cyclic;
  assert.equal(isTurnstileResourceRequest(f.request(undefined,cyclic),f.session),false);
  assert.equal(isTurnstileResourceRequest(f.request(undefined,{...f.widget,isDetached:()=>true}),f.session),false);
  f.page.url=()=> 'https://foreign.invalid/page';
  assert.equal(isTurnstileResourceRequest(f.request(),f.session),false);
});

test('live route applies the Turnstile exception only when opted in and rechecks each exposed request', async t => {
  const profile=verifiedProfile();profile.allowTurnstileResources=true;
  const {driver,state,page}=await liveFixture(t,profile);
  await driver.advance(task());
  const origin=page.mainFrame();
  const requests=[
    {url:()=> 'https://challenges.cloudflare.com/turnstile/v0/api.js',frame:()=>origin,isNavigationRequest:()=>false,serviceWorker:()=>null},
    {url:()=> 'https://redirected.invalid/not-allowed',frame:()=>origin,isNavigationRequest:()=>false,serviceWorker:()=>null},
    {url:()=> 'https://challenges.cloudflare.com/top-page',frame:()=>origin,isNavigationRequest:()=>true,serviceWorker:()=>null}
  ];
  for(let index=0;index<requests.length;index++) {
    let action;
    await state.routeHandler({request:()=>requests[index],continue:async()=>{action='continued';},abort:async()=>{action='aborted';}});
    assert.equal(action,index===0?'continued':'aborted');
  }
});

test('multiple password matches fail closed before submission, including hidden plus visible matches', async t => {
  for(const visibility of [[true,true],[false,true]]) {
    const profile=verifiedProfile();
    Object.assign(profile.selectors,{accountPassword:'#account-password',accountIdentity:'#account-identity'});
    const {driver,state}=await liveFixture(t,profile);
    state.hiddenSelectors['#account-password']=true;
    let current=carry(task(),await driver.advance(task()));
    current=carry(current,await driver.advance(current,{code:'123456'}));
    state.terms.account=true;
    current=carry(current,await driver.advance(current,{confirmed:true}));
    assert.equal(current.stage,'account_create');
    state.matchVisibility['#account-password']=visibility;
    const result=await driver.advance(current,{confirmed:true});
    assert.equal(result.stage,'manual_recovery_required');
    assert.equal(state.clicked.includes('#account-submit'),false);
    assert.equal(state.inputReads.includes('#account-password'),false);
  }
});
