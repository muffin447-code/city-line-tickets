#!/usr/bin/env node
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const uuid = { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' };
const participant = {
  type: 'object', additionalProperties: false,
  required: ['fullName', 'email', 'countryCode', 'phone'],
  properties: {
    fullName: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', minLength: 3, maxLength: 254 },
    countryCode: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' },
    phone: { type: 'string', minLength: 4, maxLength: 24 },
    provider: { type: 'string', maxLength: 80 }
  }
};
export const TOOLS = [
  {
    name: 'create_cityline_task',
    description: 'Create or recover the one-participant Cityline task. Demo is local simulation; live requires local website configuration. Do not provide passwords or keys.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: 'object', additionalProperties: false, required: ['participant', 'mode', 'registerAccount'], properties: { participant, mode: { type: 'string', enum: ['demo', 'live'] }, registerAccount: { type: 'boolean' } } }
  },
  {
    name: 'get_cityline_task', description: 'Read masked task progress and the current one-use challenge. Does not perform browser actions.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, required: ['taskId'], properties: { taskId: uuid } }
  },
  {
    name: 'start_cityline_task', description: 'Start a created task. Browser work runs asynchronously and stops for current verification or confirmation checkpoints.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: 'object', additionalProperties: false, required: ['taskId'], properties: { taskId: uuid } }
  },
  {
    name: 'resume_cityline_task', description: 'Respond only to the latest challenge. A current user decision is required for each approval; never infer or reuse consent. OTPs are transient.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['taskId', 'challengeId'],
      properties: { taskId: uuid, challengeId: uuid, code: { type: 'string', minLength: 1, maxLength: 32 }, confirmed: { type: 'boolean', const: true }, confirmationNumber: { type: 'string', minLength: 1, maxLength: 120 } }
    }
  }
];

function validate(value, schema) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool arguments.');
    if ((schema.required || []).some(key => !(key in value))) throw new Error('Missing required tool arguments.');
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) throw new Error('Unknown tool arguments.');
    for (const [key, item] of Object.entries(value)) validate(item, schema.properties[key]);
  } else {
    if (typeof value !== schema.type) throw new Error('Invalid argument type.');
    if (schema.enum && !schema.enum.includes(value)) throw new Error('Invalid argument value.');
    if ('const' in schema && value !== schema.const) throw new Error('Invalid confirmation.');
    if (typeof value === 'string' && ((schema.minLength && value.length < schema.minLength) || (schema.maxLength && value.length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) throw new Error('Invalid argument format.');
  }
}

export function readConfig(env = process.env) {
  let base;
  try { base = new URL(env.CITYLINE_BRIDGE_URL || 'http://127.0.0.1:8787'); }
  catch { throw new Error('Invalid bridge URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback))) throw new Error('Bridge URL must be a bare HTTPS origin, or HTTP loopback origin.');
  const token = env.CITYLINE_BRIDGE_TOKEN || '';
  if (token.length < 43 || /\s/.test(token)) throw new Error('Set CITYLINE_BRIDGE_TOKEN from the private local .env file.');
  return { base: base.origin, token };
}

export function createHandler({ env = process.env, fetchImpl = fetch } = {}) {
  const config = readConfig(env);
  const callApi = async (method, path, body) => {
    let response;
    try {
      response = await fetchImpl(config.base + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: 'Bearer ' + config.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch { throw new Error('Local bridge unavailable. Check that the service is running.'); }
    if (!response.ok) throw new Error('Bridge request rejected (HTTP ' + response.status + '). Read local task progress before retrying.');
    const length = Number(response.headers.get('content-length') || '0');
    if (length > 65_536) throw new Error('Bridge response too large.');
    const text = await response.text();
    if (text.length > 65_536) throw new Error('Bridge response too large.');
    try { return JSON.parse(text); } catch { throw new Error('Invalid bridge response.'); }
  };
  return async message => {
    const id = message?.id;
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid request.' } };
    if (id === undefined) return null;
    const success = result => ({ jsonrpc: '2.0', id, result });
    const fail = (code, msg) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });
    if (message.method === 'initialize') {
      const supported = ['2024-11-05', '2025-03-26', '2025-06-18'];
      const requested = message.params?.protocolVersion;
      return success({ protocolVersion: supported.includes(requested) ? requested : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cityline-gpt-bridge', version: '0.1.0' }, instructions: 'Use only for the requested one-participant task. Stop at current verification/approval checkpoints. Demo success is not real registration.' });
    }
    if (message.method === 'ping') return success({});
    if (message.method === 'tools/list') return success({ tools: TOOLS });
    if (message.method !== 'tools/call') return fail(-32601, 'Method not found.');
    const tool = TOOLS.find(t => t.name === message.params?.name);
    if (!tool) return fail(-32602, 'Unknown tool.');
    const args = message.params?.arguments || {};
    try { validate(args, tool.inputSchema); }
    catch (error) { return fail(-32602, error.message); }
    try {
      let result;
      if (tool.name === 'create_cityline_task') result = await callApi('POST', '/v1/tasks', args);
      if (tool.name === 'get_cityline_task') result = await callApi('GET', '/v1/tasks/' + args.taskId);
      if (tool.name === 'start_cityline_task') result = await callApi('POST', '/v1/tasks/' + args.taskId + '/start', {});
      if (tool.name === 'resume_cityline_task') {
        const { taskId, ...body } = args;
        const answers = ['code', 'confirmed', 'confirmationNumber'].filter(k => Object.hasOwn(body, k));
        if (answers.length !== 1) return fail(-32602, 'Provide exactly one answer for the current challenge.');
        result = await callApi('POST', '/v1/tasks/' + taskId + '/resume', body);
      }
      return success({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
    } catch (error) { return success({ content: [{ type: 'text', text: error.message }], isError: true }); }
  };
}

export async function runStdio({ input = process.stdin, output = process.stdout, env = process.env, fetchImpl = fetch } = {}) {
  const handler = createHandler({ env, fetchImpl });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    if (Buffer.byteLength(line, 'utf8') > 131_072) response = { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large.' } };
    else {
      let message;
      try { message = JSON.parse(line); }
      catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }; }
      if (message) response = await handler(message);
    }
    if (response) output.write(JSON.stringify(response) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStdio().catch(() => { process.stderr.write('Cityline MCP could not start. Check local configuration.\n'); process.exitCode = 1; });
}
