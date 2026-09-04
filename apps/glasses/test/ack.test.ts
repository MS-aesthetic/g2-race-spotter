import {
  RoomClient,
  type RoomWebSocketConstructor,
} from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TextUpgrade } from '../src/bridge.ts';
import { startDriver, type Driver } from '../src/driver.ts';
import { EXIT_MODE_DIALOGUE } from '../src/input.ts';
import { RenderQueue } from '../src/render/queue.ts';
import { CONTAINER_MSG } from '../src/startup-page.ts';
import {
  FakeBridge,
  FakeClock,
  FakeSocket,
  FakeWebSocket,
  stateFrame,
} from './helpers.ts';

const URL = 'ws://relay.test/room/QA01?role=driver';
const MESSAGE = { id: 'm1', text: 'BOX THIS LAP', ts: 10, ackedAt: null };

interface Harness {
  bridge: FakeBridge;
  clock: FakeClock;
  queue: RenderQueue;
  socket: FakeSocket;
  driver: Driver;
}

function messages(bridge: FakeBridge): string[] {
  return bridge
    .callsNamed('textContainerUpgrade')
    .map((entry) => entry.payload as TextUpgrade)
    .filter((payload) => payload.containerID === CONTAINER_MSG)
    .map((payload) => payload.content);
}

function acks(socket: FakeSocket): unknown[] {
  return socket
    .frames()
    .filter((frame) => (frame as { t: string }).t === 'ack');
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

  return { bridge, clock, queue, socket, driver };
}

describe('message ack (030 AC-5)', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
  });

  it('sends ack once on a tap and keeps the text until the relay says acked', async () => {
    const { bridge, queue, socket } = await harness();

    socket.receive(stateFrame({ lane: 'top', gap: 20, msg: MESSAGE }));
    await queue.whenIdle();
    expect(messages(bridge)).toEqual(['BOX THIS LAP']);

    bridge.emit({ textEvent: { containerID: 1, eventType: 0 } });
    await queue.whenIdle();

    expect(acks(socket)).toEqual([{ t: 'ack', msgId: 'm1' }]);
    // The text must NOT be cleared locally: only a state frame hides it.
    expect(messages(bridge)).toEqual(['BOX THIS LAP']);

    bridge.emit({ textEvent: { containerID: 1, eventType: 'CLICK_EVENT' } });
    await queue.whenIdle();
    expect(acks(socket)).toHaveLength(1);

    socket.receive(
      stateFrame({
        seq: 2,
        lane: 'top',
        gap: 20,
        msg: { ...MESSAGE, ackedAt: 99 },
      }),
    );
    await queue.whenIdle();

    expect(messages(bridge)).toEqual(['BOX THIS LAP', '']);
  });

  it('acks a second message after the first was acked', async () => {
    const { bridge, queue, socket } = await harness();

    socket.receive(stateFrame({ msg: MESSAGE }));
    await queue.whenIdle();
    bridge.emit({ textEvent: { eventType: 'CLICK_EVENT' } });

    socket.receive(stateFrame({ seq: 2, msg: { ...MESSAGE, ackedAt: 99 } }));
    socket.receive(
      stateFrame({
        seq: 3,
        msg: { id: 'm2', text: 'PIT NOW', ts: 20, ackedAt: null },
      }),
    );
    await queue.whenIdle();
    bridge.emit({ textEvent: { eventType: 'CLICK_EVENT' } });

    expect(acks(socket)).toEqual([
      { t: 'ack', msgId: 'm1' },
      { t: 'ack', msgId: 'm2' },
    ]);
  });

  it('does not ack when there is no unacked message', async () => {
    const { bridge, queue, socket } = await harness();

    socket.receive(stateFrame({ lane: 'mid', gap: 5 }));
    await queue.whenIdle();

    bridge.emit({ textEvent: { eventType: 0 } });
    await queue.whenIdle();

    expect(acks(socket)).toHaveLength(0);
  });

  it('opens the exit dialogue on a double tap (030 R8)', async () => {
    const { bridge, queue } = await harness();

    bridge.emit({ textEvent: { eventType: 'DOUBLE_CLICK_EVENT' } });
    await queue.whenIdle();

    expect(bridge.callsNamed('shutDownPageContainer')).toEqual([
      { call: 'shutDownPageContainer', payload: EXIT_MODE_DIALOGUE },
    ]);
  });

  it('ignores scroll events', async () => {
    const { bridge, queue, socket } = await harness();

    socket.receive(stateFrame({ msg: MESSAGE }));
    await queue.whenIdle();
    const before = bridge.calls.length;

    bridge.emit({ textEvent: { eventType: 'SCROLL_TOP_EVENT' } });
    bridge.emit({ textEvent: { eventType: 'SCROLL_BOTTOM_EVENT' } });
    await queue.whenIdle();

    expect(bridge.calls).toHaveLength(before);
    expect(acks(socket)).toHaveLength(0);
  });
});
