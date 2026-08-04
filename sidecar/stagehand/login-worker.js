#!/usr/bin/env node
'use strict';

const { createLocalStagehand } = require('./worker');
const { executeCredentialLogin, verifyCredentialLogin } = require('./session');

const ALLOWED_FIELDS = new Set([
  'allowedOrigin', 'loginUrl', 'pageLocator', 'identityLocator', 'privateLocator',
  'submitLocator', 'successLocator', 'username', 'password',
]);

function parsePayload(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error('INVALID_LOGIN_PAYLOAD'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('INVALID_LOGIN_PAYLOAD');
  if (Object.keys(payload).some(key => !ALLOWED_FIELDS.has(key))) throw new Error('INVALID_LOGIN_PAYLOAD');
  return payload;
}

function clearPayload(payload) {
  if (!payload) return;
  for (const key of Object.keys(payload)) payload[key] = '';
}

async function runLoginWorker({ env = process.env, stagehand, output = process.stdout } = {}) {
  const raw = env.LOGICGUARD_LOGIN_PAYLOAD;
  delete env.LOGICGUARD_LOGIN_PAYLOAD;
  if (!raw) throw new Error('MISSING_LOGIN_PAYLOAD');
  const mode = env.LOGICGUARD_LOGIN_MODE === 'verify' ? 'verify' : 'login';
  const payload = parsePayload(raw);
  let instance;
  try {
    instance = stagehand || await createLocalStagehand({ env });
    const data = mode === 'verify'
      ? await verifyCredentialLogin(instance, payload)
      : await executeCredentialLogin(instance, payload);
    output.write(`${JSON.stringify({ ok: true, data })}\n`);
  } finally {
    clearPayload(payload);
    if (instance) await instance.close();
  }
}

if (require.main === module) {
  runLoginWorker().catch(error => {
    const raw = String(error && (error.code || error.message) || 'LOGIN_WORKER_FAILED');
    const code = /^[A-Z0-9_]{1,64}$/.test(raw) ? raw : 'LOGIN_WORKER_FAILED';
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code } })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { clearPayload, parsePayload, runLoginWorker };
