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
