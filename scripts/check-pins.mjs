import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const PINNED_PACKAGES = new Set([
  '@evenrealities/even_hub_sdk',
  '@evenrealities/evenhub-cli',
  '@evenrealities/evenhub-simulator',
  'wrangler',
  'vite',
  'vitest',
  'typescript',
]);

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.wrangler',
  'dist',
  'node_modules',
]);
const EXACT_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

async function findPackageJsonFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...(await findPackageJsonFiles(entryPath)));
      }
    } else if (entry.isFile() && entry.name === 'package.json') {
      files.push(entryPath);
    }
  }

  return files;
}

export function isExactVersion(version) {
  return typeof version === 'string' && EXACT_VERSION.test(version);
}

export async function findUnpinnedDependencies(root) {
  const packageFiles = await findPackageJsonFiles(root);
  const failures = [];

  for (const packageFile of packageFiles) {
    const manifest = JSON.parse(await readFile(packageFile, 'utf8'));
    for (const section of DEPENDENCY_SECTIONS) {
      const dependencies = manifest[section];
      if (dependencies === undefined) continue;

      for (const [name, version] of Object.entries(dependencies)) {
        if (PINNED_PACKAGES.has(name) && !isExactVersion(version)) {
          failures.push({
            file: relative(root, packageFile).split(sep).join('/'),
            section,
            name,
            version,
          });
        }
      }
    }
  }

  return failures;
}

async function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = resolve(
    rootIndex === -1 ? process.cwd() : process.argv[rootIndex + 1],
  );
  const failures = await findUnpinnedDependencies(root);

  if (failures.length === 0) {
    console.log('Dependency pins are exact.');
    return;
  }

  for (const failure of failures) {
    console.error(
      `${failure.file} ${failure.section}.${failure.name} must use an exact version; found ${JSON.stringify(failure.version)}`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
