import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
for (const executable of [
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
]) {
  const result = spawnSync(process.execPath, [executable, ...(executable.endsWith('tsc') ? ['-b'] : ['build'])], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
