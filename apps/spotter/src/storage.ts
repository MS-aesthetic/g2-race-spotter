import type { JoinForm } from './model.ts';

/** The slice of `localStorage` this module needs, so tests can pass a stub. */
export interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Spotter persistence is `localStorage`, namespaced `g2rs:v1:` (constitution §5). */
export const STORAGE_KEYS = {
  room: 'g2rs:v1:room',
  pin: 'g2rs:v1:pin',
  name: 'g2rs:v1:name',
  /** Last time this phone heard its room (ms epoch), for the 24 h session. */
  seenAt: 'g2rs:v1:seenAt',
} as const;

/** Written by builds before design round 4; saved messages now live in the
 * room (`State.presets`), so the old list is dropped on load. */
const RETIRED_KEYS = ['g2rs:v1:recentMsgs'] as const;

/** Room codes are `[A-Z0-9]{4,6}`; the field uppercases as the spotter types
 * so a lowercase code never looks wrong on the relay. */
export function normaliseRoom(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function isValidRoom(room: string): boolean {
  return /^[A-Z0-9]{4,6}$/.test(room);
}

/** Optional 4-digit PIN when joining an existing room. */
export function normalisePin(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4);
}

export function isValidPin(pin: string): boolean {
  return pin === '' || /^\d{4}$/.test(pin);
}

export function normaliseName(value: string): string {
  return value.replace(/\s+/g, ' ').trimStart().slice(0, 24);
}

function read(storage: WebStorage, key: string): string {
  try {
    return storage.getItem(key) ?? '';
  } catch {
    // Safari in private mode throws on access, not just on write.
    return '';
  }
}

export function loadJoinForm(storage: WebStorage): JoinForm {
  for (const key of RETIRED_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing to tidy when storage is unavailable.
    }
  }

  return {
    room: normaliseRoom(read(storage, STORAGE_KEYS.room)),
    pin: normalisePin(read(storage, STORAGE_KEYS.pin)),
    name: normaliseName(read(storage, STORAGE_KEYS.name)),
  };
}

export function saveJoinForm(storage: WebStorage, form: JoinForm): void {
  try {
    storage.setItem(STORAGE_KEYS.room, form.room);
    storage.setItem(STORAGE_KEYS.pin, form.pin);
    storage.setItem(STORAGE_KEYS.name, form.name);
  } catch {
    // Persistence is a convenience; joining must still work without it.
  }
}

export function loadSeenAt(storage: WebStorage): number {
  const value = Number(read(storage, STORAGE_KEYS.seenAt));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function saveSeenAt(storage: WebStorage, at: number): void {
  try {
    storage.setItem(STORAGE_KEYS.seenAt, String(at));
  } catch {
    // Without it the next visit simply auto-joins the stored room.
  }
}
