import { HUD_GAP_FLUSH_MS } from '@g2-race-spotter/protocol';
import { describe, expect, it, vi } from 'vitest';

import { drawBottomStrip, drawTopStrip } from '../src/render/draw-hud.ts';
import { RenderQueue } from '../src/render/queue.ts';
import { FakeBridge, FakeClock } from './helpers.ts';

/**
 * Drawing the car strip (the corner-L regions) is the costly part of a frame,
 * so a push that changes only the top strip — a lane call, a blink phase, a
 * message — must not redraw it (hud-qa, T063 review).
 */
vi.mock('../src/render/draw-hud.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../src/render/draw-hud.ts')>();
  return {
    ...original,
    drawTopStrip: vi.fn(original.drawTopStrip),
    drawBottomStrip: vi.fn(original.drawBottomStrip),
  };
});

describe('render queue draw cost', () => {
  it('redraws the bottom strip only when cars or the link change', async () => {
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
    const bottom = vi.mocked(drawBottomStrip);
    const counts = (): [number, number] => [
      top.mock.calls.length,
      bottom.mock.calls.length,
    ];
    top.mockClear();
    bottom.mockClear();

    queue.push({
      kind: 'hud',
      state: { lane: null, cars: [1, 2, 3] },
      linkOk: true,
    });
    expect(counts()).toEqual([1, 1]);

    // Lane call, its blink phases, a message and its blink: top only.
    const cars = [1, 2, 3] as const;
    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars },
      linkOk: true,
      laneStyle: 'outline',
    });
    queue.push({ kind: 'hud', state: { lane: 'mid', cars }, linkOk: true });
    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars },
      linkOk: true,
      message: 'BOX',
    });
    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars },
      linkOk: true,
      message: 'BOX',
      msgVisible: false,
    });
    expect(counts()).toEqual([5, 1]);

    // A cars change or a link change redraws it.
    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [1, 0, 3] },
      linkOk: true,
    });
    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [1, 0, 3] },
      linkOk: false,
    });
    expect(counts()).toEqual([7, 3]);

    await clock.advance(HUD_GAP_FLUSH_MS * 2);
    await queue.whenIdle();
    expect(bottom.mock.calls.length).toBe(3);
  });
});
