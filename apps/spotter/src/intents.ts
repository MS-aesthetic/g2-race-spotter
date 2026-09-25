import {
  CAR_LEVEL_MAX,
  MSG_MAX_CHARS,
  type CarLevel,
  type Cars,
} from '@g2-race-spotter/protocol';

/**
 * The three car-behind sliders, in the glasses' left-to-right order (Maxx,
 * 2026-09-25 design round 3; vertical since round 4): one 3-segment level
 * meter per `cars` slot.
 */
export const CAR_ROWS: readonly {
  readonly index: 0 | 1 | 2;
  readonly label: string;
}[] = [
  { index: 0, label: 'LEFT' },
  { index: 1, label: 'MIDDLE' },
  { index: 2, label: 'RIGHT' },
];

/** Segment numbers, bottom (1) to top (3); tapping segment `n` calls level
 * `n`. The view stacks them bottom-up like a level meter. */
export const CAR_SEGMENTS: readonly CarLevel[] = [1, 2, 3];

/**
 * The five built-in messages (Maxx, 2026-09-25 design round 4): client
 * constants, one tap sends them as `msg`. Room presets (`State.presets`) are
 * the spotter's own additions.
 */
export const BUILTIN_MESSAGES: readonly string[] = [
  'PULL OFF',
  'LEADERS BEHIND',
  'BACK UP ENTRY',
  'DRIVE IN FURTHER',
  'SPIN',
];

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
  return endCarDrag(startCarDrag(current, row, tapped));
}

function withRow(cars: Readonly<Cars>, row: 0 | 1 | 2, level: CarLevel): Cars {
  const next: Cars = [cars[0], cars[1], cars[2]];
  next[row] = level;
  return next;
}

/**
 * One touch on a slider, from `pointerdown` to `pointerup`. The level shown
 * while the finger is down is `level`; nothing is sent until the gesture
 * ends, and then at most one `cars` frame (040 AC-2).
 */
export interface CarDrag {
  readonly row: 0 | 1 | 2;
  /** The triple when the finger went down; only `row` can change. */
  readonly base: Readonly<Cars>;
  readonly level: CarLevel;
  /** The segment last under the finger (0 = below the bottom segment). */
  readonly over: CarLevel;
}

/**
 * Finger down on segment `segment`: the same decision as a tap — that level,
 * or 0 on the lit top segment.
 */
export function startCarDrag(
  current: Readonly<Cars>,
  row: 0 | 1 | 2,
  segment: CarLevel,
): CarDrag {
  return {
    row,
    base: [current[0], current[1], current[2]],
    level: nextCarLevel(current[row], segment),
    over: segment,
  };
}

/**
 * The finger moved over `segment` of slider `row` (0 = the label under the
 * bottom segment: no car). Another slider is ignored, and so is wobble inside
 * the segment the finger is already on — that is what keeps a tap on the lit
 * top segment at 0 instead of re-lighting it.
 */
export function moveCarDrag(
  drag: CarDrag,
  row: 0 | 1 | 2,
  segment: CarLevel,
): CarDrag {
  if (row !== drag.row || segment === drag.over) {
    return drag;
  }

  return { ...drag, level: segment, over: segment };
}

/** What the sliders show while the finger is down. */
export function dragCars(drag: CarDrag): Cars {
  return withRow(drag.base, drag.row, drag.level);
}

/** Finger up: the one triple to send, or `null` when the row did not change. */
export function endCarDrag(drag: CarDrag): Cars | null {
  return drag.level === drag.base[drag.row] ? null : dragCars(drag);
}

/** Row levels the spotter tapped while no replayed room state backed them. */
export type PendingCarRows = Partial<Record<0 | 1 | 2, CarLevel>>;

/**
 * The triple to send after a reconnect: the replayed room's `cars` with only
 * the rows the spotter tapped while offline overridden, or `null` if that is
 * what the room already holds. Building it from the replayed state (not from
 * the pre-drop local copy) keeps a row the relay cleared meanwhile — the 6 s
 * stale clear, say — from coming back.
 */
export function rebaseCars(
  server: Readonly<Cars>,
  pending: PendingCarRows,
): Cars | null {
  const next: Cars = [
    pending[0] ?? server[0],
    pending[1] ?? server[1],
    pending[2] ?? server[2],
  ];
  return next.every((level, index) => level === server[index]) ? null : next;
}

/**
 * Trim and cap to `MSG_MAX_CHARS`, then re-trim: slicing an 80-char boundary
 * can leave a trailing space, and `isSetMsg` rejects untrimmed text outright.
 */
export function normaliseMessage(text: string): string {
  return text.trim().slice(0, MSG_MAX_CHARS).trim();
}
