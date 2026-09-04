import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shellAssets } from '../src/sw.ts';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Build into a temporary directory, never into `apps/spotter/dist`: the relay's
// live tests run in parallel and assert that the real spotter assets are left
// untouched, so writing there mid-run is a cross-test race.
const DIST = mkdtempSync(join(tmpdir(), 'g2rs-spotter-dist-'));
const BUDGET_BYTES = 40 * 1024;

/** AC-5 measures what ships, so this runs the real `vite build` rather than
 * bundling a stand-in. */
function build(): void {
  // `vite/bin/vite.js` is not an exported subpath, so resolve the package
  // manifest and walk to the bin it declares.
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('vite/package.json');
  const viteBin = join(dirname(packageJson), 'bin', 'vite.js');
  execFileSync(process.execPath, [viteBin, 'build', '--outDir', DIST], {
    cwd: APP_ROOT,
    stdio: 'pipe',
  });
}

describe('AC-5 bundle budget', () => {
  beforeAll(() => build(), 180_000);
  afterAll(() => rmSync(DIST, { recursive: true, force: true }));

  it('keeps the shipped JS at or under 40 KB gzipped', () => {
    const scripts = [
      ...readdirSync(join(DIST, 'assets'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => join(DIST, 'assets', name)),
      join(DIST, 'sw.js'),
    ];
    expect(scripts.length).toBeGreaterThan(1);

    // Every JS file the app ships, service worker included, so neither a
    // future code-split nor SW growth can hide weight outside the budget.
    const total = scripts.reduce(
      (bytes, file) => bytes + gzipSync(readFileSync(file)).length,
      0,
    );

    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it('emits the service worker at /sw.js so its scope covers the origin', () => {
    expect(readdirSync(DIST)).toContain('sw.js');
    expect(readdirSync(DIST)).toContain('index.html');
    expect(readdirSync(DIST)).toContain('manifest.webmanifest');
  });

  it('precaches every hashed asset the built shell references', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const referenced = shellAssets(html).sort();

    // What the SW would precache on install must be the whole app, not just
    // the unhashed shell: an offline launch otherwise gets a page and no code.
    const emitted = readdirSync(join(DIST, 'assets'))
      .filter((name) => /\.(?:js|css)$/.test(name))
      .map((name) => `/assets/${name}`)
      .sort();

    expect(emitted.length).toBeGreaterThan(0);
    expect(referenced).toEqual(emitted);
  });
});
