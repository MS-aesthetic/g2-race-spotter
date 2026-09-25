import {
  ALARM_TICK_MS,
  HUD_STALE_CLEAR_MS,
  isHudEmpty,
  ROOM_TTL_MS,
  type State,
} from '@g2-race-spotter/protocol';

/**
 * When a non-empty room's HUD content goes stale and must be cleared —
 * `HUD_STALE_CLEAR_MS` after the spotter's last call (`calledAt`), so driver
 * acks and presence flips never postpone it — or `null` while the room shows
 * nothing (an empty room never re-arms for it).
 */
export function staleClearAt(state: State): number | null {
  return isHudEmpty(state) ? null : state.calledAt + HUD_STALE_CLEAR_MS;
}

/** True when `alarm()` must reduce `{t:'stale'}` for this state. */
export function staleClearDue(state: State, now: number): boolean {
  const due = staleClearAt(state);
  return due !== null && now >= due;
}

/**
 * The single alarm target: the tick while sockets are open, the TTL once the
 * room is empty — or the stale clear, whichever is EARLIER.
 */
export function nextAlarmAt(
  socketCount: number,
  state: State,
  now: number,
): number {
  const base =
    socketCount > 0 ? now + ALARM_TICK_MS : state.updatedAt + ROOM_TTL_MS;
  const stale = staleClearAt(state);
  return stale === null ? base : Math.min(base, stale);
}

/**
 * Where a state change may move an already-armed alarm: only EARLIER, to the
 * stale clear, never later (pings and frames never push the tick/TTL back).
 * `undefined` means leave the alarm alone.
 */
export function earlierAlarmAt(
  current: number | null,
  state: State,
): number | undefined {
  const stale = staleClearAt(state);
  if (stale === null) {
    return undefined;
  }
  return current === null || stale < current ? stale : undefined;
}
