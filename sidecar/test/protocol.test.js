const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ERROR_CATEGORIES,
  errorEnvelope,
  parseRequest,
  successEnvelope,
} = require('../stagehand/protocol');

test('parses execute and bounded agent requests with normalized origins', () => {
  const execute = parseRequest(JSON.stringify({
    id: 'step-1',
    command: 'execute',
    step: { action: 'click', locator: { kind: 'role', value: 'button', name: '提交' } },
  }));
  assert.equal(execute.step.locator.kind, 'role');
  assert.equal(Object.isFrozen(execute), true);

  const agent = parseRequest(JSON.stringify({
    id: 'agent-1',
    command: 'agent',
    goal: '提交表单',
    allowedOrigins: ['HTTPS://Test.Example:443', 'http://localhost:3000'],
    maxActions: 6,
    timeoutMs: 30000,
  }));
  assert.deepEqual(agent.allowedOrigins, ['https://test.example', 'http://localhost:3000']);
  assert.equal(agent.maxActions, 6);
});

test('requires bounded origins and timeouts for act and agent', () => {
  const base = { id: '1', command: 'act', instruction: '点击提交' };
  assert.throws(() => parseRequest(JSON.stringify(base)), /MISSING_ALLOWED_ORIGINS/);
  assert.throws(() => parseRequest(JSON.stringify({ ...base, allowedOrigins: ['https://example.test'], timeoutMs: 0 })), /INVALID_TIMEOUT_MS/);
  assert.throws(() => parseRequest(JSON.stringify({ ...base, allowedOrigins: ['https://example.test'], timeoutMs: 300001 })), /INVALID_TIMEOUT_MS/);
  assert.throws(() => parseRequest(JSON.stringify({ ...base, allowedOrigins: ['https://example.test'], timeoutMs: 1000, maxActions: 1 })), /UNKNOWN_REQUEST_FIELD/);
  assert.throws(() => parseRequest(JSON.stringify({ ...base, command: 'agent', goal: '提交', instruction: undefined, allowedOrigins: ['https://example.test'], timeoutMs: 1000, maxActions: 0 })), /INVALID_MAX_ACTIONS/);
  assert.throws(() => parseRequest(JSON.stringify({ ...base, command: 'agent', goal: '提交', instruction: undefined, allowedOrigins: ['https://example.test'], timeoutMs: 1000, maxActions: 21 })), /INVALID_MAX_ACTIONS/);
});

test('rejects non-https remote origins and normalizes explicit localhost http origins', () => {
  const request = value => JSON.stringify({ id: '1', command: 'act', instruction: '继续', allowedOrigins: [value], timeoutMs: 1000 });
  assert.throws(() => parseRequest(request('http://example.test')), /INVALID_ALLOWED_ORIGIN/);
  assert.throws(() => parseRequest(request('https://example.test/path')), /INVALID_ALLOWED_ORIGIN/);
  assert.throws(() => parseRequest(request('https://user@example.test')), /INVALID_ALLOWED_ORIGIN/);
  assert.equal(parseRequest(request('http://127.0.0.1:5173')).allowedOrigins[0], 'http://127.0.0.1:5173');
  assert.equal(parseRequest(request('http://[::1]:5173')).allowedOrigins[0], 'http://[::1]:5173');
});

test('rejects arrays, unknown fields, commands, and secret data at any depth', () => {
  assert.throws(() => parseRequest('[]'), /REQUEST_MUST_BE_OBJECT/);
  assert.throws(() => parseRequest('{"id":"1","command":"terminate","extra":true}'), /UNKNOWN_REQUEST_FIELD/);
  assert.throws(() => parseRequest('{"id":"1","command":"login"}'), /UNKNOWN_COMMAND/);
  assert.throws(() => parseRequest('{"id":"1","command":"act","instruction":"use ${accessToken}","allowedOrigins":["https://example.test"],"timeoutMs":1000}'), /SECRET_PLACEHOLDER/);
  assert.throws(() => parseRequest('{"id":"1","command":"act","instruction":"read the password","allowedOrigins":["https://example.test"],"timeoutMs":1000}'), /SECRET_VALUE/);
  assert.throws(() => parseRequest('{"id":"1","command":"self_check","password":"do-not-log"}'), error => error.code === 'SECRET_FIELD');
});

test('enforces the 64 KiB UTF-8 payload limit and one-line JSON boundary', () => {
  const exactShape = JSON.stringify({ id: '1', command: 'act', instruction: '界'.repeat(22000), allowedOrigins: ['https://example.test'], timeoutMs: 1000 });
  assert.ok(Buffer.byteLength(exactShape, 'utf8') > 64 * 1024);
  assert.throws(() => parseRequest(exactShape), /PAYLOAD_TOO_LARGE/);
  assert.equal(parseRequest('{"id":"1","command":"terminate"}\r\n').command, 'terminate');
  assert.throws(() => parseRequest('{"id":"1",\n"command":"terminate"}'), /MULTILINE_REQUEST/);
  assert.throws(() => parseRequest('{"id":"1","command":"terminate"} trailing'), /INVALID_JSON/);
});

test('supports observe, terminate, and self_check with closed schemas', () => {
  assert.equal(parseRequest('{"id":"o1","command":"observe","instruction":"有哪些按钮"}').command, 'observe');
  assert.equal(parseRequest('{"id":"t1","command":"terminate"}').command, 'terminate');
  assert.equal(parseRequest('{"id":"s1","command":"self_check"}').command, 'self_check');
});

test('creates frozen envelopes with stable categories and redacted messages', () => {
  assert.deepEqual([...ERROR_CATEGORIES], ['invalid_request', 'blocked', 'business_failed', 'cancelled', 'interrupted']);
  assert.deepEqual(successEnvelope('1', { status: 'ok' }), { id: '1', ok: true, data: { status: 'ok' } });

  const envelope = errorEnvelope('2', 'blocked', {
    code: 'MODEL_REJECTED',
    message: 'password=hunter2 token: abc123 Bearer secret-value ${accessToken}',
  });
  assert.equal(envelope.error.category, 'blocked');
  assert.equal(envelope.error.code, 'MODEL_REJECTED');
  assert.doesNotMatch(JSON.stringify(envelope), /hunter2|abc123|secret-value|accessToken/);
  assert.equal(Object.isFrozen(envelope.error), true);
  assert.throws(() => errorEnvelope('2', 'internal', new Error('no')), /INVALID_ERROR_CATEGORY/);
});
