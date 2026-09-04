import {
  DRIVER_NO_LINK_MS,
  RoomClient,
  type RoomWebSocketConstructor,
} from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ImageRawData, TextUpgrade } from '../src/bridge.ts';
import { startDriver, type Driver } from '../src/driver.ts';
import { statusLinkOk, STATUS_NO_LINK, STATUS_NO_ROOM } from '../src/link.ts';
import { drawHud } from '../src/render/draw-hud.ts';
import { pack } from '../src/render/gray4.ts';
import { RenderQueue } from '../src/render/queue.ts';
import { CONTAINER_STATUS } from '../src/startup-page.ts';
import {
  FakeBridge,
  FakeClock,
  FakeSocket,
  FakeWebSocket,
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

describe('NO LINK watchdog (030 AC-4)', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
  });

  it('shows CONNECTING before the first frame and LINK OK after it', async () => {
    const { bridge, socket, queue } = await harness();

    expect(statuses(bridge)[0]).toMatch(/^CONNECTING/);

    socket.receive(stateFrame({ lane: 'top', gap: 30 }));
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe(statusLinkOk(true));
  });

  it('goes NO LINK after 5 s of silence and dims the next HUD frame', async () => {
    const { bridge, clock, socket, queue, driver } = await harness();

    socket.receive(stateFrame({ lane: 'top', gap: 30 }));
    await queue.whenIdle();
    expect(images(bridge).at(-1)?.imageData).toEqual(
      pack(drawHud({ lane: 'top', gap: 30 }, { linkOk: true })),
    );

    await clock.advance(DRIVER_NO_LINK_MS + 1);
    driver.checkLink();
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe(STATUS_NO_LINK);
    expect(images(bridge).at(-1)?.imageData).toEqual(
      pack(drawHud({ lane: 'top', gap: 30 }, { linkOk: false })),
    );
  });

  it('recovers on a pong, without a state frame (030 R3)', async () => {
    const { bridge, clock, socket, queue, driver } = await harness();

    socket.receive(stateFrame({ lane: 'mid', gap: 10, spotterOnline: false }));
    await queue.whenIdle();

    await clock.advance(DRIVER_NO_LINK_MS + 1);
    driver.checkLink();
    await queue.whenIdle();
    expect(statuses(bridge).at(-1)).toBe(STATUS_NO_LINK);

    socket.receive({ t: 'pong', ts: clock.ms, serverTs: clock.ms });
    driver.checkLink();
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe(statusLinkOk(false));
    expect(images(bridge).at(-1)?.imageData).toEqual(
      pack(drawHud({ lane: 'mid', gap: 10 }, { linkOk: true })),
    );
  });

  it('spends exactly one image send on a recovery frame, with its values', async () => {
    const { bridge, clock, socket, queue, driver } = await harness();

    socket.receive(stateFrame({ lane: 'top', gap: 30 }));
    await queue.whenIdle();

    await clock.advance(DRIVER_NO_LINK_MS + 1);
    driver.checkLink();
    await queue.whenIdle();
    const beforeRecovery = images(bridge).length;

    // The frame that clears NO LINK must not first redraw the OLD gap bright.
    socket.receive(stateFrame({ seq: 2, lane: 'top', gap: 70 }));
    await queue.whenIdle();

    const sent = images(bridge);
    expect(sent.length - beforeRecovery).toBe(1);
    expect(sent.at(-1)?.imageData).toEqual(
      pack(drawHud({ lane: 'top', gap: 70 }, { linkOk: true })),
    );
    expect(statuses(bridge).at(-1)).toBe(statusLinkOk(true));
  });

  it('re-checks on its own interval without an explicit call', async () => {
    const { bridge, clock, socket, queue } = await harness();

    socket.receive(stateFrame({ lane: 'bot', gap: 80 }));
    await queue.whenIdle();

    await clock.advance(DRIVER_NO_LINK_MS + 1_000);
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe(STATUS_NO_LINK);
  });

  it('dims while a reconnect blip has no frame of its own', async () => {
    const { bridge, clock, socket, queue, client, driver } = await harness();

    socket.receive(stateFrame({ lane: 'top', gap: 45 }));
    await queue.whenIdle();
    expect(statuses(bridge).at(-1)).toBe(statusLinkOk(true));

    // A non-terminal close reconnects; `RoomClient` clears `lastFrameAt` when
    // the replacement socket opens, so the blip dims until its state replay.
    socket.close(1_006);
    await clock.advance(2_000);
    driver.checkLink();
    await queue.whenIdle();

    expect(client.lastFrameAt).toBeUndefined();
    expect(FakeWebSocket.sockets.length).toBeGreaterThan(1);
    expect(statuses(bridge).at(-1)).toBe(STATUS_NO_LINK);
    expect(images(bridge).at(-1)?.imageData).toEqual(
      pack(drawHud({ lane: 'top', gap: 45 }, { linkOk: false })),
    );

    const next = FakeWebSocket.last();
    next.open();
    next.receive(stateFrame({ seq: 2, lane: 'top', gap: 45 }));
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe(statusLinkOk(true));
  });

  it('reports a terminal close instead of spinning', async () => {
    const { bridge, socket, queue } = await harness();

    socket.receive(stateFrame({ lane: 'top', gap: 10 }));
    await queue.whenIdle();

    socket.close(4_401);
    await queue.whenIdle();

    expect(statuses(bridge).at(-1)).toBe('PIN REJECTED');
    expect(FakeWebSocket.sockets).toHaveLength(1);
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
