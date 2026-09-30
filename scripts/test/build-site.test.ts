import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assembleSite } from '../build-site.mjs';

const script = fileURLToPath(new URL('../build-site.mjs', import.meta.url));
const glassesManifest = fileURLToPath(
  new URL('../../apps/glasses/app.json', import.meta.url),
);

describe('build:site (T058)', () => {
  let work: string;
  let site: string;
  let result: ReturnType<typeof spawnSync>;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'g2rs-site-'));
    site = join(work, 'site');
    // The real CLI, both real Vite builds — but into the temp dir, never
    // apps/*/dist, which the relay's live tests watch.
    result = spawnSync(
      process.execPath,
      [script, '--out', site, '--dist-root', join(work, 'dist')],
      { encoding: 'utf8' },
    );
  }, 180_000);

  afterAll(async () => {
    await rm(work, { force: true, recursive: true });
  });

  it('exits 0', () => {
    expect(result.status, String(result.stderr)).toBe(0);
  });

  it('puts the spotter at the root and the glasses app under glasses/', async () => {
    const root = await readdir(site);
    expect(root).toEqual(
      expect.arrayContaining([
        'index.html',
        'sw.js',
        'manifest.webmanifest',
        'assets',
        'glasses',
      ]),
    );

    const spotter = await readFile(join(site, 'index.html'), 'utf8');
    expect(spotter).toMatch(/<script[^>]+src="\/assets\//);

    const glasses = await readFile(join(site, 'glasses', 'index.html'), 'utf8');
    // Built with base /glasses/, so its code resolves under the mount.
    expect(glasses).toMatch(/<script[^>]+src="\/glasses\/assets\/[^"]+\.js"/);
    expect(glasses).not.toMatch(/src="\/assets\//);
    const glassesAssets = await readdir(join(site, 'glasses', 'assets'));
    expect(glassesAssets.some((name) => name.endsWith('.js'))).toBe(true);
  });

  it('ships app.json (the network whitelist) next to the glasses index.html', async () => {
    const shipped = await readFile(join(site, 'glasses', 'app.json'), 'utf8');
    expect(JSON.parse(shipped)).toEqual(
      JSON.parse(await readFile(glassesManifest, 'utf8')),
    );
  });
});

describe('assembleSite', () => {
  it('refuses a spotter build that would shadow the glasses mount', async () => {
    const work = await mkdtemp(join(tmpdir(), 'g2rs-site-'));
    try {
      const spotterDist = join(work, 'spotter');
      const glassesDist = join(work, 'glasses-dist');
      await mkdir(join(spotterDist, 'glasses'), { recursive: true });
      await mkdir(glassesDist, { recursive: true });
      await writeFile(join(spotterDist, 'index.html'), '');

      await expect(
        assembleSite({ spotterDist, glassesDist, outDir: join(work, 'site') }),
      ).rejects.toThrow(/collide/);
    } finally {
      await rm(work, { force: true, recursive: true });
    }
  });

  it('names the files a broken build left out', async () => {
    const work = await mkdtemp(join(tmpdir(), 'g2rs-site-'));
    try {
      const spotterDist = join(work, 'spotter');
      const glassesDist = join(work, 'glasses-dist');
      await mkdir(spotterDist, { recursive: true });
      await mkdir(glassesDist, { recursive: true });
      await writeFile(join(spotterDist, 'index.html'), '');
      await writeFile(join(spotterDist, 'sw.js'), '');
      await writeFile(join(spotterDist, 'manifest.webmanifest'), '');
      await writeFile(join(glassesDist, 'index.html'), '');

      await expect(
        assembleSite({ spotterDist, glassesDist, outDir: join(work, 'site') }),
      ).rejects.toThrow('site is missing glasses/app.json');
    } finally {
      await rm(work, { force: true, recursive: true });
    }
  });
});
