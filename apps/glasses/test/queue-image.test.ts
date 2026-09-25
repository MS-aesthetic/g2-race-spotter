import { HUD_GAP_FLUSH_MS } from '@g2-race-spotter/protocol';
import { describe, expect, it } from 'vitest';

import type { ImageRawData } from '../src/bridge.ts';
import type { HudState } from '../src/render/hud-design.ts';
import { packContainers, RenderQueue } from '../src/render/queue.ts';
import {
  CONTAINER_STRIP_BL,
  CONTAINER_STRIP_BR,
  CONTAINER_STRIP_TL,
  CONTAINER_STRIP_TR,
} from '../src/startup-page.ts';
import {
  burstCars,
  collectLogs,
  FakeBridge,
  FakeClock,
  flush,
} from './helpers.ts';

function imageQueue(): {
  bridge: FakeBridge;
  clock: FakeClock;
  queue: RenderQueue;
  entries: ReturnType<typeof collectLogs>['entries'];
} {
  const bridge = new FakeBridge();
  const clock = new FakeClock();
  const { log, entries } = collectLogs();
  const queue = new RenderQueue({
    bridge,
    mode: 'image',
    timers: clock.timers,
    now: clock.now,
    log,
  });

  return { bridge, clock, queue, entries };
}

function images(bridge: FakeBridge): ImageRawData[] {
  return bridge
    .callsNamed('updateImageRawData')
    .map((entry) => entry.payload as ImageRawData);
}

function names(sent: readonly ImageRawData[]): string[] {
  return sent.map((payload) => payload.containerName);
}

function hud(
  state: HudState,
  linkOk = true,
): { kind: 'hud'; state: HudState; linkOk: boolean } {
  return { kind: 'hud', state, linkOk };
}

/** Pushes a state and returns the image sends it caused. */
async function sendsFor(
  bridge: FakeBridge,
  queue: RenderQueue,
  state: HudState,
  linkOk = true,
): Promise<ImageRawData[]> {
  const before = images(bridge).length;
  queue.push(hud(state, linkOk));
  await queue.whenIdle();
  return images(bridge).slice(before);
}

/** A queue that has already put `state` on the glasses, with the cars debounce
 * window long gone. */
async function primed(state: HudState): Promise<ReturnType<typeof imageQueue>> {
  const harness = imageQueue();
  harness.queue.push(hud(state));
  await harness.queue.whenIdle();
  await harness.clock.advance(HUD_GAP_FLUSH_MS * 2);
  return harness;
}

