import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { findUnpinnedDependencies } from '../check-pins.mjs';

const fixturesDirectory = fileURLToPath(
  new URL('./fixtures/check-pins/', import.meta.url),
);
const temporaryRoots: string[] = [];

async function rootFromFixture(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'g2-check-pins-'));
  temporaryRoots.push(root);
  await cp(join(fixturesDirectory, name), join(root, 'package.json'));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('check-pins', () => {
  it('accepts exact R2 dependency versions', async () => {
    const failures = await findUnpinnedDependencies(
      await rootFromFixture('valid.json'),
    );

    expect(failures).toEqual([]);
  });

  it('rejects range, tag, alias, wildcard, and comparator versions in every dependency section', async () => {
    const root = await rootFromFixture('ranges.json');
    const failures = await findUnpinnedDependencies(root);

    expect(failures).toEqual([
      expect.objectContaining({
        name: '@evenrealities/even_hub_sdk',
        version: '^0.0.12',
      }),
      expect.objectContaining({
        name: '@evenrealities/evenhub-cli',
        version: 'latest',
      }),
      expect.objectContaining({
        name: '@evenrealities/evenhub-simulator',
        version: '~0.9.5',
      }),
      expect.objectContaining({
        name: '@evenrealities/new-sdk',
        version: '^1.0.0',
      }),
      expect.objectContaining({ name: 'wrangler', version: '>=4.68.0' }),
      expect.objectContaining({ name: 'vite', version: '8.2.x' }),
      expect.objectContaining({ name: 'vitest', version: '*' }),
      expect.objectContaining({
        name: 'typescript',
        version: 'npm:typescript@6.0.3',
      }),
      expect.objectContaining({
        section: 'devDependencies',
        name: 'vite',
        version: '^8.2.2',
      }),
      expect.objectContaining({
        section: 'optionalDependencies',
        name: 'wrangler',
        version: '4.68.0 || 4.69.0',
      }),
      expect.objectContaining({
        section: 'peerDependencies',
        name: 'vitest',
        version: '>=5.0.0',
      }),
    ]);
  });

  it('checks the repository manifests successfully', async () => {
    const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
    const rootManifest = JSON.parse(
      await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
    );

    expect(rootManifest.devDependencies.typescript).toMatch(/^\d+\.\d+\.\d+$/);
    await expect(findUnpinnedDependencies(repositoryRoot)).resolves.toEqual([]);
  });
});
