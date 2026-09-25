import { describe, expect, it } from 'vitest';

import type { ImageRawData } from '../src/bridge.ts';
import { drawHud } from '../src/render/draw-hud.ts';
import { pack } from '../src/render/gray4.ts';
import { RenderQueue } from '../src/render/queue.ts';
import { CONTAINER_HUD } from '../src/startup-page.ts';
import { burstCars, FakeBridge, FakeClock } from './helpers.ts';

function imageQueue(): {
  bridge: FakeBridge;
  clock: FakeClock;
  queue: RenderQueue;
} {
  const bridge = new FakeBridge();
  const clock = new FakeClock();
  const queue = new RenderQueue({
    bridge,
    mode: 'image',
    timers: clock.timers,
    now: clock.now,
    log: () => undefined,
  });

  return { bridge, clock, queue };
}

function images(bridge: FakeBridge): ImageRawData[] {
  return bridge
    .callsNamed('updateImageRawData')
    .map((entry) => entry.payload as ImageRawData);
}

describe('render queue, image mode (050 AC-4)', () => {
  it('sends at most 5 images for 20 cars states in 1 s and lands on the last one', async () => {
    const { bridge, clock, queue } = imageQueue();

    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 0, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    for (let index = 1; index <= 20; index += 1) {
      queue.push({
        kind: 'hud',
        state: { lane: 'top', cars: burstCars(index) },
        linkOk: true,
      });
      await clock.advance(50);
    }
    await queue.whenIdle();

    const sent = images(bridge);
    expect(clock.ms).toBe(1_000);
    // The priming send plus one flush per 250 ms window.
    expect(sent.length).toBeLessThanOrEqual(5);
    expect(sent.at(-1)?.imageData).toEqual(
      pack(drawHud({ lane: 'top', cars: burstCars(20) }, { linkOk: true })),
    );
    expect(sent[0]).toMatchObject({
      containerID: CONTAINER_HUD,
      containerName: 'hud',
      imageWidth: 288,
      imageHeight: 144,
    });
  });

  it('sends a lane change mid-burst immediately', async () => {
    const { bridge, clock, queue } = imageQueue();

    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 0, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 1, 0] },
      linkOk: true,
    });
    await clock.advance(50);
    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 2, 0] },
      linkOk: true,
    });
    await clock.advance(50);
    await queue.whenIdle();
    expect(images(bridge)).toHaveLength(1);

    queue.push({
      kind: 'hud',
      state: { lane: 'bot', cars: [0, 2, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    const sent = images(bridge);
    expect(clock.ms).toBe(100);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.imageData).toEqual(
      pack(drawHud({ lane: 'bot', cars: [0, 2, 0] }, { linkOk: true })),
    );
  });

  it('sends the relay stale clear mid-burst immediately', async () => {
    const { bridge, clock, queue } = imageQueue();

    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [0, 0, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [0, 1, 0] },
      linkOk: true,
    });
    await clock.advance(50);
    await queue.whenIdle();
    expect(images(bridge)).toHaveLength(1);

    // The relay's stale clear drops the lane: that is a lane change, so the
    // blank HUD does not wait out the cars debounce.
    queue.push({
      kind: 'hud',
      state: { lane: null, cars: [0, 0, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    const sent = images(bridge);
    expect(clock.ms).toBe(50);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.imageData).toEqual(
      pack(drawHud({ lane: null, cars: [0, 0, 0] }, { linkOk: true })),
    );
  });

  it('sends a stale clear of a cars-only state immediately', async () => {
    const { bridge, clock, queue } = imageQueue();

    queue.push({
      kind: 'hud',
      state: { lane: null, cars: [0, 2, 0] },
      linkOk: true,
    });
    await queue.whenIdle();
    // A cars change right after the first send would wait out the debounce…
    queue.push({
      kind: 'hud',
      state: { lane: null, cars: [0, 3, 0] },
      linkOk: true,
    });
    await clock.advance(20);
    await queue.whenIdle();
    expect(images(bridge)).toHaveLength(1);

    // …but the relay emptying the HUD (no lane was up) goes out at once.
    queue.push({
      kind: 'hud',
      state: { lane: null, cars: [0, 0, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    const sent = images(bridge);
    expect(clock.ms).toBe(20);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.imageData).toEqual(
      pack(drawHud({ lane: null, cars: [0, 0, 0] }, { linkOk: true })),
    );
  });

  it('never creates a second image container', async () => {
    const { bridge, clock, queue } = imageQueue();

    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [0, 2, 0] },
      linkOk: true,
    });
    queue.push({ kind: 'msg', text: 'GO' });
    await clock.advance(500);
    await queue.whenIdle();

    for (const payload of images(bridge)) {
      expect(payload.containerID).toBe(CONTAINER_HUD);
    }
    expect(bridge.callsNamed('createStartUpPageContainer')).toHaveLength(0);
  });
});
