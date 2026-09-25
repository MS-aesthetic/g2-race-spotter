import { describe, expect, it, vi } from 'vitest';

import { HALF_WIDTH, STRIP_HEIGHT, STRIP_Y } from '../src/render/hud-design.ts';
import {
  buildPage,
  createStartupPage,
  SDK_MAX_CONTAINERS,
  SDK_MAX_IMAGE_CONTAINERS,
  SDK_MAX_TEXT_CONTAINERS,
  STRIP_CONTAINERS,
} from '../src/startup-page.ts';

const PAGE = buildPage({ mode: 'image', status: 'CONNECTING' });

describe('startup page', () => {
  it('creates the seven-container page through one guarded call', async () => {
    const bridge = { createStartUpPageContainer: vi.fn(async () => 0) };
    const startPage = createStartupPage(bridge, PAGE, () => undefined);

    await expect(startPage()).resolves.toBe(true);
    await expect(startPage()).resolves.toBe(true);

    expect(bridge.createStartUpPageContainer).toHaveBeenCalledOnce();
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledWith(PAGE);
    expect(PAGE).toEqual({
      containerTotalNum: 7,
      textObject: [
        expect.objectContaining({
          containerID: 1,
          containerName: 'bg',
          content: ' ',
          isEventCapture: 1,
        }),
        expect.objectContaining({ containerID: 3, containerName: 'msg' }),
        expect.objectContaining({
          containerID: 4,
          containerName: 'status',
          content: 'CONNECTING',
        }),
      ],
      imageObject: [
        expect.objectContaining({ containerID: 2, containerName: 'stripTL' }),
        expect.objectContaining({ containerID: 5, containerName: 'stripTR' }),
        expect.objectContaining({ containerID: 6, containerName: 'stripBL' }),
        expect.objectContaining({ containerID: 7, containerName: 'stripBR' }),
      ],
    });
  });

  it('stays within the SDK 0.0.12 caps: <= 4 images, <= 8 text, <= 12 total', () => {
    for (const mode of ['image', 'text'] as const) {
      const page = buildPage({ mode, status: 'L S' });
      const images = page.imageObject ?? [];
      const total = page.textObject.length + images.length;

      expect(images.length).toBeLessThanOrEqual(SDK_MAX_IMAGE_CONTAINERS);
      expect(page.textObject.length).toBeLessThanOrEqual(
        SDK_MAX_TEXT_CONTAINERS,
      );
      expect(total).toBeLessThanOrEqual(SDK_MAX_CONTAINERS);
      expect(page.containerTotalNum).toBe(total);
    }
    expect([
      SDK_MAX_IMAGE_CONTAINERS,
      SDK_MAX_TEXT_CONTAINERS,
      SDK_MAX_CONTAINERS,
    ]).toEqual([4, 8, 12]);
  });

  it('lays the HUD out as four edge strips, message in the centre, status on the right border', () => {
    // The layout table in the g2-hud-display skill (Maxx design round 4,
    // 2026-09-25).
    const page = buildPage({ mode: 'image', status: 'L S', message: 'BOX' });
    const byName = new Map(
      [...page.textObject, ...(page.imageObject ?? [])].map((container) => [
        container.containerName,
        container,
      ]),
    );
    const rect = (name: string): number[] => {
      const container = byName.get(name)!;
      return [
        container.xPosition,
        container.yPosition,
        container.width,
        container.height,
      ];
    };

    expect(rect('bg')).toEqual([0, 0, 576, 288]);
    expect(rect('stripTL')).toEqual([0, 0, 288, 48]);
    expect(rect('stripTR')).toEqual([288, 0, 288, 48]);
    expect(rect('stripBL')).toEqual([0, 240, 288, 48]);
    expect(rect('stripBR')).toEqual([288, 240, 288, 48]);
    expect(rect('msg')).toEqual([16, 112, 504, 64]);
    expect(rect('status')).toEqual([528, 124, 40, 28]);
    expect(byName.get('msg')).toMatchObject({ content: 'BOX' });
    expect(byName.get('status')).toMatchObject({ content: 'L S' });

    // The strip halves match what the queue draws into them.
    for (const strip of STRIP_CONTAINERS) {
      expect(rect(strip.containerName)).toEqual([
        strip.half * HALF_WIDTH,
        STRIP_Y[strip.strip],
        HALF_WIDTH,
        STRIP_HEIGHT,
      ]);
    }
  });

  it('keeps every container on the canvas, apart from bg overlapping nothing, with unique zOrder', () => {
    for (const mode of ['image', 'text'] as const) {
      const page = buildPage({ mode, status: 'L S' });
      const all = [...page.textObject, ...(page.imageObject ?? [])];

      for (const container of all) {
        expect(container.xPosition).toBeGreaterThanOrEqual(0);
        expect(container.yPosition).toBeGreaterThanOrEqual(0);
        expect(container.xPosition + container.width).toBeLessThanOrEqual(576);
        expect(container.yPosition + container.height).toBeLessThanOrEqual(288);
      }
      for (const image of page.imageObject ?? []) {
        expect(image.width).toBeGreaterThanOrEqual(20);
        expect(image.width).toBeLessThanOrEqual(288);
        expect(image.height).toBeGreaterThanOrEqual(20);
        expect(image.height).toBeLessThanOrEqual(144);
      }

      // `bg` is the full-canvas event-capture layer behind everything.
      const foreground = all.filter(
        (container) => container.containerName !== 'bg',
      );
      for (const [index, a] of foreground.entries()) {
        for (const b of foreground.slice(index + 1)) {
          const apart =
            a.xPosition + a.width <= b.xPosition ||
            b.xPosition + b.width <= a.xPosition ||
            a.yPosition + a.height <= b.yPosition ||
            b.yPosition + b.height <= a.yPosition;
          expect(apart, `${a.containerName} overlaps ${b.containerName}`).toBe(
            true,
          );
        }
      }

      const zOrders = all.map((container) => container.zOrderIndex);
      expect(new Set(zOrders).size).toBe(zOrders.length);
      const bg = all.find((container) => container.containerName === 'bg')!;
      expect(Math.min(...zOrders)).toBe(bg.zOrderIndex);
      const ids = all.map((container) => container.containerID);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort((x, y) => x - y)).toEqual(
        Array.from({ length: all.length }, (_, index) => index + 1),
      );
    }
  });

  it('does not retry a failed startup-page call', async () => {
    const bridge = { createStartUpPageContainer: vi.fn(async () => 1) };
    const startPage = createStartupPage(bridge, PAGE, () => undefined);

    await expect(startPage()).resolves.toBe(false);
    await expect(startPage()).resolves.toBe(false);

    expect(bridge.createStartUpPageContainer).toHaveBeenCalledOnce();
  });

  it('times and logs the call (030 R7)', async () => {
    const bridge = { createStartUpPageContainer: vi.fn(async () => 0) };
    const entries: Array<{ call: string; result: unknown }> = [];

    await createStartupPage(bridge, PAGE, (entry) => entries.push(entry))();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      call: 'createStartUpPageContainer',
      result: 0,
    });
  });
});
