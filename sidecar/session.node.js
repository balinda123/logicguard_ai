const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearBrowserSession,
  loginWithCredentials,
  parseBrowserLoginPayload,
  resolveLoginLocator,
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

test('accepts an automatic-login payload without optional selectors', () => {
  const payload = parseBrowserLoginPayload(JSON.stringify({
    loginUrl: 'https://example.test/login',
    username: 'employee-a',
    password: 'test-password',
  }));

  assert.equal(payload.usernameSelector, undefined);
  assert.equal(payload.passwordSelector, undefined);
  assert.equal(payload.submitSelector, undefined);
});

function fakePage(visibleSelectors) {
  const calls = [];
  const page = {
    frames: () => [page],
    locator: selector => ({
      count: async () => visibleSelectors.has(selector) ? 1 : 0,
      first: () => ({
        isVisible: async () => visibleSelectors.has(selector),
        fill: async value => calls.push(['fill', selector, value]),
        click: async () => calls.push(['click', selector]),
      }),
    }),
  };
  return { page, calls };
}

test('uses a visible manual selector before local candidates or AI', async () => {
  const { page } = fakePage(new Set(['#manual-user', '[autocomplete="username"]']));
  let aiCalls = 0;

  const locator = await resolveLoginLocator(page, {
    kind: 'username',
    manualSelector: '#manual-user',
    aiResolver: async () => { aiCalls += 1; return '#ai-user'; },
  });

  assert.equal(locator.selector, '#manual-user');
  assert.equal(aiCalls, 0);
});

test('uses local semantic selectors and only falls back to AI after they fail', async () => {
  const local = fakePage(new Set(['[autocomplete="username"]']));
  let aiCalls = 0;
  const localLocator = await resolveLoginLocator(local.page, {
    kind: 'username',
    aiResolver: async () => { aiCalls += 1; return '#ai-user'; },
  });
  assert.equal(localLocator.selector, '[autocomplete="username"]');
  assert.equal(aiCalls, 0);

  const ai = fakePage(new Set(['#ai-user']));
  const aiLocator = await resolveLoginLocator(ai.page, {
    kind: 'username',
    aiResolver: async kind => { aiCalls += 1; assert.equal(kind, 'username'); return '#ai-user'; },
  });
  assert.equal(aiLocator.selector, '#ai-user');
  assert.equal(aiCalls, 1);
});

test('fills credentials locally after resolving login controls', async () => {
  const { page, calls } = fakePage(new Set([
    '[autocomplete="username"]',
    '[autocomplete="current-password"]',
    'button[type="submit"]',
  ]));
  page.goto = async () => {};
  page.url = () => 'https://example.test/home';

  await loginWithCredentials(page, {
    loginUrl: 'https://example.test/login',
    username: 'employee-a',
    password: 'test-password',
  });

  assert.deepEqual(calls, [
    ['fill', '[autocomplete="username"]', 'employee-a'],
    ['fill', '[autocomplete="current-password"]', 'test-password'],
    ['click', 'button[type="submit"]'],
  ]);
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
