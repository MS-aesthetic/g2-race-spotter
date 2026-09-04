/**
 * App-shell service worker.
 *
 * The one hard rule (spec 040 R7): never intercept `/room/*` or `/health`.
 * The relay's WebSocket upgrade and its health probe must reach the network
 * untouched — a cached or rewritten response there would either break the
 * socket outright or let a stale reply masquerade as a live relay. Everything
 * else is app shell: navigations are network-first so a deploy is picked up on
 * the next load, hashed assets are cache-first because their names already
 * encode their version.
 */

const CACHE = 'g2rs-shell-v1';

/** Nothing here is content-hashed, so it can be listed ahead of the build. */
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

/** Paths the worker must stay out of. */
const PASSTHROUGH = /^\/(?:room\/|health$)/;

/**
 * Pure so the R7 guarantee is unit-testable without a ServiceWorker global.
 * Cross-origin, non-GET and relay paths are all left to the network.
 */
export function shouldHandle(
  method: string,
  requestUrl: string,
  scopeOrigin: string,
): boolean {
  if (method !== 'GET') {
    return false;
  }

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }

  if (url.origin !== scopeOrigin) {
    return false;
  }

  return !PASSTHROUGH.test(url.pathname);
}

interface SwExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SwFetchEvent extends SwExtendableEvent {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

interface SwScope extends EventTarget {
  location: { origin: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}

/**
 * `undefined` outside a worker. Unit tests import this module for
 * `shouldHandle` (the R7 guarantee) and must not need a ServiceWorker global
 * just to read a pure function.
 */
const scope = (globalThis as { self?: unknown }).self as SwScope | undefined;

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached !== undefined) {
      return cached;
    }

    const shell = await caches.match('/');
    if (shell !== undefined) {
      return shell;
    }

    throw error;
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached !== undefined) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }

  return response;
}

scope?.addEventListener('install', (event) => {
  (event as SwExtendableEvent).waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined),
  );
});

scope?.addEventListener('activate', (event) => {
  (event as SwExtendableEvent).waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await scope?.clients.claim();
    })(),
  );
});

scope?.addEventListener('fetch', (event) => {
  const fetchEvent = event as SwFetchEvent;
  const request = fetchEvent.request;
  if (
    !shouldHandle(request.method, request.url, scope?.location.origin ?? '')
  ) {
    return;
  }

  fetchEvent.respondWith(
    request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request),
  );
});

scope?.addEventListener('message', (event) => {
  if ((event as MessageEvent).data === 'skip-waiting') {
    void scope?.skipWaiting();
  }
});
