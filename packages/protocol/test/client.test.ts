import { describe, expect, it } from 'vitest';

import {
  CLOSE_CODE_AUTH,
  CLOSE_CODE_BAD_HELLO,
  CLOSE_CODE_DRIVER_EVICTED,
  CLOSE_CODE_SILENT_PEER,
  CLOSE_CODE_VERSION,
  PING_INTERVAL_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  RoomClient,
  type RoomClientTimers,
  type RoomWebSocket,
} from '../src/index.js';

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
    this.receiveRaw(JSON.stringify(message));
  }

  receiveRaw(data: unknown): void {
    this.emit('message', { data });
  }

  fail(code?: number): void {
    this.emit('close', { code });
  }

  error(): void {
    this.emit('error');
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

class FakeNodeSocket implements RoomWebSocket {
  readonly sent: string[] = [];
  private readonly listeners = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.emit('close', code);
  }

  on(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (...args: unknown[]) => void,
  ): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open(): void {
    this.emit('open');
  }

  fail(code?: number): void {
    this.emit('close', code);
  }

  error(): void {
    this.emit('error');
  }

  private emit(type: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(...args);
    }
  }
}

class FakeNodeWebSocket {
  static readonly sockets: FakeNodeSocket[] = [];

  constructor() {
    const socket = new FakeNodeSocket();
    FakeNodeWebSocket.sockets.push(socket);
    return socket;
  }

  static reset(): void {
    FakeNodeWebSocket.sockets.length = 0;
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

  tickIntervals(): void {
    for (const interval of this.intervals.values()) {
      interval.callback();
    }
  }
}

function sent(socket: FakeSocket): unknown[] {
  return socket.sent.map((frame) => JSON.parse(frame));
}

const fakeWebSocket = FakeWebSocket as unknown as {
  new (url: string): RoomWebSocket;
};
const fakeNodeWebSocket = FakeNodeWebSocket as unknown as {
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

describe('RoomClient', () => {
  it('forgets lastFrameAt from a previous socket session on reconnect and on disconnect', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    let now = 1_000;
    const client = createClient(timers, { now: () => now });

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const first = FakeWebSocket.sockets[0];
    expect(client.lastFrameAt).toBeUndefined();
    first.open();
    first.receive(state(1));
    expect(client.lastFrameAt).toBe(1_000);

    now = 1_500;
    first.fail();
    // the drop itself is not a frame: the stale timestamp must not survive into the next session
    timers.runNextTimeout();
    const second = FakeWebSocket.sockets[1];
    expect(client.lastFrameAt).toBeUndefined();
    second.open();
    expect(client.lastFrameAt).toBeUndefined();
    now = 2_000;
    second.receive({ t: 'pong', ts: 1, serverTs: 2 });
    expect(client.lastFrameAt).toBe(2_000);

    client.disconnect();
    expect(client.lastFrameAt).toBeUndefined();
  });

  it('clears lastFrameAt on a terminal close because no reconnect will follow', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers, { now: () => 5_000 });

    client.connect('ws://relay.test/room/CAR42?role=driver');
    const socket = FakeWebSocket.sockets[0];
    socket.open();
    socket.receive(state(1));
    expect(client.lastFrameAt).toBe(5_000);

    socket.fail(CLOSE_CODE_DRIVER_EVICTED);
    expect(client.lastFrameAt).toBeUndefined();
    expect(timers.timeouts.size).toBe(0);
  });

  it('drops, reopens, waits for replay, and flushes only disconnected intents', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers, { name: 'Pit wall' });

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const first = FakeWebSocket.sockets[0];
    first.open();
    first.receive(state(1));
    client.send({ t: 'msg', text: 'already delivered' });
    first.fail();

    client.send({ t: 'lane', lane: 'top' });
    client.send({ t: 'gap', value: 20 });
    client.send({ t: 'gap', value: 80 });
    client.send({ t: 'ack', msgId: 'old-message' });
    client.send({ t: 'msg', text: 'first offline' });
    client.send({ t: 'clear' });
    client.send({ t: 'msg', text: 'hold line' });

