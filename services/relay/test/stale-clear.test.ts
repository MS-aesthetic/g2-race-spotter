import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  ALARM_TICK_MS,
  HUD_STALE_CLEAR_MS,
  PING_INTERVAL_MS,
  ROOM_TTL_MS,
  type State,
} from '@g2-race-spotter/protocol';

import {
  nextClose,
  nextMessage,
  nextMessageMatching,
  openSocket,
  startWorker,
  type RunningWorker,
  within,
} from './live-worker.js';

interface AlarmDebug {
  readonly alarm: number | null;
  readonly state: State;
}

/** The observed clear must land in [6 s, 7 s) after the last spotter call. */
const CLEAR_WINDOW_MS = 1_000;

function roomUrl(
  worker: RunningWorker,
  room: string,
  role: 'spotter' | 'driver',
): string {
  return `${worker.origin.replace('http', 'ws')}/room/${room}?role=${role}`;
}

async function readAlarm(
  worker: RunningWorker,
  room: string,
): Promise<AlarmDebug> {
  const response = await fetch(`${worker.origin}/room/${room}/debug?alarm=1`, {
    headers: { 'X-Debug-Key': 'test-debug-key' },
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<AlarmDebug>;
}

async function join(
  worker: RunningWorker,
  room: string,
): Promise<{ readonly spotter: WebSocket; readonly driver: WebSocket }> {
  const spotter = await openSocket(roomUrl(worker, room, 'spotter'));
  const driver = await openSocket(roomUrl(worker, room, 'driver'));
  const spotterReplay = nextMessage(spotter);
  spotter.send(JSON.stringify({ t: 'hello', v: 2, role: 'spotter' }));
  await within(spotterReplay, 500);
  const driverReplay = nextMessageMatching(
    driver,
    (frame) => frame.t === 'state' && frame.spotterOnline === true,
  );
  driver.send(JSON.stringify({ t: 'hello', v: 2, role: 'driver' }));
  await within(driverReplay, 500);
  return { spotter, driver };
}

/**
 * Both peers keep pinging like a real `RoomClient`: pings are liveness, not
 * spotter data, and must never postpone the stale clear.
 */
function keepPinging(...sockets: WebSocket[]): () => void {
  const timer = setInterval(() => {
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: 'ping', ts: Date.now() }));
      }
    }
  }, PING_INTERVAL_MS);
  return () => clearInterval(timer);
}

/** Send a spotter call and wait until the driver has the resulting state. */
async function call(
  spotter: WebSocket,
  driver: WebSocket,
  frame: object,
  matches: (state: Record<string, unknown>) => boolean,
): Promise<number> {
  const seen = nextMessageMatching(
    driver,
    (message) => message.t === 'state' && matches(message),
  );
  const sentAt = Date.now();
  spotter.send(JSON.stringify(frame));
  await within(seen, 500);
  return sentAt;
}

function isCleared(frame: Record<string, unknown>): boolean {
  return (
    frame.t === 'state' &&
    frame.lane === null &&
    JSON.stringify(frame.cars) === '[0,0,0]' &&
    frame.msg === null
  );
}

