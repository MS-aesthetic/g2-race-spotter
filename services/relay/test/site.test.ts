import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { startWorker, type RunningWorker } from './live-worker.ts';

/**
 * T058: the relay serves the assembled `site/` — spotter at the root, the
 * glasses app under /glasses/ — from one origin, so the driver sideloads the
 * glasses app by QR with no PC. The shape mirrors what
 * `scripts/build-site.mjs` produces; the glasses manifest is the real one.
 */

const DEPLOYED_ORIGIN = 'https://g2-race-relay.maxx-384.workers.dev';
const SPOTTER_HTML = '<!doctype html><title>Spotter</title>';
const GLASSES_HTML = '<!doctype html><title>Glasses</title>';

async function siteAssets(): Promise<Record<string, string>> {
  const appJson = await readFile(
    new URL('../../../apps/glasses/app.json', import.meta.url),
    'utf8',
  );
  return {
    'index.html': SPOTTER_HTML,
    'sw.js': 'self.addEventListener("fetch", () => {});',
    'glasses/index.html': GLASSES_HTML,
    'glasses/app.json': appJson,
    'glasses/assets/index-abc.js': 'console.log("glasses");',
  };
}

interface Manifest {
  entrypoint: string;
  permissions: { name: string; whitelist?: string[] }[];
}

describe('relay serves the glasses app next to the spotter', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop();
    worker = undefined;
  });

  it('serves /glasses/, its app.json and assets, and 404s a glasses miss instead of the spotter shell', async () => {
    worker = await startWorker(undefined, await siteAssets());
    const { origin } = worker;

    const glasses = await fetch(`${origin}/glasses/`);
    expect(glasses.status).toBe(200);
    expect(glasses.headers.get('Content-Type')).toMatch(/^text\/html/);
    await expect(glasses.text()).resolves.toBe(GLASSES_HTML);
    expect(glasses.headers.get('Access-Control-Allow-Origin')).toBe('*');

    // What the QR carries, minus the slash: the query must survive the hop.
    const bare = await fetch(
      `${origin}/glasses?room=QA01&pin=1234&name=driver`,
      { redirect: 'manual' },
    );
    expect(bare.status).toBeGreaterThanOrEqual(301);
    expect(bare.status).toBeLessThanOrEqual(308);
    expect(bare.headers.get('Location')).toBe(
      '/glasses/?room=QA01&pin=1234&name=driver',
    );

    const manifest = await fetch(`${origin}/glasses/app.json`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('Content-Type')).toMatch(/^application\/json/);
    const body = (await manifest.json()) as Manifest;
    expect(body.entrypoint).toBe('index.html');
    expect(
      body.permissions.find((permission) => permission.name === 'network')
        ?.whitelist,
    ).toContain(DEPLOYED_ORIGIN);

    const script = await fetch(`${origin}/glasses/assets/index-abc.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('Content-Type')).toMatch(/javascript/);

    for (const miss of ['/glasses/nope.js', '/glasses/assets/gone.js']) {
      const response = await fetch(`${origin}${miss}`);
      expect(response.status, miss).toBe(404);
      const text = await response.text();
      expect(text, miss).not.toContain('Spotter');
      expect(response.headers.get('Content-Type') ?? '', miss).not.toMatch(
        /^text\/html/,
      );
    }
  }, 20_000);

  it('keeps the spotter single-page fallback everywhere outside /glasses/', async () => {
    worker = await startWorker(undefined, await siteAssets());
    const { origin } = worker;

    for (const path of ['/', '/console', '/some/deep/link']) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('Content-Type'), path).toMatch(/^text\/html/);
      await expect(response.text(), path).resolves.toBe(SPOTTER_HTML);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }

    // An asset-like miss from a stale tab must not receive the shell as a
    // 200 "script" — the service worker would cache the HTML under that URL.
    for (const miss of ['/assets/main-OLD.js', '/nope.png']) {
      const response = await fetch(`${origin}${miss}`);
      expect(response.status, miss).toBe(404);
    }

    const sw = await fetch(`${origin}/sw.js`);
    expect(sw.status).toBe(200);
    expect(sw.headers.get('Content-Type')).toMatch(/javascript/);

    // The relay routes are still the Worker's, not the assets'.
    expect((await fetch(`${origin}/health`)).status).toBe(200);
    expect((await fetch(`${origin}/room/QA01`)).status).toBe(426);
  }, 20_000);
});
