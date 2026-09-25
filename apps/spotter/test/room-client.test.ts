import {
  CLOSE_CODE_AUTH,
  PROTOCOL_VERSION,
  type RoomWebSocket,
} from '@g2-race-spotter/protocol';
import { describe, expect, it } from 'vitest';

import {
  createSpotterClient,
  nextLatency,
  relayOrigin,
  roomUrl,
} from '../src/net/room-client.ts';
import { shellAssets, shouldHandle } from '../src/sw.ts';

type Listener = (event: unknown) => void;

class FakeSocket implements RoomWebSocket {
  static last: FakeSocket | undefined;

  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close', { code: 1_006 });
  }

  addEventListener(type: string, listener: Listener): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  deliver(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

function stateFrame(seq: number) {
  return {
    t: 'state',
    seq,
    lane: null,
    cars: [0, 0, 0],
    msg: null,
    spotterOnline: true,
    driverOnline: false,
    updatedAt: 1,
    calledAt: 0,
  };
}

describe('EWMA latency', () => {
  it('seeds from the first sample and converges over ~5', () => {
    expect(nextLatency(null, 200)).toBe(200);
    // alpha = 2/6; 200 -> 200 + (80-200)/3 = 160
    expect(nextLatency(200, 80)).toBe(160);
    expect(nextLatency(160, 160)).toBe(160);
  });

  it('never reports a negative round trip', () => {
    expect(nextLatency(null, -5)).toBe(0);
  });
});

describe('spotter RoomClient wrapper', () => {
  it('derives round-trip latency from pong.ts without touching the protocol package', () => {
    const samples: number[] = [];
    let now = 0;
    const client = createSpotterClient({
      WebSocket: FakeSocket,
      name: 'Sam',
      now: () => now,
      onLatency: (ms) => samples.push(ms),
    });

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeSocket.last!;
    socket.emit('open', {});

    // RoomClient sent `hello` first; the ping loop stamps `ts` with `now`.
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      t: 'hello',
      v: PROTOCOL_VERSION,
      role: 'spotter',
      name: 'Sam',
    });

    now = 240;
    socket.deliver({ t: 'pong', ts: 100, serverTs: 170 });

    expect(samples).toEqual([140]);

    // Frames that are not pongs must not produce a sample.
    socket.deliver(stateFrame(1));
    socket.emit('message', { data: 'not json' });
    expect(samples).toEqual([140]);

    client.disconnect();
  });

  it('keeps delivering frames when the latency callback throws', () => {
    const seen: number[] = [];
    const client = createSpotterClient({
      WebSocket: FakeSocket,
      now: () => 500,
      onLatency: () => {
        throw new Error('render blew up');
      },
    });
    client.onState((state) => seen.push(state.seq));

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeSocket.last!;
    socket.emit('open', {});
    expect(() =>
      socket.deliver({ t: 'pong', ts: 100, serverTs: 200 }),
    ).not.toThrow();
    socket.deliver(stateFrame(1));

    expect(seen).toEqual([1]);

    client.disconnect();
  });

  it('reports a terminal auth close so the UI can bounce back to Join', () => {
    const closes: Array<{ code: number | undefined; terminal: boolean }> = [];
    const client = createSpotterClient({
      WebSocket: FakeSocket,
      onLatency: () => undefined,
    });
    client.onConnection((state, detail) => {
      if (state === 'closed') {
        closes.push(detail);
      }
    });

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeSocket.last!;
    socket.emit('open', {});
    socket.emit('close', { code: CLOSE_CODE_AUTH });

    expect(closes).toEqual([{ code: CLOSE_CODE_AUTH, terminal: true }]);
  });

  it('still delivers state frames through the observing socket', () => {
    const seen: number[] = [];
    const client = createSpotterClient({
      WebSocket: FakeSocket,
      onLatency: () => undefined,
    });
    client.onState((state) => seen.push(state.seq));

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeSocket.last!;
    socket.emit('open', {});
    socket.deliver(stateFrame(1));
    socket.deliver(stateFrame(2));

    expect(seen).toEqual([1, 2]);

    client.disconnect();
  });
});

describe('room URL', () => {
  it('builds the documented query string', () => {
    expect(
      roomUrl('wss://relay.example.com', {
        room: 'CAR42',
        pin: '1234',
        name: 'Sam Ray',
      }),
    ).toBe(
      'wss://relay.example.com/room/CAR42?role=spotter&token=1234&name=Sam+Ray',
    );
  });

  it('omits an absent PIN and name', () => {
    expect(
      roomUrl('ws://localhost:8787/', { room: 'QA01', pin: '', name: '' }),
    ).toBe('ws://localhost:8787/room/QA01?role=spotter');
  });

  it('derives wss from https and honours an explicit override', () => {
    expect(relayOrigin({ protocol: 'https:', host: 'spot.example' })).toBe(
      'wss://spot.example',
    );
    expect(relayOrigin({ protocol: 'http:', host: 'localhost:8787' })).toBe(
      'ws://localhost:8787',
    );
    expect(
      relayOrigin(
        { protocol: 'https:', host: 'spot.example' },
        'ws://192.168.1.5:8787/',
      ),
    ).toBe('ws://192.168.1.5:8787');
  });
});

describe('service worker shell discovery', () => {
  it('picks the hashed JS and CSS out of the built index.html', () => {
    const html = [
      '<link rel="manifest" href="/manifest.webmanifest">',
      '<link rel="apple-touch-icon" href="/icon-192.png">',
      '<link rel="stylesheet" crossorigin href="/assets/main-DL0oZ.css">',
      '<script type="module" crossorigin src="/assets/main-B2LL9.js"></script>',
      '<script src="https://cdn.example/analytics.js"></script>',
      '<script src="//cdn.example/other.js"></script>',
    ].join('\n');

    expect(shellAssets(html).sort()).toEqual([
      '/assets/main-B2LL9.js',
      '/assets/main-DL0oZ.css',
    ]);
  });

  it('returns nothing for HTML with no local code', () => {
    expect(shellAssets('<html><body>hi</body></html>')).toEqual([]);
  });
});

describe('R7 service worker passthrough', () => {
  const origin = 'https://spot.example';

  it('never intercepts /room/* or /health', () => {
    expect(
      shouldHandle('GET', `${origin}/room/CAR42?role=spotter`, origin),
    ).toBe(false);
    expect(shouldHandle('GET', `${origin}/room/`, origin)).toBe(false);
    expect(shouldHandle('GET', `${origin}/health`, origin)).toBe(false);
  });

  it('handles the app shell and its assets', () => {
    expect(shouldHandle('GET', `${origin}/`, origin)).toBe(true);
    expect(shouldHandle('GET', `${origin}/assets/main-abc.js`, origin)).toBe(
      true,
    );
    expect(shouldHandle('GET', `${origin}/manifest.webmanifest`, origin)).toBe(
      true,
    );
  });

  it('leaves cross-origin and non-GET traffic alone', () => {
    expect(shouldHandle('GET', 'https://other.example/', origin)).toBe(false);
    expect(shouldHandle('POST', `${origin}/`, origin)).toBe(false);
    expect(shouldHandle('GET', 'not a url', origin)).toBe(false);
  });
});
