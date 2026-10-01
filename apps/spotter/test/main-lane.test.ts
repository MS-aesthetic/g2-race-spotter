// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Design round 6 (040 Decisions 2026-10-01) through the real `main.ts`: the
 * CLEAR button is gone, so tapping the lit lane again sends the lane clear
 * (`{t:'lane', lane:null}`); the 2×2 message buttons send `msg`; nothing on
 * the page sends `preset` any more.
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
let socket: FakeSocket;

function roomState(lane: 'bot' | 'mid' | 'top' | null) {
  seq += 1;
  return {
    t: 'state',
    seq,
    lane,
    cars: [0, 0, 0],
    msg: null,
    spotterOnline: true,
    driverOnline: true,
    updatedAt: 1_000 + seq,
    calledAt: 1_000,
    presets: ['BOX THIS LAP'],
  };
}

/** Every frame the page sent after `hello`, parsed. */
function frames(): { t: string }[] {
  return socket.sent
    .map((frame) => JSON.parse(frame) as { t: string })
    .filter((frame) => frame.t !== 'hello' && frame.t !== 'ping');
}

function tap(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  expect(el).not.toBeNull();
  el!.click();
}

/** The relay applied the lane; the optimistic window has closed. */
async function settle(lane: 'bot' | 'mid' | 'top' | null): Promise<void> {
  await vi.advanceTimersByTimeAsync(1_000);
  socket.receive(roomState(lane));
}

describe('lane taps and message buttons (main.ts, jsdom)', () => {
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
    socket.receive(roomState(null));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('a tap on an unlit lane calls it; a tap on the lit lane clears it', async () => {
    const before = frames().length;

    tap('.lane[data-lane="mid"]');
    await settle('mid');
    expect(
      document.querySelector('.lane.is-selected')!.getAttribute('data-lane'),
    ).toBe('mid');

    tap('.lane[data-lane="mid"]');
    await settle(null);

    expect(frames().slice(before)).toEqual([
      { t: 'lane', lane: 'mid' },
      { t: 'lane', lane: null },
    ]);
    expect(document.querySelectorAll('.lane.is-selected')).toHaveLength(0);
  });

  it('a second tap inside the optimistic window clears what the first lit', async () => {
    await settle(null);
    const before = frames().length;

    tap('.lane[data-lane="bot"]');
    tap('.lane[data-lane="bot"]');

    expect(frames().slice(before)).toEqual([
      { t: 'lane', lane: 'bot' },
      { t: 'lane', lane: null },
    ]);
  });

  it('moving from one lane to another sends just the new lane', async () => {
    await settle('top');
    const before = frames().length;

    tap('.lane[data-lane="bot"]');

    expect(frames().slice(before)).toEqual([{ t: 'lane', lane: 'bot' }]);
  });

  it('the message buttons and Send send msg; nothing sends preset', async () => {
    await settle(null);
    const before = frames().length;

    tap('[data-act="say"][data-arg="EXIT"]');
    tap('[data-act="say"][data-arg="CATCHING UP"]');
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="msg-input"]',
    )!;
    input.value = '  box this lap ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    tap('[data-testid="send"]');

    expect(frames().slice(before)).toEqual([
      { t: 'msg', text: 'EXIT' },
      { t: 'msg', text: 'CATCHING UP' },
      { t: 'msg', text: 'box this lap' },
    ]);
    expect(frames().filter((frame) => frame.t === 'preset')).toHaveLength(0);
    expect(document.querySelector('[data-act="save"]')).toBeNull();
  });
});
