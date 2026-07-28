const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearBrowserSession,
  parseBrowserLoginPayload,
  safeScreenshotPath,
} = require('./session');

test('parses a complete automatic-login payload without returning its raw JSON', () => {
  const payload = parseBrowserLoginPayload(JSON.stringify({
    loginUrl: 'https://example.test/login',
    usernameSelector: '#username',
    passwordSelector: '#password',
    submitSelector: '#submit',
    username: 'employee-a',
    password: 'test-password',
  }));

  assert.equal(payload.loginUrl, 'https://example.test/login');
  assert.equal(payload.usernameSelector, '#username');
  assert.equal(payload.passwordSelector, '#password');
  assert.equal(payload.submitSelector, '#submit');
  assert.equal(payload.username, 'employee-a');
  assert.equal(payload.password, 'test-password');
});

test('rejects incomplete credential payloads and unsafe screenshot paths', () => {
  assert.throws(() => parseBrowserLoginPayload('{"loginUrl":"https://example.test/login"}'));
  assert.throws(() => safeScreenshotPath(''));
  assert.throws(() => safeScreenshotPath('../evidence.png'));
  assert.equal(safeScreenshotPath('C:\\app-data\\failure-evidence\\run-1\\step-1.png'), 'C:\\app-data\\failure-evidence\\run-1\\step-1.png');
});

test('clears cookies and page storage before returning to a blank page', async () => {
  const evaluations = [];
  const page = {
    evaluate: async callback => {
      evaluations.push(callback);
    },
    goto: async (url, options) => {
      assert.equal(url, 'about:blank');
      assert.deepEqual(options, { waitUntil: 'commit' });
    },
  };
  const context = {
    clearCookies: async () => {},
    pages: () => [page],
  };

  await clearBrowserSession(context, page);
  assert.equal(evaluations.length, 1);
});
