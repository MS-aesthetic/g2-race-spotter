import {
  RoomClient,
  type RoomWebSocketConstructor,
} from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { MSG_AUTO_ACK_MS } from '../src/app.ts';
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

  it('lets the driver ack again after a blip swallowed the first ack', async () => {
    const { bridge, clock, queue, socket } = await harness();

    socket.receive(stateFrame({ msg: MESSAGE }));
    await queue.whenIdle();

    // The socket drops before the tap: `RoomClient.send` discards an ack that
    // has nowhere to go, so the message is still unacked when the room replays.
    socket.close(1_006);
    bridge.emit({ textEvent: { eventType: 'CLICK_EVENT' } });
    await queue.whenIdle();
    expect(acks(socket)).toHaveLength(0);

    await clock.advance(1_000);
    const replacement = FakeWebSocket.last();
    expect(replacement).not.toBe(socket);
    replacement.open();
    replacement.receive(stateFrame({ seq: 1, msg: MESSAGE }));
    await queue.whenIdle();

    bridge.emit({ textEvent: { eventType: 'CLICK_EVENT' } });
    await queue.whenIdle();

    expect(acks(replacement)).toEqual([{ t: 'ack', msgId: 'm1' }]);
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

  it('clears the message and acks it after MSG_AUTO_ACK_MS, exactly once', async () => {
    const { bridge, clock, queue, socket } = await harness();

    socket.receive(stateFrame({ msg: MESSAGE }));
    await queue.whenIdle();
    expect(messages(bridge)).toEqual(['BOX THIS LAP']);

    // One tick short of the window the text is still up and nothing was sent.
    await clock.advance(MSG_AUTO_ACK_MS - 1);
    await queue.whenIdle();
    expect(acks(socket)).toHaveLength(0);
    expect(messages(bridge)).toEqual(['BOX THIS LAP']);

    await clock.advance(1);
    await queue.whenIdle();
    expect(acks(socket)).toEqual([{ t: 'ack', msgId: 'm1' }]);
    expect(messages(bridge)).toEqual(['BOX THIS LAP', '']);

    // The timer is one-shot, and the message it cleared is no longer tappable.
    await clock.advance(MSG_AUTO_ACK_MS * 2);
    bridge.emit({ textEvent: { eventType: 'CLICK_EVENT' } });
    await queue.whenIdle();
    expect(acks(socket)).toHaveLength(1);
  });

  it('re-sends an auto-ack the dead socket swallowed, once the room replays', async () => {
    const { bridge, clock, queue, socket } = await harness();

    socket.receive(stateFrame({ msg: MESSAGE }));
    await queue.whenIdle();

    // The socket dies before the window closes. The timer still clears the
    // text (five seconds is five seconds), but `RoomClient.send` has nowhere
    // to put the ack — and the driver cannot tap a message he can no longer
    // see, so nothing but this retry can ever get the ack out.
    await clock.advance(3_000);
    socket.close(1_006);
    await clock.advance(2_000);
    await queue.whenIdle();
    expect(messages(bridge)).toEqual(['BOX THIS LAP', '']);
    expect(acks(socket)).toHaveLength(0);

    await clock.advance(1_000);
    const replacement = FakeWebSocket.last();
    expect(replacement).not.toBe(socket);
    replacement.open();
    replacement.receive(stateFrame({ seq: 2, msg: MESSAGE }));
    // `RoomClient` counts the session replayed only after its listeners run,
    // so the retry is scheduled for the next turn rather than sent inline.
    await clock.advance(0);
    await queue.whenIdle();

    expect(acks(replacement)).toEqual([{ t: 'ack', msgId: 'm1' }]);

    // And once the relay confirms it, the retry stops.
    replacement.receive(
      stateFrame({ seq: 3, msg: { ...MESSAGE, ackedAt: 99 } }),
    );
    replacement.receive(stateFrame({ seq: 4, gap: 40 }));
    await clock.advance(1_000);
    await queue.whenIdle();

    expect(acks(replacement)).toHaveLength(1);
  });

  it('does not auto-ack a message the driver already tapped', async () => {
    const { bridge, clock, queue, socket } = await harness();

    socket.receive(stateFrame({ msg: MESSAGE }));
    await queue.whenIdle();

    await clock.advance(2_000);
    bridge.emit({ textEvent: { eventType: 'CLICK_EVENT' } });
    await queue.whenIdle();
    expect(acks(socket)).toHaveLength(1);

    await clock.advance(MSG_AUTO_ACK_MS);
    await queue.whenIdle();

    expect(acks(socket)).toEqual([{ t: 'ack', msgId: 'm1' }]);
  });

  it('restarts the window for a new message id', async () => {
    const { bridge, clock, queue, socket } = await harness();

    socket.receive(stateFrame({ msg: MESSAGE }));
    await queue.whenIdle();
    await clock.advance(4_000);

    socket.receive(
      stateFrame({
        seq: 2,
        msg: { id: 'm2', text: 'PIT NOW', ts: 4_000, ackedAt: null },
      }),
    );
    await queue.whenIdle();

    // The first message's remaining second must not clear the second message.
    await clock.advance(2_000);
    await queue.whenIdle();
    expect(acks(socket)).toHaveLength(0);
    expect(messages(bridge)).toEqual(['BOX THIS LAP', 'PIT NOW']);

    await clock.advance(3_000);
    await queue.whenIdle();
    expect(acks(socket)).toEqual([{ t: 'ack', msgId: 'm2' }]);
    expect(messages(bridge)).toEqual(['BOX THIS LAP', 'PIT NOW', '']);
  });

  it('sends nothing after the driver is stopped', async () => {
    const { bridge, clock, driver, queue, socket } = await harness();

    socket.receive(stateFrame({ msg: MESSAGE }));
    await queue.whenIdle();
    const before = bridge.calls.length;

    driver.stop();
    await clock.advance(MSG_AUTO_ACK_MS * 2);
    await queue.whenIdle();

    expect(acks(socket)).toHaveLength(0);
    expect(bridge.calls).toHaveLength(before);
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
