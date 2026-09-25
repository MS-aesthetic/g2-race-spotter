import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serialize } from 'node:v8';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { isState, type State } from '@g2-race-spotter/protocol';

import {
  createPersistenceDirectory,
  nextClose,
  nextMessage,
  openSocket,
  removeTemporaryDirectory,
  startWorker,
  type RunningWorker,
  within,
} from './live-worker.js';

interface AlarmDebug {
  readonly alarm: number | null;
  readonly createdAt: number | null;
  readonly state: State;
}

const ROOM = 'QA41';

function roomUrl(worker: RunningWorker, query: string): string {
  return `${worker.origin.replace('http', 'ws')}/room/${ROOM}${query}`;
}

async function readDebug(worker: RunningWorker): Promise<AlarmDebug> {
  const response = await fetch(`${worker.origin}/room/${ROOM}/debug?alarm=1`, {
    headers: { 'X-Debug-Key': 'test-debug-key' },
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<AlarmDebug>;
}

async function hello(
  socket: WebSocket,
  role: 'spotter' | 'driver',
): Promise<Record<string, unknown>> {
  const replay = nextMessage(socket);
  socket.send(JSON.stringify({ t: 'hello', v: 2, role }));
  return within(replay, 1_000);
}

/** The one Durable Object SQLite file wrangler wrote under `--persist-to`. */
function roomDatabase(persistence: string): string {
  const directory = join(persistence, 'v3', 'do', 'g2-race-relay-RaceRoom');
  const files = readdirSync(directory).filter((name) =>
    name.endsWith('.sqlite'),
  );
  expect(files).toHaveLength(1);
  return join(directory, files[0] as string);
}

/**
 * Rewrites the stored room the way the deployed v1 relay left it: `gap` and
 * `side`, no `cars`/`calledAt`. Values are V8-serialized, as workerd stores
 * them.
 */
function seedV1Room(persistence: string, now: number): void {
  const database = new DatabaseSync(roomDatabase(persistence));
  try {
    const v1State = {
      t: 'state',
      seq: 7,
      lane: 'top',
      side: 'inside',
      gap: 63,
      msg: null,
      spotterOnline: false,
      driverOnline: false,
      updatedAt: now - 1_000,
    };
    database
      .prepare('UPDATE _cf_KV SET value = ? WHERE key = ?')
      .run(serialize(v1State), 'state');
  } finally {
    database.close();
  }
}

describe('RaceRoom stored state from an older relay (T055b)', () => {
  let worker: RunningWorker | undefined;
  let persistence: string | undefined;

  afterEach(async () => {
    await worker?.stop({ removePersistence: false });
    if (persistence !== undefined) {
      await removeTemporaryDirectory(persistence);
    }
  });

  it('starts a v1-shaped room fresh, keeps its PIN, and its alarm still ticks', async () => {
    persistence = await createPersistenceDirectory();
    worker = await startWorker(persistence);

    // A room created (PIN 1234) and left with a lane up, then the relay stops.
    const spotter = await openSocket(
      roomUrl(worker, '?role=spotter&token=1234'),
    );
    await hello(spotter, 'spotter');
    const laneSet = nextMessage(spotter);
    spotter.send(JSON.stringify({ t: 'lane', lane: 'top' }));
    await within(laneSet, 500);
    const closed = nextClose(spotter);
    spotter.terminate();
    await within(closed, 500);
    const created = await readDebug(worker);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await worker.stop({ removePersistence: false });

    seedV1Room(persistence, Date.now());
    worker = await startWorker(persistence);

    // First touch loads the stored v1 object: it must come back as a fresh
    // v2 state, not be echoed.
    const loaded = await readDebug(worker);
    expect(isState(loaded.state)).toBe(true);
    expect(loaded.state).toMatchObject({
      lane: null,
      cars: [0, 0, 0],
      calledAt: 0,
    });
    // createdAt and the PIN are separate keys and survive.
    expect(loaded.createdAt).toBe(created.createdAt);

    const rejected = await openSocket(roomUrl(worker, '?role=driver'));
    const rejection = nextMessage(rejected);
    rejected.send(JSON.stringify({ t: 'hello', v: 2, role: 'driver' }));
    await expect(within(rejection, 1_000)).resolves.toMatchObject({
      t: 'error',
      code: 'auth',
    });
    rejected.terminate();

    const driver = await openSocket(roomUrl(worker, '?role=driver&token=1234'));
    try {
      const replay = await hello(driver, 'driver');
      // A valid v2 state every client accepts — not the v1 object.
      expect(isState(replay)).toBe(true);
      expect(replay).toMatchObject({
        lane: null,
        cars: [0, 0, 0],
        msg: null,
        driverOnline: true,
      });
      expect(replay).not.toHaveProperty('gap');
      expect(replay).not.toHaveProperty('side');

      // `alarm()` runs on the loaded state: the tick fires, finds nothing to
      // clear and re-arms (a throw would leave the old target in place).
      const armed = await readDebug(worker);
      expect(armed.alarm).not.toBeNull();
      let ticked = armed;
      const deadline = Date.now() + 6_000;
      while (Date.now() < deadline) {
        ticked = await readDebug(worker);
        if ((ticked.alarm ?? 0) > (armed.alarm ?? 0)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(ticked.alarm as number).toBeGreaterThan(armed.alarm as number);
      expect(isState(ticked.state)).toBe(true);
    } finally {
      driver.terminate();
    }
  }, 40_000);
});
