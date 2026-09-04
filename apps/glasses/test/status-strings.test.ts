import { describe, expect, it } from 'vitest';

import {
  isLinkOk,
  statusBlinks,
  statusConnecting,
  statusLine,
  statusStrip,
  statusTerminal,
  STATUS_NO_ROOM,
} from '../src/link.ts';
import { glyph, useAsciiFallback } from '../src/render/glyphs.ts';

describe('status strip strings', () => {
  it('is two letters: L for the link, S while the spotter is on', () => {
    expect(statusStrip(true, true)).toBe('L S');
    expect(statusStrip(true, false)).toBe('L');
    expect(statusConnecting()).toBe('CONNECTING…');
    expect(STATUS_NO_ROOM).toBe('ROOM ?');
  });

  it('blanks only the L on the off phase, keeping S in its column', () => {
    expect(statusStrip(false, true, true)).toBe('L S');
    expect(statusStrip(false, true, false)).toBe('  S');
    expect(statusStrip(false, false, true)).toBe('L');
    expect(statusStrip(false, false, false)).toBe('');
    // The link being up is not a phase: a solid L ignores the blink.
    expect(statusStrip(true, true, false)).toBe('L S');
  });

  it('keeps every non-ASCII character behind glyphs.ts (030 R6)', () => {
    useAsciiFallback(true);
    try {
      expect(glyph('separator')).toBe('|');
      expect(glyph('ellipsis')).toBe('...');
      expect(statusConnecting()).toBe('CONNECTING...');
    } finally {
      useAsciiFallback(false);
    }

    // The strip itself is ASCII in either mode.
    expect(statusStrip(true, true)).toMatch(/^[\x20-\x7e]*$/);
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
    expect(statusLine({ ...base, hasRoom: true })).toBe(
      statusStrip(true, true),
    );
    expect(statusLine({ ...base, hasRoom: true, linkOk: false })).toBe('L S');
    expect(
      statusLine({
        ...base,
        hasRoom: true,
        linkOk: false,
        blinkOn: false,
      }),
    ).toBe('  S');
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

  it('blinks only while the link is down and there is nothing else to say', () => {
    const base = {
      hasRoom: true,
      connection: 'open' as const,
      linkOk: false,
      spotterOnline: true,
      everLinked: true,
    };

    expect(statusBlinks(base)).toBe(true);
    expect(statusBlinks({ ...base, linkOk: true })).toBe(false);
    expect(statusBlinks({ ...base, hasRoom: false })).toBe(false);
    expect(statusBlinks({ ...base, terminal: { code: 4_401 } })).toBe(false);
    // Still connecting for the first time: CONNECTING…, not a blinking L.
    expect(
      statusBlinks({ ...base, everLinked: false, connection: 'connecting' }),
    ).toBe(false);
    // A socket that closed before it ever linked has no excuse left.
    expect(
      statusBlinks({ ...base, everLinked: false, connection: 'closed' }),
    ).toBe(true);
  });

  it('treats silence longer than DRIVER_NO_LINK_MS as no link', () => {
    expect(isLinkOk(undefined, 10_000)).toBe(false);
    expect(isLinkOk(5_000, 10_000)).toBe(true);
    expect(isLinkOk(4_999, 10_000)).toBe(false);
  });
});
