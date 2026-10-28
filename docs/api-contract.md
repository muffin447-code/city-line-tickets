# API contract

Node ESM, Node >=22. No OpenAI API calls or API key required. A Custom GPT uses authenticated HTTP Actions; Codex uses a local stdio MCP adapter forwarding to the same service.

## HTTP routes

- GET /health (no auth; only reports ok/version).
- POST /v1/tasks -> 201 task public view. Body `{participant:{fullName,email,countryCode,phone,provider?},mode:"demo"|"live",registerAccount:true|false}`. Unknown properties rejected. Only the fixed Eason event is supported. One participant identity per installation; duplicate identity returns same existing task, different identity is rejected. No passwords/API keys in task body.
- GET /v1/tasks/{id} -> public task view, masked participant only.
- POST /v1/tasks/{id}/start -> 202 public task view, enqueues driver.
- POST /v1/tasks/{id}/resume -> 202 task. Body `{challengeId,code?,confirmed?,confirmationNumber?}`. Only fields needed by the pending challenge are accepted. No blanket approvals. A challenge is single-use and version-bound.
- All /v1 endpoints use Authorization: Bearer token (minimum 32 random bytes). Requests and responses never log PII, secrets, or OTP. Public task ids are UUIDs. Local journal uses directory 0700/files0600, excluded from Git. OTP only exists transiently and is never journaled.

Task public view: `{id,mode,status,stage,message,participant:{fullNameMasked,emailMasked,phoneMasked},challenge?:{id,kind,prompt},evidence?:{source,confirmationNumber},updatedAt}`. Statuses created,running,needs_input,needs_confirmation,awaiting_email,completed,blocked,failed. Completion must distinguish actual verified evidence from user-reported receipt. Never claim receipt verification when only provided by user.

## Driver interface

`createDriver({mode,profilePath,dataDir,playwrightModulePath?})` async -> driver.
`driver.advance(task,input={})` async -> `{status,stage,message,challenge?:{kind,prompt},evidence?}`.
`driver.close()` async.
Task contains participant raw data, id,stage,status,registerAccount; current state is passed on each advance.
Engine calls advance on start or resume, exactly once, and persists returned transition. Driver may advance normal actions until next checkpoint. Driver must not expect challenge.id (engine assigns it). Driver must not persist OTP or log raw personal data.
Challenge kinds: otp,captcha,terms,password,create_account,submit_ballot,email_confirmation. Root service assigns challenge id. OTP resumes with code; captcha/terms/password resume with confirmed:true after local manual completion; create_account/submit_ballot resume with confirmed:true after explicit user approval; email_confirmation uses confirmationNumber and labels source user_reported (not independently verified).
Demo driver must exercise signup OTP -> account terms -> create_account approval -> ballot captcha -> ballot terms -> submit_ballot approval -> confirmation email -> completed with evidence source user_reported. No network in demo.
Live driver uses a local admin-configured site profile, verified:false by default. Never invent actual selectors or endpoints. If not verified/configured, return blocked and explain required setup. No proxy/fingerprint evasion or CAPTCHA solving. Only Cityline HTTPS navigation allowed; external document/email links are not opened. No ticket purchase.

Runtime state, browser profiles, task data, and tokens are private deployment files and must never be committed or included in source archives.
