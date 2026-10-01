import {
  RoomClient,
  type Cars,
  type Lane,
  type RoomWebSocketConstructor,
  type State,
} from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { MSG_AUTO_ACK_MS } from '../src/app.ts';
import type { ImageRawData, TextUpgrade } from '../src/bridge.ts';
import { startDriver, type Driver } from '../src/driver.ts';
import { MSG_BLINK_MS, MSG_BLINK_PHASES } from '../src/msg-blink.ts';
import type { RenderMode } from '../src/render/mode.ts';
import { packContainers, RenderQueue } from '../src/render/queue.ts';
import {
  CONTAINER_MSG,
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
 * The message blink (Maxx, 2026-10-01 design round 6: "make text blink every
 * second for 5 seconds"): in image mode the message is drawn into the top
 * strip, visible at 0, 2 and 4 s, hidden at 1 and 3 s, and cleared + auto-acked
 * at `MSG_AUTO_ACK_MS` (5 s) — through the real driver, store and queue
 * against a fake bridge and clock.
 */

const URL = 'ws://relay.test/room/QA01?role=driver';
const LANE: Lane = 'mid';
const CARS: Cars = [1, 0, 2];
const M1 = { id: 'm1', text: 'BOX THIS LAP', ts: 10, ackedAt: null };
const M2 = { id: 'm2', text: 'PIT NOW', ts: 20, ackedAt: null };

/** Visibility at 0, 1, 2, 3, 4 s — written out, not read from the module. */
const VISIBLE_AT = [true, false, true, false, true] as const;

const TL = CONTAINER_STRIP_TL;
const TR = CONTAINER_STRIP_TR;

interface Harness {
  bridge: FakeBridge;
  clock: FakeClock;
  queue: RenderQueue;
  driver: Driver;
  client: RoomClient;
  socket: FakeSocket;
  /** Sends a room `state` (lane/cars fixed unless overridden) and drains. */
  state(overrides?: Partial<State>, socket?: FakeSocket): Promise<void>;
  /** Moves the clock in 100 ms steps, draining the queue after each. */
  advance(ms: number): Promise<void>;
}

function images(bridge: FakeBridge): ImageRawData[] {
  return bridge
    .callsNamed('updateImageRawData')
    .map((entry) => entry.payload as ImageRawData);
}

function acks(socket: FakeSocket): unknown[] {
  return socket
    .frames()
    .filter((frame) => (frame as { t: string }).t === 'ack');
}

/** The top-strip halves for the HUD with `text` shown (`null` = none). */
function top(
  text: string | null,
  visible = true,
  linkOk = true,
): Array<Uint8Array | undefined> {
  const packed = packContainers(
    { lane: LANE, cars: CARS },
    linkOk,
    'filled',
    text,
    visible,
  );
  return [packed.get(TL), packed.get(TR)];
}

function shownTop(bridge: FakeBridge): Array<Uint8Array | undefined> {
  const shown = shownImages(bridge);
  return [shown.get(TL), shown.get(TR)];
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

  let seq = 0;
  const h: Harness = {
    bridge,
    clock,
    queue,
    driver,
    client,
    socket,
    async state(overrides = {}, target = socket) {
      seq += 1;
      target.receive(stateFrame({ seq, lane: LANE, cars: CARS, ...overrides }));
      await queue.whenIdle();
    },
    async advance(ms) {
      for (let left = ms; left > 0; left -= 100) {
        await clock.advance(Math.min(left, 100));
        await queue.whenIdle();
      }
    },
  };
  return h;
}

/** A harness showing lane/cars with no message and every debounce over. */
async function settled(mode: RenderMode = 'image'): Promise<Harness> {
  const h = await harness(mode);
  await h.state();
  await h.advance(1_000);
  return h;
}

describe('message blink (round 6)', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
  });

  it('is 1 s per phase: visible at 0, 2, 4 s and hidden at 1, 3 s, inside the 5 s auto-clear', () => {
    expect(MSG_BLINK_MS).toBe(1_000);
    expect(MSG_BLINK_PHASES).toEqual(VISIBLE_AT);
    expect(MSG_BLINK_MS * MSG_BLINK_PHASES.length).toBe(MSG_AUTO_ACK_MS);
  });

  it('draws the message into the top strip, blinks it, then clears and acks it at 5 s', async () => {
    const h = await settled();

    await h.state({ msg: M1 });
    expect(shownTop(h.bridge)).toEqual(top(M1.text));

    for (let second = 1; second < VISIBLE_AT.length; second += 1) {
      if (second === 3) {
        // Keep the link fresh with a state that changes nothing on screen:
        // it must neither restart the blink nor extend the window.
        await h.state({ msg: M1 });
      }
      // Nothing moves before the phase is due …
      await h.advance(MSG_BLINK_MS - 100);
      expect(shownTop(h.bridge)).toEqual(top(M1.text, VISIBLE_AT[second - 1]));
      // … and it lands on time.
      await h.advance(100);
      expect(shownTop(h.bridge), `${second} s`).toEqual(
        top(M1.text, VISIBLE_AT[second]),
      );
    }
    expect(acks(h.socket)).toHaveLength(0);

    // At 5 s: cleared (no message pixels) and auto-acked, exactly once.
    await h.advance(MSG_BLINK_MS - 100);
    expect(acks(h.socket)).toHaveLength(0);
    await h.advance(100);
    expect(shownTop(h.bridge)).toEqual(top(null));
    expect(acks(h.socket)).toEqual([{ t: 'ack', msgId: 'm1' }]);

    await h.state({ msg: { ...M1, ackedAt: 99 } });
    await h.advance(2_000);
    expect(acks(h.socket)).toHaveLength(1);
    expect(shownTop(h.bridge)).toEqual(top(null));
  });

  it('sends only the top-strip halves for every phase, never the car strip', async () => {
    const h = await settled();
    const start = images(h.bridge).length;

    await h.state({ msg: M1 });
    await h.advance(2_500);
    await h.state({ msg: M1 }); // keep the link fresh
    await h.advance(2_500);

    const sent = images(h.bridge)
      .slice(start)
      .map((payload) => payload.containerID);
    // Shown, hidden, shown, hidden, shown, cleared: the message straddles the
    // seam, so each is one send per top half.
    expect(sent).toEqual(Array.from({ length: 6 }, () => [TL, TR]).flat());
    expect(sent).not.toContain(CONTAINER_STRIP_BL);
    expect(sent).not.toContain(CONTAINER_STRIP_BR);
  });

  it('restarts the sequence for a new message id', async () => {
    const h = await settled();

    await h.state({ msg: M1 });
    await h.advance(1_500); // m1 hidden
    expect(shownTop(h.bridge)).toEqual(top(M1.text, false));

    await h.state({ msg: M2 });
    // The new message is up at once, visible, on its own clock.
    expect(shownTop(h.bridge)).toEqual(top(M2.text));
    await h.advance(900); // m1 would have been visible again at 2 s: no-op
    expect(shownTop(h.bridge)).toEqual(top(M2.text));
    await h.advance(100);
    expect(shownTop(h.bridge)).toEqual(top(M2.text, false));
    await h.state({ msg: M2 }); // keep the link fresh
    await h.advance(1_000);
    expect(shownTop(h.bridge)).toEqual(top(M2.text));

    // m1's remaining window does not clear m2; m2's own 5 s does.
    await h.advance(2_900);
    expect(acks(h.socket)).toHaveLength(0);
    expect(shownTop(h.bridge)).toEqual(top(M2.text));
    await h.advance(100);
    expect(acks(h.socket)).toEqual([{ t: 'ack', msgId: 'm2' }]);
    expect(shownTop(h.bridge)).toEqual(top(null));
  });

  it('keeps the auto-ack retry: an ack the dead socket swallowed goes out on replay', async () => {
    const h = await settled();

    await h.state({ msg: M1 });
    await h.advance(3_000);
    h.socket.close(1_006);
    await h.advance(2_000);
    // Cleared at 5 s whatever the link — but the ack had nowhere to go.
    const [tl, tr] = shownTop(h.bridge);
    expect([top(null, true, true), top(null, true, false)]).toContainEqual([
      tl,
      tr,
    ]);
    expect(acks(h.socket)).toHaveLength(0);

    await h.clock.advance(1_000);
    const replacement = FakeWebSocket.last();
    expect(replacement).not.toBe(h.socket);
    replacement.open();
    await h.state({ msg: M1 }, replacement);
    await h.clock.advance(0);
    await h.queue.whenIdle();
    expect(acks(replacement)).toEqual([{ t: 'ack', msgId: 'm1' }]);

    // The replayed (still unacked) message does not come back on screen.
    expect(shownTop(h.bridge)).toEqual(top(null));
    await h.state({ msg: { ...M1, ackedAt: 99 } }, replacement);
    await h.advance(1_000);
    expect(acks(replacement)).toHaveLength(1);
  });

  it('dims the message with the rest of the HUD on NO LINK', async () => {
    const h = await settled();

    await h.state({ msg: M1 });
    h.client.disconnect();
    await h.queue.whenIdle();
    expect(shownTop(h.bridge)).toEqual(top(M1.text, true, false));
  });

  it('sends nothing after the driver is stopped', async () => {
    const h = await settled();

    await h.state({ msg: M1 });
    const before = h.bridge.calls.length;
    h.driver.stop();
    await h.advance(MSG_AUTO_ACK_MS * 2);

    expect(h.bridge.calls).toHaveLength(before);
    expect(acks(h.socket)).toHaveLength(0);
  });

  it('costs nothing in text mode: the msg container gets the text once and is cleared at 5 s', async () => {
    const h = await settled('text');
    const messages = (): string[] =>
      h.bridge
        .callsNamed('textContainerUpgrade')
        .map((entry) => entry.payload as TextUpgrade)
        .filter((payload) => payload.containerID === CONTAINER_MSG)
        .map((payload) => payload.content);

    await h.state({ msg: M1 });
    await h.advance(2_500);
    await h.state({ msg: M1 });
    await h.advance(2_500);

    expect(messages()).toEqual([M1.text, '']);
    expect(h.bridge.callsNamed('updateImageRawData')).toHaveLength(0);
    expect(acks(h.socket)).toEqual([{ t: 'ack', msgId: 'm1' }]);
  });

  it('clears a message tapped in a hidden phase once the relay says acked, with no further sends', async () => {
    const h = await settled();

    await h.state({ msg: M1 });
    await h.advance(1_500); // hidden phase
    expect(shownTop(h.bridge)).toEqual(top(M1.text, false));
    const before = images(h.bridge).length;

    h.bridge.emit({ textEvent: { eventType: 'CLICK_EVENT' } });
    await h.queue.whenIdle();
    expect(acks(h.socket)).toEqual([{ t: 'ack', msgId: 'm1' }]);

    await h.state({ msg: { ...M1, ackedAt: 99 } });
    expect(shownTop(h.bridge)).toEqual(top(null));
    // The phases still due at 2, 3 and 4 s and the 5 s auto-clear are gone.
    await h.advance(3_500);
    expect(shownTop(h.bridge)).toEqual(top(null));
    // A hidden phase is pixel-identical to no message: the clear costs nothing.
    expect(images(h.bridge).length).toBe(before);
    expect(acks(h.socket)).toHaveLength(1);
  });

  it('renders a lane-blink phase and a message phase due together as ONE frame', async () => {
    // A frame carrying a new call AND a new message: lane phases every 500 ms
    // to 3.5 s, message phases at 1, 2, 3, 4 s, the clear at 5 s. Phases due
    // together (1, 2, 3 s) are one render, so there are 10 top-strip frames
    // in 0–6 s: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5. ▲ and the message both
    // straddle the seam: 2 sends a frame = 20. ◀ (▶) alone changes only TL
    // (TR) at 0.5/1.5/2.5/3.5 s: 4 × 1 + 6 × 2 = 16. Rendering each phase on
    // its own sent 26 / 19.
    const expected: Record<Lane, number> = { mid: 20, bot: 16, top: 16 };
    for (const lane of ['mid', 'bot', 'top'] as const) {
      FakeWebSocket.reset();
      const h = await harness();
      await h.state({ lane: null });
      await h.advance(1_000);
      const before = images(h.bridge).length;

      await h.state({ lane, msg: M1 });
      await h.advance(2_500);
      await h.state({ lane, msg: M1 }); // keep the link fresh; changes nothing
      await h.advance(2_000);
      await h.state({ lane, msg: M1 });
      await h.advance(1_500);

      const sent = images(h.bridge)
        .slice(before)
        .map((payload) => payload.containerID);
      expect(sent.length, lane).toBe(expected[lane]);
      expect(sent).not.toContain(CONTAINER_STRIP_BL);
      expect(sent).not.toContain(CONTAINER_STRIP_BR);
      expect(shownImages(h.bridge)).toEqual(
        packContainers({ lane, cars: CARS }, true),
      );
      h.driver.stop();
    }
  });
});
