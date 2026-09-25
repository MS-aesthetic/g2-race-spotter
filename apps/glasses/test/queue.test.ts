import { HUD_GAP_FLUSH_MS } from '@g2-race-spotter/protocol';
import { describe, expect, it } from 'vitest';

import {
  CONTAINER_HUD,
  CONTAINER_MSG,
  CONTAINER_STATUS,
} from '../src/startup-page.ts';
import { RenderQueue } from '../src/render/queue.ts';
import { renderText } from '../src/render/text.ts';
import type { TextUpgrade } from '../src/bridge.ts';
import {
  burstCars,
  collectLogs,
  FakeBridge,
  FakeClock,
  flush,
} from './helpers.ts';

function textQueue(): {
  bridge: FakeBridge;
  clock: FakeClock;
  queue: RenderQueue;
  entries: ReturnType<typeof collectLogs>['entries'];
} {
  const bridge = new FakeBridge();
  const clock = new FakeClock();
  const { log, entries } = collectLogs();
  const queue = new RenderQueue({
    bridge,
    mode: 'text',
    timers: clock.timers,
    now: clock.now,
    log,
  });

  return { bridge, clock, queue, entries };
}

function hudUpgrades(bridge: FakeBridge): TextUpgrade[] {
  return bridge
    .callsNamed('textContainerUpgrade')
    .map((entry) => entry.payload as TextUpgrade)
    .filter((payload) => payload.containerID === CONTAINER_HUD);
}

describe('render queue', () => {
  it('coalesces 10 cars states in 250 ms into one HUD send, last wins (030 AC-3)', async () => {
    const { bridge, clock, queue } = textQueue();

    // Prime with a lane call so the burst below is a pure cars burst.
    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 0, 0] },
      linkOk: true,
    });
    await queue.whenIdle();
    expect(hudUpgrades(bridge)).toHaveLength(1);

    for (let index = 1; index <= 10; index += 1) {
      queue.push({
        kind: 'hud',
        state: { lane: 'top', cars: burstCars(index) },
        linkOk: true,
      });
      await clock.advance(25);
    }

    expect(clock.ms).toBe(250);
    await queue.whenIdle();

    const sends = hudUpgrades(bridge).slice(1);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.content).toBe(
      renderText({ lane: 'top', cars: burstCars(10) }),
    );
  });

  it('lets a lane change bypass the debounce', async () => {
    const { bridge, clock, queue } = textQueue();

    queue.push({
      kind: 'hud',
      state: { lane: null, cars: [0, 1, 0] },
      linkOk: true,
    });
    await queue.whenIdle();
    await clock.advance(10);

    queue.push({
      kind: 'hud',
      state: { lane: null, cars: [0, 2, 0] },
      linkOk: true,
    });
    await queue.whenIdle();
    expect(hudUpgrades(bridge)).toHaveLength(1);

    queue.push({
      kind: 'hud',
      state: { lane: 'bot', cars: [0, 2, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    const sends = hudUpgrades(bridge);
    expect(sends).toHaveLength(2);
    expect(sends[1]?.content).toBe(
      renderText({ lane: 'bot', cars: [0, 2, 0] }),
    );
    expect(clock.ms).toBeLessThan(HUD_GAP_FLUSH_MS);
  });

  it('sends a link-state change immediately as well', async () => {
    const { bridge, clock, queue } = textQueue();

    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [1, 1, 1] },
      linkOk: true,
    });
    await queue.whenIdle();
    await clock.advance(5);

    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [1, 1, 1] },
      linkOk: false,
    });
    await queue.whenIdle();

    expect(hudUpgrades(bridge)).toHaveLength(2);
  });

  it('replaces a pending HUD job instead of queueing behind it', async () => {
    const { bridge, clock, queue } = textQueue();

    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 0, 0] },
      linkOk: true,
    });
    await queue.whenIdle();

    for (const cars of [
      [0, 1, 0],
      [0, 2, 0],
      [1, 1, 1],
    ] as const) {
      queue.push({
        kind: 'hud',
        state: { lane: 'top', cars },
        linkOk: true,
      });
    }
    await clock.advance(HUD_GAP_FLUSH_MS);
    await queue.whenIdle();

    const sends = hudUpgrades(bridge);
    expect(sends).toHaveLength(2);
    expect(sends[1]?.content).toBe(
      renderText({ lane: 'top', cars: [1, 1, 1] }),
    );
  });

  it('routes msg to container 3 and status to container 4', async () => {
    const { bridge, queue } = textQueue();

    queue.push({ kind: 'msg', text: 'BOX THIS LAP' });
    queue.push({ kind: 'status', text: 'NO LINK' });
    await queue.whenIdle();

    const upgrades = bridge
      .callsNamed('textContainerUpgrade')
      .map((entry) => entry.payload as TextUpgrade);

    expect(upgrades).toEqual([
      {
        containerID: CONTAINER_MSG,
        containerName: 'msg',
        content: 'BOX THIS LAP',
      },
      {
        containerID: CONTAINER_STATUS,
        containerName: 'status',
        content: 'NO LINK',
      },
    ]);
    expect(bridge.callsNamed('rebuildPageContainer')).toHaveLength(0);
  });

  it('keeps one bridge call in flight and coalesces what arrives meanwhile', async () => {
    const { bridge, clock, queue } = textQueue();

    bridge.paused = true;
    queue.push({
      kind: 'hud',
      state: { lane: 'top', cars: [0, 0, 0] },
      linkOk: true,
    });
    await flush();
    expect(bridge.calls).toHaveLength(1);

    // Three more HUD states and a message while the first call is unresolved.
    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [1, 0, 0] },
      linkOk: true,
    });
    queue.push({
      kind: 'hud',
      state: { lane: 'mid', cars: [2, 0, 0] },
      linkOk: true,
    });
    queue.push({ kind: 'msg', text: 'PIT' });
    await flush();
    expect(bridge.calls).toHaveLength(1);

    bridge.paused = false;
    bridge.release();
    await clock.advance(HUD_GAP_FLUSH_MS);
    await queue.whenIdle();

    const sends = hudUpgrades(bridge);
    expect(sends).toHaveLength(2);
    expect(sends[1]?.content).toBe(
      renderText({ lane: 'mid', cars: [2, 0, 0] }),
    );
    expect(bridge.callsNamed('textContainerUpgrade')).toHaveLength(3);
  });

  it('times and logs every bridge call (030 R7)', async () => {
    const { bridge, clock, queue, entries } = textQueue();

    bridge.paused = true;
    queue.push({ kind: 'status', text: 'CONNECTING' });
    await flush();
    await clock.advance(12);
    bridge.paused = false;
    bridge.release();
    await queue.whenIdle();

    expect(entries).toEqual([
      {
        call: 'textContainerUpgrade',
        ms: 12,
        result: true,
        container: 'status',
      },
    ]);
  });

  it('survives a bridge call that rejects', async () => {
    const { bridge, queue, entries } = textQueue();
    bridge.textContainerUpgrade = async () => {
      throw new Error('bridge exploded');
    };

    queue.push({ kind: 'status', text: 'NO LINK' });
    queue.push({ kind: 'msg', text: 'still draining' });
    await queue.whenIdle();

    expect(entries).toHaveLength(2);
    expect(entries[0]?.result).toMatchObject({ error: expect.any(Error) });
  });
});
