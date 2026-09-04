import { afterEach, describe, expect, it } from 'vitest';

import { ROOM_TTL_MS, type State } from '@g2-race-spotter/protocol';

import { nextAlarmAt } from '../src/alarm.js';

import {
  nextMessage,
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

describe('RaceRoom room-expiry alarm', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop();
  });

  it('arms the live room tick and repoints an empty room to its state TTL', async () => {
    worker = await startWorker();
    const socket = await openSocket(
      `${worker.origin.replace('http', 'ws')}/room/QA09?role=spotter`,
    );

    try {
      const initial = await readAlarm(worker);
      expect(initial.alarm).not.toBeNull();
      expect(initial.alarm as number).toBeLessThan(Date.now() + ROOM_TTL_MS);

      const replay = nextMessage(socket);
      socket.send(JSON.stringify({ t: 'hello', v: 1, role: 'spotter' }));
      await within(replay, 500);

      const tick = await readAlarm(worker);
      expect(tick.alarm).not.toBeNull();
      expect(tick.alarm as number).toBeLessThan(
        tick.state.updatedAt + ROOM_TTL_MS,
      );

      const emptyState: State = { ...tick.state, updatedAt: 123_456 };
      expect(nextAlarmAt(0, emptyState, Date.now())).toBe(
        emptyState.updatedAt + ROOM_TTL_MS,
      );
    } finally {
      socket.terminate();
    }
  }, 20_000);
});
