import {
  RoomClient,
  type Cars,
  type Lane,
  type RoomWebSocketConstructor,
} from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { LANE_BLINK_MS, LANE_BLINK_PHASES } from '../src/blink.ts';
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
 * The lane-call blink (Maxx, 2026-09-30 design round 5): a new call draws the
 * called icon outline → filled → outline → filled, `LANE_BLINK_MS` apart,
 * through the real driver, store and queue against a fake bridge and clock.
 */

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
    // Phase by phase: the fake bridge answers at once, but a single long
    // `clock.advance` would fire the next phase before the queue has drained
    // the last one, and the queue's latest-wins rule would merge them — real
    // behaviour for a bridge slower than `LANE_BLINK_MS`, not what these
    // tests are about.
    async advance(ms) {
      for (let left = ms; left > 0; left -= LANE_BLINK_MS) {
        await clock.advance(Math.min(left, LANE_BLINK_MS));
        await queue.whenIdle();
      }
    },
  };
  return h;
}

/** A harness already showing `lane`/`cars` with every debounce and blink over. */
async function settled(lane: Lane | null, cars: Cars): Promise<Harness> {
  const h = await harness();
  await h.state(lane, cars);
  await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length + 500);
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

describe('lane-call blink', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
  });

  it('runs outline → filled → outline → filled, 300 ms per phase, ending filled', async () => {
    expect(LANE_BLINK_MS).toBe(300);
    expect(LANE_BLINK_PHASES).toEqual([
      'outline',
      'filled',
      'outline',
      'filled',
    ]);

    const h = await settled(null, [0, 0, 0]);
    const cars: Cars = [0, 0, 0];
    const start = images(h.bridge).length;
    const shownAt: Array<Uint8Array | undefined> = [];

    await h.state('top', cars);
    shownAt.push(shownImages(h.bridge).get(TR));
    for (let phase = 1; phase < LANE_BLINK_PHASES.length; phase += 1) {
      // Nothing moves before the phase is due …
      await h.advance(LANE_BLINK_MS - 1);
      expect(shownImages(h.bridge).get(TR)).toEqual(shownAt.at(-1));
      // … and it lands exactly on time.
      await h.advance(1);
      shownAt.push(shownImages(h.bridge).get(TR));
    }

    expect(shownAt).toEqual(
      LANE_BLINK_PHASES.map((style) =>
        packContainers({ lane: 'top', cars }, true, style).get(TR),
      ),
    );
    // Four frames, each one top-strip send: ▶ lives wholly in stripTR.
    expect(sentSince(h.bridge, start)).toEqual([TR, TR, TR, TR]);

    // And then it stops, filled.
    await h.advance(LANE_BLINK_MS * 10);
    expect(sentSince(h.bridge, start)).toHaveLength(4);
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars }, true),
    );
  });

  it('costs top-strip sends only: 4 for ◀ or ▶ from none, 8 for ▲, 5 for ◀ → ▶', async () => {
    const cases: Array<{
      from: Lane | null;
      to: Lane;
      sends: number[];
    }> = [
      { from: null, to: 'bot', sends: [TL, TL, TL, TL] },
      { from: null, to: 'top', sends: [TR, TR, TR, TR] },
      // ▲ straddles the seam: every phase touches both halves.
      { from: null, to: 'mid', sends: [TL, TR, TL, TR, TL, TR, TL, TR] },
      // The call frame also hollows ◀; the later phases touch ▶ only.
      { from: 'bot', to: 'top', sends: [TL, TR, TR, TR, TR] },
      { from: 'top', to: 'mid', sends: [TL, TR, TL, TR, TL, TR, TL, TR] },
    ];

    for (const { from, to, sends } of cases) {
      FakeWebSocket.reset();
      const h = await settled(from, [1, 2, 3]);
      const start = images(h.bridge).length;

      await h.state(to, [1, 2, 3]);
      await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length);

      const sent = sentSince(h.bridge, start);
      expect(sent, `${from} → ${to}`).toEqual(sends);
      expect(sent).not.toContain(BL);
      expect(sent).not.toContain(BR);
      h.driver.stop();
    }
  });

  it('is cancelled by a newer lane, which starts its own blink', async () => {
    const h = await settled(null, [0, 0, 0]);
    const start = images(h.bridge).length;

    await h.state('bot', [0, 0, 0]);
    await h.advance(LANE_BLINK_MS); // ◀ filled
    await h.advance(100);
    await h.state('top', [0, 0, 0]); // mid-blink: ▶ called

    // ◀ goes back to a dim outline and ▶ opens hollow, in one frame.
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars: [0, 0, 0] }, true, 'outline'),
    );

    // The old sequence is gone: from now on only ▶'s phases, on ▶'s clock.
    const afterCall = images(h.bridge).length;
    await h.advance(LANE_BLINK_MS - 100 - 1);
    expect(images(h.bridge).length).toBe(afterCall);
    await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length);
    expect(sentSince(h.bridge, afterCall)).toEqual([TR, TR, TR]);
    expect(sentSince(h.bridge, start)).toEqual([TL, TL, TL, TR, TR, TR, TR]);
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars: [0, 0, 0] }, true),
    );
  });

  it('is cancelled by a clear (the spotter or the relay stale clear)', async () => {
    const h = await settled(null, [0, 2, 0]);

    await h.state('mid', [0, 2, 0]);
    await h.advance(LANE_BLINK_MS + 50);
    const before = images(h.bridge).length;
    await h.state(null, [0, 0, 0]);

    await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length + 500);
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: null, cars: [0, 0, 0] }, true),
    );
    // Only the clear itself: ▲ back to a dim outline (TL, TR) and the middle
    // bar emptied (BL, BR). No blink phase after it.
    expect(sentSince(h.bridge, before).sort()).toEqual([TL, TR, BL, BR].sort());
  });

  it('is cancelled by NO LINK, which shows the called icon dimmed and filled', async () => {
    const h = await settled(null, [1, 0, 0]);

    await h.state('bot', [1, 0, 0]);
    await h.advance(LANE_BLINK_MS * 2); // back in an outline phase
    expect(shownImages(h.bridge).get(TL)).toEqual(
      packContainers({ lane: 'bot', cars: [1, 0, 0] }, true, 'outline').get(TL),
    );

    // The session ends (`lastFrameAt` resets): the watchdog says NO LINK.
    h.client.disconnect();
    await h.queue.whenIdle();
    const afterDrop = images(h.bridge).length;
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'bot', cars: [1, 0, 0] }, false),
    );

    // No phase fires into the dimmed HUD.
    await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length);
    expect(images(h.bridge).length).toBe(afterDrop);
  });

  it('is cancelled by stop()', async () => {
    const h = await settled(null, [0, 0, 0]);

    await h.state('top', [0, 0, 0]);
    const before = images(h.bridge).length;
    h.driver.stop();

    await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length);
    expect(images(h.bridge).length).toBe(before);
  });

  it('is not disturbed by a cars-only state mid-blink', async () => {
    const h = await settled(null, [0, 0, 0]);
    const start = images(h.bridge).length;
    const trFrames = (): Array<Uint8Array> =>
      images(h.bridge)
        .slice(start)
        .filter((payload) => payload.containerID === TR)
        .map((payload) => payload.imageData);

    await h.state('top', [0, 0, 0]);
    await h.advance(100);
    await h.state('top', [2, 0, 1]); // cars only: same lane

    await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length + 500);

    // ▶ still went through all four phases on its own clock …
    expect(trFrames()).toEqual(
      LANE_BLINK_PHASES.map((style) =>
        packContainers({ lane: 'top', cars: [0, 0, 0] }, true, style).get(TR),
      ),
    );
    // … the new cars reached the car strip (one debounced flush) …
    const bottomSends = sentSince(h.bridge, start).filter(
      (id) => id === BL || id === BR,
    );
    expect(bottomSends).toEqual([BL, BR]);
    // … and it all ends filled, with the new cars.
    expect(shownImages(h.bridge)).toEqual(
      packContainers({ lane: 'top', cars: [2, 0, 1] }, true),
    );
  });

  it('does not restart for a state that repeats the same lane', async () => {
    const h = await settled('mid', [0, 0, 0]);
    const before = images(h.bridge).length;

    await h.state('mid', [0, 0, 0]);
    await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length);
    expect(images(h.bridge).length).toBe(before);
  });

  it('costs nothing extra in text mode: one HUD text per call', async () => {
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
    await h.advance(LANE_BLINK_MS * LANE_BLINK_PHASES.length + 500);

    expect(hudTexts().slice(before)).toEqual([
      '  <     ^    [>] \n[   ] [   ] [   ]',
    ]);
    expect(h.bridge.callsNamed('updateImageRawData')).toHaveLength(0);
  });
});
