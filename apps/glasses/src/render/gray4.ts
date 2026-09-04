/**
 * gray4 packing: two 4-bit pixels per byte, high nibble = left pixel, row
 * stride = width / 2 bytes, rows top to bottom.
 *
 * The nibble order is the community convention from the SDK's `image` template
 * and is NOT stated in the docs — spec 050 R4/AC-6 confirms it on hardware with
 * a bright column at x = 0. If the display comes out mirrored, `NIBBLE_ORDER`
 * below is the one thing to flip.
 */

import { HUD_HEIGHT, HUD_WIDTH } from './hud-design.ts';

export const NIBBLE_ORDER: 'high-left' | 'high-right' = 'high-left';

export const PACKED_BYTE_LENGTH = (HUD_WIDTH * HUD_HEIGHT) / 2;

export interface PackOptions {
  readonly width?: number;
  readonly height?: number;
}

/** Packs a one-byte-per-pixel frame of 0..15 values into gray4 bytes. */
export function pack(frame: Uint8Array, options: PackOptions = {}): Uint8Array {
  const width = options.width ?? HUD_WIDTH;
  const height = options.height ?? HUD_HEIGHT;

  if (frame.length !== width * height) {
    throw new Error(
      `frame is ${frame.length} px, expected ${width * height} (${width}x${height})`,
    );
  }
  if (width % 2 !== 0) {
    throw new Error(`width must be even to pack two pixels per byte: ${width}`);
  }

  const stride = width / 2;
  const packed = new Uint8Array(stride * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 2) {
      const left = (frame[y * width + x] as number) & 0x0f;
      const right = (frame[y * width + x + 1] as number) & 0x0f;
      packed[y * stride + x / 2] =
        NIBBLE_ORDER === 'high-left'
          ? (left << 4) | right
          : (right << 4) | left;
    }
  }

  return packed;
}
