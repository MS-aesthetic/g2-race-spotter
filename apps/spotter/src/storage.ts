import type { JoinForm } from './model.ts';
import type { WebStorage } from './recent-messages.ts';

export const STORAGE_KEYS = {
  room: 'g2rs:v1:room',
  pin: 'g2rs:v1:pin',
  name: 'g2rs:v1:name',
} as const;

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

/** Optional 4-digit PIN. */
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
    return '';
  }
}

export function loadJoinForm(storage: WebStorage): JoinForm {
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
