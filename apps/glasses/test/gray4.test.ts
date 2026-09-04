import { describe, expect, it } from 'vitest';

import { drawHud, HUD_HEIGHT, HUD_WIDTH } from '../src/render/draw-hud.ts';
import { NIBBLE_ORDER, pack, PACKED_BYTE_LENGTH } from '../src/render/gray4.ts';
import {
  COMPRESS_MODE,
  imageRawDataPayload,
} from '../src/render/sdk-quirks.ts';

const STRIDE = HUD_WIDTH / 2;

function brightColumn(x: number): Uint8Array {
  const frame = new Uint8Array(HUD_WIDTH * HUD_HEIGHT);
  for (let y = 0; y < HUD_HEIGHT; y += 1) {
    frame[y * HUD_WIDTH + x] = 15;
  }

  return frame;
}

describe('gray4 packing', () => {
  it('packs a 288x144 frame into 20736 bytes (050 AC-3)', () => {
    const packed = pack(drawHud({ lane: 'mid', gap: 40 }, { linkOk: true }));

    expect(PACKED_BYTE_LENGTH).toBe(20_736);
    expect(packed.length).toBe(20_736);
    expect(packed.length).toBe(STRIDE * HUD_HEIGHT);
  });

  it('puts a bright column at x=0 in the high nibble of byte 0 of every row', () => {
    // The hardware test pattern of 050 AC-6: if the glasses show this column on
    // the right instead, NIBBLE_ORDER is the thing to flip.
    expect(NIBBLE_ORDER).toBe('high-left');

    const packed = pack(brightColumn(0));
    for (let y = 0; y < HUD_HEIGHT; y += 1) {
      expect(packed[y * STRIDE]).toBe(0xf0);
    }
  });

  it('puts x=1 in the low nibble of the same byte', () => {
    const packed = pack(brightColumn(1));

    expect(packed[0]).toBe(0x0f);
    expect(packed[1]).toBe(0x00);
  });

  it('keeps rows in order with a width/2 stride', () => {
    const frame = new Uint8Array(HUD_WIDTH * HUD_HEIGHT);
    frame[HUD_WIDTH * 3] = 9;
    const packed = pack(frame);

    expect(packed[3 * STRIDE]).toBe(0x90);
    expect(packed[2 * STRIDE]).toBe(0);
    expect(packed[4 * STRIDE]).toBe(0);
  });

  it('rejects a frame that is not the declared size', () => {
    expect(() => pack(new Uint8Array(10))).toThrow(/expected 41472/);
  });
});

describe('sdk quirks', () => {
  it('carries the size and the SDK compress mode in one payload builder', () => {
    const imageData = pack(drawHud({ lane: 'top', gap: 10 }, { linkOk: true }));
    const payload = imageRawDataPayload({
      containerID: 2,
      containerName: 'hud',
      imageData,
      imageWidth: HUD_WIDTH,
      imageHeight: HUD_HEIGHT,
    });

    expect(payload).toEqual({
      containerID: 2,
      containerName: 'hud',
      imageData,
      imageWidth: 288,
      imageHeight: 144,
      compressMode: COMPRESS_MODE,
    });
  });
});
