// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Pins the reconnect wiring in `main.ts` (T055a/T055b): a car tap made while
 * the socket is down is not queued as a triple built from the pre-drop copy;
 * the tapped row is rebased onto the replayed `state.cars` and sent once.
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

  frames(): Array<Record<string, unknown>> {
    return this.sent.map(
      (frame) => JSON.parse(frame) as Record<string, unknown>,
    );
  }
}

function state(seq: number, cars: [number, number, number]) {
  return {
    t: 'state',
    seq,
    lane: null,
    cars,
    msg: null,
    spotterOnline: true,
    driverOnline: true,
    updatedAt: 1_000 + seq,
    calledAt: 1_000,
  };
}

function tap(arg: string): void {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-act="car"][data-arg="${arg}"]`,
  );
  expect(button).not.toBeNull();
  button!.click();
}

describe('spotter reconnect: offline car taps (main.ts)', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.setItem('g2rs:v1:room', 'CAR42');
    Object.assign(window, {
      WebSocket: FakeSocket,
      matchMedia: () => ({ matches: true }),
    });
    await import('../src/main.ts');
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('rebases a tap made while down onto the replayed room and sends it once', async () => {
    const first = FakeSocket.sockets[0]!;
    first.emit('open');
    first.receive(state(1, [2, 1, 0]));
    expect(document.querySelectorAll('.seg.is-lit')).toHaveLength(3);

    // The link drops; the relay stale-clears the room meanwhile. The spotter
    // taps RIGHT 3 while offline, looking at the old [2, 1, 0].
    first.emit('close', { code: 1006 });
    tap('2:3');
    expect(first.frames().filter((frame) => frame.t === 'cars')).toEqual([]);

    await vi.advanceTimersByTimeAsync(10_000);
    const second = FakeSocket.sockets[1]!;
    second.emit('open');
    second.receive(state(1, [0, 0, 0]));

    // Only the tapped row overrides the replay: LEFT/MIDDLE stay cleared.
    expect(second.frames().filter((frame) => frame.t === 'cars')).toEqual([
      { t: 'cars', cars: [0, 0, 3] },
    ]);

    // Once replayed, a tap goes straight out, built on what was just sent.
    tap('0:1');
    expect(second.frames().filter((frame) => frame.t === 'cars')).toEqual([
      { t: 'cars', cars: [0, 0, 3] },
      { t: 'cars', cars: [1, 0, 3] },
    ]);
  });
});
