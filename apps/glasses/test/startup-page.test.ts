import { describe, expect, it, vi } from 'vitest';

import { createStartupPage, startupPage } from '../src/startup-page';

describe('startup page', () => {
  it('renders Hello, driver through one guarded startup-page call', async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 0),
    };
    const startPage = createStartupPage(bridge);

    await expect(startPage()).resolves.toBe(true);
    await expect(startPage()).resolves.toBe(true);

    expect(bridge.createStartUpPageContainer).toHaveBeenCalledOnce();
    expect(bridge.createStartUpPageContainer).toHaveBeenCalledWith(startupPage);
    expect(startupPage).toEqual({
      containerTotalNum: 1,
      textObject: [
        expect.objectContaining({
          containerID: 1,
          containerName: 'greeting',
          content: 'Hello, driver',
          isEventCapture: 1,
        }),
      ],
    });
  });

  it('does not retry a failed startup-page call', async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn(async () => 1),
    };
    const startPage = createStartupPage(bridge);

    await expect(startPage()).resolves.toBe(false);
    await expect(startPage()).resolves.toBe(false);

    expect(bridge.createStartUpPageContainer).toHaveBeenCalledOnce();
  });
});
