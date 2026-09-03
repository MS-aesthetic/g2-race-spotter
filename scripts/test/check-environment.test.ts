import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { validateEnvironment } from '../check-environment.mjs';

const fixturesDirectory = fileURLToPath(
  new URL('./fixtures/check-environment/', import.meta.url),
);
const temporaryRoots: string[] = [];

async function rootFromFixture(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'g2-check-environment-'));
  temporaryRoots.push(root);
  await cp(join(fixturesDirectory, name), root, { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('check-environment', () => {
  it('accepts a complete environment record with only the interim and hardware TBD fields', async () => {
    await expect(
      validateEnvironment(await rootFromFixture('valid')),
    ).resolves.toEqual([]);
  });

  it('requires every R5 field and rejects TBD outside its allowlist', async () => {
    await expect(
      validateEnvironment(await rootFromFixture('missing-and-tbd')),
    ).resolves.toEqual([
      { field: 'CLI', reason: 'tbd-not-allowed' },
      { field: 'Glasses firmware', reason: 'missing' },
      { field: 'CLI', reason: 'manifest-version-mismatch', expected: '0.1.12' },
    ]);
  });

  it('rejects documentation that drifts from pinned package or Node versions', async () => {
    await expect(
      validateEnvironment(await rootFromFixture('version-mismatch')),
    ).resolves.toEqual([
      {
        field: 'Simulator',
        reason: 'manifest-version-mismatch',
        expected: '0.9.5',
      },
      {
        field: 'Wrangler',
        reason: 'manifest-version-mismatch',
        expected: '4.68.0',
      },
      { field: 'Node', reason: 'node-version-mismatch', expected: '22' },
    ]);
  });
});
