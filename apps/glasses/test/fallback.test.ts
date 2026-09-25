import { describe, expect, it } from 'vitest';

import type {
  ImageSendResult,
  PageContainer,
  TextUpgrade,
} from '../src/bridge.ts';
import { RenderQueue, SEND_FAILED_LIMIT } from '../src/render/queue.ts';
import { renderText } from '../src/render/text.ts';
import { CONTAINER_HUD } from '../src/startup-page.ts';
import { FakeBridge, FakeClock } from './helpers.ts';

function failingQueue(
  result: (index: number) => ImageSendResult,
  modes: string[] = [],
): { bridge: FakeBridge; queue: RenderQueue } {
  const bridge = new FakeBridge();
  const clock = new FakeClock();
  bridge.imageResult = result;
  const queue = new RenderQueue({
    bridge,
    mode: 'image',
    timers: clock.timers,
    now: clock.now,
    log: () => undefined,
    onModeChange: (mode) => modes.push(mode),
  });

  return { bridge, queue };
}

/** 050 AC-5 / R3: three consecutive `sendFailed`, then text mode until restart. */
describe('image send failure fallback', () => {
  it('rebuilds the page in text mode and keeps using textContainerUpgrade', async () => {
    const modes: string[] = [];
    const { bridge, queue } = failingQueue(() => 'sendFailed', modes);

    // The first frame fans out to all four image containers; the first three
    // of those sends fail in a row.
    queue.push({
      kind: 'hud',
      state: { lane: 'bot', cars: [1, 2, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    expect(bridge.callsNamed('updateImageRawData')).toHaveLength(
      SEND_FAILED_LIMIT,
    );
    expect(modes).toEqual(['text']);
    expect(queue.mode).toBe('text');

    const rebuilds = bridge.callsNamed('rebuildPageContainer');
    expect(rebuilds).toHaveLength(1);
    const page = rebuilds[0]?.payload as PageContainer;
    expect(page.imageObject).toBeUndefined();
    expect(page.containerTotalNum).toBe(4);
    expect(page.textObject).toHaveLength(4);
    expect(
      page.textObject.find(
        (container) => container.containerID === CONTAINER_HUD,
      )?.content,
    ).toBe(renderText({ lane: 'bot', cars: [1, 2, 0] }));

    // Every later HUD update is a text upgrade on the same container.
    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [3, 3, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    expect(bridge.callsNamed('updateImageRawData')).toHaveLength(
      SEND_FAILED_LIMIT,
    );
    const upgrades = bridge
      .callsNamed('textContainerUpgrade')
      .map((entry) => entry.payload as TextUpgrade);
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]).toEqual({
      containerID: CONTAINER_HUD,
      containerName: 'hud',
      content: renderText({ lane: 'top', cars: [3, 3, 0] }),
    });
  });

  it('draws the newest HUD state into the rebuilt page', async () => {
    const { bridge, queue } = failingQueue(() => 'sendFailed');
    bridge.paused = true;

    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 0, 0] },
      linkOk: true,
    });
    await Promise.resolve();
    // A newer state lands while the failing sends are still in flight.
    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [0, 3, 0] },
      linkOk: true,
    });
    bridge.paused = false;
    bridge.release();
    await queue.whenIdle();

    const page = bridge.callsNamed('rebuildPageContainer')[0]
      ?.payload as PageContainer;
    expect(
      page.textObject.find(
        (container) => container.containerID === CONTAINER_HUD,
      )?.content,
    ).toBe(renderText({ lane: 'mid', cars: [0, 3, 0] }));
  });

  it('carries the current message and status into the rebuilt page', async () => {
    const { bridge, queue } = failingQueue(() => 'sendFailed');

    queue.push({ kind: 'status', text: 'LINK OK' });
    queue.push({ kind: 'msg', text: 'BOX BOX' });
    await queue.whenIdle();
    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 1, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    const page = bridge.callsNamed('rebuildPageContainer')[0]
      ?.payload as PageContainer;
    const contents = page.textObject.map((container) => container.content);

    expect(contents).toContain('BOX BOX');
    expect(contents).toContain('LINK OK');
  });

  it('counts failures across containers but not across a success', async () => {
    // First frame: TL fails, TR fails, BL succeeds, BR fails — never three in
    // a row, so image mode survives.
    const { bridge, queue } = failingQueue((index) =>
      index === 2 ? 'success' : 'sendFailed',
    );

    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 1, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    expect(bridge.callsNamed('updateImageRawData')).toHaveLength(4);
    expect(bridge.callsNamed('rebuildPageContainer')).toHaveLength(0);
    expect(queue.mode).toBe('image');
    expect(queue.consecutiveSendFailures).toBe(1);
  });

  it('ignores non-sendFailed image errors for the fallback counter', async () => {
    const { bridge, queue } = failingQueue(() => 'imageSizeInvalid');

    for (const lane of ['top', 'mid', 'bot', null] as const) {
      queue.push({
        kind: 'hud',
        state: { lane, cars: [0, 1, 0] },
        linkOk: true,
      });
      await queue.whenIdle();
    }

    expect(bridge.callsNamed('updateImageRawData').length).toBeGreaterThan(
      SEND_FAILED_LIMIT,
    );
    expect(bridge.callsNamed('rebuildPageContainer')).toHaveLength(0);
    expect(queue.mode).toBe('image');
  });
});
