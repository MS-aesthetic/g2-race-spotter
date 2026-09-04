import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket from 'ws';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const wranglerEntrypoint = join(
  projectDirectory,
  '..',
  '..',
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);

export interface RunningWorker {
  readonly origin: string;
  stop(options?: { readonly removePersistence?: boolean }): Promise<void>;
}

export async function createPersistenceDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'g2rs-relay-'));
}

export async function removeTemporaryDirectory(path: string): Promise<void> {
  await rm(path, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  });
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

export async function startWorker(
  persistenceDirectory?: string,
): Promise<RunningWorker> {
  const persistence =
    persistenceDirectory ?? (await createPersistenceDirectory());
  const assetDirectory = await mkdtemp(join(tmpdir(), 'g2rs-assets-'));
  await writeFile(
    join(assetDirectory, 'index.html'),
    '<!doctype html><title>Spotter</title>',
  );

  const port = await reservePort();
  const worker = spawn(
    process.execPath,
    [
      wranglerEntrypoint,
      'dev',
      '--local',
      '--port',
      String(port),
      '--persist-to',
      persistence,
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
          origin,
          async stop(options = {}): Promise<void> {
            await stopProcess(worker);
            await removeTemporaryDirectory(assetDirectory);
            if (options.removePersistence !== false) {
              await removeTemporaryDirectory(persistence);
            }
          },
        };
      }
    } catch {
      // Wrangler has not opened its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  await stopProcess(worker);
  await removeTemporaryDirectory(assetDirectory);
  await removeTemporaryDirectory(persistence);
  throw new Error(`wrangler did not start:\n${output.join('')}`);
}

export function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

export function nextMessage(
  socket: WebSocket,
): Promise<Record<string, unknown>> {
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

export function nextClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('close', resolve));
}

export async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
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
