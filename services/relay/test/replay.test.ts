import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  createPersistenceDirectory,
  nextMessage,
  openSocket,
  removeTemporaryDirectory,
  startWorker,
  type RunningWorker,
  within,
} from './live-worker.js';

function roomUrl(worker: RunningWorker, role: 'spotter' | 'driver'): string {
  return `${worker.origin.replace('http', 'ws')}/room/QA08?role=${role}`;
}

async function hello(
  socket: WebSocket,
  role: 'spotter' | 'driver',
): Promise<Record<string, unknown>> {
  const replay = nextMessage(socket);
  socket.send(JSON.stringify({ t: 'hello', v: 2, role }));
  return within(replay, 500);
}

describe('RaceRoom replay', () => {
  let worker: RunningWorker | undefined;
  let persistenceDirectory: string | undefined;

  afterEach(async () => {
    await worker?.stop({ removePersistence: false });
    if (persistenceDirectory !== undefined) {
      await removeTemporaryDirectory(persistenceDirectory);
    }
  });

  it('replays the complete latest state to a reconnecting driver', async () => {
    worker = await startWorker();
    const spotter = await openSocket(roomUrl(worker, 'spotter'));
    const driver = await openSocket(roomUrl(worker, 'driver'));

    try {
      await hello(spotter, 'spotter');
      await hello(driver, 'driver');

      const lane = nextMessage(spotter);
      spotter.send(JSON.stringify({ t: 'lane', lane: 'top' }));
      await within(lane, 500);
      const cars = nextMessage(spotter);
      spotter.send(JSON.stringify({ t: 'cars', cars: [1, 2, 3] }));
      await within(cars, 500);
      const message = nextMessage(spotter);
      spotter.send(JSON.stringify({ t: 'msg', text: 'hold line' }));
      const lastSeen = await within(message, 500);
      driver.terminate();
      const reconnectingDriver = await openSocket(roomUrl(worker, 'driver'));
      try {
        const replay = await hello(reconnectingDriver, 'driver');
        expect(replay).toMatchObject({
          t: 'state',
          lane: 'top',
          cars: [1, 2, 3],
          msg: expect.objectContaining({ text: 'hold line' }),
        });
        expect(replay.seq).toBeGreaterThanOrEqual(lastSeen.seq as number);
      } finally {
        reconnectingDriver.close();
      }
    } finally {
      spotter.close();
      driver.terminate();
    }
  }, 20_000);

  it('loads persisted state and sequence after the Durable Object runtime restarts', async () => {
    persistenceDirectory = await createPersistenceDirectory();
    worker = await startWorker(persistenceDirectory);
    const spotter = await openSocket(roomUrl(worker, 'spotter'));

    try {
      await hello(spotter, 'spotter');
      const lane = nextMessage(spotter);
      spotter.send(JSON.stringify({ t: 'lane', lane: 'bot' }));
      await within(lane, 500);
      const cars = nextMessage(spotter);
      spotter.send(JSON.stringify({ t: 'cars', cars: [0, 0, 2] }));
      await within(cars, 500);
      const message = nextMessage(spotter);
      spotter.send(JSON.stringify({ t: 'msg', text: 'traffic ahead' }));
      const lastSeen = await within(message, 500);

      await worker.stop({ removePersistence: false });
      worker = await startWorker(persistenceDirectory);
      const driver = await openSocket(roomUrl(worker, 'driver'));
      try {
        const replay = await hello(driver, 'driver');
        expect(replay).toMatchObject({
          t: 'state',
          lane: 'bot',
          cars: [0, 0, 2],
          msg: expect.objectContaining({ text: 'traffic ahead' }),
          spotterOnline: false,
          driverOnline: true,
        });
        expect(replay.seq).toBeGreaterThanOrEqual(lastSeen.seq as number);
      } finally {
        driver.close();
      }
    } finally {
      spotter.terminate();
    }
  }, 30_000);
});
