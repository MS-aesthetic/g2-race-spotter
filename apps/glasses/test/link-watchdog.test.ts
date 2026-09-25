import {
  DRIVER_NO_LINK_MS,
  RoomClient,
  type RoomWebSocketConstructor,
} from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ImageRawData, TextUpgrade } from '../src/bridge.ts';
import { startDriver, type Driver } from '../src/driver.ts';
import { statusStrip, STATUS_BLINK_MS, STATUS_NO_ROOM } from '../src/link.ts';
import { packContainers, RenderQueue } from '../src/render/queue.ts';
import { CONTAINER_STATUS } from '../src/startup-page.ts';
import {
  FakeBridge,
  FakeClock,
  FakeSocket,
  FakeWebSocket,
  shownImages,
  stateFrame,
} from './helpers.ts';

const URL = 'ws://relay.test/room/QA01?role=driver';

interface Harness {
  bridge: FakeBridge;
  clock: FakeClock;
  queue: RenderQueue;
  client: RoomClient;
  driver: Driver;
  socket: FakeSocket;
}

function statuses(bridge: FakeBridge): string[] {
  return bridge
    .callsNamed('textContainerUpgrade')
    .map((entry) => entry.payload as TextUpgrade)
    .filter((payload) => payload.containerID === CONTAINER_STATUS)
    .map((payload) => payload.content);
}

function images(bridge: FakeBridge): ImageRawData[] {
  return bridge
    .callsNamed('updateImageRawData')
    .map((entry) => entry.payload as ImageRawData);
}

