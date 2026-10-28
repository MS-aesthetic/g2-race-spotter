import {
  RoomClient,
  type Cars,
  type Lane,
  type RoomWebSocketConstructor,
} from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ImageRawData, TextUpgrade } from '../src/bridge.ts';
import { startDriver, type Driver } from '../src/driver.ts';
import type { RenderMode } from '../src/render/mode.ts';
import { packContainers, RenderQueue } from '../src/render/queue.ts';
import {
  CONTAINER_HUD,
  CONTAINER_STRIP_BL,
  CONTAINER_STRIP_BR,
  CONTAINER_STRIP_TL,
  CONTAINER_STRIP_TR,
} from '../src/startup-page.ts';
import {
  FakeBridge,
  FakeClock,
  FakeSocket,
  FakeWebSocket,
  shownImages,
  stateFrame,
} from './helpers.ts';

/**
 * A lane call (Maxx, 2026-10-28 design round 7: "solid instead of blinking"):
 * the called icon is drawn FILLED by the very frame that applies the call and
 * stays filled — no outline phases, no timer, no further sends. This file
 * replaces the round-5/6 lane-blink tests (`blink.test.ts`, removed with
 * `src/blink.ts`); it drives the real driver, store and queue against a fake
 * bridge and clock.
 */

/** Longer than the old 4 s blink, inside the 5 s NO-LINK watchdog. */
const QUIET_MS = 4_500;

const URL = 'ws://relay.test/room/QA01?role=driver';

interface Harness {
  bridge: FakeBridge;
  clock: FakeClock;
  queue: RenderQueue;
  driver: Driver;
  client: RoomClient;
  socket: FakeSocket;
  seq: number;
  /** Sends a room `state` and lets the queue drain. */
  state(lane: Lane | null, cars: Cars): Promise<void>;
  /** Moves the fake clock and lets the queue drain. */
  advance(ms: number): Promise<void>;
}

function images(bridge: FakeBridge): ImageRawData[] {
  return bridge
    .callsNamed('updateImageRawData')
    .map((entry) => entry.payload as ImageRawData);
}

async function harness(mode: RenderMode = 'image'): Promise<Harness> {
  const bridge = new FakeBridge();
  const clock = new FakeClock();
  const queue = new RenderQueue({
    bridge,
    mode,
    timers: clock.timers,
    now: clock.now,
    log: () => undefined,
  });
  const client = new RoomClient({
    WebSocket: FakeWebSocket as unknown as RoomWebSocketConstructor,
    role: 'driver',
    timers: clock.roomTimers,
    now: clock.now,
    random: () => 0.5,
  });
  const driver = startDriver({
    bridge,
    client,
    queue,
    hasRoom: true,
    now: clock.now,
    connect: () => client.connect(URL),
    timers: clock.roomTimers,
  });

  client.connect(URL);
  const socket = FakeWebSocket.last();
  socket.open();
  await queue.whenIdle();

  const h: Harness = {
    bridge,
    clock,
    queue,
    driver,
    client,
    socket,
    seq: 0,
    async state(lane, cars) {
      h.seq += 1;
      socket.receive(stateFrame({ seq: h.seq, lane, cars }));
      await queue.whenIdle();
    },
    // In steps, draining the queue after each, so any timer-driven render
    // would show up as its own send.
    async advance(ms) {
      for (let left = ms; left > 0; left -= 500) {
        await clock.advance(Math.min(left, 500));
        await queue.whenIdle();
      }
    },
  };
  return h;
}

/** A harness already showing `lane`/`cars` with every debounce over. */
async function settled(lane: Lane | null, cars: Cars): Promise<Harness> {
  const h = await harness();
  await h.state(lane, cars);
  await h.advance(1_000);
  return h;
}

/** Container ids of the image sends since `from`. */
function sentSince(bridge: FakeBridge, from: number): number[] {
  return images(bridge)
    .slice(from)
    .map((payload) => payload.containerID);
}

const TL = CONTAINER_STRIP_TL;
const TR = CONTAINER_STRIP_TR;
const BL = CONTAINER_STRIP_BL;
const BR = CONTAINER_STRIP_BR;

