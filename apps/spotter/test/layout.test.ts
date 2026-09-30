/**
 * 040 AC-8: the console fits a phone screen. Nothing here is simulated — the
 * real `vite build` output is served over HTTP and measured in the container's
 * Chromium, because "does it need scrolling?" is a question only a layout
 * engine can answer (jsdom reports every box as 0×0).
 *
 * Two consoles per viewport (design round 4, 2026-09-25): `down` — no relay,
 * the socket never opens, the header shows its RECONNECTING pill — and `live`
 * — the page's WebSocket is replaced by an in-page fake that replays a room
 * holding three saved messages and an unacknowledged message, which is the
 * fullest console (preset chips, ack icon). Saved messages are room state, so
 * only a replayed room can show them.
 */

import { createReadStream, existsSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { AddressInfo } from 'node:net';

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSpotter, tempDist } from './build-app.ts';

const DIST = tempDist('g2rs-spotter-layout-');

/** Portrait phones the spotter is likely to hold, plus a landscape one. */
const VIEWPORTS = [
  { name: 'iPhone-ish portrait', width: 390, height: 664 },
  { name: 'small Android portrait', width: 360, height: 640 },
  { name: 'landscape', width: 740, height: 360 },
] as const;

/** Every button, and each fader knob and track's hit width. */
const MIN_TOUCH_PX = 44;
const MIN_LANE_PX = 64;
/** Lanes and faders stay in the top of a portrait screen: round 4's "top
 * half", loosened to 55 % in round 5 so the faders get a usable travel. */
const TOP_SHARE = 0.55;
/** Four detents on the smallest travel still leave a finger-sized step. */
const MIN_TRACK_PX = 96;

const LIVE_PRESETS = ['BOX THIS LAP', 'PIT NOW', 'DEBRIS TURN 4 STAY LEFT'];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * The Chromium this machine already has, in the order most likely to be right:
 * an explicit `CHROME_PATH`, Playwright's own registry (`executablePath()`,
 * which honours `PLAYWRIGHT_BROWSERS_PATH`), then a scan of the browsers
 * directory for a build whose revision this `playwright-core` did not install.
 * A download is never triggered.
 */
