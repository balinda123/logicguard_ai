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
  const provider = env.LLM_PROVIDER === 'gemini'
    ? 'google'
    : env.LLM_PROVIDER === 'openai_compat'
      ? 'openai'
      : 'deepseek';
  const modelName = `${provider}/${env.LLM_MODEL || 'deepseek-chat'}`;
  const clientOptions = {};
  if (env.LLM_API_KEY) clientOptions.apiKey = env.LLM_API_KEY;
  if (env.LLM_BASE_URL) clientOptions.baseURL = env.LLM_BASE_URL.replace(/\/+$/, '');
  return { modelName, ...clientOptions };
}

async function resolveCdpWebSocketUrl(cdpUrl, fetchImpl = fetch) {
  let parsed;
  try { parsed = new URL(cdpUrl); } catch { throw new SessionError('INVALID_CDP_URL'); }
  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') return parsed.toString();
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new SessionError('INVALID_CDP_URL');
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!localHosts.has(parsed.hostname) || parsed.username || parsed.password) throw new SessionError('INVALID_CDP_URL');
  const endpoint = new URL('/json/version', parsed);
  let response;
  try { response = await fetchImpl(endpoint); } catch { throw new SessionError('CDP_VERSION_UNAVAILABLE'); }
  if (!response.ok) throw new SessionError('CDP_VERSION_UNAVAILABLE');
  const payload = await response.json();
  const webSocketUrl = typeof payload.webSocketDebuggerUrl === 'string' ? payload.webSocketDebuggerUrl : '';
  let websocket;
  try { websocket = new URL(webSocketUrl); } catch { throw new SessionError('CDP_WEBSOCKET_UNAVAILABLE'); }
  if (!['ws:', 'wss:'].includes(websocket.protocol) || !localHosts.has(websocket.hostname)) {
    throw new SessionError('CDP_WEBSOCKET_UNAVAILABLE');
  }
  return websocket.toString();
}

async function createLocalStagehand({
  env = process.env,
  loadStagehand = () => import('@browserbasehq/stagehand'),
  resolveCdpUrl = resolveCdpWebSocketUrl,
} = {}) {
  const cdpUrl = env.LOGICGUARD_CDP_URL;
  if (!cdpUrl) throw new SessionError('MISSING_CDP_URL');
  const webSocketUrl = await resolveCdpUrl(cdpUrl);
  const module = await loadStagehand();
  const Stagehand = module.Stagehand || module.default?.Stagehand;
  if (typeof Stagehand !== 'function') throw new SessionError('STAGEHAND_UNAVAILABLE');
  const stagehand = new Stagehand({
    env: 'LOCAL',
    localBrowserLaunchOptions: { cdpUrl: webSocketUrl },
    model: modelConfiguration(env),
    verbose: 0,
    disablePino: true,
    logger: () => {},
    experimental: true,
    disableAPI: true,
  });
  await stagehand.init();
  return stagehand;
}

function categoryFor(error) {
  if (error instanceof ValidationError) return 'invalid_request';
  if (error && ['INVALID_CSS_LOCATOR', 'INVALID_WORKER_ORIGINS'].includes(error.code)) return 'invalid_request';
  if (error && ['ORIGIN_NOT_ALLOWED', 'AGENT_BOUND_EXCEEDED', 'WAIT_TARGET_NOT_VISIBLE', 'ACT_FAILED', 'AGENT_FAILED', 'POST_ACTION_UNRESOLVED'].includes(error.code)) return 'blocked';
  if (error && error.code === 'ASSERTION_FAILED') return 'business_failed';
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
  if (request.command === 'assert_page') return session.assertPage(request);
  if (request.command === 'capture_requirement') return session.captureRequirement(request);
  if (request.command === 'set_control_marker') return session.setControlMarker(request.marker);
  if (request.command === 'remove_control_marker') return session.removeControlMarker();
  if (request.command === 'self_check') return { stagehand: true, persistent: true };
  if (request.command === 'terminate') {
    await session.removeControlMarker();
    return { terminated: true };
  }
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
  // marker 跨 NDJSON 请求保存；业务命令会创建临时 session，但导航后仍必须知道要恢复哪一个运行提示层。
  // 动作缓存只活在单次 Worker 内存中，不落盘，也不会跨运行保存业务数据或登录信息。
  const controlState = { marker: null, actionCache: new Map() };
  const baseSession = createSession({ stagehand: instance, allowedOrigins: configuredOrigins, controlState });
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
          controlState,
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
  if (process.argv.includes('--remove-control-marker')) {
    const stagehand = await createLocalStagehand();
    const session = createSession({ stagehand });
    try {
      await session.removeControlMarker();
    } finally {
      await session.close();
    }
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
  resolveCdpWebSocketUrl,
  runWorker,
};
