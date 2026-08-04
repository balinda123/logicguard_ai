import { isAbsolute, normalize, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const GENERATED_PREFIXES = [
  'artifacts/runs/',
  'sidecar/.stagehand/',
  'src-tauri/runtime/',
  'migration-backups/',
  'coverage/',
];

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
}
