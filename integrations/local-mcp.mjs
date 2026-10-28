#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBridge } from '../src/server.mjs';
import { readConfig, runStdio } from './mcp.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const missingTask = '/v1/tasks/00000000-0000-0000-0000-000000000000';

class BootstrapError extends Error {
  constructor(code, message) { super(message); this.name = 'BootstrapError'; this.code = code; }
}

function localConfig(env) {
  const port = Number(env.CITYLINE_PORT || '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BootstrapError('INVALID_PORT', 'Invalid local bridge port.');
  const base = 'http://127.0.0.1:' + port;
  if (env.CITYLINE_BRIDGE_URL) {
    let supplied;
    try { supplied = new URL(env.CITYLINE_BRIDGE_URL); }
    catch { throw new BootstrapError('INVALID_URL', 'Invalid local bridge URL.'); }
    if (supplied.origin !== base || supplied.pathname !== '/' || supplied.search || supplied.hash || supplied.username || supplied.password) throw new BootstrapError('INVALID_URL', 'Local MCP requires the configured HTTP 127.0.0.1 origin and matching port.');
  }
  const parsed = readConfig({ ...env, CITYLINE_BRIDGE_URL: base });
  if (parsed.token.startsWith('replace-')) throw new BootstrapError('INVALID_TOKEN', 'Run local setup before starting MCP.');
  return { port, base, token: parsed.token, env: { ...env, CITYLINE_BRIDGE_URL: base } };
}

function isRefused(error, seen = new Set()) {
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return error.code === 'ECONNREFUSED' || isRefused(error.cause, seen) || (Array.isArray(error.errors) && error.errors.some(item => isRefused(item, seen)));
}

async function smallJson(response, maximum = 4096) {
  if (Number(response.headers.get('content-length') || '0') > maximum) throw new BootstrapError('UNRECOGNIZED_SERVICE', 'The local port is not the expected bridge.');
  const reader = response.body?.getReader();
  if (!reader) throw new BootstrapError('UNRECOGNIZED_SERVICE', 'The local port is not the expected bridge.');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new BootstrapError('UNRECOGNIZED_SERVICE', 'The local port is not the expected bridge.'); }
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    throw new BootstrapError('UNRECOGNIZED_SERVICE', 'The local port is not the expected bridge.');
  } finally { reader.releaseLock(); }
}

async function probe(config, fetchImpl, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(config.base + missingTask, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: 'Bearer ' + config.token }
    });
  } catch (error) {
    if (isRefused(error)) return 'absent';
    throw new BootstrapError('PROBE_FAILED', 'The local port could not be verified. Check the existing service before retrying.');
  }
  if (response.status === 401) {
    await response.body?.cancel().catch(() => {});
    throw new BootstrapError('TOKEN_MISMATCH', 'An existing local service rejected authentication. Check configuration; no new service was started.');
  }
  if (response.status !== 404) {
    await response.body?.cancel().catch(() => {});
    throw new BootstrapError('UNRECOGNIZED_SERVICE', 'The local port is occupied by an unverified service.');
  }
  const payload = await smallJson(response);
  if (payload?.error?.code !== 'NOT_FOUND') throw new BootstrapError('UNRECOGNIZED_SERVICE', 'The local port is occupied by an unverified service.');
  return 'verified';
}

async function deadline(promise, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new BootstrapError(code, 'Local bridge startup timed out.')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Starts an owned loopback bridge only when the configured port is absent. */
export async function ensureLocalBridge({ env = process.env, fetchImpl = fetch, createBridgeImpl = createBridge, probeTimeoutMs = 1500, startupTimeoutMs = 5000 } = {}) {
  const config = localConfig(env);
  const reused = () => ({ owned: false, base: config.base, env: config.env, close: async () => {} });
  if (await probe(config, fetchImpl, probeTimeoutMs) === 'verified') return reused();

  let bridge;
  let closed = false;
  const closeOwned = async () => {
    if (!bridge || closed) return;
    closed = true;
    await bridge.close();
  };
  try {
    // createBridge/TaskStore own the private-directory lock. Never remove it here.
    bridge = await createBridgeImpl({
      token: config.token,
      dataDir: path.resolve(env.CITYLINE_DATA_DIR || path.join(projectRoot, '.data')),
      allowLive: env.CITYLINE_ALLOW_LIVE === 'true',
      publicOrigin: env.CITYLINE_PUBLIC_ORIGIN || '',
      profilePath: path.resolve(env.CITYLINE_PROFILE_PATH || path.join(projectRoot, 'config/cityline.local.json')),
      playwrightModulePath: env.PLAYWRIGHT_MODULE_PATH
    });
    await deadline(bridge.listen(config.port), startupTimeoutMs, 'STARTUP_TIMEOUT');
    if (await probe(config, fetchImpl, probeTimeoutMs) !== 'verified') throw new BootstrapError('STARTUP_FAILED', 'The owned local service could not be verified.');
    return { owned: true, base: config.base, env: config.env, close: closeOwned };
  } catch (error) {
    await closeOwned().catch(() => {});
    // Another authorized instance may have acquired the port or data lock first.
    // Reuse it only after the same authenticated probe; never choose another port.
    if (error?.code !== 'STARTUP_TIMEOUT') {
      try { if (await probe(config, fetchImpl, probeTimeoutMs) === 'verified') return reused(); }
      catch (probeError) { throw probeError; }
    }
    if (error instanceof BootstrapError) throw error;
    throw new BootstrapError('STARTUP_FAILED', 'Local bridge could not start. Check the private data lock and configured port.');
  }
}

/** MCP stdin lifetime owns only a bridge created by this wrapper. */
export async function runLocalMcp({ input = process.stdin, output = process.stdout, env = process.env, fetchImpl = fetch, createBridgeImpl = createBridge, handleSignals = false, probeTimeoutMs, startupTimeoutMs } = {}) {
  const local = await ensureLocalBridge({ env, fetchImpl, createBridgeImpl, probeTimeoutMs, startupTimeoutMs });
  const stopInput = () => input.destroy();
  if (handleSignals) { process.once('SIGINT', stopInput); process.once('SIGTERM', stopInput); }
  try { await runStdio({ input, output, env: local.env, fetchImpl }); }
  finally {
    if (handleSignals) { process.removeListener('SIGINT', stopInput); process.removeListener('SIGTERM', stopInput); }
    await local.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLocalMcp({ handleSignals: true }).catch(() => {
    process.stderr.write('Cityline local MCP could not start or continue. Check local setup, port, and private data lock.\n');
    process.exitCode = 1;
  });
}
