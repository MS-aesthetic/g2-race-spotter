/**
 * Shared by the two tests that measure what actually ships (`bundle-size` and
 * `layout`): both run the real `vite build` rather than bundling a stand-in.
 *
 * Always into a fresh temp directory, never into `apps/spotter/dist`: the
 * relay's live tests run in parallel and assert that the real spotter assets
 * are left untouched, so writing there mid-run is a cross-test race.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function tempDist(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function buildSpotter(outDir: string): void {
  // `vite/bin/vite.js` is not an exported subpath, so resolve the package
  // manifest and walk to the bin it declares.
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('vite/package.json');
  const viteBin = join(dirname(packageJson), 'bin', 'vite.js');
  execFileSync(process.execPath, [viteBin, 'build', '--outDir', outDir], {
    cwd: APP_ROOT,
    stdio: 'pipe',
  });
}
