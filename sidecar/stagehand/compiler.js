'use strict';

const ACTION_VALUES = Object.freeze(['navigate', 'click', 'fill', 'select', 'press', 'wait', 'read', 'assert']);
const LOCATOR_VALUES = Object.freeze(['role', 'label', 'text', 'placeholder', 'testId', 'css']);
const ACTIONS = new Set(ACTION_VALUES);
const LOCATORS = new Set(LOCATOR_VALUES);
const SECRET_PATTERN = /\{\{[^}]*?(password|token|otp|secret)[^}]*\}\}|\$\{[^}]*?(password|token|otp|secret)[^}]*\}/i;
const SECRET_KEY_PATTERN = /(password|token|otp|secret|credential)/i;
const SECRET_VALUE_PATTERN = /(password|token|otp|secret|credential)/i;

const MAX_VALUE_LENGTH = 4096;
const MAX_LOCATOR_LENGTH = 1024;
const MAX_NAME_LENGTH = 512;
const MAX_URL_LENGTH = 2048;
const MAX_WAIT_MS = 60000;

class ValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ValidationError';
    this.code = code;
  }
}

function fail(code) {
  throw new ValidationError(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function rejectSecrets(value) {
  if (typeof value === 'string') {
    if (SECRET_PATTERN.test(value)) fail('SECRET_PLACEHOLDER');
    if (SECRET_VALUE_PATTERN.test(value)) fail('SECRET_VALUE');
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) fail('SECRET_FIELD');
    rejectSecrets(child);
  }
}

function requireString(value, code, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(code);
  const normalized = value.trim();
  if (normalized.length > maxLength) fail(code.replace(/^EMPTY_/, '').replace(/^INVALID_/, '') + '_TOO_LONG');
  return normalized;
}

function assertKnownFields(value, allowed, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code);
  }
}

function hasBalancedCssStructure(selector) {
  let quote = null;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;

  for (const character of selector) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets -= 1;
    } else if (character === '(') {
      parentheses += 1;
    } else if (character === ')') {
      parentheses -= 1;
    }
    if (brackets < 0 || parentheses < 0) return false;
  }

  return !quote && !escaped && brackets === 0 && parentheses === 0;
}

// This is deliberately a conservative preflight, not a complete CSS parser.
function validateCssLocator(selector) {
  if (
    /[\u0000-\u001f\u007f]/.test(selector) ||
    /[,{};@]|::|\/\//.test(selector) ||
    !hasBalancedCssStructure(selector)
  ) {
    fail('INVALID_CSS_LOCATOR');
  }

  let quote = null;
  let escaped = false;
  for (const character of selector) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character.charCodeAt(0) > 127) {
      fail('INVALID_CSS_LOCATOR');
    }
  }

  const safePseudoClasses = new Set([
    'checked', 'disabled', 'enabled', 'first-child', 'last-child', 'nth-child',
  ]);
  for (const match of selector.matchAll(/:([a-z-]+)/gi)) {
    if (!safePseudoClasses.has(match[1].toLowerCase())) fail('INVALID_CSS_LOCATOR');
  }

  if (/:(?:has|is|where|not)\s*\(/i.test(selector)) fail('INVALID_CSS_LOCATOR');
  return selector;
}

function compileLocator(locator) {
  if (!isPlainObject(locator)) fail('INVALID_LOCATOR');
  assertKnownFields(locator, new Set(['kind', 'value', 'name', 'exact']), 'UNKNOWN_LOCATOR_FIELD');
  if (!LOCATOR_VALUES.includes(locator.kind)) fail('UNKNOWN_LOCATOR');

  const compiled = {
    kind: locator.kind,
    value: requireString(locator.value, 'EMPTY_LOCATOR_VALUE', MAX_LOCATOR_LENGTH),
  };
  if (locator.kind === 'css') validateCssLocator(compiled.value);

  if (locator.name !== undefined) {
    if (locator.kind !== 'role') fail('UNKNOWN_LOCATOR_FIELD');
    compiled.name = requireString(locator.name, 'EMPTY_LOCATOR_NAME', MAX_NAME_LENGTH);
  }
  if (locator.exact !== undefined) {
    if (locator.kind === 'css' || typeof locator.exact !== 'boolean') fail('INVALID_LOCATOR_EXACT');
    compiled.exact = locator.exact;
  }
  return compiled;
}

function compileUrl(value) {
  const raw = requireString(value, 'INVALID_URL', MAX_URL_LENGTH);
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('INVALID_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('INVALID_URL');
  return url.href;
}

const STEP_FIELDS = Object.freeze({
  navigate: new Set(['action', 'url']),
  click: new Set(['action', 'locator']),
  fill: new Set(['action', 'locator', 'value']),
  select: new Set(['action', 'locator', 'value']),
  press: new Set(['action', 'locator', 'key']),
  wait: new Set(['action', 'locator', 'durationMs']),
  read: new Set(['action', 'locator']),
  assert: new Set(['action', 'locator', 'condition', 'expected']),
});

function compileStep(step) {
  if (!isPlainObject(step)) fail('INVALID_STEP');
  rejectSecrets(step);
  if (!ACTION_VALUES.includes(step.action)) fail('UNKNOWN_ACTION');
  assertKnownFields(step, STEP_FIELDS[step.action], 'UNKNOWN_STEP_FIELD');

  const compiled = { action: step.action };
  if (step.action === 'navigate') {
    compiled.url = compileUrl(step.url);
  } else if (step.action === 'press') {
    if (step.locator !== undefined) compiled.locator = compileLocator(step.locator);
    compiled.key = requireString(step.key, 'INVALID_KEY', 64);
  } else if (step.action === 'wait') {
    const hasLocator = step.locator !== undefined;
    const hasDuration = step.durationMs !== undefined;
    if (hasLocator === hasDuration) fail('INVALID_WAIT_TARGET');
    if (hasLocator) compiled.locator = compileLocator(step.locator);
    if (hasDuration) {
      if (!Number.isInteger(step.durationMs) || step.durationMs < 1 || step.durationMs > MAX_WAIT_MS) {
        fail('INVALID_DURATION_MS');
      }
      compiled.durationMs = step.durationMs;
    }
  } else {
    compiled.locator = compileLocator(step.locator);
    if (step.action === 'fill' || step.action === 'select') {
      compiled.value = requireString(step.value, 'EMPTY_VALUE', MAX_VALUE_LENGTH);
    }
    if (step.action === 'assert') {
      const conditions = new Set(['visible', 'hidden', 'equals', 'contains']);
      if (!conditions.has(step.condition)) fail('INVALID_ASSERT_CONDITION');
      compiled.condition = step.condition;
      if (step.condition === 'equals' || step.condition === 'contains') {
        compiled.expected = requireString(step.expected, 'EMPTY_EXPECTED', MAX_VALUE_LENGTH);
      } else if (step.expected !== undefined) {
        fail('UNKNOWN_STEP_FIELD');
      }
    }
  }

  return deepFreeze(compiled);
}

module.exports = {
  ACTIONS,
  LOCATORS,
  SECRET_KEY_PATTERN,
  SECRET_PATTERN,
  SECRET_VALUE_PATTERN,
  ValidationError,
  compileStep,
  deepFreeze,
  rejectSecrets,
  validateCssLocator,
};
