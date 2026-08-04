import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

import { auditForbiddenProductionTokens, classifyPath } from './audit-repo-hygiene.mjs';

const auditScript = resolve('scripts/audit-repo-hygiene.mjs');

test('classifies generated repository paths', () => {
  expect(classifyPath('artifacts/runs/r1/trace.zip')).toBe('generated');
  expect(classifyPath('sidecar/.stagehand/profile/Preferences')).toBe('generated');
  expect(classifyPath('src-tauri/runtime/chromium/chrome.exe')).toBe('generated');
  expect(classifyPath('migration-backups/backup.json')).toBe('generated');
  expect(classifyPath('coverage/unit/index.html')).toBe('generated');
});

test('keeps tests and source files classified as source', () => {
  expect(classifyPath('src/pages/TestCases.test.tsx')).toBe('source');
  expect(classifyPath('src/api/runBridge.ts')).toBe('source');
  expect(classifyPath('artifacts/runs-old/trace.zip')).toBe('source');
  expect(classifyPath('coverage-report/index.html')).toBe('source');
});

test('normalizes Windows path separators', () => {
  expect(classifyPath('sidecar\\.stagehand\\profile\\Preferences')).toBe(
    'generated',
  );
});

test('normalizes repository-relative path forms', () => {
  const absoluteCoveragePath = resolve('coverage/unit/index.html');

  expect(classifyPath('./coverage')).toBe('generated');
  expect(classifyPath('.\\coverage')).toBe('generated');
  expect(classifyPath(absoluteCoveragePath)).toBe('generated');
  expect(classifyPath('../coverage')).toBe('source');
});

test('CLI lists generated paths and exits with status 1', () => {
  const result = spawnSync(
    process.execPath,
    [
      auditScript,
      'src/pages/TestCases.test.tsx',
      'coverage/unit/index.html',
      'sidecar\\.stagehand\\profile\\Preferences',
    ],
    { encoding: 'utf8' },
  );

  expect(result.status).toBe(1);
  expect(result.stdout).toMatch(/coverage\/unit\/index\.html/);
  expect(result.stdout).toMatch(/sidecar\\\.stagehand\\profile\\Preferences/);
  expect(result.stdout).not.toMatch(/TestCases\.test\.tsx/);
});

test('CLI accepts source paths without findings', () => {
  const result = spawnSync(
    process.execPath,
    [auditScript, 'src/api/runBridge.ts'],
    { encoding: 'utf8' },
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
});

test('production sources contain no legacy executor or direct browser driver path', () => {
  expect(auditForbiddenProductionTokens()).toEqual([]);
});
