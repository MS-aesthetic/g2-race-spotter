/**
 * Driver settings, persisted in the bridge KV (constitution §5 — never browser
 * `localStorage` on the glasses side). Keys are the ones in the
 * `race-relay-protocol` skill.
 *
 * Everything here is pure or takes the KV store as a parameter, so the
 * companion page in `companion.ts` stays a thin DOM shell.
 */

import type { RenderMode } from './render/mode.ts';
import { isRenderMode } from './render/mode.ts';
import { MIN_EVEN_APP_VERSION } from './render/sdk-quirks.ts';

export const STORAGE_KEYS = {
  room: 'g2rs:v1:room',
  pin: 'g2rs:v1:pin',
  name: 'g2rs:v1:name',
  render: 'g2rs:v1:render',
} as const;

export const ROOM_MIN_LENGTH = 4;
export const ROOM_MAX_LENGTH = 6;
export const PIN_LENGTH = 4;

export interface Settings {
  readonly room: string;
  readonly pin: string;
  readonly name: string;
  /** Manual render override; `null` means "no override, use the default". */
  readonly render: RenderMode | null;
}

export const EMPTY_SETTINGS: Settings = {
  room: '',
  pin: '',
  name: '',
  render: null,
};

export interface SettingsStore {
  getLocalStorage(key: string): Promise<string | null>;
  setLocalStorage(key: string, value: string): Promise<boolean>;
}

export function normaliseRoom(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_MAX_LENGTH);
}

export function isValidRoom(room: string): boolean {
  return (
    room.length >= ROOM_MIN_LENGTH &&
    room.length <= ROOM_MAX_LENGTH &&
    /^[A-Z0-9]+$/.test(room)
  );
}

export function normalisePin(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, PIN_LENGTH);
}

/** A PIN is optional; when present it must be exactly four digits. */
export function isValidPin(pin: string): boolean {
  return pin === '' || pin.length === PIN_LENGTH;
}

export async function loadSettings(store: SettingsStore): Promise<Settings> {
  const [room, pin, name, render] = await Promise.all([
    store.getLocalStorage(STORAGE_KEYS.room),
    store.getLocalStorage(STORAGE_KEYS.pin),
    store.getLocalStorage(STORAGE_KEYS.name),
    store.getLocalStorage(STORAGE_KEYS.render),
  ]);

  return {
    room: normaliseRoom(room ?? ''),
    pin: normalisePin(pin ?? ''),
    name: (name ?? '').trim(),
    render: isRenderMode(render) ? render : null,
  };
}

export async function saveSettings(
  store: SettingsStore,
  settings: Settings,
): Promise<void> {
  await Promise.all([
    store.setLocalStorage(STORAGE_KEYS.room, settings.room),
    store.setLocalStorage(STORAGE_KEYS.pin, settings.pin),
    store.setLocalStorage(STORAGE_KEYS.name, settings.name),
    store.setLocalStorage(STORAGE_KEYS.render, settings.render ?? ''),
  ]);
}

export interface RelayBaseInput {
  /** `location.search`. `?relay=` wins so a sideloaded build can be pointed anywhere. */
  readonly search?: string;
  /** `location.origin`, e.g. `https://relay.example`. */
  readonly origin?: string;
}

export function resolveRelayBase(input: RelayBaseInput = {}): string {
  const search = input.search ?? '';
  const override = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  ).get('relay');
  if (override) {
    return override.replace(/\/+$/, '');
  }

  const origin = (input.origin ?? '').replace(/\/+$/, '');
  if (origin.startsWith('https://')) {
    return `wss://${origin.slice('https://'.length)}`;
  }
  if (origin.startsWith('http://')) {
    return `ws://${origin.slice('http://'.length)}`;
  }

  return origin;
}

export interface DriverUrlInput {
  readonly base: string;
  readonly room: string;
  readonly pin?: string;
  readonly name?: string;
}

/** `wss://host/room/ROOM?role=driver&token=…&name=…` — the URL is authoritative. */
export function driverUrl(input: DriverUrlInput): string {
  const params = new URLSearchParams({ role: 'driver' });
  if (input.pin) {
    params.set('token', input.pin);
  }
  if (input.name) {
    params.set('name', input.name);
  }

  const base = input.base.replace(/\/+$/, '');
  return `${base}/room/${normaliseRoom(input.room)}?${params.toString()}`;
}

function versionParts(version: string): number[] {
  return version
    .trim()
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Spec 050 R5: image mode needs Even App >= 2.2.7 (the LZ4 regression). SDK
 * 0.0.12 does not expose the host app version, so an unknown version warns too
 * — the companion page advises, it cannot block.
 */
export function evenAppWarning(
  mode: RenderMode,
  version?: string | null,
): string | null {
  if (mode !== 'image') {
    return null;
  }

  if (version && compareVersions(version, MIN_EVEN_APP_VERSION) >= 0) {
    return null;
  }

  return `Image HUD needs Even App ${MIN_EVEN_APP_VERSION} or newer. Use ?render=text if the display stays blank.`;
}