async function harness(): Promise<Harness> {
  const bridge = new FakeBridge();
  const clock = new FakeClock();
  const queue = new RenderQueue({
    bridge,
    mode: 'image',
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

  return { bridge, clock, queue, client, driver, socket };
}

/** The two phases of the NO-LINK blink: the `L` is on, then blank. Which one is
 * showing depends on where the clock stopped, so assertions that only care that
 * the link is DOWN accept either. */
const BLINK_PHASES = ['L S', '  S'];
describe('NO LINK watchdog (030 AC-4)', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
  });

  it('shows CONNECTING before the first frame and LINK OK after it', async () => {
    const { bridge, socket, queue } = await harness();

    expect(statuses(bridge)[0]).toMatch(/^CONNECTING/);

    socket.receive(stateFrame({ lane: 'top', cars: [1, 1, 1] }));
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe(statusStrip(true, true));
  });

  it('goes NO LINK after 5 s of silence and dims all four image containers', async () => {
    const { bridge, clock, socket, queue, driver } = await harness();

    socket.receive(stateFrame({ lane: 'top', cars: [1, 1, 1] }));
    await queue.whenIdle();
    expect(shownImages(bridge)).toEqual(
      packContainers({ lane: 'top', cars: [1, 1, 1] }, true),
    );
    const beforeNoLink = images(bridge).length;

    await clock.advance(DRIVER_NO_LINK_MS + 1);
    driver.checkLink();
    await queue.whenIdle();

    expect(BLINK_PHASES).toContain(statuses(bridge).at(-1));
    // All four image containers are re-sent at half intensity, once each.
    expect(
      images(bridge)
        .slice(beforeNoLink)
        .map((payload) => payload.containerName),
    ).toEqual(['stripTL', 'stripTR', 'stripBL', 'stripBR']);
    expect(shownImages(bridge)).toEqual(
      packContainers({ lane: 'top', cars: [1, 1, 1] }, false),
    );

    // NO LINK is a blinking `L`: one status job per phase, never an image send.
    const beforeBlink = images(bridge).length;
    await clock.advance(STATUS_BLINK_MS);
    await queue.whenIdle();
    expect(statuses(bridge).at(-1)).toBe('  S');
    await clock.advance(STATUS_BLINK_MS);
    await queue.whenIdle();
    expect(statuses(bridge).at(-1)).toBe('L S');
    expect(images(bridge).length).toBe(beforeBlink);
  });

  it('recovers on a pong, without a state frame (030 R3)', async () => {
    const { bridge, clock, socket, queue, driver } = await harness();

    socket.receive(
      stateFrame({ lane: 'mid', cars: [0, 1, 0], spotterOnline: false }),
    );
    await queue.whenIdle();

    await clock.advance(DRIVER_NO_LINK_MS + 1);
    driver.checkLink();
    await queue.whenIdle();
    // No spotter, so the strip is only the blinking `L`.
    expect(['L', '']).toContain(statuses(bridge).at(-1));

    socket.receive({ t: 'pong', ts: clock.ms, serverTs: clock.ms });
    driver.checkLink();
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe(statusStrip(true, false));
    expect(shownImages(bridge)).toEqual(
      packContainers({ lane: 'mid', cars: [0, 1, 0] }, true),
    );
  });

  it('spends one send per image container on a recovery frame, with its values', async () => {
    const { bridge, clock, socket, queue, driver } = await harness();

    socket.receive(stateFrame({ lane: 'top', cars: [1, 1, 1] }));
    await queue.whenIdle();

    await clock.advance(DRIVER_NO_LINK_MS + 1);
    driver.checkLink();
    await queue.whenIdle();
    const beforeRecovery = images(bridge).length;

    // The frame that clears NO LINK must not first redraw the OLD cars bright.
    socket.receive(stateFrame({ seq: 2, lane: 'top', cars: [0, 2, 2] }));
    await queue.whenIdle();

    // Every container was dimmed, so every one is re-sent once — with the new
    // values, never first with the old cars at full intensity.
    const sent = images(bridge).slice(beforeRecovery);
    const fresh = packContainers({ lane: 'top', cars: [0, 2, 2] }, true);
    expect(sent.map((payload) => payload.containerName)).toEqual([
      'stripTL',
      'stripTR',
      'stripBL',
      'stripBR',
    ]);
    for (const payload of sent) {
      expect(payload.imageData).toEqual(fresh.get(payload.containerID));
    }
    expect(shownImages(bridge)).toEqual(
      packContainers({ lane: 'top', cars: [0, 2, 2] }, true),
    );
    expect(statuses(bridge).at(-1)).toBe(statusStrip(true, true));
  });

  it('re-checks on its own interval without an explicit call', async () => {
    const { bridge, clock, socket, queue } = await harness();

    socket.receive(stateFrame({ lane: 'bot', cars: [3, 0, 1] }));
    await queue.whenIdle();

    await clock.advance(DRIVER_NO_LINK_MS + 1_000);
    await queue.whenIdle();

    expect(BLINK_PHASES).toContain(statuses(bridge).at(-1));
  });

  it('dims while a reconnect blip has no frame of its own', async () => {
    const { bridge, clock, socket, queue, client, driver } = await harness();

    socket.receive(stateFrame({ lane: 'top', cars: [2, 1, 0] }));
    await queue.whenIdle();
    expect(statuses(bridge).at(-1)).toBe(statusStrip(true, true));

    // A non-terminal close reconnects; `RoomClient` clears `lastFrameAt` when
    // the replacement socket opens, so the blip dims until its state replay.
    socket.close(1_006);
    await clock.advance(2_000);
    driver.checkLink();
    await queue.whenIdle();

    expect(client.lastFrameAt).toBeUndefined();
    expect(FakeWebSocket.sockets.length).toBeGreaterThan(1);
    expect(BLINK_PHASES).toContain(statuses(bridge).at(-1));
    expect(shownImages(bridge)).toEqual(
      packContainers({ lane: 'top', cars: [2, 1, 0] }, false),
    );

    const next = FakeWebSocket.last();
    next.open();
    next.receive(stateFrame({ seq: 2, lane: 'top', cars: [2, 1, 0] }));
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe(statusStrip(true, true));
  });

  it('reports a terminal close instead of spinning', async () => {
    const { bridge, socket, queue } = await harness();

    socket.receive(stateFrame({ lane: 'top', cars: [0, 1, 0] }));
    await queue.whenIdle();

    socket.close(4_401);
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe('PIN REJECTED');
    expect(FakeWebSocket.sockets).toHaveLength(1);
  });

  it('draws the cars carried by the room state and the relay stale clear (T055)', async () => {
    const { bridge, socket, queue } = await harness();

    socket.receive(stateFrame({ lane: 'mid', cars: [0, 2, 3] }));
    await queue.whenIdle();
    expect(shownImages(bridge)).toEqual(
      packContainers({ lane: 'mid', cars: [0, 2, 3] }, true),
    );

    // The relay's stale clear is an ordinary `state`: blank lanes and empty
    // bars, still at full intensity (the link is fine) — one send for each
    // container whose pixels it changes (here all four: the dash straddles the
    // top seam, the middle bar the bottom one).
    const before = images(bridge).length;
    socket.receive(stateFrame({ seq: 2, lane: null, cars: [0, 0, 0] }));
    await queue.whenIdle();
    expect(images(bridge).length).toBe(before + 4);
    expect(shownImages(bridge)).toEqual(
      packContainers({ lane: null, cars: [0, 0, 0] }, true),
    );
  });

  it('shows ROOM ? until a room is configured', async () => {
    const bridge = new FakeBridge();
    const clock = new FakeClock();
    const queue = new RenderQueue({
      bridge,
      mode: 'image',
      timers: clock.timers,
      now: clock.now,
      log: () => undefined,
    });
    const client = new RoomClient({
      WebSocket: FakeWebSocket as unknown as RoomWebSocketConstructor,
      role: 'driver',
      timers: clock.roomTimers,
      now: clock.now,
    });
    const driver = startDriver({
      bridge,
      client,
      queue,
      hasRoom: false,
      now: clock.now,
      connect: () => undefined,
      timers: clock.roomTimers,
    });
    await queue.whenIdle();

    expect(statuses(bridge)).toEqual([STATUS_NO_ROOM]);

    driver.app.setHasRoom(true);
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toMatch(/^CONNECTING/);
  });
});
