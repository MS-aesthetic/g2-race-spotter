import { afterEach, describe, expect, it } from 'vitest';

import { type State } from '@g2-race-spotter/protocol';

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
  const response = await fetch(`${worker.origin}/room/QA16/debug?alarm=1`, {
    headers: { 'X-Debug-Key': 'test-debug-key' },
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<AlarmDebug>;
}

async function waitForAlarmAdvances(
  worker: RunningWorker,
  firstAlarm: number,
): Promise<AlarmDebug> {
  const deadline = Date.now() + 10_000;
  let previous = firstAlarm;
  let advances = 0;

  while (Date.now() < deadline) {
    const { alarm } = await readAlarm(worker);
    if (alarm !== null && alarm > previous + 1_000) {
      advances += 1;
      previous = alarm;
      if (advances === 2) {
        return { alarm, state: (await readAlarm(worker)).state };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`alarm advanced ${advances} times in 10 seconds`);
}

function startPinging(
  socket: Awaited<ReturnType<typeof openSocket>>,
): () => void {
  let timestamp = Date.now();
  const interval = setInterval(() => {
    timestamp += 1;
    socket.send(JSON.stringify({ t: 'ping', ts: timestamp }));
  }, 2_000);
  return () => clearInterval(interval);
}

describe('RaceRoom heartbeat prerequisites', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop();
  });

  it('pongs ready clients and self-arms the shared alarm while a quiet room pings', async () => {
    worker = await startWorker();
    const room = `${worker.origin.replace('http', 'ws')}/room/QA16`;
    const spotter = await openSocket(`${room}?role=spotter`);
    const driver = await openSocket(`${room}?role=driver`);
    const stopPinging: Array<() => void> = [];

    try {
      const spotterReplay = nextMessage(spotter);
      spotter.send(JSON.stringify({ t: 'hello', v: 2, role: 'spotter' }));
      await within(spotterReplay, 500);

      const spotterPresence = nextMessage(spotter);
      const driverReplay = nextMessage(driver);
      driver.send(JSON.stringify({ t: 'hello', v: 2, role: 'driver' }));
      await Promise.all([
        within(spotterPresence, 500),
        within(driverReplay, 500),
      ]);

      const spotterPong = nextMessage(spotter);
      spotter.send(JSON.stringify({ t: 'ping', ts: 17 }));
      const driverPong = nextMessage(driver);
      driver.send(JSON.stringify({ t: 'ping', ts: 23 }));
      const spotterFrame = await within(spotterPong, 500);
      expect(spotterFrame).toMatchObject({
        t: 'pong',
        ts: 17,
      });
      expect(Number.isFinite(spotterFrame.serverTs)).toBe(true);

      const driverFrame = await within(driverPong, 500);
      expect(driverFrame).toMatchObject({
        t: 'pong',
        ts: 23,
      });
      expect(Number.isFinite(driverFrame.serverTs)).toBe(true);

      const initial = await readAlarm(worker);
      expect(initial.alarm).not.toBeNull();
      stopPinging.push(startPinging(spotter), startPinging(driver));
      const advanced = await waitForAlarmAdvances(
        worker,
        initial.alarm as number,
      );
      expect(advanced.state).toEqual(initial.state);
    } finally {
      for (const stop of stopPinging) {
        stop();
      }
      spotter.terminate();
      driver.terminate();
    }
  }, 20_000);
});
