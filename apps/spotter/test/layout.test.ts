/**
 * 040 AC-8: the console fits a phone screen. Nothing here is simulated — the
 * real `vite build` output is served over HTTP and measured in the container's
 * Chromium, because "does it need scrolling?" is a question only a layout
 * engine can answer (jsdom reports every box as 0×0).
 *
 * The relay is not running, so the socket never opens and the console renders
 * with its RECONNECTING banner up. That is the *tallest* console — the banner
 * costs a row that a healthy room does not — so it is the right case to
 * measure.
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

const MIN_TOUCH_PX = 44;
const MIN_LANE_PX = 64;

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

  async function measure(width: number, height: number): Promise<Measured> {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    // A stored room sends `main.ts` straight to the console, which is the only
    // screen this criterion is about.
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('g2rs:v1:room', 'CAR42');
      localStorage.setItem('g2rs:v1:name', 'Sam');
      // A console with recent chips is the fullest one; measuring the empty
      // one would let the chip row grow the page unnoticed.
      localStorage.setItem(
        'g2rs:v1:recentMsgs',
        JSON.stringify(['BOX THIS LAP', 'PIT NOW', 'DEBRIS TURN 4']),
      );
    });
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.waitForSelector('.console .lane');
    // The banner is what makes the console tallest; wait for it to be up.
    await page.waitForSelector(
      '[data-testid="reconnect-banner"]:not([hidden])',
    );

    try {
      return await page.evaluate(() => {
        const consoleEl = document.querySelector('.console')!;
        // A hidden slot (the update toast) is 0 px by design; only what the
        // spotter can actually hit has to clear the touch floor.
        const heights = [...consoleEl.querySelectorAll('button')]
          .filter((el) => !el.hasAttribute('hidden'))
          .map((el) => el.getBoundingClientRect().height);
        const lanes = [...consoleEl.querySelectorAll('.lane')].map(
          (el) => el.getBoundingClientRect().height,
        );

        return {
          documentScroll: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          consoleScroll: consoleEl.scrollHeight,
          consoleClient: consoleEl.clientHeight,
          minButton: Math.min(...heights),
          minLane: Math.min(...lanes),
          buttons: heights.length,
        };
      });
    } finally {
      await context.close();
    }
  }

  for (const viewport of VIEWPORTS) {
    it(`fits ${viewport.name} (${viewport.width}x${viewport.height})`, async () => {
      const measured = await measure(viewport.width, viewport.height);

      // Reported so a regression says by how much, not just that it failed.
      console.info(
        `layout ${viewport.width}x${viewport.height}: document ${measured.documentScroll} <= ${measured.innerHeight}, console ${measured.consoleScroll} <= ${measured.consoleClient}, buttons ${measured.buttons} min ${measured.minButton}px, lanes min ${measured.minLane}px`,
      );

      expect(measured.documentScroll).toBeLessThanOrEqual(measured.innerHeight);
      expect(measured.consoleScroll).toBeLessThanOrEqual(
        measured.consoleClient,
      );
      expect(measured.buttons).toBeGreaterThanOrEqual(11);
      expect(measured.minButton).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
      expect(measured.minLane).toBeGreaterThanOrEqual(MIN_LANE_PX);
    }, 60_000);
  }
});
