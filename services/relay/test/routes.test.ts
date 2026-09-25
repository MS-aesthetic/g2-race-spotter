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
const productionAssetDirectory = join(
  projectDirectory,
  '..',
  '..',
  'apps',
  'spotter',
  'dist',
);
const productionAssetFixture = join(productionAssetDirectory, 'route-test.txt');

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

async function startWorker(): Promise<RunningWorker> {
  const assetDirectory = await mkdtemp(join(tmpdir(), 'g2rs-assets-'));
  const assetFixture = join(assetDirectory, 'route-test.txt');
  await writeFile(assetFixture, 'spotter asset');

  const port = await reservePort();
  const persistenceDirectory = await mkdtemp(join(tmpdir(), 'g2rs-routes-'));
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
      '--var',
      'DEBUG_KEY:test-debug-key',
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
      if ((await fetch(`${origin}/health`)).ok) {
        return {
          assetDirectory,
          origin,
          async stop(): Promise<void> {
            await stopProcess(worker);
            await rm(persistenceDirectory, {
              force: true,
              maxRetries: 10,
              recursive: true,
              retryDelay: 100,
            });
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
  await rm(persistenceDirectory, { force: true, recursive: true });
  await rm(assetDirectory, { force: true, recursive: true });
  throw new Error(`wrangler did not start:\n${output.join('')}`);
}

function expectCors(response: Response): void {
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
    'Content-Type, X-Debug-Key',
  );
  expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
    'GET, OPTIONS',
  );
}

describe('relay HTTP routes', () => {
  let worker: RunningWorker | undefined;

  afterEach(async () => {
    await worker?.stop();
  });

  it('serves health and CORS preflights', async () => {
    worker = await startWorker();

    const health = await fetch(`${worker.origin}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true, version: 2 });
    expectCors(health);

    const preflight = await fetch(`${worker.origin}/anything`, {
      method: 'OPTIONS',
    });
    expect(preflight.status).toBe(204);
    expectCors(preflight);
  }, 20_000);

  it('gates debug state with DEBUG_KEY and returns the Durable Object state', async () => {
    worker = await startWorker();

    const denied = await fetch(`${worker.origin}/room/QA01/debug`);
    expect(denied.status).toBe(403);
    expectCors(denied);

    const debug = await fetch(`${worker.origin}/room/QA01/debug`, {
      headers: { 'X-Debug-Key': 'test-debug-key' },
    });
    expect(debug.status).toBe(200);
    await expect(debug.json()).resolves.toEqual({
      driverOnline: false,
      cars: [0, 0, 0],
      lane: null,
      msg: null,
      seq: 0,
      spotterOnline: false,
      t: 'state',
      updatedAt: 0,
      calledAt: 0,
    });
    expectCors(debug);
  }, 20_000);

  it('falls through to static assets and preserves CORS on non-upgrade room requests', async () => {
    const productionAssetBefore = await readOptionalFile(
      productionAssetFixture,
    );
    worker = await startWorker();

    expect(worker.assetDirectory).not.toBe(productionAssetDirectory);
    await expect(readOptionalFile(productionAssetFixture)).resolves.toBe(
      productionAssetBefore,
    );

    const asset = await fetch(`${worker.origin}/route-test.txt`);
    expect(asset.status).toBe(200);
    await expect(asset.text()).resolves.toBe('spotter asset');
    expectCors(asset);

    const room = await fetch(`${worker.origin}/room/QA01`);
    expect(room.status).toBe(426);
    expectCors(room);
  }, 20_000);

  it('does not allow a caller to forge the relay internal debug header', async () => {
    worker = await startWorker();
    const socket = new WebSocket(
      `${worker.origin.replace('http', 'ws')}/room/QA01?role=driver`,
      { headers: { 'X-G2RS-Internal-Debug': '1' } },
    );

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const state = new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once('message', (data) => {
        try {
          resolve(JSON.parse(data.toString()) as Record<string, unknown>);
        } catch (error) {
          reject(error);
        }
      });
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({ t: 'hello', v: 2, role: 'driver' }));
    await expect(state).resolves.toMatchObject({ t: 'state' });
    socket.close();
  }, 20_000);
});
