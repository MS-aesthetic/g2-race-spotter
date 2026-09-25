// @vitest-environment jsdom
import { CLOSE_CODE_AUTH, ROOM_TTL_MS } from '@g2-race-spotter/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  generateRoomCode,
  isSessionCurrent,
  isStartPin,
  ROOM_CODE_LENGTH,
} from '../src/join.ts';
import { loadSeenAt, saveSeenAt, STORAGE_KEYS } from '../src/storage.ts';

/**
 * Design round 4 (e): a first visit is assigned a random room code and must
 * set a 4-digit PIN; an `auth` answer to a fresh code (it collided with
 * someone's PIN'd room) is retried once with a new code. The pure rules are
 * pinned first, then the real `main.ts` wiring in jsdom with a fake socket.
 */

describe('room code and PIN rules', () => {
  it('generates a 6-char [A-Z0-9] code from crypto.getRandomValues', () => {
    const codes = Array.from({ length: 200 }, () => generateRoomCode());
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
    }
    expect(ROOM_CODE_LENGTH).toBe(6);
    // 200 draws from 36^6 codes: any repeat means the source is not random.
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('maps bytes onto the alphabet without modulo bias', () => {
    // 252..255 would favour A–D; they are redrawn instead.
    const bytes = [255, 252, 0, 25, 26, 35, 36, 251, 253, 1];
    let calls = 0;
    const code = generateRoomCode((buffer) => {
      calls += 1;
      buffer.set(bytes.slice(0, buffer.length));
      return buffer;
    });

    expect(code).toBe('AZ09A9');
    expect(calls).toBe(1);
  });

  it('requires exactly four digits to start a room', () => {
    expect(isStartPin('4821')).toBe(true);
    expect(isStartPin('')).toBe(false);
    expect(isStartPin('482')).toBe(false);
    expect(isStartPin('48a1')).toBe(false);
  });

  it('resumes a stored room for 24 h after it was last heard, then starts fresh', () => {
    const now = 10 * ROOM_TTL_MS;
    expect(isSessionCurrent(now - 1_000, now)).toBe(true);
    expect(isSessionCurrent(now - ROOM_TTL_MS + 1, now)).toBe(true);
    expect(isSessionCurrent(now - ROOM_TTL_MS, now)).toBe(false);
    // Stored by a build that did not record it: keep the old behaviour.
    expect(isSessionCurrent(0, now)).toBe(true);

    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    expect(loadSeenAt(storage)).toBe(0);
    saveSeenAt(storage, 1_234);
    expect(store.get(STORAGE_KEYS.seenAt)).toBe('1234');
    expect(loadSeenAt(storage)).toBe(1_234);
  });
});

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

  /** What the relay does to a wrong PIN: error frame, then close 4401. */
  rejectAuth(): void {
    this.receive({ t: 'error', code: 'auth' });
    this.emit('close', { code: CLOSE_CODE_AUTH });
  }

  room(): string {
    return new URL(this.url).pathname.split('/').at(-1) ?? '';
  }
}

function el(testId: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  expect(found).not.toBeNull();
  return found!;
}

function visible(testId: string): boolean {
  const found = document.querySelector(`[data-testid="${testId}"]`);
  return found !== null && !found.hasAttribute('hidden');
}

