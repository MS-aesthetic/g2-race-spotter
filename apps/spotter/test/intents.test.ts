import { describe, expect, it } from 'vitest';

import {
  CAR_ROWS,
  CAR_SEGMENTS,
  nextCarLevel,
  nextCars,
  normaliseMessage,
} from '../src/intents.ts';

describe('AC-2 car rows (Maxx design round 3)', () => {
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

describe('message normalising', () => {
  it('trims, caps and re-trims', () => {
    expect(normaliseMessage('  box box  ')).toBe('box box');
    expect(normaliseMessage(`${'a'.repeat(79)} tail`)).toBe('a'.repeat(79));
  });
});
