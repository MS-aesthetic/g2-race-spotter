#!/usr/bin/env node
// Builds both apps and assembles the one static site the relay serves (T058):
//
//   site/                 spotter PWA (index.html, sw.js, assets/, manifest)
//   site/glasses/         glasses app (built with base /glasses/) + app.json
//
//   node scripts/build-site.mjs                                  # → <repo>/site
//   node scripts/build-site.mjs --out <dir> --dist-root <dir>    # tests: nothing under apps/*/dist
//
// `services/relay/wrangler.jsonc` points its assets directory at ../../site, so
// `npm run deploy` (build:site + wrangler deploy) ships relay, spotter and
// glasses app together, and the driver sideloads the glasses app by QR from
// https://<relay>/glasses/ with no PC running.

import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where each app is served from inside the site. */
export const GLASSES_DIR = 'glasses';

/** Files that must exist in the assembled site, relative to its root. */
export const REQUIRED_FILES = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  `${GLASSES_DIR}/index.html`,
  `${GLASSES_DIR}/app.json`,
];

function viteBin() {
  // `vite/bin/vite.js` is not an exported subpath: resolve the manifest and
  // walk to the bin it declares (same as apps/spotter/test/build-app.ts).
  const require = createRequire(join(repoRoot, 'apps', 'spotter', 'x.js'));
  return join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
}

/** `vite build` of one app into `outDir`. */
export function buildApp(app, outDir) {
  execFileSync(
    process.execPath,
    [viteBin(), 'build', '--outDir', outDir, '--emptyOutDir'],
    { cwd: join(repoRoot, 'apps', app), stdio: 'inherit' },
  );
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies the spotter dist to `outDir` and the glasses dist to
 * `outDir/glasses`, replacing whatever was there. Throws if a required file is
 * missing or the spotter would shadow the glasses mount.
 */
export async function assembleSite({ spotterDist, glassesDist, outDir }) {
  if ((await readdir(spotterDist)).includes(GLASSES_DIR)) {
    throw new Error(
      `${spotterDist} already contains "${GLASSES_DIR}/" — it would collide with the glasses app`,
    );
  }

  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { recursive: true });
  await cp(spotterDist, outDir, { recursive: true });
  await cp(glassesDist, join(outDir, GLASSES_DIR), { recursive: true });

  const missing = [];
  for (const file of REQUIRED_FILES) {
    if (!(await exists(join(outDir, file)))) {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    throw new Error(`site is missing ${missing.join(', ')}`);
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : resolve(process.argv[index + 1]);
}

async function main() {
  const outDir = option('--out') ?? join(repoRoot, 'site');
  const distRoot = option('--dist-root');
  const spotterDist =
    distRoot === undefined
      ? join(repoRoot, 'apps', 'spotter', 'dist')
      : join(distRoot, 'spotter');
  const glassesDist =
    distRoot === undefined
      ? join(repoRoot, 'apps', 'glasses', 'dist')
      : join(distRoot, 'glasses');

  buildApp('spotter', spotterDist);
  buildApp('glasses', glassesDist);
  await assembleSite({ spotterDist, glassesDist, outDir });
  console.log(`site assembled in ${outDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
