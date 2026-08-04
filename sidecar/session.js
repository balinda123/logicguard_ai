const path = require('node:path');

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`INVALID_${field}`);
  }
  return value;
}

function optionalString(value, field) {
  return value === undefined || value === null || value === ''
    ? undefined
    : requiredString(value, field);
}

const LOGIN_SELECTOR_CANDIDATES = {
  username: [
    '[autocomplete="username"]',
    'input[name*="username" i]',
    'input[id*="username" i]',
    'input[name*="account" i]',
    'input[id*="account" i]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="text"]',
  ],
  password: [
    '[autocomplete="current-password"]',
    'input[type="password"]',
    'input[name*="password" i]',
    'input[id*="password" i]',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("登录")',
    'button:has-text("登陆")',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    '[role="button"]:has-text("登录")',
  ],
};

function parseBrowserLoginPayload(rawPayload) {
  let value;
  try {
    value = JSON.parse(requiredString(rawPayload, 'BROWSER_LOGIN_PAYLOAD'));
  } catch {
    throw new Error('INVALID_BROWSER_LOGIN_PAYLOAD');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_BROWSER_LOGIN_PAYLOAD');
  }

  return {
    loginUrl: requiredString(value.loginUrl, 'LOGIN_URL'),
    pageSelector: optionalString(value.pageSelector, 'PAGE_SELECTOR'),
    usernameSelector: optionalString(value.usernameSelector, 'USERNAME_SELECTOR'),
    passwordSelector: optionalString(value.passwordSelector, 'PASSWORD_SELECTOR'),
    submitSelector: optionalString(value.submitSelector, 'SUBMIT_SELECTOR'),
    successSelector: optionalString(value.successSelector, 'SUCCESS_SELECTOR'),
    username: requiredString(value.username, 'USERNAME'),
    password: requiredString(value.password, 'PASSWORD'),
  };
}

function safeScreenshotPath(outputPath) {
  requiredString(outputPath, 'FAILURE_SCREENSHOT_PATH');
  const segments = outputPath.split(/[\\/]+/);
  if (
    (!path.win32.isAbsolute(outputPath) && !path.posix.isAbsolute(outputPath)) ||
    segments.includes('..') ||
    !outputPath.toLowerCase().endsWith('.png')
  ) {
    throw new Error('INVALID_FAILURE_SCREENSHOT_PATH');
  }
  return outputPath;
}

async function clearBrowserSession(context, page) {
  await context.clearCookies();
  await Promise.all(
    context.pages().map(async candidate => {
      try {
        await candidate.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
      } catch {
        // Browser-internal pages cannot expose storage through CDP.
      }
    }),
  );
  await page.goto('about:blank', { waitUntil: 'commit' });
}

async function captureFailureScreenshot(page, outputPath) {
  await page.screenshot({ path: safeScreenshotPath(outputPath), fullPage: false });
}

async function findVisibleLocator(page, selector) {
  const frames = typeof page.frames === 'function' ? page.frames() : [page];
  for (const frame of frames) {
    try {
      const candidates = frame.locator(selector);
      if (await candidates.count() === 0) continue;
      const locator = candidates.first();
      if (await locator.isVisible()) return { selector, locator };
    } catch {
      // Invalid or unsupported selectors are ignored so automatic discovery can continue.
    }
  }
  return undefined;
}

async function resolveLoginLocator(page, { kind, manualSelector, aiResolver }) {
  if (!LOGIN_SELECTOR_CANDIDATES[kind]) throw new Error(`INVALID_LOGIN_LOCATOR_KIND_${kind}`);

  if (manualSelector) {
    const manual = await findVisibleLocator(page, manualSelector);
    if (manual) return manual;
  }
  for (const selector of LOGIN_SELECTOR_CANDIDATES[kind]) {
    const local = await findVisibleLocator(page, selector);
    if (local) return local;
  }
  if (aiResolver) {
    const aiSelector = await aiResolver(kind);
    if (aiSelector) {
      const ai = await findVisibleLocator(page, aiSelector);
      if (ai) return ai;
    }
  }
  throw new Error(`LOGIN_${kind.toUpperCase()}_CONTROL_NOT_FOUND`);
}

async function loginWithCredentials(page, payload, options = {}) {
  await page.goto(payload.loginUrl, { waitUntil: 'domcontentloaded' });
  if (payload.pageSelector) {
    await page.waitForSelector(payload.pageSelector);
  }
  const username = await resolveLoginLocator(page, {
    kind: 'username',
    manualSelector: payload.usernameSelector,
    aiResolver: options.aiResolver,
  });
  const password = await resolveLoginLocator(page, {
    kind: 'password',
    manualSelector: payload.passwordSelector,
    aiResolver: options.aiResolver,
  });
  const submit = await resolveLoginLocator(page, {
    kind: 'submit',
    manualSelector: payload.submitSelector,
    aiResolver: options.aiResolver,
  });
  await username.locator.fill(payload.username);
  await password.locator.fill(payload.password);
  await submit.locator.click();
  if (payload.successSelector) {
    await page.waitForSelector(payload.successSelector);
  }
  return { status: 'completed', finalUrl: page.url() };
}

module.exports = {
  captureFailureScreenshot,
  clearBrowserSession,
  loginWithCredentials,
  parseBrowserLoginPayload,
  resolveLoginLocator,
  safeScreenshotPath,
};
