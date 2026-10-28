// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PING_INTERVAL_MS } from '@g2-race-spotter/protocol';

/**
 * Back from a locked phone (timers frozen, socket possibly half-open), the
 * page reconnects at once on `visibilitychange` instead of waiting out the
 * silence watchdog; a socket that is still fresh is left alone.
 */

type Listener = (event: unknown) => void;

class FakeSocket {
  static readonly sockets: FakeSocket[] = [];
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeSocket.sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close', { code: 1000 });
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  receive(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

let seq = 0;
function roomState() {
  seq += 1;
  return {
    t: 'state',
    seq,
    lane: null,
    cars: [0, 0, 0],
    msg: null,
    spotterOnline: true,
    driverOnline: true,
    updatedAt: 1_000 + seq,
    calledAt: 1_000,
    presets: [],
  };
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('foreground resume (main.ts, jsdom)', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.setItem('g2rs:v1:room', 'CAR42');
    window.localStorage.setItem('g2rs:v1:seenAt', String(Date.now()));
    Object.assign(window, {
      WebSocket: FakeSocket,
      matchMedia: () => ({ matches: true }),
    });
    await import('../src/main.ts');
    const socket = FakeSocket.sockets[0]!;
    socket.emit('open');
    socket.receive(roomState());
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('leaves a fresh socket alone when the page becomes visible', () => {
    setVisibility('hidden');
    setVisibility('visible');
    expect(FakeSocket.sockets).toHaveLength(1);
  });

  it('reconnects at once when the page returns after the socket went quiet', () => {
    setVisibility('hidden');
    // Locked: the clock moves, timers do not run, nothing arrives.
    vi.setSystemTime(Date.now() + 2 * PING_INTERVAL_MS + 1_000);
    setVisibility('visible');

    expect(FakeSocket.sockets).toHaveLength(2);
    expect(FakeSocket.sockets[1]!.url).toBe(FakeSocket.sockets[0]!.url);
  });
});
