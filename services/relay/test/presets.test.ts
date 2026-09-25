import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serialize } from 'node:v8';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  HUD_STALE_CLEAR_MS,
  PRESETS_MAX,
  ROOM_TTL_MS,
  type State,
} from '@g2-race-spotter/protocol';

import {
  createPersistenceDirectory,
  nextClose,
  nextMessage,
  nextMessageMatching,
  openSocket,
  removeTemporaryDirectory,
  startWorker,
  type RunningWorker,
  within,
} from './live-worker.js';

/**
 * T056 (Maxx, 2026-09-25 design round 4): custom messages the spotter saves
 * live in the room (`State.presets`), not on one phone. The relay has no
 * preset code of its own — `preset` goes through the generic validate →
 * reduce → persist → broadcast path — so this pins that path end to end on
 * `wrangler dev`, plus the two lifetimes: a stale clear keeps them, the 24 h
 * room expiry deletes them.
 */

interface AlarmDebug {
  readonly alarm: number | null;
  readonly createdAt: number | null;
  readonly state: State;
}

function roomUrl(
  worker: RunningWorker,
  room: string,
  role: 'spotter' | 'driver',
  pin?: string,
): string {
  const token = pin === undefined ? '' : `&token=${pin}`;
  return `${worker.origin.replace('http', 'ws')}/room/${room}?role=${role}${token}`;
}

