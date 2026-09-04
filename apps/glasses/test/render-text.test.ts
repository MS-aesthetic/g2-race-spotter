import { describe, expect, it } from 'vitest';

import { renderText } from '../src/render/text.ts';

/**
 * 030 AC-1/AC-2 with the ASCII layout decided on 2026-09-04 (AC-9 dropped):
 * `^ o v` for the lane and `#`/`-` for the bar, so nothing here needs a
 * hardware glyph check.
 */
describe('renderText', () => {
  it('renders lane top and 12 of 20 cells for gap 62 (AC-1)', () => {
    expect(renderText({ lane: 'top', gap: 62 })).toBe(
      '^\n############--------  62',
    );
  });

  it('uses o for mid and v for bot', () => {
    expect(renderText({ lane: 'mid', gap: 0 })).toBe(
      'o\n--------------------  0',
    );
    expect(renderText({ lane: 'bot', gap: 5 })).toBe(
      'v\n#-------------------  5',
    );
  });

  it('leaves the first line blank when no lane is called (AC-2)', () => {
    expect(renderText({ lane: null, gap: 40 })).toBe(
      '\n########------------  40',
    );
  });

  it('prefixes the bar line with !! at gap >= 90 (AC-2)', () => {
    expect(renderText({ lane: 'top', gap: 89 })).toBe(
      '^\n##################--  89',
    );
    expect(renderText({ lane: 'top', gap: 90 })).toBe(
      '^\n!!##################--  90',
    );
    expect(renderText({ lane: null, gap: 100 })).toBe(
      '\n!!####################  100',
    );
  });

  it('is ASCII only', () => {
    for (const gap of [0, 33, 62, 90, 100]) {
      for (const lane of ['top', 'mid', 'bot', null] as const) {
        expect(renderText({ lane, gap })).toMatch(/^[\x20-\x7e\n]*$/);
      }
    }
  });

  it('clamps and rounds out-of-range gaps', () => {
    expect(renderText({ lane: null, gap: -5 })).toBe(
      '\n--------------------  0',
    );
    expect(renderText({ lane: null, gap: 137 })).toBe(
      '\n!!####################  100',
    );
    expect(renderText({ lane: null, gap: 62.4 })).toBe(
      '\n############--------  62',
    );
  });
});
