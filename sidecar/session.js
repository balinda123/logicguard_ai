const path = require('node:path');

// Compatibility-only Playwright helpers. Delete after Task 10 parity and
// migration gates prove every production browser path uses stagehand/worker.js.
const stagehandWorkerPath = path.join(__dirname, 'stagehand', 'worker.js');

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`INVALID_${field}`);
  }
  return value;
}

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
    pageSelector: value.pageSelector ? requiredString(value.pageSelector, 'PAGE_SELECTOR') : undefined,
    usernameSelector: requiredString(value.usernameSelector, 'USERNAME_SELECTOR'),
    passwordSelector: requiredString(value.passwordSelector, 'PASSWORD_SELECTOR'),
    submitSelector: requiredString(value.submitSelector, 'SUBMIT_SELECTOR'),
    successSelector: value.successSelector ? requiredString(value.successSelector, 'SUCCESS_SELECTOR') : undefined,
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

async function loginWithCredentials(page, payload) {
  await page.goto(payload.loginUrl, { waitUntil: 'domcontentloaded' });
  if (payload.pageSelector) {
    await page.waitForSelector(payload.pageSelector);
  }
  await page.locator(payload.usernameSelector).fill(payload.username);
  await page.locator(payload.passwordSelector).fill(payload.password);
  await page.locator(payload.submitSelector).click();
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
  safeScreenshotPath,
  stagehandWorkerPath,
};
