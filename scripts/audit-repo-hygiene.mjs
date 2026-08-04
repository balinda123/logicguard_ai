import { readFileSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const GENERATED_PREFIXES = [
  'artifacts/runs/',
  'sidecar/.stagehand/',
  'src-tauri/runtime/',
  'migration-backups/',
  'coverage/',
];

const PRODUCTION_ROOTS = ['src', 'src-tauri/src', 'sidecar'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx', '.rs']);
const FORBIDDEN_PRODUCTION_PATTERNS = [
  ['legacy executor: scriptExecutor', /scriptExecutor/],
  ['legacy executor: stagehandExecutor', /stagehandExecutor/],
  ['legacy executor: executorEngine', /executorEngine/],
  ['direct Playwright import', /require\(\s*['"]playwright['"]\s*\)/],
  ['direct CDP connection', /connectOverCDP/],
];

function isProductionSource(filePath) {
  const normalized = filePath.split(sep).join('/');
  return SOURCE_EXTENSIONS.has(extname(filePath))
    && !normalized.includes('/node_modules/')
    && !normalized.includes('/test/')
    && !/\.(test|spec)\.[^.]+$/.test(normalized);
}

function productionFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...productionFiles(path));
    else if (isProductionSource(path)) files.push(path);
  }
  return files;
}

export function auditForbiddenProductionTokens() {
  const findings = [];
  for (const root of PRODUCTION_ROOTS) {
    for (const filePath of productionFiles(root)) {
      const source = readFileSync(filePath, 'utf8');
      for (const [label, pattern] of FORBIDDEN_PRODUCTION_PATTERNS) {
        if (pattern.test(source)) findings.push(`${filePath.split(sep).join('/')}: ${label}`);
      }
    }
  }
  return findings;
}

export function classifyPath(filePath) {
  const platformPath = normalize(filePath.replace(/[\\/]+/g, sep));
  const repositoryPath = isAbsolute(platformPath)
    ? relative(process.cwd(), platformPath)
    : platformPath;
  const normalizedPath = repositoryPath.split(sep).join('/');

  return GENERATED_PREFIXES.some(
    (prefix) =>
      normalizedPath === prefix.slice(0, -1) ||
      normalizedPath.startsWith(prefix),
  )
    ? 'generated'
    : 'source';
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const generatedPaths = process.argv.slice(2).filter(
    (filePath) => classifyPath(filePath) === 'generated',
  );

  if (generatedPaths.length > 0) {
    console.log(
      ['Generated artifact paths detected:', ...generatedPaths.map((filePath) => `- ${filePath}`)].join('\n'),
    );
    process.exitCode = 1;
  }
  const forbidden = auditForbiddenProductionTokens();
  if (forbidden.length > 0) {
    console.log(['Forbidden production browser paths detected:', ...forbidden.map((item) => `- ${item}`)].join('\n'));
    process.exitCode = 1;
  }
}
