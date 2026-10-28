/**
 * The HUD pipeline: allocate a strip, let `hud-design.ts` paint it, halve it
 * when the link is stale, split it into the two image containers it is shown
 * in. Nothing about the look belongs in this file.
 *
 * Every function here is pure: same input, same `Uint8Array` of 0..15 out,
 * one byte per pixel. Packing to gray4 is `gray4.ts`'s job. Since design
 * round 7 the top strip is the lane icons only and the bottom strip carries
 * the car bars AND the message.
 */

import type { Cars, Lane } from '@g2-race-spotter/protocol';

import {
  drawCarsDesign,
  drawMessageDesign,
  drawTopStripDesign,
  HALF_WIDTH,
  STRIP_HEIGHTS,
  STRIP_WIDTH,
  type HudState,
  type StripId,
} from './hud-design.ts';
import { createCanvas, dim, type Canvas } from './primitives.ts';

export { HALF_WIDTH, STRIP_HEIGHTS, STRIP_WIDTH, type HudState, type StripId };

export interface DrawHudOptions {
  /** `false` renders the stale variant (every pixel `>> 1`). */
  readonly linkOk: boolean;
  /**
   * The message drawn in the bottom strip between the corner Ls (design
   * round 7); `null`/`''` = none. The top strip ignores it.
   */
  readonly message?: string | null;
  /** `false` in the hidden phases of the message blink; default `true`. */
  readonly msgVisible?: boolean;
}

function finish(canvas: Canvas, options: DrawHudOptions): Uint8Array {
  if (!options.linkOk) {
    dim(canvas);
  }

  return canvas.data;
}

/** The top strip, `Uint8Array(576*96)`: the three lane icons, nothing else. */
export function drawTopStrip(
  lane: Lane | null,
  options: Pick<DrawHudOptions, 'linkOk'>,
): Uint8Array {
  const canvas = createCanvas(STRIP_WIDTH, STRIP_HEIGHTS.top);
  drawTopStripDesign(canvas, lane);
  return finish(canvas, options);
}

/**
 * The car bars alone on a 576×144 bottom-strip canvas, at full intensity —
 * the costly part of a frame (the corner-L regions), so the queue keeps the
 * last one and lays each message phase over a copy
 * ({@link composeBottomStrip}).
 */
export function drawCarsLayer(cars: Readonly<Cars>): Uint8Array {
  const canvas = createCanvas(STRIP_WIDTH, STRIP_HEIGHTS.bottom);
  drawCarsDesign(canvas, cars);
  return canvas.data;
}

/**
 * The bottom strip from a {@link drawCarsLayer} result: a copy with the
 * message drawn in, halved when the link is stale. The layer is not touched.
 */
export function composeBottomStrip(
  carsLayer: Uint8Array,
  options: DrawHudOptions,
): Uint8Array {
  const canvas = createCanvas(STRIP_WIDTH, STRIP_HEIGHTS.bottom);
  canvas.data.set(carsLayer);
  drawMessageDesign(
    canvas,
    options.message ?? null,
    options.msgVisible ?? true,
  );
  return finish(canvas, options);
}

/**
 * The bottom strip, `Uint8Array(576*144)`: the three car-behind bars and,
 * between the corner Ls, the message (design round 7).
 */
export function drawBottomStrip(
  cars: Readonly<Cars>,
  options: DrawHudOptions,
): Uint8Array {
  return composeBottomStrip(drawCarsLayer(cars), options);
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
 * so a shape drawn across the seam (▲, the message, the middle bar) shows as
 * one shape.
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

/** One image container's worth of pixels: 288×96 on top, 288×144 below. */
export const HALF_PIXELS: Readonly<Record<StripId, number>> = {
  top: HALF_WIDTH * STRIP_HEIGHTS.top,
  bottom: HALF_WIDTH * STRIP_HEIGHTS.bottom,
};
