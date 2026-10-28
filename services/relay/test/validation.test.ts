import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { FRAME_MAX_BYTES } from '@g2-race-spotter/protocol';

import {
  nextMessage,
  nextMessageMatching,
  openSocket,
  startWorker,
  type RunningWorker,
  within,
} from './live-worker.js';

/**
 * 020 AC-9 (T050): a joined socket survives bad frames. Oversized (UTF-8
 * bytes, before JSON.parse), unparseable, binary and wrongly-shaped frames
 * get `error{bad_frame}`; unknown `t` and wrong-role frames are ignored.
 * Every case ends with a ping → pong to prove the socket is still open and
 * that nothing else (no state broadcast) came first.
 */

async function join(
  url: string,
  role: 'spotter' | 'driver',
  name?: string,
): Promise<WebSocket> {
  const socket = await openSocket(url);
  const replay = nextMessage(socket);
  socket.send(
    JSON.stringify({
      t: 'hello',
      v: 2,
      role,
      ...(name === undefined ? {} : { name }),
    }),
  );
  await expect(within(replay, 1_000)).resolves.toMatchObject({ t: 'state' });
  return socket;
}

async function expectAlive(socket: WebSocket, ts: number): Promise<void> {
  const next = nextMessage(socket);
  socket.send(JSON.stringify({ t: 'ping', ts }));
  await expect(within(next, 1_000)).resolves.toMatchObject({ t: 'pong', ts });
  expect(socket.readyState).toBe(WebSocket.OPEN);
}

async function expectBadFrame(
  socket: WebSocket,
  frame: string | Buffer,
): Promise<void> {
  const next = nextMessage(socket);
  socket.send(frame);
  await expect(within(next, 1_000)).resolves.toEqual({
    t: 'error',
    code: 'bad_frame',
  });
}

describe('RaceRoom frame validation (T050, 020 AC-9)', () => {
  let worker: RunningWorker;
  let spotter: WebSocket;
  let driver: WebSocket;
  let room: string;

  beforeEach(async () => {
    worker = await startWorker();
    room = `${worker.origin.replace('http', 'ws')}/room/QA80`;
    spotter = await join(`${room}?role=spotter`, 'spotter');
    driver = await join(`${room}?role=driver`, 'driver');
    // Drain the spotter's presence update for the driver's join.
    await within(
      nextMessageMatching(spotter, (f) => f.driverOnline === true),
      1_000,
    ).catch(() => undefined);
  });

  afterEach(async () => {
    spotter?.terminate();
    driver?.terminate();
    await worker?.stop();
  });

  it('rejects an over-cap frame (ASCII) and keeps the socket', async () => {
    const text = 'a'.repeat(FRAME_MAX_BYTES + 10);
    await expectBadFrame(spotter, JSON.stringify({ t: 'msg', text }));
    await expectAlive(spotter, 1);
  }, 30_000);

  it('measures the cap in UTF-8 bytes, not characters', async () => {
    // 400 × '€' = 400 UTF-16 units but 1200 UTF-8 bytes.
    const frame = JSON.stringify({ t: 'msg', text: '€'.repeat(400) });
    expect(frame.length).toBeLessThan(FRAME_MAX_BYTES);
    await expectBadFrame(spotter, frame);
    await expectAlive(spotter, 2);
  }, 30_000);

  it('answers unparseable JSON with bad_frame and keeps the socket', async () => {
    await expectBadFrame(spotter, '{nope');
    await expectAlive(spotter, 3);
  }, 30_000);

  it('answers a binary frame with bad_frame and keeps the socket', async () => {
    await expectBadFrame(driver, Buffer.from([1, 2, 3]));
    await expectAlive(driver, 4);
  }, 30_000);

  it('answers a known t with a bad shape, or no t at all, with bad_frame', async () => {
    await expectBadFrame(
      spotter,
      JSON.stringify({ t: 'lane', lane: 'sideways' }),
    );
    await expectBadFrame(spotter, JSON.stringify({ lane: 'top' }));
    await expectAlive(spotter, 5);
  }, 30_000);

  it('ignores an unknown t silently', async () => {
    spotter.send(JSON.stringify({ t: 'warp', speed: 9 }));
    await expectAlive(spotter, 6);
    await expectAlive(driver, 7);
  }, 30_000);

  it('ignores wrong-role frames without changing the room', async () => {
    driver.send(JSON.stringify({ t: 'lane', lane: 'top' }));
    spotter.send(JSON.stringify({ t: 'ack', msgId: 'nope' }));
    // No state broadcast came before the pongs.
    await expectAlive(spotter, 8);
    await expectAlive(driver, 9);
  }, 30_000);

  it('still applies valid frames after bad ones', async () => {
    await expectBadFrame(spotter, '{nope');
    const applied = nextMessageMatching(
      driver,
      (f) => f.t === 'state' && f.lane === 'top',
    );
    spotter.send(JSON.stringify({ t: 'lane', lane: 'top' }));
    await within(applied, 1_000);
  }, 30_000);

  it("treats name='' in the URL as no name", async () => {
    const named = await join(`${room}?role=driver&name=`, 'driver');
    named.terminate();
  }, 30_000);
});
