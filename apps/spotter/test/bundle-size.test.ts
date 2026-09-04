import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(APP_ROOT, 'dist');
const BUDGET_BYTES = 40 * 1024;

/** AC-5 measures what ships, so this runs the real `vite build` rather than
 * bundling a stand-in. */
function build(): void {
  // `vite/bin/vite.js` is not an exported subpath, so resolve the package
  // manifest and walk to the bin it declares.
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('vite/package.json');
  const viteBin = join(dirname(packageJson), 'bin', 'vite.js');
  rmSync(DIST, { recursive: true, force: true });
  execFileSync(process.execPath, [viteBin, 'build'], {
    cwd: APP_ROOT,
    stdio: 'pipe',
  });
}

describe('AC-5 bundle budget', () => {
  beforeAll(() => build(), 180_000);

  it('keeps the main JS chunk at or under 40 KB gzipped', () => {
    const assets = join(DIST, 'assets');
    const scripts = readdirSync(assets).filter((name) => name.endsWith('.js'));
    expect(scripts.length).toBeGreaterThan(0);

    // Every JS file the shell can pull in, so a future code-split cannot hide
    // weight in a lazy chunk and still claim the budget.
    const total = scripts.reduce(
      (bytes, name) =>
        bytes + gzipSync(readFileSync(join(assets, name))).length,
      0,
    );

    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it('emits the service worker at /sw.js so its scope covers the origin', () => {
    expect(readdirSync(DIST)).toContain('sw.js');
    expect(readdirSync(DIST)).toContain('index.html');
    expect(readdirSync(DIST)).toContain('manifest.webmanifest');
  });
});
