import { RaceRoom } from './race-room.js';
import { PROTOCOL_VERSION } from '@g2-race-spotter/protocol';

const ROOM_PATH = /^\/room\/([a-z0-9]{4,6})$/i;
const DEBUG_PATH = /^\/room\/([a-z0-9]{4,6})\/debug$/i;
const INTERNAL_DEBUG_HEADER = 'X-G2RS-Internal-Debug';

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type, X-Debug-Key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Origin': '*',
} as const;

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * The glasses app the driver sideloads by QR (T058). It is a separate app
 * with its own `index.html`, so a miss under it must stay a 404: handing the
 * Even app's WebView the spotter shell for a missing script would fail
 * silently instead of loudly.
 */
function isGlassesPath(pathname: string): boolean {
  return pathname === '/glasses' || pathname.startsWith('/glasses/');
}

/**
 * Static assets with the spotter's single-page fallback done here rather than
 * by `not_found_handling`, because that setting is one policy for the whole
 * site and `/glasses/*` needs the opposite one.
 */
async function serveAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const url = new URL(request.url);
  const lastSegment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  if (
    response.status !== 404 ||
    isGlassesPath(url.pathname) ||
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    // An asset-like miss (`/assets/main-OLD.js` from a stale tab) must stay a
    // 404: a 200 HTML "script" would be cached by the service worker.
    lastSegment.includes('.')
  ) {
    return response;
  }

  return env.ASSETS.fetch(new Request(new URL('/', url), request));
}

function withoutInternalDebugHeader(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_DEBUG_HEADER);
  return new Request(request, { headers });
}

export { RaceRoom };

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return withCors(Response.json({ ok: true, version: PROTOCOL_VERSION }));
    }

    const debugMatch = DEBUG_PATH.exec(url.pathname);
    if (debugMatch !== null) {
      if (
        request.method !== 'GET' ||
        request.headers.get('X-Debug-Key') !== env.DEBUG_KEY
      ) {
        return withCors(new Response('Forbidden', { status: 403 }));
      }

      const roomId = debugMatch[1].toUpperCase();
      const debugRequest = new Request(request, {
        headers: new Headers({ [INTERNAL_DEBUG_HEADER]: '1' }),
      });
      return withCors(
        await env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(debugRequest),
      );
    }

    const match = ROOM_PATH.exec(url.pathname);
    if (match === null) {
      return withCors(await serveAsset(request, env));
    }

    if (
      request.method !== 'GET' ||
      request.headers.get('Upgrade') !== 'websocket'
    ) {
      return withCors(
        new Response('Expected Upgrade: websocket', { status: 426 }),
      );
    }

    const roomId = match[1].toUpperCase();
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(
      withoutInternalDebugHeader(request),
    );
  },
} satisfies ExportedHandler<Env>;
