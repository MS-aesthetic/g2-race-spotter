import { describe, expect, it } from 'vitest';

import {
  isLinkOk,
  statusConnecting,
  statusLine,
  statusLinkOk,
  statusTerminal,
  STATUS_NO_LINK,
  STATUS_NO_ROOM,
} from '../src/link.ts';
import { glyph, useAsciiFallback } from '../src/render/glyphs.ts';

describe('status strip strings', () => {
  it('matches the g2-hud-display skill exactly', () => {
    expect(statusLinkOk(true)).toBe('LINK OK · SPOTTER ON');
    expect(statusLinkOk(false)).toBe('LINK OK · SPOTTER OFF');
    expect(statusConnecting()).toBe('CONNECTING…');
    expect(STATUS_NO_LINK).toBe('NO LINK');
    expect(STATUS_NO_ROOM).toBe('ROOM ?');
  });

  it('keeps every non-ASCII character behind glyphs.ts (030 R6)', () => {
    useAsciiFallback(true);
    try {
      expect(glyph('separator')).toBe('|');
      expect(glyph('ellipsis')).toBe('...');
      expect(statusLinkOk(true)).toBe('LINK OK | SPOTTER ON');
      expect(statusConnecting()).toBe('CONNECTING...');
    } finally {
      useAsciiFallback(false);
    }

    expect(statusLinkOk(true)).toBe('LINK OK · SPOTTER ON');
  });

  it('names the terminal closes the driver can act on', () => {
    expect(statusTerminal({ code: 4_401 })).toBe('PIN REJECTED');
    expect(statusTerminal({ error: 'auth' })).toBe('PIN REJECTED');
    expect(statusTerminal({ code: 4_409 })).toBe('DRIVER REPLACED');
    expect(statusTerminal({ code: 4_426 })).toBe('UPDATE APP');
    expect(statusTerminal({ code: 4_400 })).toBe('LINK ERROR');
    expect(statusTerminal({})).toBe('DISCONNECTED');
  });

  it('prefers ROOM ? and a terminal error over the link state', () => {
    const base = {
      connection: 'open' as const,
      linkOk: true,
      spotterOnline: true,
      everLinked: true,
    };

    expect(statusLine({ ...base, hasRoom: false })).toBe(STATUS_NO_ROOM);
    expect(
      statusLine({ ...base, hasRoom: true, terminal: { code: 4_401 } }),
    ).toBe('PIN REJECTED');
    expect(statusLine({ ...base, hasRoom: true })).toBe(statusLinkOk(true));
    expect(statusLine({ ...base, hasRoom: true, linkOk: false })).toBe(
      STATUS_NO_LINK,
    );
    expect(
      statusLine({
        ...base,
        hasRoom: true,
        linkOk: false,
        everLinked: false,
        connection: 'connecting',
      }),
    ).toBe(statusConnecting());
  });

  it('treats silence longer than DRIVER_NO_LINK_MS as no link', () => {
    expect(isLinkOk(undefined, 10_000)).toBe(false);
    expect(isLinkOk(5_000, 10_000)).toBe(true);
    expect(isLinkOk(4_999, 10_000)).toBe(false);
  });
});
