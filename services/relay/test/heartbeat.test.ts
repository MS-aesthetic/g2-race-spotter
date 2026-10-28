import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  ALARM_TICK_MS,
  CLOSE_CODE_SILENT_PEER,
  PEER_OFFLINE_MS,
} from '@g2-race-spotter/protocol';

import {
  keepAlive,
  nextMessage,
  nextMessageMatching,
  openSocket,
  startWorker,
  type RunningWorker,
  within,
} from './live-worker.js';

/** 020 R4 / AC-7 (T050): the relay closes silent peers and says so. */

function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) =>
    socket.once('close', (code) => resolve(code)),
  );
}

async function join(
  url: string,
  role: 'spotter' | 'driver',
): Promise<WebSocket> {
  const socket = await openSocket(url);
  const replay = nextMessage(socket);
  socket.send(JSON.stringify({ t: 'hello', v: 2, role }));
  await within(replay, 1_000);
  return socket;
}

async function readAlarm(
  worker: RunningWorker,
  room: string,
): Promise<{ readonly alarm: number | null }> {
  const response = await fetch(`${worker.origin}/room/${room}/debug?alarm=1`, {
    headers: { 'X-Debug-Key': 'test-debug-key' },
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<{ readonly alarm: number | null }>;
}

// Slack for wrangler dev scheduling on a loaded CI box.
const SLACK_MS = 1_500;

describe('RaceRoom silent-peer reaper (T050)', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop();
    worker = undefined;
  });

  it('AC-7: a spotter that stops pinging is reported offline to the driver, then closed 4408', async () => {
    worker = await startWorker();
    const room = `${worker.origin.replace('http', 'ws')}/room/QA70`;
    const spotter = await join(`${room}?role=spotter`, 'spotter');
    const driver = await join(`${room}?role=driver`, 'driver');
    // Only the driver keeps pinging; the spotter's phone "died" after join.
    const stopPinging = keepAlive(driver);
    const silentSince = Date.now();

    try {
      const offline = nextMessageMatching(
        driver,
        (frame) => frame.t === 'state' && frame.spotterOnline === false,
      );
      const closed = closeCode(spotter);

      const frame = await within(
        offline,
        PEER_OFFLINE_MS + ALARM_TICK_MS + SLACK_MS,
      );
      const elapsed = Date.now() - silentSince;
      expect(frame).toMatchObject({ driverOnline: true });
      expect(elapsed).toBeGreaterThanOrEqual(PEER_OFFLINE_MS - 250);

      await expect(within(closed, 2_000)).resolves.toBe(CLOSE_CODE_SILENT_PEER);
      expect(driver.readyState).toBe(WebSocket.OPEN);
    } finally {
      stopPinging();
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it('keeps pinging peers connected and online', async () => {
    worker = await startWorker();
    const room = `${worker.origin.replace('http', 'ws')}/room/QA71`;
    const spotter = await join(`${room}?role=spotter`, 'spotter');
    const driver = await join(`${room}?role=driver`, 'driver');
    const stopPinging = keepAlive(spotter, driver);

    try {
      await new Promise((resolve) =>
        setTimeout(resolve, PEER_OFFLINE_MS + 2 * ALARM_TICK_MS),
      );
      expect(spotter.readyState).toBe(WebSocket.OPEN);
      expect(driver.readyState).toBe(WebSocket.OPEN);

      // Presence is still online in a fresh replay.
      const probe = await join(`${room}?role=driver`, 'driver');
      probe.terminate();
    } finally {
      stopPinging();
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it('reaps a socket that never sends hello so it no longer keeps the room ticking', async () => {
    // The relay sends the 4408 close frame on the next tick, but local
    // workerd does not complete the closing handshake for a socket that
    // never sent a message, so `ws` only reports the close after its own
    // 30 s timeout. What matters is the room's accounting: once the lurker
    // is reaped and the spotter has left, the alarm goes back from the
    // 3 s tick to the 24 h TTL.
    worker = await startWorker();
    const room = `${worker.origin.replace('http', 'ws')}/room/QA72`;
    const spotter = await join(`${room}?role=spotter`, 'spotter');
    const lurker = await openSocket(`${room}?role=driver`);

    try {
      spotter.close();
      const deadline =
        Date.now() + PEER_OFFLINE_MS + 2 * ALARM_TICK_MS + SLACK_MS;
      let alarm: number | null = null;
      while (Date.now() < deadline) {
        alarm = (await readAlarm(worker, 'QA72')).alarm;
        if (alarm !== null && alarm > Date.now() + 60 * 60 * 1_000) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(alarm).not.toBeNull();
      expect(alarm as number).toBeGreaterThan(Date.now() + 60 * 60 * 1_000);
    } finally {
      spotter.terminate();
      lurker.terminate();
    }
  }, 30_000);

  it('a reaped spotter can rejoin and is online again', async () => {
    worker = await startWorker();
    const room = `${worker.origin.replace('http', 'ws')}/room/QA73`;
    const spotter = await join(`${room}?role=spotter`, 'spotter');
    const driver = await join(`${room}?role=driver`, 'driver');
    const stopPinging = keepAlive(driver);

    try {
      await within(
        closeCode(spotter),
        PEER_OFFLINE_MS + ALARM_TICK_MS + SLACK_MS,
      );
      const online = nextMessageMatching(
        driver,
        (frame) => frame.t === 'state' && frame.spotterOnline === true,
      );
      const again = await join(`${room}?role=spotter`, 'spotter');
      await within(online, 1_000);
      again.terminate();
    } finally {
      stopPinging();
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);
});
