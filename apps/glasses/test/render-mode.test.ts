import { describe, expect, it, vi } from 'vitest';

import modeSource from '../src/render/mode.ts?raw';
import { resolveRenderMode } from '../src/render/mode.ts';
import { buildPage, createStartupPage } from '../src/startup-page.ts';
import { STORAGE_KEYS } from '../src/settings.ts';
import { FakeBridge } from './helpers.ts';

/** 030 AC-6 / 050 R6: URL beats the KV override beats image; never the simulator. */
describe('resolveRenderMode', () => {
  it('takes ?render= from the page URL first', () => {
    expect(resolveRenderMode({ search: '?render=text', kv: 'image' })).toBe(
      'text',
    );
    expect(resolveRenderMode({ search: '?render=image', kv: 'text' })).toBe(
      'image',
    );
    expect(resolveRenderMode({ search: '?relay=ws://x&render=text' })).toBe(
      'text',
    );
  });

  it('falls back to the stored override, then to image', () => {
    expect(resolveRenderMode({ kv: 'text' })).toBe('text');
    expect(resolveRenderMode({ kv: 'image' })).toBe('image');
    expect(resolveRenderMode({ kv: null })).toBe('image');
    expect(resolveRenderMode({})).toBe('image');
    expect(resolveRenderMode()).toBe('image');
  });

  it('ignores values that are not a render mode', () => {
    expect(resolveRenderMode({ search: '?render=braille', kv: 'text' })).toBe(
      'text',
    );
    expect(resolveRenderMode({ kv: 'TEXT ' })).toBe('image');
    expect(resolveRenderMode({ search: '?render=', kv: '' })).toBe('image');
  });

  it('stays on image under --mode simulator', () => {
    vi.stubEnv('MODE', 'simulator');
    try {
      expect(resolveRenderMode({})).toBe('image');
      expect(resolveRenderMode({ kv: null })).toBe('image');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('never reads import.meta in code (only the comment explaining why)', () => {
    const code = modeSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toContain('import.meta');
    expect(code).toContain('resolveRenderMode');
  });

  it('reads the override from the documented KV key', () => {
    expect(STORAGE_KEYS.render).toBe('g2rs:v1:render');
  });
});

describe('startup page per render mode', () => {
  it('builds a text container in slot 2 and no image container in text mode', async () => {
    const bridge = new FakeBridge();
    const page = buildPage({ mode: 'text', status: 'CONNECTING', hud: 'o' });

    await createStartupPage(bridge, page, () => undefined)();

    expect(page.imageObject).toBeUndefined();
    expect(page.containerTotalNum).toBe(4);
    expect(page.textObject.map((container) => container.containerID)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(page.textObject[1]).toMatchObject({
      containerID: 2,
      containerName: 'hud',
      xPosition: 144,
      yPosition: 8,
      width: 288,
      height: 144,
      content: 'o',
    });
    expect(bridge.callsNamed('createStartUpPageContainer')[0]?.payload).toBe(
      page,
    );
  });

  it('builds exactly one image container in image mode', () => {
    const page = buildPage({ mode: 'image', status: 'CONNECTING' });

    expect(page.containerTotalNum).toBe(4);
    expect(page.imageObject).toHaveLength(1);
    expect(page.imageObject?.[0]).toMatchObject({
      containerID: 2,
      containerName: 'hud',
      xPosition: 144,
      yPosition: 8,
      width: 288,
      height: 144,
      zOrderIndex: 3,
    });
    expect(page.textObject.map((container) => container.containerID)).toEqual([
      1, 3, 4,
    ]);
  });

  it('gives every container a unique zOrderIndex and one event capture', () => {
    for (const mode of ['image', 'text'] as const) {
      const page = buildPage({ mode, status: 'ROOM ?' });
      const zOrders = [
        ...page.textObject.map((container) => container.zOrderIndex),
        ...(page.imageObject ?? []).map((container) => container.zOrderIndex),
      ];

      expect(new Set(zOrders).size).toBe(zOrders.length);
      expect(zOrders.every((value) => value > 0)).toBe(true);
      expect(
        page.textObject.filter((container) => container.isEventCapture === 1),
      ).toHaveLength(1);
    }
  });

  it('creates the startup page exactly once, whatever the mode', async () => {
    const bridge = new FakeBridge();
    const startPage = createStartupPage(
      bridge,
      buildPage({ mode: 'image', status: 'CONNECTING' }),
      () => undefined,
    );

    await expect(startPage()).resolves.toBe(true);
    await expect(startPage()).resolves.toBe(true);
    await expect(startPage()).resolves.toBe(true);

    expect(bridge.callsNamed('createStartUpPageContainer')).toHaveLength(1);
  });
});