describe('lane call (round 7: solid, no blink)', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
  });

  it('draws the called icon filled at once and keeps it filled, with no further sends', async () => {
    const h = await settled(null, [0, 0, 0]);
    const cars: Cars = [0, 0, 0];
    const start = images(h.bridge).length;

    await h.state('top', cars);
    // The call frame itself shows ▶ solid: no hollow first phase.
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars }, true),
    );
    expect(sentSince(h.bridge, start)).toEqual([TR]);

    // Nothing moves afterwards: no timer re-renders the icon.
    await h.advance(QUIET_MS);
    expect(sentSince(h.bridge, start)).toEqual([TR]);
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars }, true),
    );
  });

  it('costs top-strip sends only: 1 for ◀ or ▶ from none, 2 for ▲, 2 for ◀ → ▶', async () => {
    const cases: Array<{
      from: Lane | null;
      to: Lane;
      sends: number[];
    }> = [
      { from: null, to: 'bot', sends: [TL] },
      { from: null, to: 'top', sends: [TR] },
      // ▲ straddles the seam: both halves.
      { from: null, to: 'mid', sends: [TL, TR] },
      // ◀ back to an outline (TL), ▶ filled (TR).
      { from: 'bot', to: 'top', sends: [TL, TR] },
      { from: 'top', to: 'mid', sends: [TL, TR] },
    ];

    for (const { from, to, sends } of cases) {
      FakeWebSocket.reset();
      const h = await settled(from, [1, 2, 3]);
      const start = images(h.bridge).length;

      await h.state(to, [1, 2, 3]);
      await h.advance(QUIET_MS);

      const sent = sentSince(h.bridge, start);
      expect(sent, `${from} → ${to}`).toEqual(sends);
      expect(sent).not.toContain(BL);
      expect(sent).not.toContain(BR);
      h.driver.stop();
    }
  });

  it('moves straight to a newer lane: the old icon outlined, the new one filled, in one frame', async () => {
    const h = await settled(null, [0, 0, 0]);
    const start = images(h.bridge).length;

    await h.state('bot', [0, 0, 0]);
    await h.advance(600);
    await h.state('top', [0, 0, 0]);
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars: [0, 0, 0] }, true),
    );
    await h.advance(QUIET_MS);
    expect(sentSince(h.bridge, start)).toEqual([TL, TL, TR]);
  });

  it('clears to three outlines on a clear (the spotter or the relay stale clear)', async () => {
    const h = await settled(null, [0, 2, 0]);

    await h.state('mid', [0, 2, 0]);
    await h.advance(600);
    const before = images(h.bridge).length;
    await h.state(null, [0, 0, 0]);

    await h.advance(QUIET_MS);
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: null, cars: [0, 0, 0] }, true),
    );
    // Only the clear itself: ▲ back to a dim outline (TL, TR) and the middle
    // bar emptied (BL, BR).
    expect(sentSince(h.bridge, before).sort()).toEqual([TL, TR, BL, BR].sort());
  });

  it('dims the filled icon on NO LINK, and nothing fires afterwards', async () => {
    const h = await settled(null, [1, 0, 0]);

    await h.state('bot', [1, 0, 0]);
    // The session ends (`lastFrameAt` resets): the watchdog says NO LINK.
    h.client.disconnect();
    await h.queue.whenIdle();
    const afterDrop = images(h.bridge).length;
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'bot', cars: [1, 0, 0] }, false),
    );

    await h.advance(QUIET_MS);
    expect(images(h.bridge).length).toBe(afterDrop);
  });

  it('sends nothing after stop()', async () => {
    const h = await settled(null, [0, 0, 0]);

    await h.state('top', [0, 0, 0]);
    const before = images(h.bridge).length;
    h.driver.stop();

    await h.advance(QUIET_MS);
    expect(images(h.bridge).length).toBe(before);
  });

  it('draws a cars-only state after a call with the icon still filled, on the car strip only', async () => {
    const h = await settled(null, [0, 0, 0]);
    const start = images(h.bridge).length;

    await h.state('top', [0, 0, 0]);
    await h.advance(100);
    await h.state('top', [2, 0, 1]); // cars only: same lane
    await h.advance(QUIET_MS);

    // ▶ once, then one debounced car flush (both bottom halves).
    expect(sentSince(h.bridge, start)).toEqual([TR, BL, BR]);
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars: [2, 0, 1] }, true),
    );
  });

  it('shows the first snapshot after launch as is, and a state repeating the lane costs nothing', async () => {
    const h = await harness();

    await h.state('top', [0, 0, 0]);
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars: [0, 0, 0] }, true),
    );
    const afterSnapshot = images(h.bridge).length;
    await h.advance(1_000);
    await h.state('top', [0, 0, 0]);
    await h.advance(QUIET_MS);
    expect(images(h.bridge).length).toBe(afterSnapshot);
  });

  it('costs one HUD text per call in text mode', async () => {
    const h = await harness('text');
    const hudTexts = (): string[] =>
      h.bridge
        .callsNamed('textContainerUpgrade')
        .map((entry) => entry.payload as TextUpgrade)
        .filter((payload) => payload.containerID === CONTAINER_HUD)
        .map((payload) => payload.content);

    await h.state(null, [0, 0, 0]);
    await h.advance(1_000);
    const before = hudTexts().length;

    await h.state('top', [0, 0, 0]);
    await h.advance(QUIET_MS);

    expect(hudTexts().slice(before)).toEqual([
      '  <     ^    [>] \n[   ] [   ] [   ]',
    ]);
    expect(h.bridge.callsNamed('updateImageRawData')).toHaveLength(0);
  });
});
