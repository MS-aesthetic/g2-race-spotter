import { describe, expect, it } from 'vitest';

import type { PageContainer, TextUpgrade } from '../src/bridge.ts';
import { RenderQueue, SEND_FAILED_LIMIT } from '../src/render/queue.ts';
import { renderText } from '../src/render/text.ts';
import { CONTAINER_HUD } from '../src/startup-page.ts';
import { FakeBridge, FakeClock } from './helpers.ts';

/** 050 AC-5 / R3: three consecutive `sendFailed`, then text mode until restart. */
describe('image send failure fallback', () => {
  it('rebuilds the page in text mode and keeps using textContainerUpgrade', async () => {
    const bridge = new FakeBridge();
    const clock = new FakeClock();
    const modes: string[] = [];
    bridge.imageResult = () => 'sendFailed';
    const queue = new RenderQueue({
      bridge,
      mode: 'image',
      timers: clock.timers,
      now: clock.now,
      log: () => undefined,
      onModeChange: (mode) => modes.push(mode),
    });

    // Three lane changes so each HUD job bypasses the gap debounce.
    for (const lane of ['top', 'mid', 'bot'] as const) {
      queue.push({
        kind: 'hud',
        state: { lane, side: null, gap: 40 },
        linkOk: true,
      });
      await queue.whenIdle();
    }

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
    expect(
      page.textObject.find(
        (container) => container.containerID === CONTAINER_HUD,
      )?.content,
    ).toBe(renderText({ lane: 'bot', side: null, gap: 40 }));

    // Every later HUD update is a text upgrade on the same container.
    queue.push({
      kind: 'hud',
      state: { lane: 'top', side: null, gap: 90 },
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
      content: renderText({ lane: 'top', side: null, gap: 90 }),
    });
  });

  it('carries the current message and status into the rebuilt page', async () => {
    const bridge = new FakeBridge();
    const clock = new FakeClock();
    bridge.imageResult = () => 'sendFailed';
    const queue = new RenderQueue({
      bridge,
      mode: 'image',
      timers: clock.timers,
      now: clock.now,
      log: () => undefined,
    });

    queue.push({ kind: 'status', text: 'LINK OK' });
    queue.push({ kind: 'msg', text: 'BOX BOX' });
    for (const lane of ['top', 'mid', 'bot'] as const) {
      queue.push({
        kind: 'hud',
        state: { lane, side: null, gap: 10 },
        linkOk: true,
      });
      await queue.whenIdle();
    }

    const page = bridge.callsNamed('rebuildPageContainer')[0]
      ?.payload as PageContainer;
    const contents = page.textObject.map((container) => container.content);

    expect(contents).toContain('BOX BOX');
    expect(contents).toContain('LINK OK');
  });

  it('does not fall back when the failures are not consecutive', async () => {
    const bridge = new FakeBridge();
    const clock = new FakeClock();
    // fail, fail, succeed, fail — never three in a row.
    bridge.imageResult = (index) => (index === 2 ? 'success' : 'sendFailed');
    const queue = new RenderQueue({
      bridge,
      mode: 'image',
      timers: clock.timers,
      now: clock.now,
      log: () => undefined,
    });

    for (const lane of ['top', 'mid', 'bot', null] as const) {
      queue.push({
        kind: 'hud',
        state: { lane, side: null, gap: 10 },
        linkOk: true,
      });
      await queue.whenIdle();
    }

    expect(bridge.callsNamed('rebuildPageContainer')).toHaveLength(0);
    expect(queue.mode).toBe('image');
    expect(queue.consecutiveSendFailures).toBe(1);
  });

  it('ignores non-sendFailed image errors for the fallback counter', async () => {
    const bridge = new FakeBridge();
    const clock = new FakeClock();
    bridge.imageResult = () => 'imageSizeInvalid';
    const queue = new RenderQueue({
      bridge,
      mode: 'image',
      timers: clock.timers,
      now: clock.now,
      log: () => undefined,
    });

    for (const lane of ['top', 'mid', 'bot', null] as const) {
      queue.push({
        kind: 'hud',
        state: { lane, side: null, gap: 10 },
        linkOk: true,
      });
      await queue.whenIdle();
    }

    expect(bridge.callsNamed('rebuildPageContainer')).toHaveLength(0);
    expect(queue.mode).toBe('image');
  });
});
