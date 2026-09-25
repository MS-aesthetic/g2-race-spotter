import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  nextMessage,
  openSocket,
  startWorker,
  createPersistenceDirectory,
  removeTemporaryDirectory,
  type RunningWorker,
  within,
} from './live-worker.js';

interface DebugRoom {
  readonly alarm: number | null;
  readonly createdAt: number | null;
  readonly state: Record<string, unknown>;
}

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
  socket.send(JSON.stringify({ t: 'hello', v: 2, role }));
  return within(replay, 500);
}

async function openRejectedSocket(url: string): Promise<RejectedSocket> {
  const socket = new WebSocket(url);
  const message = nextMessage(socket);
  const closed = new Promise<{ readonly code: number }>((resolve) => {
    socket.once('close', (code) => resolve({ code }));
  });
  await once(socket, 'open');
  return { socket, message, closed };
}

async function readDebug(
  worker: RunningWorker,
  room: string,
): Promise<DebugRoom> {
  const response = await fetch(`${worker.origin}/room/${room}/debug?alarm=1`, {
    headers: { 'X-Debug-Key': 'test-debug-key' },
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<DebugRoom>;
}

async function expectRejected(
  url: string,
  role: 'spotter' | 'driver',
  error: 'auth' | 'bad_frame' | 'version',
  closeCode: number,
): Promise<void> {
  const rejected = await openRejectedSocket(url);
  rejected.socket.send(JSON.stringify({ t: 'hello', v: 2, role }));
  await expect(within(rejected.message, 500)).resolves.toEqual({
    t: 'error',
    code: error,
  });
  await expect(within(rejected.closed, 2_000)).resolves.toEqual({
    code: closeCode,
  });
  rejected.socket.terminate();
}

describe('RaceRoom PIN authentication', () => {
  let worker: RunningWorker | undefined;
  let persistenceDirectory: string | undefined;

  afterEach(async () => {
    await worker?.stop({ removePersistence: false });
    if (persistenceDirectory !== undefined) {
      await removeTemporaryDirectory(persistenceDirectory);
    }
  });

  it('creates an open room with an explicit null PIN that accepts later tokens', async () => {
    worker = await startWorker();
    const spotter = await openSocket(roomUrl(worker, 'QA11', '?role=spotter'));
    const driver = await openSocket(
      roomUrl(worker, 'QA11', '?role=driver&token=9999'),
    );

    try {
      await hello(spotter, 'spotter');
      await expect(hello(driver, 'driver')).resolves.toMatchObject({
        t: 'state',
        spotterOnline: true,
        driverOnline: true,
      });
    } finally {
      spotter.terminate();
      driver.terminate();
    }
  }, 20_000);

  it('rejects a mismatched first-hello version before URL authority or PIN storage', async () => {
    worker = await startWorker();
    const rejected = await openRejectedSocket(
      roomUrl(worker, 'QA16', '?role=spotter&name=url-name&token=9999'),
    );

    try {
      rejected.socket.send(
        // A protocol v1 client (gap/side era) after the v2 bump.
        JSON.stringify({
          t: 'hello',
          v: 1,
          role: 'driver',
          name: 'hello-name',
        }),
      );
      await expect(within(rejected.message, 500)).resolves.toEqual({
        t: 'error',
        code: 'version',
      });
      await expect(within(rejected.closed, 2_000)).resolves.toEqual({
        code: 4426,
      });
      await expect(readDebug(worker, 'QA16')).resolves.toMatchObject({
        alarm: null,
        createdAt: null,
        state: { seq: 0, spotterOnline: false, driverOnline: false },
      });

      const firstCurrent = await openSocket(
        roomUrl(worker, 'QA16', '?role=spotter&token=1234'),
      );
      try {
        await expect(hello(firstCurrent, 'spotter')).resolves.toMatchObject({
          t: 'state',
          spotterOnline: true,
        });
        await expect(readDebug(worker, 'QA16')).resolves.toMatchObject({
          createdAt: expect.any(Number),
        });
        await expectRejected(
          roomUrl(worker, 'QA16', '?role=driver'),
          'driver',
          'auth',
          4401,
        );
      } finally {
        firstCurrent.terminate();
      }
    } finally {
      rejected.socket.terminate();
    }
  }, 20_000);

  it.each(['', 'abc', '12345'])(
    'rejects the supplied invalid token %j before it establishes a room',
    async (token) => {
      worker = await startWorker();
      await expectRejected(
        roomUrl(worker, 'QA12', `?role=spotter&token=${token}`),
        'spotter',
        'auth',
        4401,
      );

      await expect(readDebug(worker, 'QA12')).resolves.toMatchObject({
        alarm: null,
        state: { seq: 0, spotterOnline: false, driverOnline: false },
      });

      const openRoom = await openSocket(
        roomUrl(worker, 'QA12', '?role=spotter'),
      );
      try {
        await expect(hello(openRoom, 'spotter')).resolves.toMatchObject({
          t: 'state',
          spotterOnline: true,
        });
      } finally {
        openRoom.terminate();
      }
    },
    20_000,
  );

  it('keeps an absent token distinct from a supplied token in an open room', async () => {
    worker = await startWorker();
    const first = await openSocket(roomUrl(worker, 'QA12', '?role=spotter'));

    try {
      await hello(first, 'spotter');
      const driver = await openSocket(
        roomUrl(worker, 'QA12', '?role=driver&token=9999'),
      );
      try {
        await expect(hello(driver, 'driver')).resolves.toMatchObject({
          t: 'state',
          driverOnline: true,
        });
      } finally {
        driver.terminate();
      }
    } finally {
      first.terminate();
    }
  }, 20_000);

  it('persists a protected room PIN across a local Worker restart', async () => {
    persistenceDirectory = await createPersistenceDirectory();
    worker = await startWorker(persistenceDirectory);
    const first = await openSocket(
      roomUrl(worker, 'QA13', '?role=spotter&token=1234'),
    );

    try {
      await hello(first, 'spotter');
      await worker.stop({ removePersistence: false });
      worker = await startWorker(persistenceDirectory);

      await expectRejected(
        roomUrl(worker, 'QA13', '?role=driver'),
        'driver',
        'auth',
        4401,
      );
      const matching = await openSocket(
        roomUrl(worker, 'QA13', '?role=driver&token=1234'),
      );
      try {
        await expect(hello(matching, 'driver')).resolves.toMatchObject({
          t: 'state',
          driverOnline: true,
          spotterOnline: false,
        });
      } finally {
        matching.terminate();
      }
    } finally {
      first.terminate();
    }
  }, 30_000);

  it('keeps an auth-rejected driver from changing room state, alarms, or the ready driver', async () => {
    worker = await startWorker();
    const driver = await openSocket(
      roomUrl(worker, 'QA14', '?role=driver&token=1234'),
    );

    try {
      await hello(driver, 'driver');
      const before = await readDebug(worker, 'QA14');

      await expectRejected(
        roomUrl(worker, 'QA14', '?role=driver&token=9999'),
        'driver',
        'auth',
        4401,
      );
      const after = await readDebug(worker, 'QA14');
      expect(after).toEqual(before);

      const pong = nextMessage(driver);
      driver.send(JSON.stringify({ t: 'ping', ts: 17 }));
      await expect(within(pong, 500)).resolves.toMatchObject({
        t: 'pong',
        ts: 17,
      });
    } finally {
      driver.terminate();
    }
  }, 20_000);

  it.each(['', '?role=crew'])(
    'rejects a version mismatch before the %s URL role decision',
    async (query) => {
      worker = await startWorker();
      const rejected = await openRejectedSocket(roomUrl(worker, 'QA17', query));

      try {
        rejected.socket.send(
          JSON.stringify({ t: 'hello', v: 999, role: 'driver' }),
        );
        await expect(within(rejected.message, 500)).resolves.toEqual({
          t: 'error',
          code: 'version',
        });
        await expect(within(rejected.closed, 2_000)).resolves.toEqual({
          code: 4426,
        });
        await expect(readDebug(worker, 'QA17')).resolves.toMatchObject({
          alarm: null,
          createdAt: null,
          state: { seq: 0, spotterOnline: false, driverOnline: false },
        });
      } finally {
        rejected.socket.terminate();
      }
    },
    20_000,
  );

  it.each(['', '?role=crew'])(
    'rejects a %s URL role after hello without establishing a PIN or alarm',
    async (query) => {
      worker = await startWorker();
      await expectRejected(
        roomUrl(worker, 'QA15', query),
        'driver',
        'bad_frame',
        4400,
      );

      await expect(readDebug(worker, 'QA15')).resolves.toMatchObject({
        alarm: null,
      });

      const protectedSocket = await openSocket(
        roomUrl(worker, 'QA15', '?role=spotter&token=1234'),
      );
      try {
        await hello(protectedSocket, 'spotter');
        await expectRejected(
          roomUrl(worker, 'QA15', '?role=driver'),
          'driver',
          'auth',
          4401,
        );
      } finally {
        protectedSocket.terminate();
      }
    },
    20_000,
  );
});