function typeInto(testId: string, value: string): void {
  const input = el(testId) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('new-visit join flow (main.ts)', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.clear();
    // A list the old recent-messages feature left behind is tidied away.
    window.localStorage.setItem('g2rs:v1:recentMsgs', '["BOX"]');
    Object.assign(window, {
      WebSocket: FakeSocket,
      matchMedia: () => ({ matches: true }),
    });
    await import('../src/main.ts');
  });

  afterAll(() => {
    window.localStorage.clear();
  });

  it('shows a generated code and requires a PIN before connecting', () => {
    expect(visible('join-new')).toBe(true);
    expect(visible('join-form')).toBe(false);
    expect(el('join-code').textContent).toMatch(/^[A-Z0-9]{6}$/);
    expect(window.localStorage.getItem('g2rs:v1:recentMsgs')).toBeNull();

    el('start').click();
    expect(FakeSocket.sockets).toHaveLength(0);
    expect(visible('join-notice')).toBe(true);
    expect(el('join-notice').textContent).toBe('Set a 4-digit PIN first.');

    typeInto('start-pin', '12');
    el('start').click();
    expect(FakeSocket.sockets).toHaveLength(0);
  });

  it('starts the room with the generated code and the PIN, and remembers both', () => {
    const code = el('join-code').textContent!;
    typeInto('start-pin', '4821');
    el('start').click();

    expect(FakeSocket.sockets).toHaveLength(1);
    const socket = FakeSocket.sockets[0]!;
    expect(socket.room()).toBe(code);
    expect(new URL(socket.url).searchParams.get('token')).toBe('4821');
    expect(window.localStorage.getItem('g2rs:v1:room')).toBe(code);
    expect(window.localStorage.getItem('g2rs:v1:pin')).toBe('4821');
    expect(document.querySelector('.console')).not.toBeNull();
    expect(el('header-room').textContent).toBe(code);
  });

  it('retries ONCE with a new code when the fresh code collides (auth), then reports it', () => {
    const first = FakeSocket.sockets[0]!;
    first.emit('open');
    first.rejectAuth();

    // Retried silently with a different code and the same PIN.
    expect(FakeSocket.sockets).toHaveLength(2);
    const second = FakeSocket.sockets[1]!;
    expect(second.room()).toMatch(/^[A-Z0-9]{6}$/);
    expect(second.room()).not.toBe(first.room());
    expect(new URL(second.url).searchParams.get('token')).toBe('4821');
    expect(window.localStorage.getItem('g2rs:v1:room')).toBe(second.room());
    expect(document.querySelector('.console')).not.toBeNull();

    // A second collision is not retried: back to Join with the reason.
    second.emit('open');
    second.rejectAuth();
    expect(FakeSocket.sockets).toHaveLength(2);
    expect(document.querySelector('.join')).not.toBeNull();
    expect(el('join-notice').textContent).toContain('Wrong PIN');
  });

  it('does not treat an auth close after the room has replayed as a collision', () => {
    el('start').click();
    expect(FakeSocket.sockets).toHaveLength(3);
    const third = FakeSocket.sockets[2]!;
    third.emit('open');
    third.receive({
      t: 'state',
      seq: 1,
      lane: null,
      cars: [0, 0, 0],
      msg: null,
      spotterOnline: true,
      driverOnline: false,
      updatedAt: 1,
      calledAt: 0,
      presets: [],
    });
    expect(
      Number(window.localStorage.getItem('g2rs:v1:seenAt')),
    ).toBeGreaterThan(0);

    third.rejectAuth();
    expect(FakeSocket.sockets).toHaveLength(3);
    expect(document.querySelector('.join')).not.toBeNull();
  });

  it('keeps the classic form behind "Join an existing room"', () => {
    el('join-existing').click();
    expect(visible('join-form')).toBe(true);
    expect(visible('join-new')).toBe(false);

    typeInto('join-room', 'qa01');
    typeInto('join-pin', '');
    el('join').click();

    const socket = FakeSocket.sockets.at(-1)!;
    expect(FakeSocket.sockets).toHaveLength(4);
    expect(socket.room()).toBe('QA01');
    // Joining an existing room: the PIN stays optional.
    expect(new URL(socket.url).searchParams.has('token')).toBe(false);
  });
});

describe('the code overlay', () => {
  it('toggles from the header chip', () => {
    expect(visible('code-overlay')).toBe(false);
    el('header-room').click();
    expect(visible('code-overlay')).toBe(true);
    expect(document.querySelector('.codeview__code')!.textContent).toBe('QA01');
    el('code-overlay').click();
    expect(visible('code-overlay')).toBe(false);
  });
});
