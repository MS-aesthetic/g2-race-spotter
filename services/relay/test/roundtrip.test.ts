import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

interface RunningWorker {
  readonly assetDirectory: string;
  readonly origin: string;
  stop(): Promise<void>;
}

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const nodeExecutable = process.execPath;
const wranglerEntrypoint = join(
  projectDirectory,
  '..',
  '..',
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const productionAssetFixture = join(
  projectDirectory,
  '..',
  '..',
  'apps',
  'spotter',
  'dist',
  'index.html',
);

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}
async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('could not reserve a TCP port');
  }
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

async function stopProcess(worker: ReturnType<typeof spawn>): Promise<void> {
  if (worker.exitCode !== null) {
    return;
  }
  const exited = once(worker, 'exit');
  worker.kill();
  await exited;
}

async function removePersistence(directory: string): Promise<void> {
  await rm(directory, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  });
}

async function startWorker(): Promise<RunningWorker> {
  const assetDirectory = await mkdtemp(join(tmpdir(), 'g2rs-assets-'));
  const assetFixture = join(assetDirectory, 'index.html');
  await writeFile(assetFixture, '<!doctype html><title>Spotter</title>');

  const port = await reservePort();
  const persistenceDirectory = await mkdtemp(join(tmpdir(), 'g2rs-relay-'));
  const worker = spawn(
    nodeExecutable,
    [
      wranglerEntrypoint,
      'dev',
      '--local',
      '--port',
      String(port),
      '--persist-to',
      persistenceDirectory,
      '--assets',
      assetDirectory,
    ],
    { cwd: projectDirectory, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const output: string[] = [];
  const collect = (chunk: Buffer): void => {
    output.push(chunk.toString());
  };
  worker.stdout.on('data', collect);
  worker.stderr.on('data', collect);

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) {
        return {
          assetDirectory,
          origin,
          async stop(): Promise<void> {
            await stopProcess(worker);
            await removePersistence(persistenceDirectory);
            await rm(assetDirectory, { force: true, recursive: true });
          },
        };
      }
    } catch {
      // Wrangler has not opened its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  await stopProcess(worker);
  await removePersistence(persistenceDirectory);
  await rm(assetDirectory, { force: true, recursive: true });
  throw new Error(`wrangler did not start:\n${output.join('')}`);
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

function nextClose(
  socket: WebSocket,
): Promise<{ readonly code: number; readonly reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function expectNoMessage(socket: WebSocket, ms: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handler = (data: WebSocket.RawData): void => {
      clearTimeout(timeout);
      reject(new Error(`unexpected message: ${data.toString()}`));
    };
    const timeout = setTimeout(() => {
      socket.off('message', handler);
      resolve();
    }, ms);
    socket.on('message', handler);
  });
}

async function openRejectedSocket(url: string): Promise<{
  readonly socket: WebSocket;
  readonly message: Promise<Record<string, unknown>>;
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
}> {
  const socket = new WebSocket(url);
  const message = nextMessage(socket);
  const closed = nextClose(socket);
  await once(socket, 'open');
  return { socket, message, closed };
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`message exceeded ${ms} ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

describe('RaceRoom roundtrip', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop();
  });

  it('broadcasts a persisted lane state to the driver within 500 ms', async () => {
    const productionAssetBefore = await readOptionalFile(
      productionAssetFixture,
    );
    worker = await startWorker();
    await expect(readOptionalFile(productionAssetFixture)).resolves.toBe(
      productionAssetBefore,
    );
    const room = 'QA01';
    const spotter = await openSocket(
      `${worker.origin.replace('http', 'ws')}/room/${room}?role=spotter`,
    );
    const driver = await openSocket(
      `${worker.origin.replace('http', 'ws')}/room/${room}?role=driver`,
    );

    try {
      spotter.send(JSON.stringify({ t: 'hello', v: 2, role: 'spotter' }));
      await nextMessage(spotter);
      driver.send(JSON.stringify({ t: 'hello', v: 2, role: 'driver' }));
      await nextMessage(driver);

      const state = nextMessage(driver);
      spotter.send(JSON.stringify({ t: 'lane', lane: 'top' }));
      await expect(within(state, 500)).resolves.toMatchObject({
        t: 'state',
        lane: 'top',
        seq: expect.any(Number),
      });
      const received = await state;
      expect(received.seq).toBeGreaterThan(0);
    } finally {
      spotter.close();
      driver.close();
    }
  }, 20_000);

  it('broadcasts a spotter cars call, clamped, and ignores one from the driver', async () => {
    worker = await startWorker();
    const room = 'QA05';
    const spotter = await openSocket(
      `${worker.origin.replace('http', 'ws')}/room/${room}?role=spotter`,
    );
    const driver = await openSocket(
      `${worker.origin.replace('http', 'ws')}/room/${room}?role=driver`,
    );

    try {
      spotter.send(JSON.stringify({ t: 'hello', v: 2, role: 'spotter' }));
      await nextMessage(spotter);
      driver.send(JSON.stringify({ t: 'hello', v: 2, role: 'driver' }));
      await nextMessage(driver);

      const called = nextMessage(driver);
      spotter.send(JSON.stringify({ t: 'cars', cars: [1, 2.4, 7] }));
      await expect(within(called, 500)).resolves.toMatchObject({
        t: 'state',
        cars: [1, 2, 3],
      });

      // Role check: the driver cannot call cars on itself, so the frame is
      // dropped without a state broadcast; a repeat is a no-op as well.
      driver.send(JSON.stringify({ t: 'cars', cars: [0, 0, 0] }));
      spotter.send(JSON.stringify({ t: 'cars', cars: [1, 2, 3] }));
      await expectNoMessage(driver, 250);

      const cleared = nextMessage(driver);
      spotter.send(JSON.stringify({ t: 'cars', cars: [0, 0, 0] }));
      await expect(within(cleared, 500)).resolves.toMatchObject({
        t: 'state',
        cars: [0, 0, 0],
      });
    } finally {
      spotter.close();
      driver.close();
    }
  }, 20_000);

  it('does not broadcast to an unready socket and replays the latest state after hello', async () => {
    worker = await startWorker();
    const room = 'QA02';
    const driver = await openSocket(
      `${worker.origin.replace('http', 'ws')}/room/${room}?role=driver`,
    );
    const spotter = await openSocket(
      `${worker.origin.replace('http', 'ws')}/room/${room}?role=spotter`,
    );

    try {
      spotter.send(JSON.stringify({ t: 'hello', v: 2, role: 'spotter' }));
      await nextMessage(spotter);
      await expectNoMessage(driver, 150);

      const replay = nextMessage(driver);
      spotter.send(JSON.stringify({ t: 'lane', lane: 'bot' }));
      await nextMessage(spotter);
      await expectNoMessage(driver, 150);

      driver.send(JSON.stringify({ t: 'hello', v: 2, role: 'driver' }));
      await expect(within(replay, 500)).resolves.toMatchObject({
        t: 'state',
        lane: 'bot',
        driverOnline: true,
        spotterOnline: true,
      });
    } finally {
      spotter.close();
      driver.close();
    }
  }, 20_000);

  it.each(['', '?role=crew'])(
    'accepts a missing or invalid URL role then reports bad_frame and closes 4400 (%s)',
    async (query) => {
      worker = await startWorker();
      const rejected = await openRejectedSocket(
        `${worker.origin.replace('http', 'ws')}/room/QA03${query}`,
      );
      rejected.socket.send(
        JSON.stringify({ t: 'hello', v: 2, role: 'spotter' }),
      );

      await expect(within(rejected.message, 500)).resolves.toEqual({
        t: 'error',
        code: 'bad_frame',
      });
      await expect(within(rejected.closed, 2_000)).resolves.toMatchObject({
        code: 4400,
      });
      rejected.socket.terminate();
    },
    20_000,
  );
});
