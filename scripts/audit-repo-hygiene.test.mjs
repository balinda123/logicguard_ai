import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyPath } from './audit-repo-hygiene.mjs';

const auditScript = fileURLToPath(
  new URL('./audit-repo-hygiene.mjs', import.meta.url),
);

test('classifies generated repository paths', () => {
  assert.equal(classifyPath('artifacts/runs/r1/trace.zip'), 'generated');
  assert.equal(classifyPath('sidecar/.stagehand/profile/Preferences'), 'generated');
  assert.equal(classifyPath('src-tauri/runtime/chromium/chrome.exe'), 'generated');
  assert.equal(classifyPath('migration-backups/backup.json'), 'generated');
  assert.equal(classifyPath('coverage/unit/index.html'), 'generated');
});

test('keeps tests and source files classified as source', () => {
  assert.equal(classifyPath('src/pages/TestCases.test.tsx'), 'source');
  assert.equal(classifyPath('src/agents/scriptExecutor.ts'), 'source');
  assert.equal(classifyPath('artifacts/runs-old/trace.zip'), 'source');
  assert.equal(classifyPath('coverage-report/index.html'), 'source');
});

test('normalizes Windows path separators', () => {
  assert.equal(
    classifyPath('sidecar\\.stagehand\\profile\\Preferences'),
    'generated',
  );
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

  assert.equal(result.status, 1);
  assert.match(result.stdout, /coverage\/unit\/index\.html/);
  assert.match(result.stdout, /sidecar\\\.stagehand\\profile\\Preferences/);
  assert.doesNotMatch(result.stdout, /TestCases\.test\.tsx/);
});

test('CLI accepts source paths without findings', () => {
  const result = spawnSync(
    process.execPath,
    [auditScript, 'src/agents/scriptExecutor.ts'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
