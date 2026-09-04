import { describe, expect, it } from 'vitest';

import {
  GAP_LABELS,
  GAP_VALUES,
  nearestGapValue,
  nextGap,
  nextSide,
} from '../src/intents.ts';

describe('AC-2 gap buttons', () => {
  it('offers the five values Maxx named, in order, with their labels', () => {
    expect([...GAP_VALUES]).toEqual([0, 25, 50, 75, 100]);
    expect([...GAP_LABELS]).toEqual(['CLEAR', '25', '50', '75', 'BUMPER']);
  });

  it('sends the tapped value once, and nothing at all for the current one', () => {
    // One tap, one send.
    expect(nextGap(0, 50)).toBe(50);
    expect(nextGap(100, 0)).toBe(0);
    // The room already holds exactly this: a second tap is not news.
    expect(nextGap(50, 50)).toBeNull();
    expect(nextGap(0, 0)).toBeNull();
  });

  it('compares against the room gap, not the button that is lit', () => {
    // At gap 40 the console lights `50` (the nearest button). Tapping `50` is
    // still a real change — the room is at 40 — and comparing the tap against
    // the lit button instead of the room would swallow it.
    expect(nearestGapValue(40)).toBe(50);
    expect(nextGap(40, 50)).toBe(50);
    expect(nextGap(40, 25)).toBe(25);
    // Only an exact match is a no-op.
    expect(nextGap(50, 50)).toBeNull();
  });

  it('snaps any server value to the nearest button', () => {
    expect(nearestGapValue(0)).toBe(0);
    expect(nearestGapValue(12)).toBe(0);
    expect(nearestGapValue(13)).toBe(25);
    expect(nearestGapValue(63)).toBe(75);
    expect(nearestGapValue(100)).toBe(100);
    // A value the relay should never send still lights a button.
    expect(nearestGapValue(Number.NaN)).toBe(0);
    expect(nearestGapValue(-10)).toBe(0);
    expect(nearestGapValue(400)).toBe(100);
  });
});

describe('side toggle (T052)', () => {
  it('sets the tapped side and clears it on a second tap', () => {
    expect(nextSide(null, 'inside')).toBe('inside');
    expect(nextSide(null, 'outside')).toBe('outside');
    // Tapping the lit button is how the spotter says the car has gone.
    expect(nextSide('inside', 'inside')).toBeNull();
    expect(nextSide('outside', 'outside')).toBeNull();
    // Tapping the other one switches sides without a clear in between.
    expect(nextSide('inside', 'outside')).toBe('outside');
    expect(nextSide('outside', 'inside')).toBe('inside');
  });
});
