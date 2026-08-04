const test = require('node:test');
const assert = require('node:assert/strict');

const { ACTIONS, LOCATORS, compileStep } = require('../stagehand/compiler');

test('exposes the closed action and locator model', () => {
  assert.deepEqual([...ACTIONS], ['navigate', 'click', 'fill', 'select', 'press', 'wait', 'read', 'assert']);
  assert.deepEqual([...LOCATORS], ['role', 'label', 'text', 'placeholder', 'testId', 'css']);
});

test('normalizes and deeply freezes semantic locator steps', () => {
  const step = compileStep({
    action: 'click',
    locator: { kind: 'role', value: ' button ', name: ' 提交 ', exact: true },
  });

  assert.deepEqual(step, {
    action: 'click',
    locator: { kind: 'role', value: 'button', name: '提交', exact: true },
  });
  assert.equal(Object.isFrozen(step), true);
  assert.equal(Object.isFrozen(step.locator), true);
});

test('rejects Chinese text masquerading as css and unsafe selector syntax', () => {
  for (const value of ['我的试用期', 'div:has(form)', 'a, iframe', 'div { color: red }', '[name="open"']) {
    assert.throws(
      () => compileStep({ action: 'click', locator: { kind: 'css', value } }),
      error => error.code === 'INVALID_CSS_LOCATOR',
    );
  }
});

test('accepts structurally safe css for browser-native validation later', () => {
  const step = compileStep({
    action: 'click',
    locator: { kind: 'css', value: ' form#trial button[type="submit"] ' },
  });
  assert.equal(step.locator.value, 'form#trial button[type="submit"]');
});

test('rejects secret placeholders and credential-shaped keys before compilation', () => {
  for (const value of ['{{employeePassword}}', '${PASSWORD}', '{{one_time_otp}}', '${accessToken}', '{{clientSecret}}']) {
    assert.throws(
      () => compileStep({ action: 'fill', locator: { kind: 'label', value: '账号' }, value }),
      error => error.code === 'SECRET_PLACEHOLDER',
    );
  }
  assert.throws(
    () => compileStep({ action: 'click', locator: { kind: 'text', value: '继续' }, credentialHint: 'x' }),
    error => error.code === 'SECRET_FIELD',
  );
  assert.throws(
    () => compileStep({ action: 'fill', locator: { kind: 'label', value: '账号' }, value: 'plain accessToken value' }),
    error => error.code === 'SECRET_VALUE',
  );
});

test('rejects unknown fields, actions, locators, empty values, long values, and invalid bounds', () => {
  assert.throws(() => compileStep({ action: 'hover', locator: { kind: 'text', value: '提交' } }), /UNKNOWN_ACTION/);
  assert.throws(() => compileStep({ action: 'click', locator: { kind: 'xpath', value: '//button' } }), /UNKNOWN_LOCATOR/);
  assert.throws(() => compileStep({ action: 'click', locator: { kind: 'text', value: '提交', nth: 1 } }), /UNKNOWN_LOCATOR_FIELD/);
  assert.throws(() => compileStep({ action: 'click', locator: { kind: 'text', value: '   ' } }), /EMPTY_LOCATOR_VALUE/);
  assert.throws(() => compileStep({ action: 'fill', locator: { kind: 'label', value: '姓名' }, value: 'x'.repeat(4097) }), /VALUE_TOO_LONG/);
  assert.throws(() => compileStep({ action: 'wait', durationMs: 0 }), /INVALID_DURATION_MS/);
  assert.throws(() => compileStep({ action: 'wait', durationMs: 60001 }), /INVALID_DURATION_MS/);
  assert.throws(() => compileStep({ action: 'click', locator: { kind: 'text', value: '提交' }, timeoutMs: 10 }), /UNKNOWN_STEP_FIELD/);
});

test('normalizes navigate, keyboard, wait, read, and assert actions', () => {
  assert.equal(compileStep({ action: 'navigate', url: 'https://Example.test:443/path' }).url, 'https://example.test/path');
  assert.deepEqual(compileStep({ action: 'press', key: ' Enter ' }), { action: 'press', key: 'Enter' });
  assert.deepEqual(compileStep({ action: 'wait', durationMs: 250 }), { action: 'wait', durationMs: 250 });
  assert.equal(compileStep({ action: 'read', locator: { kind: 'testId', value: 'summary' } }).action, 'read');
  assert.equal(compileStep({ action: 'assert', locator: { kind: 'text', value: '完成' }, condition: 'visible' }).condition, 'visible');
});
