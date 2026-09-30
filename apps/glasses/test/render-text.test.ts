import { describe, expect, it } from 'vitest';

import type { Cars } from '@g2-race-spotter/protocol';

import { renderText } from '../src/render/text.ts';

/**
 * 030 AC-1/AC-2 with the design-round-5 layout (Maxx, 2026-09-30): line 1 is
 * the lane row `<` (bottom lane) `^` (middle) `>` (top lane), always all
 * three, the called one bracketed; each marker sits in a 5-char slot over the
 * bar of its side. Line 2 is the three bracketed 3-cell car-behind bars
 * `[left] [mid] [right]`. ASCII only (AC-9 dropped).
 */
describe('renderText', () => {
  it('renders lane top and the three car bars for [1, 2, 3] (AC-1)', () => {
    expect(renderText({ lane: 'top', cars: [1, 2, 3] })).toBe(
      '  <     ^    [>] \n[#  ] [## ] [###]',
    );
  });

  it('brackets < on the left for bot and ^ in the middle for mid', () => {
    expect(renderText({ lane: 'bot', cars: [0, 0, 0] })).toBe(
      ' [<]    ^     >  \n[   ] [   ] [   ]',
    );
    expect(renderText({ lane: 'mid', cars: [2, 1, 3] })).toBe(
      '  <    [^]    >  \n[## ] [#  ] [###]',
    );
  });

  it('shows all three markers, none bracketed, when no lane is called (AC-2)', () => {
    expect(renderText({ lane: null, cars: [3, 0, 0] })).toBe(
      '  <     ^     >  \n[###] [   ] [   ]',
    );
  });

  it('keeps each lane marker over the centre of the bar of its side', () => {
    const [lanes, bars] = renderText({ lane: null, cars: [0, 0, 0] }).split(
      '\n',
    );
    for (const marker of ['<', '^', '>']) {
      const column = lanes!.indexOf(marker);
      expect(bars![column]).toBe(' ');
      expect(bars![column - 2]).toBe('[');
      expect(bars![column + 2]).toBe(']');
    }
  });

  it('keeps both lines the same width whatever the state', () => {
    const lengths = new Set<string>();
    for (const lane of ['top', 'mid', 'bot', null] as const) {
      for (const level of [0, 1, 2, 3] as const) {
        const [first, second] = renderText({
          lane,
          cars: [level, 3 - level, level] as Cars,
        }).split('\n');
        lengths.add(`${first?.length}/${second?.length}`);
      }
    }
    expect([...lengths]).toEqual(['17/17']);
  });

  it('is ASCII only', () => {
    for (const lane of ['top', 'mid', 'bot', null] as const) {
      for (const level of [0, 1, 2, 3] as const) {
        expect(
          renderText({ lane, cars: [level, level, level] as Cars }),
        ).toMatch(/^[\x20-\x7e\n]*$/);
      }
    }
  });

  it('clamps and rounds out-of-range levels', () => {
    expect(
      renderText({ lane: null, cars: [-1, 9, 1.4] as unknown as Cars }),
    ).toBe('  <     ^     >  \n[   ] [###] [#  ]');
  });
});
