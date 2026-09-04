import { MSG_MAX_CHARS, type Side } from '@g2-race-spotter/protocol';

/**
 * The five gaps the spotter can call (Maxx, 2026-09-04 design round 2). A
 * slider asked for a drag with one gloved thumb on a phone the spotter is not
 * looking at; five buttons ask for one tap and always land on a value both
 * ends agree on.
 */
export const GAP_VALUES: readonly number[] = [0, 25, 50, 75, 100];

/** Labels in button order; the ends read as words, the middle as numbers. */
export const GAP_LABELS: readonly string[] = [
  'CLEAR',
  '25',
  '50',
  '75',
  'BUMPER',
];

/**
 * Which button a server gap lights up. The relay still carries 0–100 (the
 * glasses bar is continuous and other clients may set anything), so a value
 * from outside the five snaps to the nearest one rather than lighting nothing.
 */
export function nearestGapValue(gap: number): number {
  if (!Number.isFinite(gap)) {
    return GAP_VALUES[0]!;
  }

  return GAP_VALUES.reduce((best, value) =>
    Math.abs(value - gap) < Math.abs(best - gap) ? value : best,
  );
}

/**
 * What a tap on a gap button sends: the value, or `null` for "send nothing"
 * when the room already holds exactly that gap. Kept pure and separate from
 * the DOM so the one decision AC-2 names is unit-tested on its own.
 *
 * `current` is the room's actual gap (0-100), not the button the console
 * highlights: with the room at 40 the console lights `25`, but a tap on `50`
 * is still news and must be sent.
 */
export function nextGap(current: number, tapped: number): number | null {
  return current === tapped ? null : tapped;
}

/**
 * What a tap on a side button sends. The buttons are toggles: tapping the one
 * that is already lit means "that car is gone" and clears the call, so the
 * spotter never has to find a separate clear control with a car alongside.
 */
export function nextSide(current: Side | null, tapped: Side): Side | null {
  return current === tapped ? null : tapped;
}

/**
 * Trim and cap to `MSG_MAX_CHARS`, then re-trim: slicing an 80-char boundary
 * can leave a trailing space, and `isSetMsg` rejects untrimmed text outright.
 */
export function normaliseMessage(text: string): string {
  return text.trim().slice(0, MSG_MAX_CHARS).trim();
}