function findChromium(): string | undefined {
  const explicit = process.env.CHROME_PATH;
  if (explicit !== undefined && explicit !== '' && existsSync(explicit)) {
    return explicit;
  }

  try {
    const registered = chromium.executablePath();
    if (registered !== '' && existsSync(registered)) {
      return registered;
    }
  } catch {
    // No browser registered for this playwright-core build; scan instead.
  }

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) {
    return undefined;
  }

  const binaries = ['chrome', 'headless_shell'];
  for (const entry of readdirSync(root).filter((name) =>
    name.startsWith('chromium'),
  )) {
    for (const dir of ['chrome-linux', 'chrome-linux64']) {
      for (const binary of binaries) {
        const candidate = join(root, entry, dir, binary);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

function serveDist(root: string): Promise<Server> {
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const relative = normalize(path === '/' ? '/index.html' : path).replace(
      /^(\.\.[/\\])+/,
      '',
    );
    const file = join(root, relative);
    if (!file.startsWith(root) || !existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

interface Measured {
  documentScroll: number;
  innerHeight: number;
  consoleScroll: number;
  consoleClient: number;
  minButton: number;
  minLane: number;
  buttons: number;
  fadersBottom: number;
  faders: number;
  gaps: number[];
  knob: { minWidth: number; minHeight: number };
  track: { minWidth: number; minHeight: number };
  presetSizes: string[];
  presetChips: number;
  presetsScroll: number;
  presetsClient: number;
}

/**
 * Runs in the page before `main.ts`: a WebSocket that opens at once and
 * answers `hello` with a replayed room. `RoomClient` only needs
 * `addEventListener`/`send`/`close`, which an `EventTarget` provides.
 */
function installFakeRelay(presets: readonly string[]): void {
  class FakeRelaySocket extends EventTarget {
    constructor(readonly url: string) {
      super();
      setTimeout(() => this.dispatchEvent(new Event('open')), 0);
    }

    send(data: string): void {
      if ((JSON.parse(data) as { t?: string }).t !== 'hello') {
        return;
      }

      const state = {
        t: 'state',
        seq: 5,
        lane: 'mid',
        cars: [1, 2, 3],
        msg: { id: 'm1', text: 'PIT NOW', ts: 1, ackedAt: null },
        spotterOnline: true,
        driverOnline: true,
        updatedAt: 2,
        calledAt: 1,
        presets,
      };
      setTimeout(() => {
        this.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(state) }),
        );
      }, 0);
    }

    close(): void {}
  }

  Object.assign(window, { WebSocket: FakeRelaySocket });
}

const executablePath = findChromium();
const MISSING_BROWSER =
  'layout.test: no Chromium found — set CHROME_PATH, or PLAYWRIGHT_BROWSERS_PATH to a Playwright browsers directory (this container ships /opt/pw-browsers)';

// A dev box without a browser may skip; CI may not — a criterion that quietly
// stops running is worse than one that fails.
if (executablePath === undefined) {
  if (process.env.CI !== undefined && process.env.CI !== '') {
    throw new Error(MISSING_BROWSER);
  }

  console.warn(MISSING_BROWSER);
}

const describeOrSkip = executablePath === undefined ? describe.skip : describe;

describeOrSkip('AC-8 the console never needs scrolling', () => {
  let server: Server | undefined;
  let browser: Browser;
  let origin = '';

  beforeAll(async () => {
    buildSpotter(DIST);
    server = await serveDist(DIST);
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ executablePath });
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    // The build can throw before `server` exists; an unguarded `close`
    // callback would then never fire and hang the hook instead of reporting
    // the real failure.
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }

      server.close(() => resolve());
    });
    rmSync(DIST, { recursive: true, force: true });
  });

  async function measure(
    width: number,
    height: number,
    live: boolean,
  ): Promise<Measured> {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    if (live) {
      await page.addInitScript(installFakeRelay, LIVE_PRESETS);
    }

    // A stored, current room sends `main.ts` straight to the console, which
    // is the only screen this criterion is about.
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('g2rs:v1:room', 'CAR42');
      localStorage.setItem('g2rs:v1:pin', '1234');
      localStorage.setItem('g2rs:v1:name', 'Sam');
      localStorage.setItem('g2rs:v1:seenAt', String(Date.now()));
    });
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.waitForSelector('.console .lane');
    await page.waitForSelector(
      live
        ? '[data-testid="preset-chips"]:not([hidden])'
        : '[data-testid="reconnect-pill"]:not([hidden])',
    );

    try {
      if (process.env.G2RS_LAYOUT_SHOTS) {
        await page.waitForTimeout(200);
        await page.screenshot({
          path: join(
            process.env.G2RS_LAYOUT_SHOTS,
            `console-${width}x${height}-${live ? 'live' : 'down'}.png`,
          ),
        });
      }
      return await page.evaluate(() => {
        const consoleEl = document.querySelector('.console')!;
        const presetsEl = document.querySelector('.presets')!;
        const visible = (el: Element): boolean =>
          el.getBoundingClientRect().height > 0;
        const height = (el: Element): number =>
          el.getBoundingClientRect().height;
        // A hidden slot (the update toast) is 0 px by design; only what the
        // spotter can actually hit has to clear the touch floor.
        const buttons = [...consoleEl.querySelectorAll('button')].filter(
          visible,
        );
        const boxes = (selector: string): DOMRect[] =>
          [...consoleEl.querySelectorAll(selector)].map((el) =>
            el.getBoundingClientRect(),
          );
        const faders = boxes('.fader');
        const knobs = boxes('.fader__knob');
        const tracks = boxes('.fader__track');

        return {
          documentScroll: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          consoleScroll: consoleEl.scrollHeight,
          consoleClient: consoleEl.clientHeight,
          minButton: Math.min(...buttons.map(height)),
          minLane: Math.min(
            ...[...consoleEl.querySelectorAll('.lane')].map(height),
          ),
          buttons: buttons.length,
          fadersBottom: document
            .querySelector('.faders')!
            .getBoundingClientRect().bottom,
          faders: faders.length,
          // Horizontal space between neighbouring faders.
          gaps: faders
            .slice(1)
            .map((box, index) => box.left - faders[index]!.right),
          knob: {
            minWidth: Math.min(...knobs.map((box) => box.width)),
            minHeight: Math.min(...knobs.map((box) => box.height)),
          },
          track: {
            minWidth: Math.min(...tracks.map((box) => box.width)),
            minHeight: Math.min(...tracks.map((box) => box.height)),
          },
          presetSizes: boxes('.say').map(
            (box) => `${box.width.toFixed(1)}x${box.height.toFixed(1)}`,
          ),
          presetChips: presetsEl.querySelectorAll('.pchip').length,
          presetsScroll: presetsEl.scrollHeight,
          presetsClient: presetsEl.clientHeight,
        };
      });
    } finally {
      await context.close();
    }
  }

  for (const viewport of VIEWPORTS) {
    for (const live of [false, true]) {
      const label = live ? 'live room with presets' : 'relay down';
      it(`fits ${viewport.name} (${viewport.width}x${viewport.height}), ${label}`, async () => {
        const measured = await measure(viewport.width, viewport.height, live);
        const portrait = viewport.height > viewport.width;

        // Reported so a regression says by how much, not just that it failed.
        console.info(
          `layout ${viewport.width}x${viewport.height} ${live ? 'live' : 'down'}: document ${measured.documentScroll} <= ${measured.innerHeight}, console ${measured.consoleScroll} <= ${measured.consoleClient}, buttons ${measured.buttons} min ${measured.minButton}px, lanes min ${measured.minLane}px, faders end y=${measured.fadersBottom} (${((100 * measured.fadersBottom) / measured.innerHeight).toFixed(1)} %), gaps ${measured.gaps.map((gap) => gap.toFixed(0)).join('/')}px, knob ${measured.knob.minWidth}x${measured.knob.minHeight}, track ${measured.track.minWidth}x${measured.track.minHeight}, presets ${[...new Set(measured.presetSizes)].join(',')}, preset chips ${measured.presetChips} (${measured.presetsScroll} <= ${measured.presetsClient})`,
        );

        expect(measured.documentScroll).toBeLessThanOrEqual(
          measured.innerHeight,
        );
        expect(measured.consoleScroll).toBeLessThanOrEqual(
          measured.consoleClient,
        );
        // code chip + 3 lanes + clear + 5 built-ins + Send/Save, and in the
        // live room a text + × button per saved message. Faders are not
        // buttons: each is one slider track.
        expect(measured.buttons).toBe(
          12 + (live ? 2 * LIVE_PRESETS.length : 0),
        );
        expect(measured.minButton).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
        expect(measured.minLane).toBeGreaterThanOrEqual(MIN_LANE_PX);
        // Three faders with clear horizontal gaps; a finger-sized knob on a
        // track at least a finger wide and tall enough for four detents.
        expect(measured.faders).toBe(3);
        for (const gap of measured.gaps) {
          expect(gap).toBeGreaterThanOrEqual(12);
        }
        expect(measured.knob.minWidth).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
        expect(measured.knob.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
        expect(measured.track.minWidth).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
        expect(measured.track.minHeight).toBeGreaterThanOrEqual(MIN_TRACK_PX);
        // All five built-in messages are the same size (SPIN included).
        expect(measured.presetSizes).toHaveLength(5);
        expect(new Set(measured.presetSizes).size).toBe(1);
        if (portrait) {
          // Lanes and faders sit in the top 55 % of a portrait phone.
          expect(measured.fadersBottom).toBeLessThanOrEqual(
            measured.innerHeight * TOP_SHARE,
          );
        }
        if (live) {
          // Three saved messages are all visible without scrolling their box.
          expect(measured.presetChips).toBe(LIVE_PRESETS.length);
          expect(measured.presetsScroll).toBeLessThanOrEqual(
            measured.presetsClient,
          );
        }
      }, 60_000);
    }
  }

  /** Smallest QR edge a phone camera reads comfortably across a pit lane. */
  const MIN_QR_PX = 140;

  for (const viewport of VIEWPORTS) {
    it(`fits the driver setup screen (room, PIN, QR, URL, instructions) in ${viewport.name} (${viewport.width}x${viewport.height})`, async () => {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      try {
        await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
          localStorage.setItem('g2rs:v1:room', 'Q7X2KD');
          localStorage.setItem('g2rs:v1:pin', '0042');
          localStorage.setItem('g2rs:v1:seenAt', String(Date.now()));
        });
        await page.goto(`${origin}/`, { waitUntil: 'load' });
        await page.click('[data-testid="header-room"]');
        await page.waitForSelector(
          '[data-testid="code-overlay"]:not([hidden])',
        );

        const measured = await page.evaluate(() => {
          const overlay = document.querySelector('.codeview')!;
          const box = (selector: string): DOMRect =>
            overlay.querySelector(selector)!.getBoundingClientRect();
          const parts = [
            '.codeview__code',
            '.codeview__pin',
            '.codeview__qr',
            '.codeview__url',
            '.codeview__hint',
          ].map(box);
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            overlayScroll: overlay.scrollHeight,
            overlayClient: overlay.clientHeight,
            qr: box('.codeview__qr').toJSON() as DOMRect,
            top: Math.min(...parts.map((part) => part.top)),
            bottom: Math.max(...parts.map((part) => part.bottom)),
            right: Math.max(...parts.map((part) => part.right)),
          };
        });
        console.info(
          `driver setup ${viewport.width}x${viewport.height}: overlay ${measured.overlayScroll} <= ${measured.overlayClient}, QR ${Math.round(measured.qr.width)}x${Math.round(measured.qr.height)} at y=${Math.round(measured.qr.top)}, content y ${Math.round(measured.top)}..${Math.round(measured.bottom)}`,
        );

        expect(measured.overlayScroll).toBeLessThanOrEqual(
          measured.overlayClient,
        );
        expect(measured.top).toBeGreaterThanOrEqual(0);
        expect(measured.bottom).toBeLessThanOrEqual(measured.innerHeight);
        expect(measured.right).toBeLessThanOrEqual(measured.innerWidth);
        expect(measured.qr.width).toBeGreaterThanOrEqual(MIN_QR_PX);
        expect(measured.qr.height).toBeCloseTo(measured.qr.width, 0);
        if (process.env.G2RS_LAYOUT_SHOTS) {
          await page.screenshot({
            path: join(
              process.env.G2RS_LAYOUT_SHOTS,
              `driver-setup-${viewport.width}x${viewport.height}.png`,
            ),
          });
        }
      } finally {
        await context.close();
      }
    }, 60_000);
  }
});
