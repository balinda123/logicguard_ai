'use strict';

const {
  ValidationError,
  compileStep,
  deepFreeze,
  rejectSecrets,
} = require('./compiler');

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 300000;
const MAX_TEXT_LENGTH = 4096;
const MAX_ORIGINS = 20;
const COMMAND_VALUES = Object.freeze([
  'execute', 'observe', 'act', 'agent', 'set_control_marker', 'remove_control_marker',
  'assert_page', 'capture_requirement', 'terminate', 'self_check',
]);
const ERROR_CATEGORY_VALUES = Object.freeze([
  'invalid_request',
  'blocked',
  'business_failed',
  'cancelled',
  'interrupted',
]);
const COMMANDS = new Set(COMMAND_VALUES);
const ERROR_CATEGORIES = new Set(ERROR_CATEGORY_VALUES);

function fail(code) {
  throw new ValidationError(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, code, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(code);
  const normalized = value.trim();
  if (normalized.length > maxLength) fail(`${code}_TOO_LONG`);
  return normalized;
}

function assertKnownFields(value, fields) {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) fail('UNKNOWN_REQUEST_FIELD');
  }
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) fail('INVALID_ALLOWED_ORIGIN');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_ALLOWED_ORIGIN');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const isAllowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && localHosts.has(url.hostname));
  if (
    !isAllowedProtocol ||
    url.origin === 'null' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    fail('INVALID_ALLOWED_ORIGIN');
  }
  return url.origin;
}

function normalizeOrigins(value) {
  if (!Array.isArray(value) || value.length < 1) fail('MISSING_ALLOWED_ORIGINS');
  if (value.length > MAX_ORIGINS) fail('TOO_MANY_ALLOWED_ORIGINS');
  return [...new Set(value.map(normalizeOrigin))];
}

function normalizeTimeout(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) fail('INVALID_TIMEOUT_MS');
  return value;
}

const REQUEST_FIELDS = Object.freeze({
  execute: new Set(['id', 'command', 'step', 'allowedOrigins', 'timeoutMs']),
  observe: new Set(['id', 'command', 'instruction']),
  act: new Set(['id', 'command', 'instruction', 'fallbackGoal', 'maxActions', 'allowedOrigins', 'timeoutMs']),
  agent: new Set(['id', 'command', 'goal', 'allowedOrigins', 'maxActions', 'timeoutMs']),
  assert_page: new Set(['id', 'command', 'assertions', 'allowedOrigins', 'timeoutMs']),
  capture_requirement: new Set(['id', 'command', 'url', 'keyword', 'aiMatch', 'allowedOrigins']),
  set_control_marker: new Set(['id', 'command', 'marker']),
  remove_control_marker: new Set(['id', 'command']),
  terminate: new Set(['id', 'command']),
  self_check: new Set(['id', 'command']),
});

