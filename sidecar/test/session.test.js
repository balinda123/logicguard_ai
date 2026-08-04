'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough, Readable } = require('node:stream');

const { createSession } = require('../stagehand/session');
const { runWorker } = require('../stagehand/worker');

function createFakeStagehand({ url = 'https://test.example/start' } = {}) {
  const calls = [];
  let currentUrl = url;
  const locator = {
    click: async () => calls.push(['click']),
    fill: async value => calls.push(['fill', value]),
    selectOption: async value => (calls.push(['selectOption', value]), [value]),
    isVisible: async () => true,
    innerText: async () => 'Completed',
    textContent: async () => 'Completed',
    resolveNode: async () => ({ objectId: 'node-1' }),
    getFrame: () => ({ session: { send: async (...args) => calls.push(['send', ...args]) } }),
  };
  const page = {
    url: () => currentUrl,
    goto: async target => { calls.push(['goto', target]); currentUrl = target; },
    locator: selector => (calls.push(['locator', selector]), locator),
    evaluate: async (_fn, selector) => {
      calls.push(['evaluate', selector]);
      if (selector === 'div[') throw new SyntaxError('bad selector token=do-not-log');
      return true;
    },
    waitForTimeout: async ms => calls.push(['waitForTimeout', ms]),
    keyPress: async key => calls.push(['keyPress', key]),
  };
  const stagehand = {
    calls,
    page,
    context: { awaitActivePage: async () => page },
    observe: async instruction => (calls.push(['observe', instruction]), [{ selector: 'button' }]),
    act: async (instruction, options) => (calls.push(['act', instruction, options]), { success: true }),
    agent: options => ({
      execute: async request => {
        calls.push(['agent', options, request.maxSteps]);
        await request.callbacks.onStepFinish({ toolCalls: [{ toolName: 'act' }] });
        return { success: true, message: 'done', actions: [] };
      },
    }),
    close: async () => calls.push(['close']),
  };
  return stagehand;
}

test('uses deterministic Stagehand page locators without observe', async () => {
  const fake = createFakeStagehand();
  const session = createSession({ stagehand: fake, allowedOrigins: ['https://test.example'] });

  await session.execute({ action: 'click', locator: { kind: 'role', value: 'button', name: 'Submit' } });

  assert.equal(fake.calls.filter(([name]) => name === 'locator').length, 1);
  assert.match(fake.calls.find(([name]) => name === 'locator')[1], /^xpath=/);
  assert.equal(fake.calls.filter(([name]) => name === 'observe').length, 0);
});

test('validates css with the browser native selector parser before using it', async () => {
  const fake = createFakeStagehand();
  const session = createSession({ stagehand: fake, allowedOrigins: ['https://test.example'] });

  await assert.rejects(
    () => session.execute({ action: 'click', locator: { kind: 'css', value: 'div[' } }),
    error => error.code === 'INVALID_CSS_LOCATOR' && !error.message.includes('do-not-log'),
  );
  assert.equal(fake.calls.filter(([name]) => name === 'locator').length, 0);
});

test('checks navigation targets and catches origin drift after semantic actions', async () => {
  const fake = createFakeStagehand();
  const session = createSession({ stagehand: fake, allowedOrigins: ['https://test.example'] });

  await assert.rejects(
    () => session.execute({ action: 'navigate', url: 'https://blocked.example/path' }),
    error => error.code === 'ORIGIN_NOT_ALLOWED',
  );

  fake.act = async () => {
    fake.page.goto('https://blocked.example/drift');
    return { success: true };
  };
  await assert.rejects(
    () => session.act({ instruction: 'Click once', timeoutMs: 1000 }),
    error => error.code === 'ORIGIN_NOT_ALLOWED',
  );
});

test('bounds agent execution and emits only structural progress', async () => {
  const fake = createFakeStagehand();
  const events = [];
  const session = createSession({ stagehand: fake, allowedOrigins: ['https://test.example'], emit: event => events.push(event) });

  await assert.rejects(
    () => session.agent({ goal: 'Complete approval', maxActions: 21, timeoutMs: 1000 }),
    error => error.code === 'AGENT_BOUND_EXCEEDED',
  );
  const result = await session.agent({ goal: 'Complete approval', maxActions: 2, timeoutMs: 1000 });
  assert.equal(result.success, true);
  assert.deepEqual(events, [{ phase: 'agent_step', action: 1, tools: ['act'] }]);
  assert.equal(fake.calls.find(([name]) => name === 'agent')[2], 2);
});

test('worker emits one terminal response per request and closes on terminate', async () => {
  const fake = createFakeStagehand();
  const input = Readable.from([
    '{"id":"s1","command":"self_check"}\n',
    '{"id":"t1","command":"terminate"}\n',
  ]);
  const output = new PassThrough();
  let raw = '';
  output.on('data', chunk => { raw += chunk; });

  await runWorker({ input, output, diagnostics: new PassThrough(), stagehand: fake });

  const lines = raw.trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(line => line.id), ['s1', 't1']);
  assert.equal(lines.every(line => line.ok), true);
  assert.equal(fake.calls.filter(([name]) => name === 'close').length, 1);
});

test('worker closes on EOF and never leaks rejected secret input', async () => {
  const fake = createFakeStagehand();
  const input = Readable.from([
    '{"id":"bad","command":"act","instruction":"password=hunter2","allowedOrigins":["https://test.example"],"timeoutMs":1000}\n',
  ]);
  const output = new PassThrough();
  const diagnostics = new PassThrough();
  let raw = '';
  let stderr = '';
  output.on('data', chunk => { raw += chunk; });
  diagnostics.on('data', chunk => { stderr += chunk; });

  await runWorker({ input, output, diagnostics, stagehand: fake });

  assert.doesNotMatch(raw + stderr, /hunter2/);
  assert.equal(raw.trim().split('\n').length, 1);
  assert.equal(JSON.parse(raw).error.category, 'invalid_request');
  assert.equal(fake.calls.filter(([name]) => name === 'close').length, 1);
});
