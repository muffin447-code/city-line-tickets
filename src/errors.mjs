export class BridgeError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const invalid = message => new BridgeError(400, 'INVALID_INPUT', message);
export function exactObject(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid('请求必须为 JSON 对象。');
  if (Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) throw invalid('请求字段不符合接口定义。');
}
