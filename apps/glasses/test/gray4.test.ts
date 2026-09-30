import { describe, expect, it } from 'vitest';

import {
  drawBottomStrip,
  drawTopStrip,
  HALF_WIDTH,
  splitStrip,
  STRIP_HEIGHTS,
} from '../src/render/draw-hud.ts';
import {
  NIBBLE_ORDER,
  pack,
  PACKED_BYTE_LENGTHS,
} from '../src/render/gray4.ts';
import { packContainers } from '../src/render/queue.ts';
import { STRIP_CONTAINERS } from '../src/startup-page.ts';
import {
  COMPRESS_MODE,
  imageRawDataPayload,
} from '../src/render/sdk-quirks.ts';

/** Every image container is one half of a HUD strip: 288×48 on top (the
 * shape the nibble tests use), 288×96 below. */
const WIDTH = HALF_WIDTH;
const HEIGHT = STRIP_HEIGHTS.top;
const STRIDE = WIDTH / 2;

function brightColumn(x: number): Uint8Array {
  const frame = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    frame[y * WIDTH + x] = 15;
  }

  return frame;
}

describe('gray4 packing', () => {
  it('packs each 288x48 top container into 6912 bytes and each 288x96 bottom container into 13824 (050 AC-3)', () => {
    expect(PACKED_BYTE_LENGTHS).toEqual({ top: 6_912, bottom: 13_824 });

    for (const half of splitStrip(drawTopStrip('mid', { linkOk: true }))) {
      const packed = pack(half, { width: WIDTH, height: 48 });
      expect(packed.length).toBe(6_912);
      expect(packed.length).toBe(STRIDE * 48);
    }
    for (const half of splitStrip(
      drawBottomStrip([1, 2, 0], { linkOk: true }),
    )) {
      const packed = pack(half, { width: WIDTH, height: 96 });
      expect(packed.length).toBe(13_824);
      expect(packed.length).toBe(STRIDE * 96);
    }
  });

  it('packs one buffer per image container, keyed by container id', () => {
    const packed = packContainers({ lane: 'top', cars: [0, 2, 0] }, true);

    expect([...packed.keys()]).toEqual(
      STRIP_CONTAINERS.map((container) => container.containerID),
    );
    for (const container of STRIP_CONTAINERS) {
      expect(packed.get(container.containerID)?.length).toBe(
        PACKED_BYTE_LENGTHS[container.strip],
      );
    }
  });

  it('puts a bright column at x=0 in the high nibble of byte 0 of every row of a 288x96 container', () => {
    const frame = new Uint8Array(WIDTH * 96);
    for (let y = 0; y < 96; y += 1) {
      frame[y * WIDTH] = 15;
    }
    const packed = pack(frame, { width: WIDTH, height: 96 });
    for (let y = 0; y < 96; y += 1) {
      expect(packed[y * STRIDE]).toBe(0xf0);
    }
  });

  it('puts a bright column at x=0 in the high nibble of byte 0 of every row', () => {
    // The hardware test pattern of 050 AC-6: if the glasses show this column on
    // the right instead, NIBBLE_ORDER is the thing to flip.
    expect(NIBBLE_ORDER).toBe('high-left');

    const packed = pack(brightColumn(0));
    for (let y = 0; y < HEIGHT; y += 1) {
      expect(packed[y * STRIDE]).toBe(0xf0);
    }
  });

  it('puts x=1 in the low nibble of the same byte', () => {
    const packed = pack(brightColumn(1));

    expect(packed[0]).toBe(0x0f);
    expect(packed[1]).toBe(0x00);
  });

  it('keeps rows in order with a width/2 stride', () => {
    const frame = new Uint8Array(WIDTH * HEIGHT);
    frame[WIDTH * 3] = 9;
    const packed = pack(frame);

    expect(packed[3 * STRIDE]).toBe(0x90);
    expect(packed[2 * STRIDE]).toBe(0);
    expect(packed[4 * STRIDE]).toBe(0);
  });

  it('rejects a frame that is not the declared size', () => {
    expect(() => pack(new Uint8Array(10))).toThrow(/expected 13824/);
  });
});

describe('sdk quirks', () => {
  it('carries the size and the SDK compress mode in one payload builder', () => {
    // (a top container; a bottom one carries imageHeight 96 the same way)
    const imageData = pack(
      splitStrip(drawTopStrip('top', { linkOk: true }))[1],
    );
    const payload = imageRawDataPayload({
      containerID: 5,
      containerName: 'stripTR',
      imageData,
      imageWidth: WIDTH,
      imageHeight: HEIGHT,
    });

    expect(payload).toEqual({
      containerID: 5,
      containerName: 'stripTR',
      imageData,
      imageWidth: 288,
      imageHeight: 48,
      compressMode: COMPRESS_MODE,
    });
  });
});
