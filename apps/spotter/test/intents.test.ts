import { describe, expect, it } from 'vitest';

import { MSG_MAX_CHARS } from '@g2-race-spotter/protocol';

import {
  BUILTIN_MESSAGES,
  CAR_DETENTS,
  CAR_ROWS,
  detentAt,
  detentFromPointer,
  dragCars,
  endCarDrag,
  faderPosition,
  moveCarDrag,
  nextCars,
  normaliseMessage,
  rebaseCars,
  startCarDrag,
} from '../src/intents.ts';

describe('AC-2 car faders (design round 5)', () => {
  it('offers INSIDE / BEHIND / OUTSIDE in the glasses order, four detents each', () => {
    expect(CAR_ROWS.map((row) => [row.index, row.label])).toEqual([
      [0, 'INSIDE'],
      [1, 'BEHIND'],
      [2, 'OUTSIDE'],
    ]);
    expect([...CAR_DETENTS]).toEqual([0, 1, 2, 3]);
  });

  it('snaps a pointer y to the nearest detent, 0 at the bottom of the track, 3 at the top', () => {
    // Track from y=100 to y=250: detents at 250 (0), 200 (1), 150 (2), 100 (3).
    const at = (y: number) => detentFromPointer(y, 100, 150);
    expect(at(250)).toBe(0);
    expect(at(200)).toBe(1);
    expect(at(150)).toBe(2);
    expect(at(100)).toBe(3);
    // Halfway between two detents is the boundary.
    expect(at(226)).toBe(0);
    expect(at(224)).toBe(1);
    expect(at(176)).toBe(1);
    expect(at(174)).toBe(2);
    expect(at(126)).toBe(2);
    expect(at(124)).toBe(3);
  });

  it('has one snap rule: detentAt(position), shared by detentFromPointer and a drag', () => {
    expect([0, 0.16, 0.17, 0.5, 0.83, 0.84, 1].map(detentAt)).toEqual([
      0, 0, 1, 2, 2, 3, 3,
    ]);
    expect(detentAt(-1)).toBe(0);
    expect(detentAt(2)).toBe(3);
    for (const position of [0, 0.1, 0.2, 0.49, 0.51, 0.7, 0.9, 1]) {
      expect(moveCarDrag(startCarDrag([0, 0, 0], 0, 0), position).level).toBe(
        detentAt(position),
      );
      expect(detentFromPointer(100 + 150 * (1 - position), 100, 150)).toBe(
        detentAt(position),
      );
    }
  });

  it('clamps a finger past either end of the track, and survives a zero-size box', () => {
    expect(detentFromPointer(400, 100, 150)).toBe(0);
    expect(detentFromPointer(-20, 100, 150)).toBe(3);
    expect(faderPosition(400, 100, 150)).toBe(0);
    expect(faderPosition(-20, 100, 150)).toBe(1);
    expect(faderPosition(175, 100, 150)).toBe(0.5);
    expect(detentFromPointer(120, 100, 0)).toBe(0);
    expect(detentFromPointer(Number.NaN, 100, 150)).toBe(0);
  });

  it('sends the full triple with only that fader changed, or nothing when it did not move', () => {
    expect(nextCars([0, 0, 0], 0, 2)).toEqual([2, 0, 0]);
    expect(nextCars([1, 2, 3], 1, 3)).toEqual([1, 3, 3]);
    expect(nextCars([1, 2, 3], 2, 0)).toEqual([1, 2, 0]);
    // A fader has its own 0 detent: releasing on the current level is not a
    // clear (the round-3 "tap the lit top" rule is gone).
    expect(nextCars([1, 2, 3], 1, 2)).toBeNull();
    expect(nextCars([0, 0, 0], 0, 0)).toBeNull();
  });

  it('never mutates the triple it was given', () => {
    const current = [1, 2, 3] as const;
    const next = nextCars(current, 0, 3);

    expect(next).toEqual([3, 2, 3]);
    expect(next).not.toBe(current);
    expect(current).toEqual([1, 2, 3]);
  });
});

describe('AC-2 fader drag', () => {
  it('a tap is a drag that never moves: the knob jumps to that detent, same decision as nextCars', () => {
    for (const current of [0, 1, 2, 3] as const) {
      for (const detent of [0, 1, 2, 3] as const) {
        const cars = [0, current, 0] as const;
        expect(endCarDrag(startCarDrag(cars, 1, detent / 3))).toEqual(
          nextCars(cars, 1, detent),
        );
      }
    }
  });

  it('the knob follows the finger live; the level is the nearest detent; release sends ONE triple', () => {
    let drag = startCarDrag([0, 0, 1], 0, 0.1);
    expect(drag.position).toBeCloseTo(0.1);
    expect(dragCars(drag)).toEqual([0, 0, 1]);
    drag = moveCarDrag(drag, 0.4);
    expect(drag.position).toBeCloseTo(0.4);
    expect(dragCars(drag)).toEqual([1, 0, 1]);
    drag = moveCarDrag(drag, 0.58);
    expect(dragCars(drag)).toEqual([2, 0, 1]);
    drag = moveCarDrag(drag, 1.4);
    expect(drag.position).toBe(1);

    expect(endCarDrag(drag)).toEqual([3, 0, 1]);
  });

  it('dragging to the bottom clears the fader', () => {
    let drag = startCarDrag([0, 3, 0], 1, 1);
    drag = moveCarDrag(drag, 0.5);
    drag = moveCarDrag(drag, -0.2);

    expect(endCarDrag(drag)).toEqual([0, 0, 0]);
  });

  it('sends nothing when the fader ends on the detent it started on', () => {
    let drag = startCarDrag([2, 0, 0], 0, 1);
    drag = moveCarDrag(drag, 0.62);

    expect(endCarDrag(drag)).toBeNull();
  });
});

describe('built-in messages', () => {
  it('are the five Maxx named (round 5 names), each a valid msg text', () => {
    expect(BUILTIN_MESSAGES).toEqual([
      'PULL OFF',
      'LEADERS BEHIND',
      'CATCHING UP',
      'PULLING AWAY',
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
