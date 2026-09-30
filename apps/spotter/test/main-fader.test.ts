// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  panel,
  pointer,
  TRACK_HEIGHT,
  TRACK_TOP,
  stubTrackBoxes,
  tapFader,
  track,
  yAt,
} from './fader-pointer.ts';

/**
 * 040 AC-2 through the real `main.ts` (design round 5): pointer events on a
 * fader track move its knob live, send nothing while the finger is down, and
 * send exactly one `cars` triple with the snapped detent on release; a tap
 * jumps to the detent under it and sends once.
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

function roomState(cars: [number, number, number]) {
  seq += 1;
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
    presets: [],
  };
}

let socket: FakeSocket;

function carsSent(): unknown[] {
  return socket.sent
    .map((frame) => JSON.parse(frame) as { t: string })
    .filter((frame) => frame.t === 'cars');
}

function fader(row: 0 | 1 | 2): {
  level: string | null;
  knob: string | null;
  held: boolean;
} {
  const el = document.querySelector(`.fader[data-row="${row}"]`)!;
  return {
    level: el.getAttribute('data-level'),
    knob: track(row).getAttribute('style'),
    held: el.classList.contains('is-held'),
  };
}

/** The relay applied whatever was sent; the optimistic window has closed. */
async function settle(cars: [number, number, number]): Promise<void> {
  await vi.advanceTimersByTimeAsync(1_000);
  socket.receive(roomState(cars));
}

describe('fader pointer gestures (main.ts, jsdom)', () => {
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
    socket = FakeSocket.sockets[0]!;
    socket.emit('open');
    socket.receive(roomState([0, 1, 0]));
    stubTrackBoxes();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('drag: the knob follows the finger, nothing is sent until release, then ONE cars with the detent', () => {
    const before = carsSent().length;

    // Finger down near the bottom of INSIDE, slide most of the way up.
    pointer('pointerdown', track(0), yAt(0.1));
    expect(fader(0)).toEqual({ level: '0', knob: '--pos:0.100', held: true });
    pointer('pointermove', track(0), yAt(0.4));
    expect(fader(0)).toEqual({ level: '1', knob: '--pos:0.400', held: true });
    pointer('pointermove', track(0), yAt(0.9));
    expect(fader(0)).toEqual({ level: '3', knob: '--pos:0.900', held: true });
    pointer('pointermove', track(0), yAt(0.62));
    expect(fader(0)).toEqual({ level: '2', knob: '--pos:0.620', held: true });
    expect(carsSent()).toHaveLength(before);

    // Release between detents: the knob snaps to the nearest one, 2.
    pointer('pointerup', window, yAt(0.62));
    expect(carsSent().slice(before)).toEqual([{ t: 'cars', cars: [2, 1, 0] }]);
    expect(fader(0)).toEqual({ level: '2', knob: '--pos:0.667', held: false });

    // The click a real pointer gesture ends with does not send again.
    track(0).click();
    expect(carsSent().slice(before)).toHaveLength(1);
  });

  it('tap: the knob jumps to the detent under the finger and ONE cars is sent', async () => {
    await settle([2, 1, 0]);
    const before = carsSent().length;

    tapFader(2, 3);
    expect(carsSent().slice(before)).toEqual([{ t: 'cars', cars: [2, 1, 3] }]);
    expect(fader(2).level).toBe('3');

    // A second tap right away composes with the optimistic triple.
    tapFader(1, 0);
    expect(carsSent().slice(before)).toEqual([
      { t: 'cars', cars: [2, 1, 3] },
      { t: 'cars', cars: [2, 0, 3] },
    ]);
  });

  it('sends nothing for a gesture that ends on the detent it started from', async () => {
    await settle([2, 0, 3]);
    const before = carsSent().length;

    tapFader(0, 2);
    pointer('pointerdown', track(1), yAt(0.05));
    pointer('pointermove', track(1), yAt(0.3));
    pointer('pointermove', track(1), yAt(0.1));
    pointer('pointerup', window, yAt(0.1));

    expect(carsSent()).toHaveLength(before);
    expect(fader(1)).toEqual({ level: '0', knob: '--pos:0.000', held: false });
  });

  it('clamps a finger dragged past the track ends, and ignores a second finger', async () => {
    await settle([2, 0, 3]);
    const before = carsSent().length;

    pointer('pointerdown', track(2), yAt(1), 7);
    // Way below the track: the knob parks on 0.
    pointer('pointermove', track(2), 900, 7);
    expect(fader(2)).toEqual({ level: '0', knob: '--pos:0.000', held: true });
    // Another finger on another fader neither starts a gesture nor moves this one.
    pointer('pointerdown', track(1), yAt(1), 8);
    pointer('pointermove', track(2), yAt(1), 8);
    pointer('pointerup', window, yAt(1), 8);
    expect(fader(1).held).toBe(false);
    expect(fader(2).level).toBe('0');
    expect(carsSent()).toHaveLength(before);

    pointer('pointerup', window, 900, 7);
    expect(carsSent().slice(before)).toEqual([{ t: 'cars', cars: [2, 0, 0] }]);
  });

  it('a press on the panel outside the travel still lands: 10 px above detent 3 is 3, 10 px below detent 0 is 0', async () => {
    await settle([1, 1, 1]);
    const before = carsSent().length;

    pointer('pointerdown', panel(0), TRACK_TOP - 10);
    pointer('pointerup', panel(0), TRACK_TOP - 10);
    pointer('pointerdown', panel(2), TRACK_TOP + TRACK_HEIGHT + 10);
    pointer('pointerup', panel(2), TRACK_TOP + TRACK_HEIGHT + 10);

    expect(carsSent().slice(before)).toEqual([
      { t: 'cars', cars: [3, 1, 1] },
      { t: 'cars', cars: [3, 1, 0] },
    ]);
  });

  it('a pointercancel commits the detent the knob was showing, once', async () => {
    await settle([2, 0, 0]);
    const before = carsSent().length;

    pointer('pointerdown', track(1), yAt(0.3));
    pointer('pointermove', track(1), yAt(0.7));
    pointer('pointercancel', window, 0);

    expect(carsSent().slice(before)).toEqual([{ t: 'cars', cars: [2, 2, 0] }]);
    pointer('pointerup', window, 0);
    expect(carsSent().slice(before)).toHaveLength(1);
  });

  it('keyboard: arrows step the focused fader one detent, one send each', async () => {
    await settle([2, 2, 0]);
    const before = carsSent().length;

    const key = (name: string): void => {
      track(2).dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
      );
    };
    key('ArrowUp');
    key('ArrowDown');
    // Already at 0: nothing to send.
    key('ArrowDown');
    key('End');

    expect(carsSent().slice(before)).toEqual([
      { t: 'cars', cars: [2, 2, 1] },
      { t: 'cars', cars: [2, 2, 0] },
      { t: 'cars', cars: [2, 2, 3] },
    ]);
  });
});
