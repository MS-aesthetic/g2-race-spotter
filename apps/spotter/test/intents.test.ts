import { describe, expect, it } from 'vitest';

import { MSG_MAX_CHARS } from '@g2-race-spotter/protocol';

import {
  BUILTIN_MESSAGES,
  CAR_ROWS,
  CAR_SEGMENTS,
  dragCars,
  endCarDrag,
  moveCarDrag,
  nextCarLevel,
  nextCars,
  normaliseMessage,
  rebaseCars,
  startCarDrag,
} from '../src/intents.ts';

describe('AC-2 car sliders (levels)', () => {
  it('offers LEFT / MIDDLE / RIGHT in the glasses order, three segments each', () => {
    expect(CAR_ROWS.map((row) => [row.index, row.label])).toEqual([
      [0, 'LEFT'],
      [1, 'MIDDLE'],
      [2, 'RIGHT'],
    ]);
    expect([...CAR_SEGMENTS]).toEqual([1, 2, 3]);
  });

  it('sets the tapped segment as the level and clears on the lit top segment', () => {
    // Tap segment n -> level n, from anywhere.
    expect(nextCarLevel(0, 1)).toBe(1);
    expect(nextCarLevel(0, 3)).toBe(3);
    expect(nextCarLevel(3, 1)).toBe(1);
    expect(nextCarLevel(1, 2)).toBe(2);
    // Tapping the lit top segment is how the spotter says the car has gone.
    expect(nextCarLevel(1, 1)).toBe(0);
    expect(nextCarLevel(2, 2)).toBe(0);
    expect(nextCarLevel(3, 3)).toBe(0);
  });

  it('sends the full triple with only the tapped row changed', () => {
    expect(nextCars([0, 0, 0], 0, 2)).toEqual([2, 0, 0]);
    expect(nextCars([1, 2, 3], 1, 3)).toEqual([1, 3, 3]);
    expect(nextCars([1, 2, 3], 2, 3)).toEqual([1, 2, 0]);
  });

  it('never mutates the triple it was given', () => {
    const current = [1, 2, 3] as const;
    const next = nextCars(current, 0, 3);

    expect(next).toEqual([3, 2, 3]);
    expect(next).not.toBe(current);
    expect(current).toEqual([1, 2, 3]);
  });
});

describe('AC-2 slider drag (design round 4)', () => {
  it('a tap is a drag that never moves: same decision as nextCars', () => {
    for (const current of [0, 1, 2, 3] as const) {
      for (const segment of [1, 2, 3] as const) {
        const cars = [0, current, 0] as const;
        expect(endCarDrag(startCarDrag(cars, 1, segment))).toEqual(
          nextCars(cars, 1, segment),
        );
      }
    }
    // Tapping the lit top segment clears the slider.
    expect(endCarDrag(startCarDrag([2, 0, 0], 0, 2))).toEqual([0, 0, 0]);
  });

  it('sliding up from segment 1 to 3 ends with ONE triple at level 3', () => {
    let drag = startCarDrag([0, 0, 1], 0, 1);
    expect(dragCars(drag)).toEqual([1, 0, 1]);
    drag = moveCarDrag(drag, 0, 2);
    expect(dragCars(drag)).toEqual([2, 0, 1]);
    drag = moveCarDrag(drag, 0, 3);
    expect(dragCars(drag)).toEqual([3, 0, 1]);

    expect(endCarDrag(drag)).toEqual([3, 0, 1]);
  });

  it('sliding down onto the label clears the slider', () => {
    let drag = startCarDrag([0, 3, 0], 1, 2);
    drag = moveCarDrag(drag, 1, 1);
    drag = moveCarDrag(drag, 1, 0);

    expect(endCarDrag(drag)).toEqual([0, 0, 0]);
  });

  it('keeps a tap on the lit top at 0 while the finger wobbles inside it', () => {
    let drag = startCarDrag([0, 0, 3], 2, 3);
    expect(drag.level).toBe(0);
    drag = moveCarDrag(drag, 2, 3);
    drag = moveCarDrag(drag, 2, 3);

    expect(endCarDrag(drag)).toEqual([0, 0, 0]);
  });

  it('ignores the other sliders and sends nothing when the level ends where it began', () => {
    let drag = startCarDrag([2, 0, 0], 0, 3);
    drag = moveCarDrag(drag, 1, 1);
    expect(dragCars(drag)).toEqual([3, 0, 0]);
    drag = moveCarDrag(drag, 0, 2);

    expect(endCarDrag(drag)).toBeNull();
  });
});

describe('built-in messages', () => {
  it('are the five Maxx named, each a valid msg text', () => {
    expect(BUILTIN_MESSAGES).toEqual([
      'PULL OFF',
      'LEADERS BEHIND',
      'BACK UP ENTRY',
      'DRIVE IN FURTHER',
      'SPIN',
    ]);
    for (const text of BUILTIN_MESSAGES) {
      expect(normaliseMessage(text)).toBe(text);
      expect(text.length).toBeLessThanOrEqual(MSG_MAX_CHARS);
    }
  });
});

describe('offline car taps rebased on the replayed room (T055a)', () => {
  it('overrides only the rows tapped offline', () => {
    // Offline the spotter saw [2, 1, 0] and tapped RIGHT 3; meanwhile the relay
    // stale-cleared the room. The replay says [0, 0, 0]: LEFT and MIDDLE must
    // not come back.
    expect(rebaseCars([0, 0, 0], { 2: 3 })).toEqual([0, 0, 3]);
    expect(rebaseCars([1, 2, 0], { 0: 0 })).toEqual([0, 2, 0]);
    expect(rebaseCars([1, 2, 0], { 0: 3, 1: 1 })).toEqual([3, 1, 0]);
  });

  it('sends nothing when nothing was tapped or the room already agrees', () => {
    expect(rebaseCars([1, 2, 3], {})).toBeNull();
    expect(rebaseCars([1, 2, 3], { 1: 2 })).toBeNull();
  });
});

describe('message normalising', () => {
  it('trims, caps and re-trims', () => {
    expect(normaliseMessage('  box box  ')).toBe('box box');
    expect(normaliseMessage(`${'a'.repeat(79)} tail`)).toBe('a'.repeat(79));
  });
});
