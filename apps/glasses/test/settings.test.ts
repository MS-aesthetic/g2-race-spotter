import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  driverUrl,
  evenAppWarning,
  isValidPin,
  isValidRoom,
  loadSettings,
  normalisePin,
  normaliseRoom,
  resolveRelayBase,
  saveSettings,
  seedFromSearch,
  STORAGE_KEYS,
} from '../src/settings.ts';
import { MIN_EVEN_APP_VERSION } from '../src/render/sdk-quirks.ts';
import { FakeBridge } from './helpers.ts';

describe('settings storage (030 R5)', () => {
  it('uses the bridge KV under the g2rs:v1 keys', async () => {
    const bridge = new FakeBridge();

    await saveSettings(bridge, {
      room: 'QA01',
      pin: '1234',
      name: 'maxx',
      render: 'text',
    });

    expect([...bridge.storage.entries()].sort()).toEqual([
      [STORAGE_KEYS.name, 'maxx'],
      [STORAGE_KEYS.pin, '1234'],
      [STORAGE_KEYS.render, 'text'],
      [STORAGE_KEYS.room, 'QA01'],
    ]);
    await expect(loadSettings(bridge)).resolves.toEqual({
      room: 'QA01',
      pin: '1234',
      name: 'maxx',
      render: 'text',
    });
  });

  it('reads an empty store as no settings at all', async () => {
    await expect(loadSettings(new FakeBridge())).resolves.toEqual({
      room: '',
      pin: '',
      name: '',
      render: null,
    });
  });

  it('normalises what it reads back', async () => {
    const bridge = new FakeBridge();
    bridge.storage.set(STORAGE_KEYS.room, 'qa-01x9');
    bridge.storage.set(STORAGE_KEYS.pin, '12a345');
    bridge.storage.set(STORAGE_KEYS.render, 'braille');

    await expect(loadSettings(bridge)).resolves.toMatchObject({
      room: 'QA01X9',
      pin: '1234',
      render: null,
    });
  });
});

describe('room and pin validation', () => {
  it('accepts 4-6 uppercase alphanumerics', () => {
    expect(normaliseRoom(' qa01 ')).toBe('QA01');
    expect(isValidRoom('QA01')).toBe(true);
    expect(isValidRoom('QA0')).toBe(false);
    expect(isValidRoom(normaliseRoom('abcdefgh'))).toBe(true);
    expect(normaliseRoom('abcdefgh')).toBe('ABCDEF');
  });

  it('treats a PIN as optional but four digits when present', () => {
    expect(normalisePin('12-34')).toBe('1234');
    expect(isValidPin('')).toBe(true);
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123')).toBe(false);
  });
});

describe('relay URL', () => {
  it('upgrades the page origin to a websocket scheme', () => {
    expect(resolveRelayBase({ origin: 'https://relay.example' })).toBe(
      'wss://relay.example',
    );
    expect(resolveRelayBase({ origin: 'http://192.168.1.9:5173' })).toBe(
      'ws://192.168.1.9:5173',
    );
  });

  it('uses the configured fallback for a sideloaded http dev page', () => {
    expect(
      resolveRelayBase({
        origin: 'http://192.168.1.9:5173',
        fallback: 'wss://g2-race-relay.example.workers.dev/',
      }),
    ).toBe('wss://g2-race-relay.example.workers.dev');
    // A page served by the relay itself always talks to that relay.
    expect(
      resolveRelayBase({
        origin: 'https://relay.example',
        fallback: 'wss://other.example',
      }),
    ).toBe('wss://relay.example');
  });

  it('lets ?relay= override the origin', () => {
    expect(
      resolveRelayBase({
        search: '?relay=ws://localhost:8787/&render=text',
        origin: 'https://relay.example',
      }),
    ).toBe('ws://localhost:8787');
  });

  it('builds the driver URL the relay expects', () => {
    expect(
      driverUrl({ base: 'wss://relay.example', room: 'qa01', pin: '1234' }),
    ).toBe('wss://relay.example/room/QA01?role=driver&token=1234');
    expect(
      driverUrl({ base: 'wss://relay.example/', room: 'QA01', name: 'max x' }),
    ).toBe('wss://relay.example/room/QA01?role=driver&name=max+x');
    expect(driverUrl({ base: 'ws://x', room: 'QA01', pin: '' })).toBe(
      'ws://x/room/QA01?role=driver',
    );
  });
});

describe('Even App version warning (050 R5)', () => {
  it('orders versions numerically, not lexically', () => {
    expect(compareVersions('2.2.10', MIN_EVEN_APP_VERSION)).toBe(1);
    expect(compareVersions('2.2.7', MIN_EVEN_APP_VERSION)).toBe(0);
    expect(compareVersions('2.2.6', MIN_EVEN_APP_VERSION)).toBe(-1);
    expect(compareVersions('2.3', '2.2.99')).toBe(1);
  });

  it('warns in image mode when the host app is old or unknown', () => {
    expect(evenAppWarning('image', '2.2.6')).toContain(MIN_EVEN_APP_VERSION);
    expect(evenAppWarning('image', undefined)).toContain(MIN_EVEN_APP_VERSION);
    expect(evenAppWarning('image', '2.2.7')).toBeNull();
    expect(evenAppWarning('text', '2.0.0')).toBeNull();
  });
});

describe('URL seed', () => {
  it('overrides stored room/pin/name from the page URL', () => {
    const seeded = seedFromSearch(
      { room: 'OLD1', pin: '', name: '', render: null },
      '?room=qa01&pin=1234&name=Maxx&relay=wss://x',
    );
    expect(seeded).toEqual({
      room: 'QA01',
      pin: '1234',
      name: 'Maxx',
      render: null,
    });
  });

  it('ignores absent or invalid values so a typo cannot wipe a saved room', () => {
    const stored = { room: 'QA01', pin: '1234', name: 'd', render: null };
    expect(seedFromSearch(stored, '')).toEqual(stored);
    expect(seedFromSearch(stored, '?room=x&pin=12')).toEqual(stored);
  });
});
