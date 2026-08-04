'use strict';

class SessionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part, index) => `${index ? `"'",` : ''}'${part}'`).join(',')})`;
}

function textPredicate(value, exact) {
  const literal = xpathLiteral(value);
  return exact
    ? `normalize-space(string(.))=${literal}`
    : `contains(normalize-space(string(.)),${literal})`;
}

function accessibleNamePredicate(value, exact) {
  const literal = xpathLiteral(value);
  const compare = candidate => exact
    ? `normalize-space(${candidate})=${literal}`
    : `contains(normalize-space(${candidate}),${literal})`;
  return `(${compare('@aria-label')} or ${compare('@title')} or ${compare('string(.)')})`;
}

function rolePredicate(role) {
  const literal = xpathLiteral(role);
  const implicit = {
    button: 'self::button or (self::input and (@type="button" or @type="submit" or @type="reset"))',
    checkbox: 'self::input and @type="checkbox"',
    link: 'self::a and @href',
    radio: 'self::input and @type="radio"',
    textbox: '(self::input and (not(@type) or @type="text" or @type="email" or @type="search" or @type="tel" or @type="url")) or self::textarea',
  }[role];
  return implicit ? `(@role=${literal} or ${implicit})` : `@role=${literal}`;
}

function locatorSelector(locator) {
  const exact = locator.exact === true;
  if (locator.kind === 'css') return locator.value;
  if (locator.kind === 'text' && !exact) return `text=${locator.value}`;
  if (locator.kind === 'text') return `xpath=//*[${textPredicate(locator.value, true)}]`;
  if (locator.kind === 'placeholder') {
    const operator = exact ? '=' : ', ';
    return exact
      ? `xpath=//*[@placeholder=${xpathLiteral(locator.value)}]`
      : `xpath=//*[contains(@placeholder${operator}${xpathLiteral(locator.value)})]`;
  }
  if (locator.kind === 'testId') {
    return `xpath=//*[@data-testid=${xpathLiteral(locator.value)}]`;
  }
  if (locator.kind === 'label') {
    const label = `//label[${textPredicate(locator.value, exact)}]`;
    return `xpath=(${label}//*[self::input or self::textarea or self::select][1] | //*[@id=${label}/@for])[1]`;
  }
  const name = locator.name === undefined ? '' : ` and ${accessibleNamePredicate(locator.name, exact)}`;
  return `xpath=//*[${rolePredicate(locator.value)}${name}]`;
}