describe('render queue, image mode: one job per image container (050 AC-4)', () => {
  it('sends all four containers for the first frame, with their packed bytes', async () => {
    const { bridge, queue } = imageQueue();

    const sent = await sendsFor(bridge, queue, {
      lane: 'top',
      cars: [1, 2, 3],
    });

    const expected = packContainers({ lane: 'top', cars: [1, 2, 3] }, true);
    expect(names(sent)).toEqual(['stripTL', 'stripTR', 'stripBL', 'stripBR']);
    for (const payload of sent) {
      expect(payload).toMatchObject({ imageWidth: 288, imageHeight: 48 });
      expect(payload.imageData).toEqual(expected.get(payload.containerID));
    }
    expect(sent.map((payload) => payload.containerID)).toEqual([
      CONTAINER_STRIP_TL,
      CONTAINER_STRIP_TR,
      CONTAINER_STRIP_BL,
      CONTAINER_STRIP_BR,
    ]);
  });

  it('costs at most two sends for a lane change, sent at once', async () => {
    const { bridge, clock, queue } = await primed({
      lane: 'bot',
      cars: [1, 2, 3],
    });

    // ▼ → ▲: one corner goes hollow, the other fills.
    const botToTop = await sendsFor(bridge, queue, {
      lane: 'top',
      cars: [1, 2, 3],
    });
    expect(names(botToTop)).toEqual(['stripTL', 'stripTR']);

    // ▲ → ▬: the dash straddles the seam, so both halves change.
    const topToMid = await sendsFor(bridge, queue, {
      lane: 'mid',
      cars: [1, 2, 3],
    });
    expect(names(topToMid)).toEqual(['stripTL', 'stripTR']);

    // ▬ → none: still both halves of the dash.
    const midToNull = await sendsFor(bridge, queue, {
      lane: null,
      cars: [1, 2, 3],
    });
    expect(names(midToNull)).toEqual(['stripTL', 'stripTR']);

    // none → ▼: only the top-left corner changes.
    const nullToBot = await sendsFor(bridge, queue, {
      lane: 'bot',
      cars: [1, 2, 3],
    });
    expect(names(nullToBot)).toEqual(['stripTL']);

    expect(clock.ms).toBe(HUD_GAP_FLUSH_MS * 2);
    const last = packContainers({ lane: 'bot', cars: [1, 2, 3] }, true);
    expect(nullToBot[0]?.imageData).toEqual(last.get(CONTAINER_STRIP_TL));
  });

  it('costs one send for a left or right car change and two for a middle one', async () => {
    const { bridge, clock, queue } = await primed({
      lane: 'mid',
      cars: [0, 0, 0],
    });

    expect(
      names(await sendsFor(bridge, queue, { lane: 'mid', cars: [1, 0, 0] })),
    ).toEqual(['stripBL']);
    await clock.advance(HUD_GAP_FLUSH_MS);

    expect(
      names(await sendsFor(bridge, queue, { lane: 'mid', cars: [1, 0, 3] })),
    ).toEqual(['stripBR']);
    await clock.advance(HUD_GAP_FLUSH_MS);

    // The middle bar straddles the seam; its second cell is cut by it.
    const middle = await sendsFor(bridge, queue, {
      lane: 'mid',
      cars: [1, 2, 3],
    });
    expect(names(middle)).toEqual(['stripBL', 'stripBR']);
    const expected = packContainers({ lane: 'mid', cars: [1, 2, 3] }, true);
    for (const payload of middle) {
      expect(payload.imageData).toEqual(expected.get(payload.containerID));
    }
  });

  it('sends a stale clear at once, and only the containers it changes', async () => {
    const { bridge, clock, queue } = imageQueue();
    queue.push(hud({ lane: 'top', cars: [0, 2, 0] }));
    await queue.whenIdle();
    // A cars change inside the debounce window is still waiting…
    queue.push(hud({ lane: 'top', cars: [0, 3, 0] }));
    await clock.advance(20);
    await queue.whenIdle();
    const before = images(bridge).length;
    expect(before).toBe(4);

    // …when the relay clears lane and cars: ▲ goes hollow (TR), the middle bar
    // empties (BL + BR). ▼ and the dash did not change, so TL is not sent.
    const sent = await sendsFor(bridge, queue, { lane: null, cars: [0, 0, 0] });

    expect(names(sent)).toEqual(['stripTR', 'stripBL', 'stripBR']);
    expect(clock.ms).toBe(20);
    const blank = packContainers({ lane: null, cars: [0, 0, 0] }, true);
    for (const payload of sent) {
      expect(payload.imageData).toEqual(blank.get(payload.containerID));
    }
  });

  it('sends the stale clear of a cars-only state at once (one bar, one send)', async () => {
    const { bridge, clock, queue } = imageQueue();
    queue.push(hud({ lane: null, cars: [0, 0, 2] }));
    await queue.whenIdle();
    queue.push(hud({ lane: null, cars: [0, 0, 3] }));
    await clock.advance(20);
    await queue.whenIdle();
    expect(images(bridge)).toHaveLength(4);

    const sent = await sendsFor(bridge, queue, { lane: null, cars: [0, 0, 0] });

    expect(clock.ms).toBe(20);
    expect(names(sent)).toEqual(['stripBR']);
  });

  it('dims all four containers at once when the link goes down', async () => {
    const { bridge, queue } = await primed({ lane: 'mid', cars: [0, 1, 0] });

    const sent = await sendsFor(
      bridge,
      queue,
      { lane: 'mid', cars: [0, 1, 0] },
      false,
    );

    expect(names(sent)).toEqual(['stripTL', 'stripTR', 'stripBL', 'stripBR']);
    const dimmed = packContainers({ lane: 'mid', cars: [0, 1, 0] }, false);
    for (const payload of sent) {
      expect(payload.imageData).toEqual(dimmed.get(payload.containerID));
    }
  });

  it('skips a container whose bytes are already on the glasses', async () => {
    const { bridge, clock, queue } = imageQueue();
    queue.push(hud({ lane: 'top', cars: [0, 1, 0] }));
    await queue.whenIdle();

    expect(
      await sendsFor(bridge, queue, { lane: 'top', cars: [0, 1, 0] }),
    ).toHaveLength(0);

    // A cars change that is undone inside the debounce window costs nothing.
    queue.push(hud({ lane: 'top', cars: [0, 2, 0] }));
    await clock.advance(10);
    queue.push(hud({ lane: 'top', cars: [0, 1, 0] }));
    await clock.advance(HUD_GAP_FLUSH_MS);
    await queue.whenIdle();
    expect(images(bridge)).toHaveLength(4);
  });

  it('debounces the car strip to one flush per 250 ms: 20 states in 1 s', async () => {
    const { bridge, clock, queue } = imageQueue();
    queue.push(hud({ lane: 'top', cars: [0, 0, 0] }));
    await queue.whenIdle();
    const primedCount = images(bridge).length;

    for (let index = 1; index <= 20; index += 1) {
      queue.push(hud({ lane: 'top', cars: burstCars(index) }));
      await clock.advance(50);
    }
    await queue.whenIdle();

    const burst = images(bridge).slice(primedCount);
    expect(clock.ms).toBe(1_000);
    // Only the car strip is touched, one flush (≤ 2 sends) per 250 ms window.
    expect(new Set(names(burst))).toEqual(new Set(['stripBL', 'stripBR']));
    expect(burst.length).toBeLessThanOrEqual(2 * 5);

    const last = packContainers({ lane: 'top', cars: burstCars(20) }, true);
    const latest = new Map(
      images(bridge).map((payload) => [payload.containerID, payload.imageData]),
    );
    for (const [containerID, bytes] of last) {
      expect(latest.get(containerID)).toEqual(bytes);
    }
  });

  it('sends a lane change mid-burst immediately, while the cars wait', async () => {
    const { bridge, clock, queue } = imageQueue();
    queue.push(hud({ lane: 'top', cars: [0, 0, 0] }));
    await queue.whenIdle();

    queue.push(hud({ lane: 'top', cars: [0, 1, 0] }));
    await clock.advance(50);
    queue.push(hud({ lane: 'top', cars: [0, 2, 0] }));
    await clock.advance(50);
    await queue.whenIdle();
    expect(images(bridge)).toHaveLength(4);

    const sent = await sendsFor(bridge, queue, {
      lane: 'bot',
      cars: [0, 2, 0],
    });

    expect(clock.ms).toBe(100);
    expect(names(sent)).toEqual(['stripTL', 'stripTR']);

    // The pending car change goes out in its own window, both halves together.
    await clock.advance(HUD_GAP_FLUSH_MS);
    await queue.whenIdle();
    expect(names(images(bridge).slice(6))).toEqual(['stripBL', 'stripBR']);
  });

  it('keeps one call in flight and replaces what is pending per container', async () => {
    const { bridge, clock, queue } = imageQueue();

    bridge.paused = true;
    queue.push(hud({ lane: 'top', cars: [0, 0, 0] }));
    await flush();
    expect(bridge.calls).toHaveLength(1);

    // Three more states while the first call is unresolved.
    queue.push(hud({ lane: 'mid', cars: [0, 0, 0] }));
    queue.push(hud({ lane: 'bot', cars: [0, 0, 0] }));
    queue.push(hud({ lane: 'bot', cars: [2, 0, 0] }));
    await flush();
    expect(bridge.calls).toHaveLength(1);

    bridge.paused = false;
    bridge.release();
    await clock.advance(HUD_GAP_FLUSH_MS);
    await queue.whenIdle();

    // TL went out with `top`, then once more with the newest state; every
    // other container once, with the newest state — never a queue of stale
    // frames, and the lane strip before the car strip.
    expect(names(images(bridge))).toEqual([
      'stripTL',
      'stripTL',
      'stripTR',
      'stripBL',
      'stripBR',
    ]);
    const newest = packContainers({ lane: 'bot', cars: [2, 0, 0] }, true);
    const latest = new Map(
      images(bridge).map((payload) => [payload.containerID, payload.imageData]),
    );
    for (const [containerID, bytes] of newest) {
      expect(latest.get(containerID)).toEqual(bytes);
    }
  });

  it('re-sends a container that changed back while a different frame was in flight', async () => {
    const { bridge, queue } = await primed({ lane: 'bot', cars: [0, 0, 0] });

    bridge.paused = true;
    queue.push(hud({ lane: null, cars: [0, 0, 0] }));
    await flush();
    // stripTL (▼ going hollow) is in flight; ▼ comes straight back.
    queue.push(hud({ lane: 'bot', cars: [0, 0, 0] }));
    bridge.paused = false;
    bridge.release();
    await queue.whenIdle();

    const sent = images(bridge).slice(4);
    expect(names(sent)).toEqual(['stripTL', 'stripTL']);
    expect(sent[1]?.imageData).toEqual(
      packContainers({ lane: 'bot', cars: [0, 0, 0] }, true).get(
        CONTAINER_STRIP_TL,
      ),
    );
  });

  it('does not count a failed send as on the glasses', async () => {
    const { bridge, queue } = await primed({ lane: 'top', cars: [0, 0, 0] });
    bridge.imageResult = () => 'imageException';

    expect(
      names(await sendsFor(bridge, queue, { lane: 'bot', cars: [0, 0, 0] })),
    ).toEqual(['stripTL', 'stripTR']);

    // The next state re-sends both, although the lane did not change again.
    bridge.imageResult = () => 'success';
    expect(
      names(await sendsFor(bridge, queue, { lane: 'bot', cars: [0, 0, 0] })),
    ).toEqual(['stripTL', 'stripTR']);
    expect(
      await sendsFor(bridge, queue, { lane: 'bot', cars: [0, 0, 0] }),
    ).toHaveLength(0);
  });

  it('logs {call, ms, result, container} for every image send', async () => {
    const { bridge, clock, queue, entries } = imageQueue();

    bridge.paused = true;
    queue.push(hud({ lane: null, cars: [0, 0, 0] }));
    await flush();
    await clock.advance(7);
    bridge.paused = false;
    bridge.release();
    await queue.whenIdle();

    expect(entries).toEqual([
      {
        call: 'updateImageRawData',
        ms: 7,
        result: 'success',
        container: 'stripTL',
      },
      {
        call: 'updateImageRawData',
        ms: 0,
        result: 'success',
        container: 'stripTR',
      },
      {
        call: 'updateImageRawData',
        ms: 0,
        result: 'success',
        container: 'stripBL',
      },
      {
        call: 'updateImageRawData',
        ms: 0,
        result: 'success',
        container: 'stripBR',
      },
    ]);
  });

  it('never creates an image container of its own', async () => {
    const { bridge, clock, queue } = imageQueue();

    queue.push(hud({ lane: 'mid', cars: [0, 2, 0] }));
    queue.push({ kind: 'msg', text: 'GO' });
    await clock.advance(500);
    await queue.whenIdle();

    const ids = new Set(images(bridge).map((payload) => payload.containerID));
    expect(ids).toEqual(
      new Set([
        CONTAINER_STRIP_TL,
        CONTAINER_STRIP_TR,
        CONTAINER_STRIP_BL,
        CONTAINER_STRIP_BR,
      ]),
    );
    expect(bridge.callsNamed('createStartUpPageContainer')).toHaveLength(0);
    expect(bridge.callsNamed('rebuildPageContainer')).toHaveLength(0);
  });
});
