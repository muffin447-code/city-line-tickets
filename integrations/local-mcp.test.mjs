import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { createBridge } from '../src/server.mjs';
import { ensureLocalBridge, runLocalMcp } from './local-mcp.mjs';

const token = 'local-mcp-test-' + 'a'.repeat(48);
const missing = '/v1/tasks/00000000-0000-0000-0000-000000000000';
const authenticated = { headers: { Authorization: 'Bearer ' + token } };
const envFor = (port, dir) => ({ CITYLINE_PORT: String(port), CITYLINE_BRIDGE_TOKEN: token, CITYLINE_DATA_DIR: dir });
async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cityline-local-mcp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('local MCP starts and closes only its owned loopback bridge', async t => {
  const dir = await temporary(t), port = await freePort();
  const local = await ensureLocalBridge({ env: envFor(port, dir) });
  t.after(() => local.close());
  assert.equal(local.owned, true);
  const response = await fetch(local.base + missing, authenticated);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
  await local.close();
  await assert.rejects(access(path.join(dir, 'process.lock')));
  await assert.rejects(fetch(local.base + missing, authenticated));
});

test('existing bridge is reused only after authenticated missing-task response and is not closed', async t => {
  const dir = await temporary(t);
  const bridge = await createBridge({ token, dataDir: path.join(dir, 'owned-by-server') });
  const address = await bridge.listen(0); t.after(() => bridge.close());
  const unusedDir = path.join(dir, 'must-not-be-created');
  const local = await ensureLocalBridge({ env: envFor(address.port, unusedDir) });
  assert.equal(local.owned, false);
  await local.close();
  assert.equal((await fetch(local.base + missing, authenticated)).status, 404);
  await assert.rejects(access(unusedDir));
});

test('wrong token aborts without starting a new server or touching its data directory', async t => {
  const dir = await temporary(t);
  const bridge = await createBridge({ token, dataDir: path.join(dir, 'server') });
  const address = await bridge.listen(0); t.after(() => bridge.close());
  const unusedDir = path.join(dir, 'wrong-token');
  await assert.rejects(ensureLocalBridge({ env: { ...envFor(address.port, unusedDir), CITYLINE_BRIDGE_TOKEN: 'different-' + 'b'.repeat(48) } }), { code: 'TOKEN_MISMATCH' });
  await assert.rejects(access(unusedDir));
  assert.equal((await fetch('http://127.0.0.1:' + address.port + missing, authenticated)).status, 404);
});

test('an unrelated listener and a hung listener are never replaced', async t => {
  const server = http.createServer((request, response) => {
    if (request.headers['x-test']) return;
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'SOME_OTHER_SERVICE' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const dir = await temporary(t), env = envFor(server.address().port, dir);
  let creations = 0;
  const neverCreate = () => { creations++; throw new Error('must not create'); };
  await assert.rejects(ensureLocalBridge({ env, createBridgeImpl: neverCreate }), { code: 'UNRECOGNIZED_SERVICE' });
  const hungFetch = (url, options) => fetch(url, { ...options, headers: { ...options.headers, 'x-test': 'hang' } });
  await assert.rejects(ensureLocalBridge({ env, createBridgeImpl: neverCreate, fetchImpl: hungFetch, probeTimeoutMs: 50 }), { code: 'PROBE_FAILED' });
  assert.equal(creations, 0);
});

test('a data directory lock is respected even when a different configured port is absent', async t => {
  const dir = await temporary(t), firstPort = await freePort();
  const local = await ensureLocalBridge({ env: envFor(firstPort, dir) });
  t.after(() => local.close());
  const secondPort = await freePort();
  await assert.rejects(ensureLocalBridge({ env: envFor(secondPort, dir) }), { code: 'STARTUP_FAILED' });
  await access(path.join(dir, 'process.lock'));
  assert.equal((await fetch(local.base + missing, authenticated)).status, 404);
});

test('startup timeout closes the partially created owned bridge without choosing another port', async () => {
  let closed = 0, requestedPort;
  const refused = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const factory = async () => ({ listen(port) { requestedPort = port; return new Promise(() => {}); }, async close() { closed++; } });
  await assert.rejects(ensureLocalBridge({ env: envFor(8787, '/unused-test-path'), fetchImpl: refused, createBridgeImpl: factory, startupTimeoutMs: 20 }), { code: 'STARTUP_TIMEOUT' });
  assert.equal(requestedPort, 8787); assert.equal(closed, 1);
});

test('stdin end stops an owned bridge and stdout stays JSON-RPC only', async t => {
  const dir = await temporary(t), port = await freePort();
  const input = new PassThrough(), output = new PassThrough(); let captured = '';
  output.on('data', chunk => { captured += chunk; });
  const running = runLocalMcp({ env: envFor(port, dir), input, output });
  input.end(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }) + '\n');
  await running;
  assert.deepEqual(captured.trim().split('\n').map(JSON.parse), [{ jsonrpc: '2.0', id: 3, result: {} }]);
  assert.equal(captured.includes(token), false);
  await assert.rejects(access(path.join(dir, 'process.lock')));
  await assert.rejects(fetch('http://127.0.0.1:' + port + missing, authenticated));
});

test('local bootstrap rejects remote origins and mismatched ports before any request', async () => {
  let requested = false;
  for (const url of ['https://remote.example/', 'http://localhost:8787/', 'http://127.0.0.1:9999/', 'http://127.0.0.1:8787/?token=private']) {
    await assert.rejects(ensureLocalBridge({ env: { ...envFor(8787, '/unused-test-path'), CITYLINE_BRIDGE_URL: url }, fetchImpl: () => { requested = true; } }), { code: 'INVALID_URL' });
  }
  assert.equal(requested, false);
});