function allowedOrigin(url, allowedOrigins, allowBlank = false) {
  if (allowBlank && (url === 'about:blank' || url === '')) return true;
  try {
    return allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

function assertAllowedUrl(url, allowedOrigins, allowBlank = false) {
  if (!allowedOrigin(url, allowedOrigins, allowBlank)) {
    throw new SessionError('ORIGIN_NOT_ALLOWED');
  }
}

async function activePage(stagehand) {
  return stagehand.context.awaitActivePage();
}

async function resolveLocator(page, locator) {
  if (locator.kind === 'css') {
    try {
      await page.evaluate(selector => {
        document.querySelector(selector);
        return true;
      }, locator.value);
    } catch {
      throw new SessionError('INVALID_CSS_LOCATOR');
    }
  }
  return page.locator(locatorSelector(locator));
}

async function focusLocator(locator) {
  if (typeof locator.focus === 'function') {
    await locator.focus();
    return;
  }
  const node = await locator.resolveNode();
  const frame = locator.getFrame();
  await frame.session.send('Runtime.callFunctionOn', {
    objectId: node.objectId,
    functionDeclaration: 'function () { this.focus(); }',
  });
}

async function executeCompiledStep(stagehand, allowedOrigins, step, emit) {
  const page = await activePage(stagehand);
  if (step.action === 'navigate') {
    assertAllowedUrl(step.url, allowedOrigins);
    assertAllowedUrl(page.url(), allowedOrigins, true);
    await page.goto(step.url, { waitUntil: 'domcontentloaded' });
    assertAllowedUrl(page.url(), allowedOrigins);
    return { action: step.action, url: page.url() };
  }

  assertAllowedUrl(page.url(), allowedOrigins);
  let locator;
  if (step.locator) locator = await resolveLocator(page, step.locator);
  let data;
  if (step.action === 'click') {
    await locator.click();
  } else if (step.action === 'fill') {
    await locator.fill(step.value);
  } else if (step.action === 'select') {
    data = { values: await locator.selectOption(step.value) };
  } else if (step.action === 'press') {
    if (locator) await focusLocator(locator);
    await page.keyPress(step.key);
  } else if (step.action === 'wait') {
    if (step.durationMs !== undefined) await page.waitForTimeout(step.durationMs);
    else {
      const deadline = Date.now() + 30000;
      while (!(await locator.isVisible())) {
        if (Date.now() >= deadline) throw new SessionError('WAIT_TARGET_NOT_VISIBLE');
        await page.waitForTimeout(100);
      }
    }
  } else if (step.action === 'read') {
    data = { text: await locator.innerText() };
  } else if (step.action === 'assert') {
    const visible = await locator.isVisible();
    if (step.condition === 'visible' && !visible) throw new SessionError('ASSERTION_FAILED');
    if (step.condition === 'hidden' && visible) throw new SessionError('ASSERTION_FAILED');
    if (step.condition === 'equals' || step.condition === 'contains') {
      const text = await locator.innerText();
      const passed = step.condition === 'equals' ? text === step.expected : text.includes(step.expected);
      if (!passed) throw new SessionError('ASSERTION_FAILED');
    }
    data = { passed: true };
  }
  assertAllowedUrl(page.url(), allowedOrigins);
  emit({ phase: 'executed', action: step.action });
  return { action: step.action, ...data };
}

function effectiveOrigins(defaultOrigins, request) {
  return request && Array.isArray(request.allowedOrigins) ? request.allowedOrigins : defaultOrigins;
}

async function observeCandidates(stagehand, allowedOrigins, request) {
  const page = await activePage(stagehand);
  const origins = effectiveOrigins(allowedOrigins, request);
  if (origins.length) assertAllowedUrl(page.url(), origins);
  const observations = await stagehand.observe(request.instruction, { page });
  if (origins.length) assertAllowedUrl(page.url(), origins);
  return { observations };
}

async function runBoundedAct(stagehand, allowedOrigins, request) {
  const page = await activePage(stagehand);
  const origins = effectiveOrigins(allowedOrigins, request);
  assertAllowedUrl(page.url(), origins);
  const result = await stagehand.act(request.instruction, { page, timeout: request.timeoutMs });
  assertAllowedUrl(page.url(), origins);
  if (result && result.success === false) throw new SessionError('ACT_FAILED');
  return { success: true };
}

async function runBoundedAgent(stagehand, allowedOrigins, request, emit) {
  if (!Number.isInteger(request.maxActions) || request.maxActions < 1 || request.maxActions > 20) {
    throw new SessionError('AGENT_BOUND_EXCEEDED');
  }
  const page = await activePage(stagehand);
  const origins = effectiveOrigins(allowedOrigins, request);
  assertAllowedUrl(page.url(), origins);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  let actions = 0;
  try {
    const agent = stagehand.agent({ mode: 'dom' });
    const result = await agent.execute({
      instruction: request.goal,
      maxSteps: request.maxActions,
      page,
      signal: controller.signal,
      callbacks: {
        onStepFinish: async step => {
          const toolCalls = Array.isArray(step && step.toolCalls) ? step.toolCalls : [];
          actions += Math.max(1, toolCalls.length);
          if (actions > request.maxActions) {
            controller.abort();
            throw new SessionError('AGENT_BOUND_EXCEEDED');
          }
          assertAllowedUrl(page.url(), origins);
          const safeTools = new Set([
            'act', 'ariaTree', 'done', 'extract', 'fillForm', 'goto', 'keys',
            'navback', 'screenshot', 'scroll', 'search', 'think', 'wait',
          ]);
          const tools = toolCalls.map(call => {
            const name = String(call.toolName || 'action');
            return safeTools.has(name) ? name : 'action';
          });
          emit({ phase: 'agent_step', action: actions, tools });
        },
      },
    });
    assertAllowedUrl(page.url(), origins);
    if (controller.signal.aborted) throw new SessionError('REQUEST_TIMEOUT');
    if (result && result.success === false) throw new SessionError('AGENT_FAILED');
    return {
      success: true,
      completed: result ? result.completed !== false : true,
      actionCount: actions,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function setControlMarker(stagehand, marker) {
  const page = await activePage(stagehand);
  await page.evaluate(value => {
    const id = 'logicguard-controlled-browser-marker';
    let element = document.getElementById(id);
    if (!element) {
      element = document.createElement('div');
      element.id = id;
      element.setAttribute('role', 'status');
      Object.assign(element.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        padding: '8px 12px', background: '#b42318', color: '#fff', font: '600 13px system-ui',
        textAlign: 'center', pointerEvents: 'none', boxSizing: 'border-box',
      });
      document.documentElement.appendChild(element);
    }
    const label = `自动化执行中 | system: ${value.system} | env: ${value.environment} | run: ${value.run} | step: ${value.currentStep}`;
    element.textContent = label;
    if (!document.documentElement.dataset.logicguardOriginalTitle) {
      document.documentElement.dataset.logicguardOriginalTitle = document.title;
    }
    document.title = label;
  }, marker);
  return { marked: true };
}

async function removeControlMarker(stagehand) {
  const page = await activePage(stagehand);
  await page.evaluate(() => {
    document.getElementById('logicguard-controlled-browser-marker')?.remove();
    const original = document.documentElement.dataset.logicguardOriginalTitle;
    if (original !== undefined) {
      document.title = original;
      delete document.documentElement.dataset.logicguardOriginalTitle;
    }
  });
  return { marked: false };
}

function createSession({ stagehand, allowedOrigins = [], emit = () => {} }) {
  const origins = [...new Set(allowedOrigins)];
  return {
    execute: step => executeCompiledStep(stagehand, origins, step, emit),
    observe: request => observeCandidates(stagehand, origins, request),
    act: request => runBoundedAct(stagehand, origins, request),
    agent: request => runBoundedAgent(stagehand, origins, request, emit),
    setControlMarker: marker => setControlMarker(stagehand, marker),
    removeControlMarker: () => removeControlMarker(stagehand),
    close: () => stagehand.close(),
  };
}

module.exports = {
  SessionError,
  assertAllowedUrl,
  createSession,
  locatorSelector,
};
