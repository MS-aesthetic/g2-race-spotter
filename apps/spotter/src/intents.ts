import {
  CAR_LEVEL_MAX,
  MSG_MAX_CHARS,
  type CarLevel,
  type Cars,
  type Lane,
} from '@g2-race-spotter/protocol';

/**
 * The three car-behind faders, in the glasses' left-to-right order (Maxx,
 * 2026-09-30 design round 5: "Change names to inside behind outside"): one
 * vertical 4-detent fader per `cars` slot.
 */
export const CAR_ROWS: readonly {
  readonly index: 0 | 1 | 2;
  readonly label: string;
}[] = [
  { index: 0, label: 'INSIDE' },
  { index: 1, label: 'BEHIND' },
  { index: 2, label: 'OUTSIDE' },
];

/** A fader's detents, bottom (0 = no car) to top (3 = on the bumper). */
export const CAR_DETENTS: readonly CarLevel[] = [0, 1, 2, 3];

/**
 * The built-in messages (Maxx, 2026-10-01 design round 6): a 2×2 grid read
 * left to right, top to bottom — CATCHING UP / PULLING AWAY on top, LEADERS
 * BEHIND / EXIT under them (PULL OFF renamed EXIT, SPIN removed). Client
 * constants; one tap sends one as `msg`.
 */
export const BUILTIN_MESSAGES: readonly string[] = [
  'CATCHING UP',
  'PULLING AWAY',
  'LEADERS BEHIND',
  'EXIT',
];

/**
 * The lane a tap on `tapped` calls, given the lane the console shows lit
 * (design round 6: there is no CLEAR button any more): the tapped lane, or
 * `null` — clear the lane — when it is the lit one.
 */
export function laneTap(selected: Lane | null, tapped: Lane): Lane | null {
  return tapped === selected ? null : tapped;
}

/**
 * Where a finger at `y` sits on a fader track whose box starts at `trackTop`
 * and is `trackHeight` tall: 0 at the bottom edge, 1 at the top, clamped. The
 * track box *is* the knob's travel — detent n sits at n/3 of it — so the knob
 * centre can follow this fraction directly while the finger is down.
 */
export function faderPosition(
  y: number,
  trackTop: number,
  trackHeight: number,
): number {
  if (!(trackHeight > 0) || !Number.isFinite(y)) {
    return 0;
  }

  const fraction = (trackTop + trackHeight - y) / trackHeight;
  return Math.max(0, Math.min(1, fraction));
}

/** The snap rule: the detent nearest a 0..1 track position (clamped). */
export function detentAt(position: number): CarLevel {
  const clamped = Math.max(0, Math.min(1, position));
  return Math.round(clamped * CAR_LEVEL_MAX) as CarLevel;
}

/** The detent nearest a finger at `y` on the track (0 bottom … 3 top). */
export function detentFromPointer(
  y: number,
  trackTop: number,
  trackHeight: number,
): CarLevel {
  return detentAt(faderPosition(y, trackTop, trackHeight));
}

/**
 * The full triple a fader release sends (the wire always carries all three),
 * or `null` when that fader ends where the room already has it.
 */
export function nextCars(
  current: Readonly<Cars>,
  row: 0 | 1 | 2,
  level: CarLevel,
): Cars | null {
  const clamped = Math.max(0, Math.min(CAR_LEVEL_MAX, level)) as CarLevel;
  if (current[row] === clamped) {
    return null;
  }

  const next: Cars = [current[0], current[1], current[2]];
  next[row] = clamped;
  return next;
}

/**
 * One finger on a fader, from `pointerdown` to `pointerup`. The knob follows
 * `position` live and the fader reads `level` (the nearest detent); nothing is
 * sent until the gesture ends, and then at most one `cars` frame (040 AC-2).
 */
export interface CarDrag {
  readonly row: 0 | 1 | 2;
  /** The triple when the finger went down; only `row` can change. */
  readonly base: Readonly<Cars>;
  /** 0..1 along the track, bottom to top. */
  readonly position: number;
  readonly level: CarLevel;
}

/** Finger down at `position` on fader `row`: the knob jumps under it. */
export function startCarDrag(
  current: Readonly<Cars>,
  row: 0 | 1 | 2,
  position: number,
): CarDrag {
  return moveCarDrag(
    { row, base: [current[0], current[1], current[2]], position: 0, level: 0 },
    position,
  );
}

/** The finger moved to `position` on the same track (pointer capture keeps
 * every move on the fader it went down on). */
export function moveCarDrag(drag: CarDrag, position: number): CarDrag {
  return {
    ...drag,
    position: Math.max(0, Math.min(1, position)),
    level: detentAt(position),
  };
}

/** What the faders read while the finger is down. */
export function dragCars(drag: CarDrag): Cars {
  const next: Cars = [drag.base[0], drag.base[1], drag.base[2]];
  next[drag.row] = drag.level;
  return next;
}

/** Finger up: the one triple to send, or `null` when the fader did not change. */
export function endCarDrag(drag: CarDrag): Cars | null {
  return nextCars(drag.base, drag.row, drag.level);
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