function parseRequest(line) {
  if (typeof line !== 'string') fail('INVALID_REQUEST_LINE');
  if (Buffer.byteLength(line, 'utf8') > MAX_PAYLOAD_BYTES) fail('PAYLOAD_TOO_LARGE');

  const jsonLine = line.replace(/\r?\n$/, '');
  if (/[\r\n]/.test(jsonLine)) fail('MULTILINE_REQUEST');

  let input;
  try {
    input = JSON.parse(jsonLine);
  } catch {
    fail('INVALID_JSON');
  }
  if (!isPlainObject(input)) fail('REQUEST_MUST_BE_OBJECT');
  rejectSecrets(input);
  if (!COMMAND_VALUES.includes(input.command)) fail('UNKNOWN_COMMAND');
  assertKnownFields(input, REQUEST_FIELDS[input.command]);

  const request = {
    id: requiredString(input.id, 'INVALID_REQUEST_ID', 128),
    command: input.command,
  };
  if (input.command === 'execute') {
    request.step = compileStep(input.step);
    request.allowedOrigins = normalizeOrigins(input.allowedOrigins);
    request.timeoutMs = normalizeTimeout(input.timeoutMs);
  } else if (input.command === 'observe') {
    request.instruction = requiredString(input.instruction, 'INVALID_INSTRUCTION');
  } else if (input.command === 'act') {
    request.instruction = requiredString(input.instruction, 'INVALID_INSTRUCTION');
    if (input.fallbackGoal !== undefined) {
      request.fallbackGoal = requiredString(input.fallbackGoal, 'INVALID_FALLBACK_GOAL');
      if (!Number.isInteger(input.maxActions) || input.maxActions < 1 || input.maxActions > 8) fail('INVALID_MAX_ACTIONS');
      request.maxActions = input.maxActions;
    } else if (input.maxActions !== undefined) {
      fail('UNKNOWN_REQUEST_FIELD');
    }
    request.allowedOrigins = normalizeOrigins(input.allowedOrigins);
    request.timeoutMs = normalizeTimeout(input.timeoutMs);
  } else if (input.command === 'agent') {
    request.goal = requiredString(input.goal, 'INVALID_GOAL');
    request.allowedOrigins = normalizeOrigins(input.allowedOrigins);
    if (!Number.isInteger(input.maxActions) || input.maxActions < 1 || input.maxActions > 20) {
      fail('INVALID_MAX_ACTIONS');
    }
    request.maxActions = input.maxActions;
    request.timeoutMs = normalizeTimeout(input.timeoutMs);
  } else if (input.command === 'assert_page') {
    if (!Array.isArray(input.assertions) || input.assertions.length < 1 || input.assertions.length > 8) {
      fail('INVALID_PAGE_ASSERTIONS');
    }
    request.assertions = input.assertions.map(assertion => {
      if (!isPlainObject(assertion)) fail('INVALID_PAGE_ASSERTION');
      assertKnownFields(assertion, new Set(['type', 'expected']));
      if (!['text_contains', 'text_absent', 'url_contains'].includes(assertion.type)) fail('INVALID_PAGE_ASSERTION_TYPE');
      return {
        type: assertion.type,
        expected: requiredString(assertion.expected, 'INVALID_PAGE_ASSERTION_EXPECTED', 500),
      };
    });
    request.allowedOrigins = normalizeOrigins(input.allowedOrigins);
    request.timeoutMs = normalizeTimeout(input.timeoutMs);
  } else if (input.command === 'capture_requirement') {
    request.url = requiredString(input.url, 'INVALID_REQUIREMENT_URL');
    request.keyword = typeof input.keyword === 'string' ? input.keyword.trim().slice(0, MAX_TEXT_LENGTH) : '';
    if (input.aiMatch !== undefined && typeof input.aiMatch !== 'boolean') fail('INVALID_AI_MATCH');
    request.aiMatch = input.aiMatch === true;
    request.allowedOrigins = normalizeOrigins(input.allowedOrigins);
  } else if (input.command === 'set_control_marker') {
    if (!isPlainObject(input.marker)) fail('INVALID_CONTROL_MARKER');
    assertKnownFields(input.marker, new Set(['system', 'environment', 'run', 'currentStep']));
    if (!Number.isInteger(input.marker.currentStep) || input.marker.currentStep < 0 || input.marker.currentStep > 500) {
      fail('INVALID_CONTROL_MARKER_STEP');
    }
    request.marker = {
      system: requiredString(input.marker.system, 'INVALID_CONTROL_MARKER_SYSTEM', 128),
      environment: requiredString(input.marker.environment, 'INVALID_CONTROL_MARKER_ENVIRONMENT', 128),
      run: requiredString(input.marker.run, 'INVALID_CONTROL_MARKER_RUN', 128),
      currentStep: input.marker.currentStep,
    };
  }
  return deepFreeze(request);
}

function sanitizeMessage(message) {
  let safe = typeof message === 'string' && message.trim() ? message : 'Request failed';
  safe = safe
    .replace(/\{\{[^}]*?(?:password|token|otp|secret)[^}]*\}\}|\$\{[^}]*?(?:password|token|otp|secret)[^}]*\}/gi, '[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|token|otp|secret|credential)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 1024);
  return safe;
}

function normalizeEnvelopeId(id) {
  return requiredString(id, 'INVALID_REQUEST_ID', 128);
}

function successEnvelope(id, data) {
  return deepFreeze({ id: normalizeEnvelopeId(id), ok: true, data });
}

function errorEnvelope(id, category, error) {
  if (!ERROR_CATEGORY_VALUES.includes(category)) fail('INVALID_ERROR_CATEGORY');
  const code = error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : 'REQUEST_FAILED';
  const message = error && typeof error.message === 'string' ? error.message : String(error || 'Request failed');
  return deepFreeze({
    id: normalizeEnvelopeId(id),
    ok: false,
    error: { category, code, message: sanitizeMessage(message) },
  });
}

module.exports = {
  COMMANDS,
  ERROR_CATEGORIES,
  MAX_PAYLOAD_BYTES,
  MAX_TIMEOUT_MS,
  errorEnvelope,
  normalizeOrigin,
  parseRequest,
  sanitizeMessage,
  successEnvelope,
};
