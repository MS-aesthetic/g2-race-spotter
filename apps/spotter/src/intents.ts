import {
  CAR_LEVEL_MAX,
  MSG_MAX_CHARS,
  type CarLevel,
  type Cars,
} from '@g2-race-spotter/protocol';

/**
 * The three car-behind rows, in the glasses' left-to-right order (Maxx,
 * 2026-09-25 design round 3): one 3-segment bar per `cars` slot.
 */
export const CAR_ROWS: readonly {
  readonly index: 0 | 1 | 2;
  readonly label: string;
}[] = [
  { index: 0, label: 'LEFT' },
  { index: 1, label: 'MIDDLE' },
  { index: 2, label: 'RIGHT' },
];

/** Segment numbers left to right; tapping segment `n` calls level `n`. */
export const CAR_SEGMENTS: readonly CarLevel[] = [1, 2, 3];

/**
 * What a tap on segment `tapped` of a row at level `current` sets: that
 * level, or 0 when the tap lands on the lit top segment ("that car has
 * gone"), so there is no separate clear control to find.
 */
export function nextCarLevel(current: CarLevel, tapped: CarLevel): CarLevel {
  const level = Math.max(0, Math.min(CAR_LEVEL_MAX, tapped)) as CarLevel;
  return level === current ? 0 : level;
}

/**
 * The full triple one tap sends (the wire always carries all three), or
 * `null` when it would not change the room.
 */
export function nextCars(
  current: Readonly<Cars>,
  row: 0 | 1 | 2,
  tapped: CarLevel,
): Cars | null {
  const next: Cars = [current[0], current[1], current[2]];
  next[row] = nextCarLevel(current[row], tapped);
  return next[row] === current[row] ? null : next;
}

/**
 * Trim and cap to `MSG_MAX_CHARS`, then re-trim: slicing an 80-char boundary
 * can leave a trailing space, and `isSetMsg` rejects untrimmed text outright.
 */
export function normaliseMessage(text: string): string {
  return text.trim().slice(0, MSG_MAX_CHARS).trim();
}