describe('RaceRoom stale clear', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop();
  });

  it('broadcasts a cleared state 6–7 s after the last spotter call, pings notwithstanding', async () => {
    worker = await startWorker();
    const { spotter, driver } = await join(worker, 'QA31');
    const stopPinging = keepPinging(spotter, driver);

    try {
      await call(spotter, driver, { t: 'lane', lane: 'top' }, (s) => {
        return s.lane === 'top';
      });
      await call(spotter, driver, { t: 'cars', cars: [1, 2, 3] }, (s) => {
        return JSON.stringify(s.cars) === '[1,2,3]';
      });
      const cleared = nextMessageMatching(driver, isCleared);
      const lastCallAt = await call(
        spotter,
        driver,
        { t: 'msg', text: 'box box' },
        (s) => s.msg !== null,
      );
      const before = await readAlarm(worker, 'QA31');

      const frame = await within(cleared, HUD_STALE_CLEAR_MS + 2_000);
      const silence = Date.now() - lastCallAt;
      console.info(`stale clear after ${silence} ms of spotter silence`);

      expect(silence).toBeGreaterThanOrEqual(HUD_STALE_CLEAR_MS);
      expect(silence).toBeLessThan(HUD_STALE_CLEAR_MS + CLEAR_WINDOW_MS);
      // Presence is untouched: only the HUD content goes.
      expect(frame).toMatchObject({
        spotterOnline: true,
        driverOnline: true,
      });
      expect(frame.seq as number).toBeGreaterThan(before.state.seq);
      // The spotter hears it too, and the room is empty on the server.
      const after = await readAlarm(worker, 'QA31');
      expect(after.state).toMatchObject({
        lane: null,
        cars: [0, 0, 0],
        msg: null,
      });
      // With sockets open an empty room only ticks; it never re-arms for a
      // stale clear it has nothing to clear.
      expect(after.alarm).not.toBeNull();
      expect(after.alarm as number).toBeLessThanOrEqual(
        Date.now() + ALARM_TICK_MS,
      );
    } finally {
      stopPinging();
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it('does not let the driver ack at ~5 s postpone the clear', async () => {
    worker = await startWorker();
    const { spotter, driver } = await join(worker, 'QA35');
    const stopPinging = keepPinging(spotter, driver);

    try {
      await call(spotter, driver, { t: 'lane', lane: 'bot' }, (s) => {
        return s.lane === 'bot';
      });
      await call(spotter, driver, { t: 'cars', cars: [0, 3, 0] }, (s) => {
        return JSON.stringify(s.cars) === '[0,3,0]';
      });
      const withMessage = nextMessageMatching(
        driver,
        (s) => s.t === 'state' && s.msg !== null,
      );
      const lastCallAt = Date.now();
      spotter.send(JSON.stringify({ t: 'msg', text: 'pit now' }));
      const shown = await within(withMessage, 500);
      const msgId = (shown.msg as { id: string }).id;
      const cleared = nextMessageMatching(driver, isCleared);

      // The glasses' 5 s auto-ack: a state change, but not a spotter call.
      await new Promise((resolve) =>
        setTimeout(resolve, 5_000 - (Date.now() - lastCallAt)),
      );
      const acked = nextMessageMatching(
        driver,
        (s) =>
          s.t === 'state' &&
          (s.msg as { ackedAt: number | null } | null)?.ackedAt != null,
      );
      driver.send(JSON.stringify({ t: 'ack', msgId }));
      const ackFrame = await within(acked, 500);
      expect(ackFrame.updatedAt as number).toBeGreaterThan(
        ackFrame.calledAt as number,
      );

      await within(cleared, HUD_STALE_CLEAR_MS + 2_000);
      const silence = Date.now() - lastCallAt;
      console.info(`stale clear after ${silence} ms despite a 5 s ack`);

      expect(silence).toBeGreaterThanOrEqual(HUD_STALE_CLEAR_MS);
      expect(silence).toBeLessThan(HUD_STALE_CLEAR_MS + CLEAR_WINDOW_MS);
    } finally {
      stopPinging();
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it('restarts the 6 s window on a fresh call inside it', async () => {
    worker = await startWorker();
    const { spotter, driver } = await join(worker, 'QA32');
    const stopPinging = keepPinging(spotter, driver);

    try {
      await call(spotter, driver, { t: 'lane', lane: 'mid' }, (s) => {
        return s.lane === 'mid';
      });
      const cleared = nextMessageMatching(driver, isCleared);
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      const freshCallAt = await call(
        spotter,
        driver,
        { t: 'cars', cars: [0, 1, 0] },
        (s) => JSON.stringify(s.cars) === '[0,1,0]',
      );

      const frame = await within(cleared, HUD_STALE_CLEAR_MS + 2_000);
      const silence = Date.now() - freshCallAt;
      console.info(`restarted stale clear after ${silence} ms`);

      // Nothing was cleared 6 s after the FIRST call (that was ~2 s after
      // the fresh one); the clear follows the fresh call instead.
      expect(silence).toBeGreaterThanOrEqual(HUD_STALE_CLEAR_MS);
      expect(silence).toBeLessThan(HUD_STALE_CLEAR_MS + CLEAR_WINDOW_MS);
      expect(frame).toMatchObject({ lane: null, cars: [0, 0, 0] });
    } finally {
      stopPinging();
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it('clears a room nobody is connected to, then leaves the alarm on the TTL', async () => {
    worker = await startWorker();
    const { spotter, driver } = await join(worker, 'QA33');

    try {
      await call(spotter, driver, { t: 'cars', cars: [0, 0, 3] }, (s) => {
        return JSON.stringify(s.cars) === '[0,0,3]';
      });
      const spotterClosed = nextClose(spotter);
      const driverClosed = nextClose(driver);
      spotter.terminate();
      driver.terminate();
      await within(Promise.all([spotterClosed, driverClosed]), 500);

      // Once both sockets are gone, the stale clear is earlier than the TTL.
      let armed: AlarmDebug | undefined;
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        armed = await readAlarm(worker, 'QA33');
        if (!armed.state.spotterOnline && !armed.state.driverOnline) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(armed?.state.cars).toEqual([0, 0, 3]);
      expect(armed?.alarm).toBe(
        (armed?.state.calledAt ?? 0) + HUD_STALE_CLEAR_MS,
      );

      await new Promise((resolve) =>
        setTimeout(resolve, HUD_STALE_CLEAR_MS + 1_000),
      );
      const cleared = await readAlarm(worker, 'QA33');
      expect(cleared.state).toMatchObject({
        lane: null,
        cars: [0, 0, 0],
        msg: null,
      });
      // An empty room does not loop: its only alarm is the room TTL.
      expect(cleared.alarm).toBe(cleared.state.updatedAt + ROOM_TTL_MS);

      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const later = await readAlarm(worker, 'QA33');
      expect(later.state.seq).toBe(cleared.state.seq);
      expect(later.alarm).toBe(cleared.alarm);
    } finally {
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it('never arms a stale clear for a room that shows nothing', async () => {
    worker = await startWorker();
    const { spotter, driver } = await join(worker, 'QA34');
    const spotterClosed = nextClose(spotter);
    const driverClosed = nextClose(driver);
    spotter.terminate();
    driver.terminate();
    await within(Promise.all([spotterClosed, driverClosed]), 500);

    let empty: AlarmDebug | undefined;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      empty = await readAlarm(worker, 'QA34');
      if (!empty.state.spotterOnline && !empty.state.driverOnline) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(
      empty?.alarm === null ||
        empty?.alarm === (empty?.state.updatedAt ?? 0) + ROOM_TTL_MS,
    ).toBe(true);
  }, 30_000);
});
