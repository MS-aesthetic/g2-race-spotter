import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FIELD_NAMES = [
  'SDK',
  'CLI',
  'Simulator',
  'Node',
  'Wrangler',
  'Simulator `bridge.getDeviceInfo()`',
  'Even app version',
  'Glasses firmware',
  'Hardware `getDeviceInfo()`',
  'Baked font fits one line in 28 px',
  'Gray4 nibble order on glasses',
];

const HARDWARE_TBD_FIELDS = new Set([
  'Even app version',
  'Glasses firmware',
  'Hardware `getDeviceInfo()`',
  'Baked font fits one line in 28 px',
  'Gray4 nibble order on glasses',
]);

const INTERMEDIATE_TBD_FIELDS = new Set(['Simulator `bridge.getDeviceInfo()`']);

function unquote(value) {
  return value.trim().replace(/^`([^`]*)`$/, '$1');
}

export function parseEnvironment(markdown) {
  const values = new Map();

  for (const line of markdown.split(/\r?\n/)) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length >= 2 && FIELD_NAMES.includes(cells[0])) {
      values.set(cells[0], unquote(cells[1]));
    }
  }

  return values;
}

function dependency(manifest, section, name) {
  return manifest[section]?.[name];
}

export async function validateEnvironment(root) {
  const repositoryRoot = resolve(root);
  const [
    markdown,
    rootManifestText,
    glassesManifestText,
    relayManifestText,
    nodeVersion,
  ] = await Promise.all([
    readFile(resolve(repositoryRoot, 'docs/ENVIRONMENT.md'), 'utf8'),
    readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
    readFile(resolve(repositoryRoot, 'apps/glasses/package.json'), 'utf8'),
    readFile(resolve(repositoryRoot, 'services/relay/package.json'), 'utf8'),
    readFile(resolve(repositoryRoot, '.nvmrc'), 'utf8'),
  ]);
  const values = parseEnvironment(markdown);
  const rootManifest = JSON.parse(rootManifestText);
  const glassesManifest = JSON.parse(glassesManifestText);
  const relayManifest = JSON.parse(relayManifestText);
  const expectedVersions = new Map([
    [
      'SDK',
      dependency(
        glassesManifest,
        'dependencies',
        '@evenrealities/even_hub_sdk',
      ),
    ],
    [
      'CLI',
      dependency(
        glassesManifest,
        'devDependencies',
        '@evenrealities/evenhub-cli',
      ),
    ],
    [
      'Simulator',
      dependency(
        glassesManifest,
        'devDependencies',
        '@evenrealities/evenhub-simulator',
      ),
    ],
    ['Wrangler', dependency(relayManifest, 'devDependencies', 'wrangler')],
  ]);
  const failures = [];

  for (const field of FIELD_NAMES) {
    const value = values.get(field);
    if (value === undefined || value === '') {
      failures.push({ field, reason: 'missing' });
    } else if (
      value === 'TBD' &&
      !HARDWARE_TBD_FIELDS.has(field) &&
      !INTERMEDIATE_TBD_FIELDS.has(field)
    ) {
      failures.push({ field, reason: 'tbd-not-allowed' });
    }
  }

  for (const [field, expected] of expectedVersions) {
    if (!expected) {
      failures.push({ field, reason: 'manifest-version-missing' });
    } else if (values.get(field) !== expected) {
      failures.push({ field, reason: 'manifest-version-mismatch', expected });
    }
  }

  const documentedNode = values.get('Node');
  const pinnedNode = nodeVersion.trim();
  if (documentedNode && documentedNode !== 'TBD') {
    const documentedMajor = documentedNode.split('.')[0];
    if (
      documentedMajor !== pinnedNode ||
      !rootManifest.engines?.node?.includes(pinnedNode)
    ) {
      failures.push({
        field: 'Node',
        reason: 'node-version-mismatch',
        expected: pinnedNode,
      });
    }
  }

  return failures;
}

async function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = resolve(
    rootIndex === -1 ? process.cwd() : process.argv[rootIndex + 1],
  );
  const failures = await validateEnvironment(root);

  if (failures.length === 0) {
    console.log('Environment record is complete.');
    return;
  }

  for (const failure of failures) {
    console.error(`${failure.field}: ${failure.reason}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
