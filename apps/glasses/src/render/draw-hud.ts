/**
 * The HUD pipeline: allocate a strip, let `hud-design.ts` paint it, halve it
 * when the link is stale, split it into the two image containers it is shown
 * in. Nothing about the look belongs in this file.
 *
 * Every function here is pure: same input, same `Uint8Array` of 0..15 out,
 * one byte per pixel. Packing to gray4 is `gray4.ts`'s job.
 */

import type { Cars, Lane } from '@g2-race-spotter/protocol';

import {
  drawBottomStripDesign,
  drawTopStripDesign,
  HALF_WIDTH,
  STRIP_HEIGHT,
  STRIP_WIDTH,
  type HudState,
} from './hud-design.ts';
import { createCanvas, dim, type Canvas } from './primitives.ts';

export { HALF_WIDTH, STRIP_HEIGHT, STRIP_WIDTH, type HudState };

export interface DrawHudOptions {
  /** `false` renders the stale variant (every pixel `>> 1`). */
  readonly linkOk: boolean;
}

function finish(canvas: Canvas, options: DrawHudOptions): Uint8Array {
  if (!options.linkOk) {
    dim(canvas);
  }

  return canvas.data;
}

/** The top strip, `Uint8Array(576*48)`: the three lane icons. */
export function drawTopStrip(
  lane: Lane | null,
  options: DrawHudOptions,
): Uint8Array {
  const canvas = createCanvas(STRIP_WIDTH, STRIP_HEIGHT);
  drawTopStripDesign(canvas, lane);
  return finish(canvas, options);
}

/** The bottom strip, `Uint8Array(576*48)`: the three car-behind bars. */
export function drawBottomStrip(
  cars: Readonly<Cars>,
  options: DrawHudOptions,
): Uint8Array {
  const canvas = createCanvas(STRIP_WIDTH, STRIP_HEIGHT);
  drawBottomStripDesign(canvas, cars);
  return finish(canvas, options);
}

export interface Strips {
  readonly top: Uint8Array;
  readonly bottom: Uint8Array;
}

/** Both strips for one room state. */
export function drawStrips(state: HudState, options: DrawHudOptions): Strips {
  return {
    top: drawTopStrip(state.lane, options),
    bottom: drawBottomStrip(state.cars, options),
  };
}

/**
 * Splits a 576-px-wide strip down x 288 into its left and right image
 * containers (`288*height` each). The halves are pixel-adjacent on the glasses,
 * so a shape drawn across the seam (▬, the middle bar) shows as one shape.
 */
export function splitStrip(
  strip: Uint8Array,
  width: number = STRIP_WIDTH,
): readonly [Uint8Array, Uint8Array] {
  if (width % 2 !== 0 || strip.length % width !== 0) {
    throw new Error(
      `strip of ${strip.length} px does not split into two halves of width ${width / 2}`,
    );
  }

  const half = width / 2;
  const height = strip.length / width;
  const left = new Uint8Array(half * height);
  const right = new Uint8Array(half * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    left.set(strip.subarray(row, row + half), y * half);
    right.set(strip.subarray(row + half, row + width), y * half);
  }

  return [left, right];
}

/** One image container's worth of pixels: `Uint8Array(288*48)`. */
export const HALF_PIXELS = HALF_WIDTH * STRIP_HEIGHT;
