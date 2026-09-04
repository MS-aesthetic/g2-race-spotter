import { describe, expect, it } from 'vitest';

import {
  CLOSE_CODE_DRIVER_EVICTED,
  CLOSE_CODE_SILENT_PEER,
  RoomClient,
  type ConnectionCloseDetail,
  type ConnectionState,
  type RoomClientTimers,
  type RoomWebSocket,
} from '../src/index.js';

// Fakes mirror packages/protocol/test/client.test.ts's FakeSocket /
// FakeWebSocket / FakeTimers exactly (same behaviour) — that file does not
// export them, so this file keeps its own copies rather than diverging.

type Listener = (event: unknown) => void;

class FakeSocket implements RoomWebSocket {
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.emit('close', { code });
  }

  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: Listener,
  ): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open(): void {
    this.emit('open');
  }

  receive(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  fail(code?: number): void {
    this.emit('close', { code });
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeWebSocket {
  static readonly sockets: FakeSocket[] = [];

  constructor() {
    const socket = new FakeSocket();
    FakeWebSocket.sockets.push(socket);
    return socket;
  }

  static reset(): void {
    FakeWebSocket.sockets.length = 0;
  }
}

class FakeTimers implements RoomClientTimers {
  private nextHandle = 1;
  readonly timeouts = new Map<
    number,
    { callback: () => void; delayMs: number }
  >();
  readonly intervals = new Map<
    number,
    { callback: () => void; delayMs: number }
  >();

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timeouts.set(handle, { callback, delayMs });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timeouts.delete(handle);
  }

  setInterval(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.intervals.set(handle, { callback, delayMs });
    return handle;
  }

  clearInterval(handle: number): void {
    this.intervals.delete(handle);
  }

  runNextTimeout(): void {
    const next = this.timeouts.entries().next().value as
      [number, { callback: () => void; delayMs: number }] | undefined;
    if (!next) {
      throw new Error('no reconnect timer is scheduled');
    }
    this.timeouts.delete(next[0]);
    next[1].callback();
  }
}

const fakeWebSocket = FakeWebSocket as unknown as {
  new (url: string): RoomWebSocket;
};

function state(seq: number) {
  return {
    t: 'state' as const,
    seq,
    lane: null,
    gap: 0,
    msg: null,
    spotterOnline: false,
    driverOnline: false,
    updatedAt: 100,
  };
}

function createClient(
  timers: FakeTimers,
  options: Partial<ConstructorParameters<typeof RoomClient>[0]> = {},
): RoomClient {
  return new RoomClient({
    WebSocket: fakeWebSocket,
    role: 'spotter',
    timers,
    now: () => 123,
    random: () => 0.5,
    ...options,
  });
}

describe('RoomClient errors and terminal closes', () => {
  it('invokes onError with the parsed error frame', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);
    const errors: Array<{ code: string; detail?: string }> = [];
    client.onError((error) => errors.push(error));

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeWebSocket.sockets[0];
    socket.open();
    socket.receive({ t: 'error', code: 'auth' });

    expect(errors).toEqual([{ t: 'error', code: 'auth' }]);
  });

  it('supports multiple onError subscribers and unsubscribe', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);
    const first: string[] = [];
    const second: string[] = [];
    const unsubscribeFirst = client.onError((error) => first.push(error.code));
    client.onError((error) => second.push(error.code));

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeWebSocket.sockets[0];
    socket.open();
    socket.receive({ t: 'error', code: 'rate' });
    unsubscribeFirst();
    socket.receive({ t: 'error', code: 'bad_frame' });

    expect(first).toEqual(['rate']);
    expect(second).toEqual(['rate', 'bad_frame']);
  });

  it('reports 4409 as terminal on the closed callback, empties the queue, and schedules no reconnect', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);
    const closes: Array<[ConnectionState, ConnectionCloseDetail]> = [];
    client.onConnection((connectionState, detail) =>
      closes.push([connectionState, detail]),
    );

    const url = 'ws://relay.test/room/CAR42?role=spotter';
    client.connect(url);
    const socket = FakeWebSocket.sockets[0];
    // The socket has not opened/replayed yet, so these are queued rather
    // than sent — exactly the state a terminal close must not let survive.
    client.send({ t: 'lane', lane: 'top' });
    client.send({ t: 'msg', text: 'queued before rejection' });

    socket.fail(CLOSE_CODE_DRIVER_EVICTED);

    const closedEvents = closes.filter(
      ([connectionState]) => connectionState === 'closed',
    );
    expect(closedEvents).toEqual([
      ['closed', { code: CLOSE_CODE_DRIVER_EVICTED, terminal: true }],
    ]);
    expect(timers.timeouts.size).toBe(0);

    // A later session on the *same* URL (a fresh manual connect(), since a
    // terminal close never reconnects on its own — this deliberately avoids
    // the unrelated urlChanged clearPending() path) must not inherit the
    // dropped queue.
    client.connect(url);
    const next = FakeWebSocket.sockets[1];
    next.open();
    next.receive(state(1));
    expect(next.sent.map((frame) => JSON.parse(frame))).toEqual([
      { t: 'hello', v: 1, role: 'spotter' },
    ]);
  });

  it('reports a non-terminal close (1006) as not terminal and schedules a reconnect', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);
    const closes: Array<[ConnectionState, ConnectionCloseDetail]> = [];
    client.onConnection((connectionState, detail) =>
      closes.push([connectionState, detail]),
    );

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeWebSocket.sockets[0];
    socket.open();
    socket.receive(state(1));
    socket.fail(1006);

    const closedEvents = closes.filter(
      ([connectionState]) => connectionState === 'closed',
    );
    expect(closedEvents).toEqual([['closed', { code: 1006, terminal: false }]]);
    expect(timers.timeouts.size).toBe(1);
  });

  it('also treats a silent-peer close (4408) as non-terminal', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);
    const closes: ConnectionCloseDetail[] = [];
    client.onConnection((connectionState, detail) => {
      if (connectionState === 'closed') {
        closes.push(detail);
      }
    });

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeWebSocket.sockets[0];
    socket.open();
    socket.receive(state(1));
    socket.fail(CLOSE_CODE_SILENT_PEER);

    expect(closes).toEqual([{ code: CLOSE_CODE_SILENT_PEER, terminal: false }]);
    expect(timers.timeouts.size).toBe(1);
  });

  it('replaces a zombie CONNECTING socket on a foreground connect() instead of blocking on it', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);
    const url = 'ws://relay.test/room/CAR42?role=spotter';

    client.connect(url);
    const zombie = FakeWebSocket.sockets[0];
    // The zombie never opens (never fires 'open'), so it never replays.

    client.connect(url);

    expect(FakeWebSocket.sockets.length).toBe(2);
    const fresh = FakeWebSocket.sockets[1];
    expect(fresh).not.toBe(zombie);

    // The zombie's belated events must not resurrect it as the live socket.
    zombie.open();
    zombie.receive(state(5));
    expect(client.lastSeen).toBe(0);

    fresh.open();
    fresh.receive(state(1));
    expect(client.lastSeen).toBe(1);
    expect(fresh.sent.map((frame) => JSON.parse(frame))).toEqual([
      { t: 'hello', v: 1, role: 'spotter' },
    ]);
  });
});
