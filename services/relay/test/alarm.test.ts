import { afterEach, describe, expect, it } from 'vitest';

import {
  ALARM_TICK_MS,
  HUD_STALE_CLEAR_MS,
  ROOM_TTL_MS,
  type State,
} from '@g2-race-spotter/protocol';

import { earlierAlarmAt, nextAlarmAt } from '../src/alarm.js';

import {
  nextMessage,
  nextClose,
  openSocket,
  startWorker,
  type RunningWorker,
  within,
} from './live-worker.js';

interface AlarmDebug {
  readonly alarm: number | null;
  readonly state: State;
}

async function readAlarm(worker: RunningWorker): Promise<AlarmDebug> {
  const response = await fetch(`${worker.origin}/room/QA09/debug?alarm=1`, {
    headers: { 'X-Debug-Key': 'test-debug-key' },
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<AlarmDebug>;
}

async function waitForEmptyRoom(worker: RunningWorker): Promise<AlarmDebug> {
  const deadline = Date.now() + 5_000;
  let latest: AlarmDebug | undefined;
  while (Date.now() < deadline) {
    latest = await readAlarm(worker);
    if (latest.state.spotterOnline === false && latest.alarm !== null) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`room did not become empty: ${JSON.stringify(latest)}`);
}

describe('RaceRoom room-expiry alarm', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop();
  });

  it('repoints a closed live room to its stale clear (earlier than the TTL) without losing intents', async () => {
    worker = await startWorker();
    const socket = await openSocket(
      `${worker.origin.replace('http', 'ws')}/room/QA09?role=spotter`,
    );

    try {
      const replay = nextMessage(socket);
      socket.send(JSON.stringify({ t: 'hello', v: 2, role: 'spotter' }));
      await within(replay, 500);

      const tick = await readAlarm(worker);
      expect(tick.alarm).not.toBeNull();
      expect(tick.alarm as number).toBeLessThan(
        tick.state.updatedAt + ROOM_TTL_MS,
      );

      for (const frame of [
        { t: 'lane', lane: 'top' },
        { t: 'cars', cars: [3, 0, 1] },
        { t: 'msg', text: 'hold line' },
      ]) {
        const state = nextMessage(socket);
        socket.send(JSON.stringify(frame));
        await within(state, 500);
      }

      const closed = nextClose(socket);
      socket.terminate();
      await within(closed, 500);

      const empty = await waitForEmptyRoom(worker);
      expect(empty.state).toMatchObject({
        lane: 'top',
        cars: [3, 0, 1],
        msg: expect.objectContaining({ text: 'hold line' }),
        spotterOnline: false,
        driverOnline: false,
      });
      // The room still shows a call, so its stale clear (T055) is EARLIER
      // than the TTL and is what the single alarm points at; once cleared,
      // the empty room falls back to the TTL (stale-clear.test.ts).
      expect(empty.alarm).toBe(empty.state.updatedAt + HUD_STALE_CLEAR_MS);

      const emptyState: State = {
        ...empty.state,
        lane: null,
        cars: [0, 0, 0],
        msg: null,
        updatedAt: 123_456,
      };
      expect(nextAlarmAt(0, emptyState, Date.now())).toBe(
        emptyState.updatedAt + ROOM_TTL_MS,
      );
      const called: State = { ...emptyState, lane: 'top' };
      expect(nextAlarmAt(0, called, Date.now())).toBe(
        called.updatedAt + HUD_STALE_CLEAR_MS,
      );
      // With sockets open the tick wins while it is earlier.
      expect(nextAlarmAt(1, called, called.updatedAt)).toBe(
        called.updatedAt + ALARM_TICK_MS,
      );
      // A state change only ever pulls the alarm earlier.
      expect(earlierAlarmAt(null, called)).toBe(
        called.updatedAt + HUD_STALE_CLEAR_MS,
      );
      expect(earlierAlarmAt(called.updatedAt + 9_000, called)).toBe(
        called.updatedAt + HUD_STALE_CLEAR_MS,
      );
      expect(earlierAlarmAt(called.updatedAt + 1_000, called)).toBeUndefined();
      expect(
        earlierAlarmAt(called.updatedAt + 9_000, emptyState),
      ).toBeUndefined();
    } finally {
      socket.terminate();
    }
  }, 20_000);
});
