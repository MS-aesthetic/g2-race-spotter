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
      return withCors(await env.ASSETS.fetch(request));
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
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request);
  },
} satisfies ExportedHandler<Env>;