async function readDebug(
  worker: RunningWorker,
  room: string,
): Promise<AlarmDebug> {
  const response = await fetch(`${worker.origin}/room/${room}/debug?alarm=1`, {
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

async function joinRoom(
  worker: RunningWorker,
  room: string,
  pin?: string,
): Promise<{ readonly spotter: WebSocket; readonly driver: WebSocket }> {
  const spotter = await openSocket(roomUrl(worker, room, 'spotter', pin));
  await hello(spotter, 'spotter');
  const driver = await openSocket(roomUrl(worker, room, 'driver', pin));
  const driverReplay = nextMessageMatching(
    driver,
    (frame) => frame.t === 'state' && frame.spotterOnline === true,
  );
  driver.send(JSON.stringify({ t: 'hello', v: 2, role: 'driver' }));
  await within(driverReplay, 1_000);
  return { spotter, driver };
}

function presetsAre(
  expected: readonly string[],
): (frame: Record<string, unknown>) => boolean {
  return (frame) =>
    frame.t === 'state' &&
    JSON.stringify(frame.presets) === JSON.stringify(expected);
}

/** Send one spotter frame and wait until BOTH peers hold the result. */
async function edit(
  spotter: WebSocket,
  driver: WebSocket,
  frame: object,
  expected: readonly string[],
): Promise<Record<string, unknown>> {
  const atSpotter = nextMessageMatching(spotter, presetsAre(expected));
  const atDriver = nextMessageMatching(driver, presetsAre(expected));
  spotter.send(JSON.stringify(frame));
  const [, seen] = await within(Promise.all([atSpotter, atDriver]), 1_000);
  return seen;
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

/** Rewrites the stopped relay's stored `state` (V8-serialized, as workerd
 * stores values). */
function seedRoom(persistence: string, state: Record<string, unknown>): void {
  const database = new DatabaseSync(roomDatabase(persistence));
  try {
    database
      .prepare('UPDATE _cf_KV SET value = ? WHERE key = ?')
      .run(serialize(state), 'state');
  } finally {
    database.close();
  }
}

/** Create a room with PIN 1234 holding `presets`, then disconnect. */
async function createRoomWithPresets(
  worker: RunningWorker,
  room: string,
  presets: readonly string[],
): Promise<AlarmDebug> {
  const spotter = await openSocket(roomUrl(worker, room, 'spotter', '1234'));
  await hello(spotter, 'spotter');
  const saved: string[] = [];
  for (const text of presets) {
    saved.push(text);
    const seen = nextMessageMatching(spotter, presetsAre(saved));
    spotter.send(JSON.stringify({ t: 'preset', add: text }));
    await within(seen, 1_000);
  }
  const closed = nextClose(spotter);
  spotter.terminate();
  await within(closed, 500);
  // Let the relay run its close handler (presence flip, alarm re-point).
  await new Promise((resolve) => setTimeout(resolve, 200));
  return readDebug(worker, room);
}

describe('RaceRoom presets (T056)', () => {
  let worker: RunningWorker | undefined;
  let persistence: string | undefined;

  afterEach(async () => {
    await worker?.stop({ removePersistence: false });
    worker = undefined;
    if (persistence !== undefined) {
      await removeTemporaryDirectory(persistence);
      persistence = undefined;
    }
  });

  it('broadcasts saved presets to both peers, removes them, and ignores the driver', async () => {
    worker = await startWorker();
    const { spotter, driver } = await joinRoom(worker, 'QA51');

    try {
      const saved = await edit(
        spotter,
        driver,
        { t: 'preset', add: 'Fuel save' },
        ['Fuel save'],
      );
      // Saving is not a call: nothing for the HUD, no stale-clear clock.
      expect(saved).toMatchObject({
        lane: null,
        cars: [0, 0, 0],
        msg: null,
        calledAt: 0,
      });
      await edit(spotter, driver, { t: 'preset', add: 'Box box' }, [
        'Fuel save',
        'Box box',
      ]);
      await edit(spotter, driver, { t: 'preset', remove: 'Fuel save' }, [
        'Box box',
      ]);

      // A driver cannot edit the room's presets, and a duplicate is a no-op:
      // neither bumps seq.
      const before = await readDebug(worker, 'QA51');
      driver.send(JSON.stringify({ t: 'preset', add: 'Driver note' }));
      driver.send(JSON.stringify({ t: 'preset', remove: 'Box box' }));
      spotter.send(JSON.stringify({ t: 'preset', add: 'Box box' }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = await readDebug(worker, 'QA51');
      expect(after.state.seq).toBe(before.state.seq);
      expect(after.state.presets).toEqual(['Box box']);

      // A reconnecting peer gets them in its replay.
      const late = await openSocket(roomUrl(worker, 'QA51', 'driver'));
      try {
        const replay = await hello(late, 'driver');
        expect(replay.presets).toEqual(['Box box']);
      } finally {
        late.terminate();
      }
    } finally {
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it(`stops at PRESETS_MAX (${PRESETS_MAX})`, async () => {
    worker = await startWorker();
    const { spotter, driver } = await joinRoom(worker, 'QA52');

    try {
      const expected: string[] = [];
      for (let index = 0; index < PRESETS_MAX; index += 1) {
        expected.push(`preset ${index}`);
        await edit(
          spotter,
          driver,
          { t: 'preset', add: `preset ${index}` },
          expected,
        );
      }

      const full = await readDebug(worker, 'QA52');
      spotter.send(JSON.stringify({ t: 'preset', add: 'one too many' }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = await readDebug(worker, 'QA52');
      expect(after.state.seq).toBe(full.state.seq);
      expect(after.state.presets).toHaveLength(PRESETS_MAX);
      expect(after.state.presets).not.toContain('one too many');
    } finally {
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it('keeps presets through the 6 s stale clear', async () => {
    worker = await startWorker();
    const { spotter, driver } = await joinRoom(worker, 'QA53');

    try {
      await edit(spotter, driver, { t: 'preset', add: 'Fuel save' }, [
        'Fuel save',
      ]);
      const cleared = nextMessageMatching(
        driver,
        (frame) =>
          frame.t === 'state' &&
          frame.lane === null &&
          frame.calledAt === 0 &&
          (frame.seq as number) > 3,
      );
      const laneSet = nextMessageMatching(
        driver,
        (frame) => frame.t === 'state' && frame.lane === 'top',
      );
      spotter.send(JSON.stringify({ t: 'lane', lane: 'top' }));
      await within(laneSet, 500);

      const frame = await within(cleared, HUD_STALE_CLEAR_MS + 2_000);
      expect(frame).toMatchObject({
        lane: null,
        cars: [0, 0, 0],
        msg: null,
        presets: ['Fuel save'],
      });
      const stored = await readDebug(worker, 'QA53');
      expect(stored.state.presets).toEqual(['Fuel save']);
    } finally {
      spotter.terminate();
      driver.terminate();
    }
  }, 30_000);

  it('gives a room stored before presets an empty list and keeps its calls', async () => {
    persistence = await createPersistenceDirectory();
    worker = await startWorker(persistence);
    const created = await createRoomWithPresets(worker, 'QA54', []);
    await worker.stop({ removePersistence: false });

    // A v2 room written by the relay before presets existed.
    const legacy: Record<string, unknown> = {
      ...created.state,
      lane: 'bot',
      cars: [0, 2, 0],
      calledAt: Date.now(),
      updatedAt: Date.now(),
    };
    delete legacy.presets;
    seedRoom(persistence, legacy);
    worker = await startWorker(persistence);

    const driver = await openSocket(roomUrl(worker, 'QA54', 'driver', '1234'));
    try {
      const replay = await hello(driver, 'driver');
      expect(replay).toMatchObject({
        lane: 'bot',
        cars: [0, 2, 0],
        presets: [],
      });
    } finally {
      driver.terminate();
    }
  }, 40_000);

  it('deletes presets (and the PIN) with a room idle past ROOM_TTL_MS', async () => {
    persistence = await createPersistenceDirectory();
    worker = await startWorker(persistence);
    const created = await createRoomWithPresets(worker, 'QA55', [
      'Fuel save',
      'Box box',
    ]);
    expect(created.state.presets).toEqual(['Fuel save', 'Box box']);
    // An idle room's alarm is its 24 h TTL.
    expect(created.alarm).toBe(created.state.updatedAt + ROOM_TTL_MS);
    await worker.stop({ removePersistence: false });

    // Wind the room's clock back past the TTL, as if it had sat idle for a
    // day.
    seedRoom(persistence, {
      ...created.state,
      updatedAt: Date.now() - ROOM_TTL_MS - 1_000,
    });
    worker = await startWorker(persistence);

    // A socket that never says hello changes nothing in the room; when it
    // closes, the relay re-points the alarm at `updatedAt + ROOM_TTL_MS`,
    // which is now in the past, so the TTL alarm runs straight away.
    const probe = await openSocket(roomUrl(worker, 'QA55', 'spotter'));
    const probeClosed = nextClose(probe);
    probe.terminate();
    await within(probeClosed, 1_000);

    let expired: AlarmDebug | undefined;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      expired = await readDebug(worker, 'QA55');
      if (expired.createdAt === null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // `deleteAll()` ran: no state, no createdAt, no alarm.
    expect(expired?.createdAt).toBeNull();
    expect(expired?.alarm).toBeNull();
    expect(expired?.state).toMatchObject({ seq: 0, presets: [] });

    // The room is fresh: its PIN went too, so the next joiner sets a new
    // one, and nobody sees the old presets.
    const spotter = await openSocket(
      roomUrl(worker, 'QA55', 'spotter', '9999'),
    );
    try {
      const replay = await hello(spotter, 'spotter');
      expect(replay).toMatchObject({ t: 'state', presets: [] });
    } finally {
      spotter.terminate();
    }
  }, 40_000);
});
