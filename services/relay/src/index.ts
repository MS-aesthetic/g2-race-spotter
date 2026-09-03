import { RaceRoom } from './race-room.js';

const ROOM_PATH = /^\/room\/([a-z0-9]{4,6})$/i;

export { RaceRoom };

export default {
  async fetch(request, env): Promise<Response> {
    const match = ROOM_PATH.exec(new URL(request.url).pathname);
    if (match === null) {
      return new Response('Not found', { status: 404 });
    }

    if (
      request.method !== 'GET' ||
      request.headers.get('Upgrade') !== 'websocket'
    ) {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const roomId = match[1].toUpperCase();
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request);
  },
} satisfies ExportedHandler<Env>;
