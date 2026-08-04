'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { runLoginWorker } = require('../stagehand/login-worker');

function fakeStagehand() {
  const calls = [];
  const page = {
    url: () => 'https://example.test/home',
    goto: async url => calls.push(['goto', url]),
    evaluate: async (_callback, selector) => calls.push(['validate', selector]),
    locator: selector => ({ isVisible: async () => true, fill: async value => calls.push(['fill', selector, value]), click: async () => calls.push(['click', selector]) }),
    waitForTimeout: async () => {},
  };
  return { calls, context: { awaitActivePage: async () => page }, close: async () => calls.push(['close']) };
}

test('isolated login reads credentials only from environment and returns no secret', async () => {
  const stagehand = fakeStagehand();
  const env = { LOGICGUARD_LOGIN_PAYLOAD: JSON.stringify({ allowedOrigin: 'https://example.test', loginUrl: 'https://example.test/login', identityLocator: '#user', privateLocator: '#private', submitLocator: '#submit', successLocator: '#home', username: 'employee-a', password: 'temporary-value' }) };
  const output = new PassThrough();
  let raw = '';
  output.on('data', chunk => { raw += chunk; });
  await runLoginWorker({ env, stagehand, output });
  assert.equal(env.LOGICGUARD_LOGIN_PAYLOAD, undefined);
  assert.equal(JSON.parse(raw).ok, true);
  assert.doesNotMatch(raw, /employee-a|temporary-value/);
});

test('verification uses only the success locator', async () => {
  const stagehand = fakeStagehand();
  const env = { LOGICGUARD_LOGIN_MODE: 'verify', LOGICGUARD_LOGIN_PAYLOAD: JSON.stringify({ allowedOrigin: 'https://example.test', loginUrl: 'https://example.test/login', successLocator: '#home' }) };
  const output = new PassThrough();
  let raw = '';
  output.on('data', chunk => { raw += chunk; });
  await runLoginWorker({ env, stagehand, output });
  assert.equal(JSON.parse(raw).data.status, 'verified');
  assert.equal(stagehand.calls.some(([name]) => name === 'fill'), false);
});
