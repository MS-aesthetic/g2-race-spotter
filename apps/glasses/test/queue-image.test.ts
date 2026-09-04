import { describe, expect, it } from 'vitest';

import type { ImageRawData } from '../src/bridge.ts';
import { drawHud } from '../src/render/draw-hud.ts';
import { pack } from '../src/render/gray4.ts';
import { RenderQueue } from '../src/render/queue.ts';
import { CONTAINER_HUD } from '../src/startup-page.ts';
import { FakeBridge, FakeClock } from './helpers.ts';

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
  it('sends at most 5 images for 20 gap states in 1 s and lands on the last one', async () => {
    const { bridge, clock, queue } = imageQueue();

    queue.push({ kind: 'hud', state: { lane: 'top', gap: 0 }, linkOk: true });
    await queue.whenIdle();

    for (let index = 1; index <= 20; index += 1) {
      queue.push({
        kind: 'hud',
        state: { lane: 'top', gap: index * 5 },
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
      pack(drawHud({ lane: 'top', gap: 100 }, { linkOk: true })),
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

    queue.push({ kind: 'hud', state: { lane: 'top', gap: 0 }, linkOk: true });
    await queue.whenIdle();

    queue.push({ kind: 'hud', state: { lane: 'top', gap: 10 }, linkOk: true });
    await clock.advance(50);
    queue.push({ kind: 'hud', state: { lane: 'top', gap: 20 }, linkOk: true });
    await clock.advance(50);
    await queue.whenIdle();
    expect(images(bridge)).toHaveLength(1);

    queue.push({ kind: 'hud', state: { lane: 'bot', gap: 20 }, linkOk: true });
    await queue.whenIdle();

    const sent = images(bridge);
    expect(clock.ms).toBe(100);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.imageData).toEqual(
      pack(drawHud({ lane: 'bot', gap: 20 }, { linkOk: true })),
    );
  });

  it('never creates a second image container', async () => {
    const { bridge, clock, queue } = imageQueue();

    queue.push({ kind: 'hud', state: { lane: 'mid', gap: 20 }, linkOk: true });
    queue.push({ kind: 'msg', text: 'GO' });
    await clock.advance(500);
    await queue.whenIdle();

    for (const payload of images(bridge)) {
      expect(payload.containerID).toBe(CONTAINER_HUD);
    }
    expect(bridge.callsNamed('createStartUpPageContainer')).toHaveLength(0);
  });
});