    expect(sent(first)).toEqual([
      { t: 'hello', v: 1, role: 'spotter', name: 'Pit wall' },
      { t: 'msg', text: 'already delivered' },
    ]);
    expect([...timers.timeouts.values()]).toEqual([
      expect.objectContaining({ delayMs: RECONNECT_MIN_MS }),
    ]);

    timers.runNextTimeout();
    const second = FakeWebSocket.sockets[1];
    second.open();
    expect(sent(second)).toEqual([
      { t: 'hello', v: 1, role: 'spotter', name: 'Pit wall' },
    ]);
    second.receive(state(1));

    expect(sent(second)).toEqual([
      { t: 'hello', v: 1, role: 'spotter', name: 'Pit wall' },
      { t: 'lane', lane: 'top' },
      { t: 'gap', value: 80 },
      { t: 'msg', text: 'first offline' },
      { t: 'clear' },
      { t: 'msg', text: 'hold line' },
    ]);
  });

  it('sends acknowledgements only while the replayed socket is available', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers, { role: 'driver' });

    client.send({ t: 'ack', msgId: 'offline' });
    client.connect('ws://relay.test/room/CAR42?role=driver');
    const socket = FakeWebSocket.sockets[0];
    socket.open();
    socket.receive(state(1));
    client.send({ t: 'ack', msgId: 'current-message' });

    expect(sent(socket)).toEqual([
      { t: 'hello', v: 1, role: 'driver' },
      { t: 'ack', msgId: 'current-message' },
    ]);
  });

  it('resets sequence per socket and records every current-socket frame', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    let now = 100;
    const received: number[] = [];
    const client = createClient(timers, { now: () => now });
    client.onState((value) => received.push(value.seq));

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const first = FakeWebSocket.sockets[0];
    first.open();
    now = 101;
    first.receiveRaw('{not json');
    expect(client.lastFrameAt).toBe(101);
    now = 102;
    first.receive({ t: 'unknown' });
    expect(client.lastFrameAt).toBe(102);
    now = 103;
    first.receive(state(2));
    first.receive(state(2));
    expect(received).toEqual([2]);
    first.fail();
    timers.runNextTimeout();

    const second = FakeWebSocket.sockets[1];
    second.open();
    now = 104;
    second.receive(state(1));
    expect(received).toEqual([2, 1]);
    expect(client.lastFrameAt).toBe(104);
  });

  it('uses one ping timer for the current socket and ignores stale replacement events', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const connection: string[] = [];
    const client = createClient(timers);
    client.onConnection((value) => connection.push(value));

    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const first = FakeWebSocket.sockets[0];
    first.open();
    client.send({ t: 'lane', lane: 'top' });
    client.connect('ws://relay.test/room/CAR43?role=spotter');
    const second = FakeWebSocket.sockets[1];

    first.open();
    first.receive(state(99));
    first.fail();
    expect(timers.timeouts.size).toBe(0);
    expect(timers.intervals.size).toBe(0);

    second.open();
    second.receive(state(1));
    timers.tickIntervals();

    expect(connection).toEqual(['connecting', 'open', 'connecting', 'open']);
    expect(sent(second)).toEqual([
      { t: 'hello', v: 1, role: 'spotter' },
      { t: 'ping', ts: 123 },
    ]);
    expect([...timers.intervals.values()]).toEqual([
      expect.objectContaining({ delayMs: PING_INTERVAL_MS }),
    ]);
    expect(timers.intervals.size).toBe(1);
  });

  it('clears disconnected intents on explicit disconnect', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);

    client.send({ t: 'msg', text: 'discard me' });
    client.disconnect();
    client.connect('ws://relay.test/room/CAR42?role=spotter');
    const socket = FakeWebSocket.sockets[0];
    socket.open();
    socket.receive(state(1));

    expect(sent(socket)).toEqual([{ t: 'hello', v: 1, role: 'spotter' }]);
  });

  it('waits for browser close after an error, skipping terminal reconnects and retrying silent peers once', () => {
    for (const code of [
      CLOSE_CODE_BAD_HELLO,
      CLOSE_CODE_AUTH,
      CLOSE_CODE_DRIVER_EVICTED,
      CLOSE_CODE_VERSION,
    ]) {
      FakeWebSocket.reset();
      const timers = new FakeTimers();
      const client = createClient(timers);
      client.connect('ws://relay.test/room/CAR42?role=spotter');
      FakeWebSocket.sockets[0].open();
      FakeWebSocket.sockets[0].error();
      expect(timers.timeouts.size).toBe(0);
      FakeWebSocket.sockets[0].fail(code);
      expect(timers.timeouts.size).toBe(0);
      expect(timers.intervals.size).toBe(0);
    }

    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);
    client.connect('ws://relay.test/room/CAR42?role=spotter');
    FakeWebSocket.sockets[0].open();
    FakeWebSocket.sockets[0].error();
    expect(timers.timeouts.size).toBe(0);
    FakeWebSocket.sockets[0].fail(CLOSE_CODE_SILENT_PEER);

    expect(timers.timeouts.size).toBe(1);
    expect([...timers.timeouts.values()]).toEqual([
      expect.objectContaining({ delayMs: RECONNECT_MIN_MS }),
    ]);
  });

  it('normalizes Node numeric close codes after an error', () => {
    for (const code of [
      CLOSE_CODE_BAD_HELLO,
      CLOSE_CODE_AUTH,
      CLOSE_CODE_DRIVER_EVICTED,
      CLOSE_CODE_VERSION,
    ]) {
      FakeNodeWebSocket.reset();
      const timers = new FakeTimers();
      const client = createClient(timers, { WebSocket: fakeNodeWebSocket });
      client.connect('ws://relay.test/room/CAR42?role=spotter');
      FakeNodeWebSocket.sockets[0].open();
      FakeNodeWebSocket.sockets[0].error();
      FakeNodeWebSocket.sockets[0].fail(code);

      expect(timers.timeouts.size).toBe(0);
      expect(timers.intervals.size).toBe(0);
    }

    FakeNodeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers, { WebSocket: fakeNodeWebSocket });
    client.connect('ws://relay.test/room/CAR42?role=spotter');
    FakeNodeWebSocket.sockets[0].open();
    FakeNodeWebSocket.sockets[0].error();
    FakeNodeWebSocket.sockets[0].fail(CLOSE_CODE_SILENT_PEER);

    expect(timers.timeouts.size).toBe(1);
  });

  it('applies jitter, caps reconnect delay, and leaves one retry timer active', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers, { random: () => 0.999 });
    client.connect('ws://relay.test/room/CAR42?role=spotter');

    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      FakeWebSocket.sockets.at(-1)?.fail();
      expect(timers.timeouts.size).toBe(1);
      delays.push([...timers.timeouts.values()][0].delayMs);
      timers.runNextTimeout();
    }

    expect(delays).toEqual([750, 1_499, 2_998, 5_996, 8_000, 8_000]);
    expect(delays.every((delay) => delay <= RECONNECT_MAX_MS)).toBe(true);
    expect(RECONNECT_MIN_MS).toBe(500);
    expect(PING_INTERVAL_MS).toBe(2_000);
  });

  it('keeps escalating backoff until a reconnected socket receives its replay', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers, { random: () => 0 });
    client.connect('ws://relay.test/room/CAR42?role=spotter');

    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const socket = FakeWebSocket.sockets.at(-1);
      socket?.open();
      socket?.fail();
      expect(timers.timeouts.size).toBe(1);
      delays.push([...timers.timeouts.values()][0].delayMs);
      timers.runNextTimeout();
    }

    expect(delays).toEqual([500, 500, 1_000, 2_000, 4_000, 4_000]);
    expect(delays.every((delay) => delay >= RECONNECT_MIN_MS)).toBe(true);
  });

  it('does not replace a healthy socket when connect receives the same URL', () => {
    FakeWebSocket.reset();
    const timers = new FakeTimers();
    const client = createClient(timers);
    const url = 'ws://relay.test/room/CAR42?role=spotter';

    client.connect(url);
    const socket = FakeWebSocket.sockets[0];
    socket.open();
    socket.receive(state(1));
    client.connect(url);

    expect(FakeWebSocket.sockets).toEqual([socket]);
    expect(sent(socket)).toEqual([{ t: 'hello', v: 1, role: 'spotter' }]);
  });
});
