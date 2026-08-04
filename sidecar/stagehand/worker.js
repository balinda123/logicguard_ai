#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { ValidationError } = require('./compiler');
const { errorEnvelope, normalizeOrigin, parseRequest, sanitizeMessage, successEnvelope } = require('./protocol');
const { SessionError, createSession } = require('./session');

function parseConfiguredOrigins(raw = process.env.LOGICGUARD_ALLOWED_ORIGINS) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(normalizeOrigin) : [];
  } catch {
    throw new SessionError('INVALID_WORKER_ORIGINS');
  }
}

function modelConfiguration(env) {
  const provider = env.LLM_PROVIDER === 'gemini' ? 'google' : 'deepseek';
  const modelName = `${provider}/${env.LLM_MODEL || 'deepseek-chat'}`;
  const clientOptions = {};
  if (env.LLM_API_KEY) clientOptions.apiKey = env.LLM_API_KEY;
  if (env.LLM_BASE_URL) clientOptions.baseURL = env.LLM_BASE_URL.replace(/\/+$/, '');
  return { modelName, ...clientOptions };
}

async function createLocalStagehand({
  env = process.env,
  loadStagehand = () => import('@browserbasehq/stagehand'),
} = {}) {
  const cdpUrl = env.LOGICGUARD_CDP_URL;
  if (!cdpUrl) throw new SessionError('MISSING_CDP_URL');
  const module = await loadStagehand();
  const Stagehand = module.Stagehand || module.default?.Stagehand;
  if (typeof Stagehand !== 'function') throw new SessionError('STAGEHAND_UNAVAILABLE');
  const stagehand = new Stagehand({
    env: 'LOCAL',
    localBrowserLaunchOptions: { cdpUrl },
    model: modelConfiguration(env),
    disableAPI: true,
  });
  await stagehand.init();
  return stagehand;
}

function categoryFor(error) {
  if (error instanceof ValidationError) return 'invalid_request';
  if (error && ['INVALID_CSS_LOCATOR', 'INVALID_WORKER_ORIGINS'].includes(error.code)) return 'invalid_request';
  if (error && ['ORIGIN_NOT_ALLOWED', 'AGENT_BOUND_EXCEEDED'].includes(error.code)) return 'blocked';
  if (error && ['ASSERTION_FAILED', 'WAIT_TARGET_NOT_VISIBLE', 'ACT_FAILED', 'AGENT_FAILED'].includes(error.code)) {
    return 'business_failed';
  }
  if (error && (
    error.code === 'REQUEST_TIMEOUT' ||
    error.name === 'AbortError' ||
    /timeout/i.test(String(error.name || error.code || ''))
  )) return 'cancelled';
  return 'interrupted';
}

function requestId(line) {
  try {
    const value = JSON.parse(line);
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    return id && id.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(id) && !/(password|token|otp|secret|credential)/i.test(id)
      ? id
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function writeLine(output, value) {
  output.write(`${JSON.stringify(value)}\n`);
}

async function dispatch(session, request) {
  if (request.command === 'execute') return session.execute(request.step);
  if (request.command === 'observe') return session.observe(request);
  if (request.command === 'act') return session.act(request);
  if (request.command === 'agent') return session.agent(request);
  if (request.command === 'self_check') return { stagehand: true, persistent: true };
  if (request.command === 'terminate') return { terminated: true };
  throw new SessionError('UNKNOWN_COMMAND');
}

async function runWorker({
  input = process.stdin,
  output = process.stdout,
  diagnostics = process.stderr,
  stagehand,
  createStagehand = createLocalStagehand,
  allowedOrigins,
} = {}) {
  const instance = stagehand || await createStagehand();
  const configuredOrigins = allowedOrigins || parseConfiguredOrigins();
  let activeId = null;
  const baseSession = createSession({ stagehand: instance, allowedOrigins: configuredOrigins });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      activeId = requestId(line);
      let request;
      try {
        request = parseRequest(line);
        const origins = request.allowedOrigins || configuredOrigins;
        const session = createSession({
          stagehand: instance,
          allowedOrigins: origins,
          emit: data => writeLine(output, { id: request.id, event: 'progress', data }),
        });
        const data = await dispatch(session, request);
        writeLine(output, successEnvelope(request.id, data));
        if (request.command === 'terminate') break;
      } catch (error) {
        const id = request ? request.id : activeId;
        writeLine(output, errorEnvelope(id, categoryFor(error), error));
        diagnostics.write(`[stagehand-worker] ${sanitizeMessage(error && error.code ? error.code : 'REQUEST_FAILED')}\n`);
      } finally {
        activeId = null;
      }
    }
  } finally {
    lines.close();
    await baseSession.close().catch(error => {
      diagnostics.write(`[stagehand-worker] close: ${sanitizeMessage(error && error.code ? error.code : 'CLOSE_FAILED')}\n`);
    });
  }
}

async function main() {
  if (process.argv.includes('--self-check')) {
    writeLine(process.stdout, { ok: true, stagehand: true });
    return;
  }
  await runWorker();
}

if (require.main === module) {
  main().catch(error => {
    writeLine(process.stdout, errorEnvelope('worker', categoryFor(error), error));
    process.stderr.write(`[stagehand-worker] ${sanitizeMessage(error && error.code ? error.code : 'START_FAILED')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  categoryFor,
  createLocalStagehand,
  main,
  runWorker,
};
