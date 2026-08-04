import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const resources = join(root, 'src-tauri', 'resources');
const runtimeDir = join(resources, 'runtime');
const sidecarDir = join(resources, 'sidecar');
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
const runtimeTarget = join(runtimeDir, nodeName);

if (process.platform === 'darwin' && process.arch !== 'arm64') {
  throw new Error('macOS 安装包必须在 Apple Silicon Node.js 环境中构建。');
}
if (process.platform !== 'win32' && process.platform !== 'darwin') {
  throw new Error('当前仅支持在 Windows 或 macOS 上准备安装资源。');
}

await rm(runtimeDir, { recursive: true, force: true });
await rm(sidecarDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });
await mkdir(sidecarDir, { recursive: true });

const nodeSource = process.env.LOGICGUARD_NODE_BINARY || process.execPath;
await cp(nodeSource, runtimeTarget);
await cp(join(root, 'sidecar', 'index.js'), join(sidecarDir, 'index.js'));
await cp(join(root, 'sidecar', 'session.js'), join(sidecarDir, 'session.js'));
await cp(join(root, 'sidecar', 'stagehand'), join(sidecarDir, 'stagehand'), { recursive: true });
await cp(join(root, 'sidecar', 'package.json'), join(sidecarDir, 'package.json'));
await cp(join(root, 'sidecar', 'package-lock.json'), join(sidecarDir, 'package-lock.json'));

const npmCli = process.env.npm_execpath;
const installEnv = { ...process.env, npm_config_cache: join(root, '.npm-cache') };
const install = npmCli
  ? spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: sidecarDir, stdio: 'inherit', env: installEnv })
  : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: sidecarDir, stdio: 'inherit', env: installEnv });
if (install.status !== 0) throw new Error(`sidecar 生产依赖安装失败：${install.error?.message ?? `退出码 ${install.status}`}`);

const runtimeStat = await stat(runtimeTarget);
if (runtimeStat.size < 1_000_000) throw new Error(`Node Runtime 无效: ${runtimeTarget}`);
console.log(`已准备 ${process.platform}/${process.arch} sidecar 资源：${resources}`);
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 22 && process.env.LOGICGUARD_ALLOW_UNSUPPORTED_NODE !== '1') {
  throw new Error(`安装资源必须使用 Node 22 构建，当前为 ${process.version}。`);
}
