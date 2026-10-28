import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createDriver, isCitylineHttps, validateLiveProfile } from '../src/browser.mjs';

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
const state = { url: 'about:blank', values: {}, clicked: [], terms: { account: false, ballot: false }, captcha: false, accountCaptchaSolved: false, accountCreated: false, ballotSubmitted: false, otpSent: false, buttonText: {}, closed: false, routeHandler: null, renderOnWait: {}, waits: [], disabledPolls: {}, enableChecks: {}, delayOtpOnSend: false, otpVerified: false, delayVerifiedOnClick: false, detailsRequired: false, detailsVisited: false, autoDetailsAfterVerify: false, navigations: [] };
class Locator {
  constructor(selector) { this.selector = selector; }
  async count() { return state.renderOnWait[this.selector] ? 0 : 1; }
  async isVisible() {
    if (state.renderOnWait[this.selector]) return false;
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
  async fill(value) { state.values[this.selector] = value; }
  async inputValue() { return state.values[this.selector] || ''; }
  async innerText() { return state.loginEmail || 'participant@example.com'; }
  async evaluate(fn) { return fn({ tagName:'BUTTON',value:state.values[this.selector] || '',textContent:state.buttonText[this.selector] || this.selector,getAttribute:()=> 'submit' }); }
  async click() {
    state.clicked.push(this.selector);
    if(this.selector === '#account-send') { state.otpSent = true; if(state.delayOtpOnSend) state.renderOnWait['#account-otp'] = 1; }
    if(this.selector === '#account-verify') { state.otpVerified = true; if(state.delayVerifiedOnClick)state.renderOnWait['#account-verified']=1; if(state.autoDetailsAfterVerify){state.detailsVisited=true;state.values['#account-email']=state.values['#initial-email'] || '';state.url='https://www.cityline.com/offline-fixture/details';} }
    if(this.selector === '#account-submit') state.accountCreated = true;
    if(this.selector === '#ballot-submit') state.ballotSubmitted = true;
  }
  async waitFor(options) { state.waits.push({selector:this.selector,...options}); if(state.renderOnWait[this.selector]) { await new Promise(resolve=>setTimeout(resolve,5)); state.renderOnWait[this.selector] = 0; } if (!await this.isVisible()) throw new Error('Unconfirmed simulated page'); }
}
const page = { isClosed:()=>false,url:()=>state.url,setDefaultTimeout(){},locator:s=>new Locator(s),async goto(url){state.url=url;state.navigations.push(url);if(url.endsWith('/details')){state.detailsVisited=true;state.values['#account-email']=state.values['#initial-email'] || state.values['#account-email'] || '';}},mainFrame(){return {};},on(){},async close(){state.closed=true;} };
const context = {pages:()=>[page],async newPage(){return page;},async route(_pattern,handler){state.routeHandler=handler;},on(){},async close(){state.closed=true;}};
module.exports = { state, chromium:{async launchPersistentContext(){return context;}} };
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
  return { driver, state: createRequire(import.meta.url)(modulePath).state };
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

test('details-page password and CAPTCHA handoffs do not resend or reverify OTP', async t => {
  const profile = verifiedProfile();
  profile.accountVerifyOtpIsNonConsequential = true;
  profile.accountDetailsUrl = 'https://www.cityline.com/offline-fixture/details';
  Object.assign(profile.selectors, {
    accountInitialEmail:'#initial-email', accountVerifyOtp:'#account-verify', accountVerified:'#account-verified',
    accountPassword:'#account-password', accountCaptcha:'#account-captcha', accountCaptchaComplete:'#account-captcha-complete'
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
  assert.equal(current.stage,'account_captcha');
  state.accountCaptchaSolved = true;
  current = carry(current, await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_terms');
  state.terms.account = true;
  current = carry(current, await driver.advance(current,{confirmed:true}));
  assert.equal(current.stage,'account_create');
  assert.equal(state.clicked.filter(s=>s === '#account-send').length,1);
  assert.equal(state.clicked.filter(s=>s === '#account-verify').length,1);
  assert.equal(state.clicked.includes('#account-submit'),false);
});
