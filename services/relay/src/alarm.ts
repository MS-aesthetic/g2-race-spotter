import {
  ALARM_TICK_MS,
  ROOM_TTL_MS,
  type State,
} from '@g2-race-spotter/protocol';

export function nextAlarmAt(
  socketCount: number,
  state: State,
  now: number,
): number {
  return socketCount > 0 ? now + ALARM_TICK_MS : state.updatedAt + ROOM_TTL_MS;
}
