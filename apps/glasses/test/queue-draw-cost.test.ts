import { HUD_GAP_FLUSH_MS } from '@g2-race-spotter/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  composeBottomStrip,
  drawCarsLayer,
  drawTopStrip,
} from '../src/render/draw-hud.ts';
import { RenderQueue } from '../src/render/queue.ts';
import { FakeBridge, FakeClock } from './helpers.ts';

/**
 * Drawing the car bars (the corner-L regions) is the costly part of a frame
 * (hud-qa, T063 review). Since design round 7 the message lives in the bottom
 * strip, so a message or blink phase repacks the bottom strip — but it lays
 * the message over a copy of the KEPT car layer and never redraws the bars;
 * the bars are redrawn only when the cars change. The top strip depends on
 * the lane and the link only.
 */
vi.mock('../src/render/draw-hud.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../src/render/draw-hud.ts')>();
  return {
    ...original,
    drawTopStrip: vi.fn(original.drawTopStrip),
    drawCarsLayer: vi.fn(original.drawCarsLayer),
    composeBottomStrip: vi.fn(original.composeBottomStrip),
  };
});

describe('render queue draw cost', () => {
  it('redraws the car bars only when the cars change, and each strip only when its inputs change', async () => {
    const bridge = new FakeBridge();
    const clock = new FakeClock();
    const queue = new RenderQueue({
      bridge,
      mode: 'image',
      timers: clock.timers,
      now: clock.now,
      log: () => undefined,
    });
    const top = vi.mocked(drawTopStrip);
    const bars = vi.mocked(drawCarsLayer);
    const bottom = vi.mocked(composeBottomStrip);
    /** [top strips drawn, car layers drawn, bottom strips composed] */
    const counts = (): [number, number, number] => [
      top.mock.calls.length,
      bars.mock.calls.length,
      bottom.mock.calls.length,
    ];
    top.mockClear();
    bars.mockClear();
    bottom.mockClear();

    const cars = [1, 2, 3] as const;
    queue.push({ kind: 'hud', state: { lane: null, cars }, linkOk: true });
    expect(counts()).toEqual([1, 1, 1]);

    // A lane call: the top strip only.
    queue.push({ kind: 'hud', state: { lane: 'mid', cars }, linkOk: true });
    expect(counts()).toEqual([2, 1, 1]);

    // A message and its blink phases: the bottom strip is recomposed from
    // the kept car layer; neither the bars nor the top strip are redrawn.
    const withMessage = (msgVisible: boolean) =>
      ({
        kind: 'hud',
        state: { lane: 'mid', cars },
        linkOk: true,
        message: 'GO LOW\nEXIT',
        ...(msgVisible ? {} : { msgVisible: false }),
      }) as const;
    queue.push(withMessage(true));
    queue.push(withMessage(false));
    queue.push(withMessage(true));
    expect(counts()).toEqual([2, 1, 4]);

    // A repeat of the same frame redraws nothing.
    queue.push(withMessage(true));
    expect(counts()).toEqual([2, 1, 4]);

    // The link going down: both strips again, the bars still from the layer.
    queue.push({ ...withMessage(true), linkOk: false });
    expect(counts()).toEqual([3, 1, 5]);

    // A cars change: the bars are redrawn (once) and the bottom recomposed.
    queue.push({
      ...withMessage(true),
      linkOk: false,
      state: { lane: 'mid', cars: [1, 0, 3] },
    });
    expect(counts()).toEqual([3, 2, 6]);

    // Sending never draws.
    await clock.advance(HUD_GAP_FLUSH_MS * 2);
    await queue.whenIdle();
    expect(counts()).toEqual([3, 2, 6]);
    expect(bridge.callsNamed('updateImageRawData').length).toBeGreaterThan(0);
  });
});
