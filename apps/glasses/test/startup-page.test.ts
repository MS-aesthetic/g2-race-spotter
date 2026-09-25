import { describe, expect, it, vi } from 'vitest';

import { buildPage, createStartupPage } from '../src/startup-page.ts';

const PAGE = buildPage({ mode: 'image', status: 'CONNECTING' });

describe('startup page', () => {
  it('creates the four-container page through one guarded call', async () => {
    const bridge = { createStartUpPageContainer: vi.fn(async () => 0) };
    const startPage = createStartupPage(bridge, PAGE, () => undefined);

    await expect(startPage()).resolves.toBe(true);
    await expect(startPage()).resolves.toBe(true);

    expect(bridge.createStartUpPageContainer).toHaveBeenCalledOnce();
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledWith(PAGE);
    expect(PAGE).toEqual({
      containerTotalNum: 4,
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
        expect.objectContaining({ containerID: 2, containerName: 'hud' }),
      ],
    });
  });

  it('lays the page out HUD-top, message under it, status bottom-right', () => {
    // The layout table in the g2-hud-display skill (Maxx design round 3,
    // 2026-09-25): the one image container is the top of the screen.
    const page = buildPage({ mode: 'image', status: 'L S', message: 'BOX' });
    const byId = new Map(
      [...page.textObject, ...(page.imageObject ?? [])].map((container) => [
        container.containerID,
        container,
      ]),
    );

    expect(byId.get(3)).toMatchObject({
      containerName: 'msg',
      xPosition: 16,
      yPosition: 160,
      width: 544,
      height: 90,
      content: 'BOX',
    });
    expect(byId.get(2)).toMatchObject({
      containerName: 'hud',
      xPosition: 144,
      yPosition: 8,
      width: 288,
      height: 144,
    });
    expect(byId.get(4)).toMatchObject({
      containerName: 'status',
      xPosition: 480,
      yPosition: 258,
      width: 80,
      height: 28,
      content: 'L S',
    });

    // Nothing overlaps, and everything stays on the 576x288 canvas.
    for (const id of [2, 3, 4]) {
      const container = byId.get(id)!;
      expect(container.xPosition + container.width).toBeLessThanOrEqual(576);
      expect(container.yPosition + container.height).toBeLessThanOrEqual(288);
    }
    expect(byId.get(2)!.yPosition + byId.get(2)!.height).toBeLessThanOrEqual(
      byId.get(3)!.yPosition,
    );
    expect(byId.get(3)!.yPosition + byId.get(3)!.height).toBeLessThanOrEqual(
      byId.get(4)!.yPosition,
    );
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
