import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  nextMessage,
  openSocket,
  startWorker,
  type RunningWorker,
  within,
} from './live-worker.js';

interface RejectedSocket {
  readonly socket: WebSocket;
  readonly message: Promise<Record<string, unknown>>;
  readonly closed: Promise<{ readonly code: number }>;
}

function roomUrl(worker: RunningWorker, room: string, query = ''): string {
  return `${worker.origin.replace('http', 'ws')}/room/${room}${query}`;
}

async function hello(
  socket: WebSocket,
  role: 'spotter' | 'driver',
): Promise<Record<string, unknown>> {
  const replay = nextMessage(socket);
  socket.send(JSON.stringify({ t: 'hello', v: 1, role }));
  return within(replay, 500);
}

function watchClose(socket: WebSocket): Promise<{ readonly code: number }> {
  return new Promise((resolve) => {
    socket.once('close', (code) => resolve({ code }));
  });
}

async function openRejectedSocket(url: string): Promise<RejectedSocket> {
  const socket = new WebSocket(url);
  const message = nextMessage(socket);
  const closed = watchClose(socket);
  await once(socket, 'open');
  return { socket, message, closed };
}

async function expectNoMessage(socket: WebSocket, ms: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handler = (data: WebSocket.RawData): void => {
      clearTimeout(timeout);
      socket.off('message', handler);
      reject(new Error(`unexpected message: ${data.toString()}`));
    };
    const timeout = setTimeout(() => {
      socket.off('message', handler);
      resolve();
    }, ms);
    socket.on('message', handler);
  });
}

describe('RaceRoom driver eviction', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop({ removePersistence: false });
  });

  it('evicts the previous driver on a correctly PIN-checked join, and only the new driver hears later broadcasts', async () => {
    worker = await startWorker();
    const first = await openSocket(
      roomUrl(worker, 'QA20', '?role=driver&token=1234'),
    );

    try {
      await hello(first, 'driver');

      const evictedError = nextMessage(first);
      const evictedClose = watchClose(first);

      const second = await openSocket(
        roomUrl(worker, 'QA20', '?role=driver&token=1234'),
      );

      try {
        const secondFirstFrame = await hello(second, 'driver');
        expect(secondFirstFrame).toMatchObject({
          t: 'state',
          driverOnline: true,
          seq: expect.any(Number),
        });
        expect((secondFirstFrame as { seq: number }).seq).toBeGreaterThan(0);

        await expect(within(evictedError, 500)).resolves.toEqual({
          t: 'error',
          code: 'role_taken',
        });
        await expect(within(evictedClose, 2_000)).resolves.toEqual({
          code: 4409,
        });

        // The evicted socket is closed and must not receive anything else,
        // while the new driver keeps hearing broadcasts.
        const spotter = await openSocket(
          roomUrl(worker, 'QA20', '?role=spotter&token=1234'),
        );
        try {
          await hello(spotter, 'spotter');
          const laneForNewDriver = nextMessage(second);
          const noMoreForOldDriver = expectNoMessage(first, 300);
          spotter.send(JSON.stringify({ t: 'lane', lane: 'top' }));

          await expect(within(laneForNewDriver, 500)).resolves.toMatchObject({
            t: 'state',
            lane: 'top',
            seq: expect.any(Number),
          });
          await noMoreForOldDriver;
        } finally {
          spotter.terminate();
        }
      } finally {
        second.terminate();
      }
    } finally {
      first.terminate();
    }
  }, 20_000);

  it('does not evict the first driver when a joiner supplies the wrong PIN', async () => {
    worker = await startWorker();
    const first = await openSocket(
      roomUrl(worker, 'QA21', '?role=driver&token=1234'),
    );

    try {
      await hello(first, 'driver');

      const rejected = await openRejectedSocket(
        roomUrl(worker, 'QA21', '?role=driver&token=9999'),
      );
      rejected.socket.send(
        JSON.stringify({ t: 'hello', v: 1, role: 'driver' }),
      );
      await expect(within(rejected.message, 500)).resolves.toEqual({
        t: 'error',
        code: 'auth',
      });
      await expect(within(rejected.closed, 2_000)).resolves.toEqual({
        code: 4401,
      });
      rejected.socket.terminate();

      // The first driver was never touched: it is still connected and still
      // receives broadcasts.
      const spotter = await openSocket(
        roomUrl(worker, 'QA21', '?role=spotter&token=1234'),
      );
      try {
        await hello(spotter, 'spotter');
        const laneForFirstDriver = nextMessage(first);
        spotter.send(JSON.stringify({ t: 'lane', lane: 'mid' }));
        await expect(within(laneForFirstDriver, 500)).resolves.toMatchObject({
          t: 'state',
          lane: 'mid',
          driverOnline: true,
          seq: expect.any(Number),
        });
      } finally {
        spotter.terminate();
      }
    } finally {
      first.terminate();
    }
  }, 20_000);
});
