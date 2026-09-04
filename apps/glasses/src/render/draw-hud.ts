/**
 * The HUD pipeline: allocate the bitmap, let `hud-design.ts` paint it, halve it
 * when the link is stale. Nothing about the look belongs in this file.
 */

import {
  drawDesign,
  HUD_HEIGHT,
  HUD_WIDTH,
  type HudState,
} from './hud-design.ts';
import { createCanvas, dim } from './primitives.ts';

export { HUD_HEIGHT, HUD_WIDTH, type HudState };

export interface DrawHudOptions {
  /** `false` renders the stale variant (every pixel `>> 1`). */
  readonly linkOk: boolean;
}

/**
 * Pure: same state in, same `Uint8Array(288*144)` of 0..15 out, one byte per
 * pixel. Packing to gray4 is `gray4.ts`'s job.
 */
export function drawHud(state: HudState, options: DrawHudOptions): Uint8Array {
  const canvas = createCanvas(HUD_WIDTH, HUD_HEIGHT);
  drawDesign(canvas, state);

  if (!options.linkOk) {
    dim(canvas);
  }

  return canvas.data;
}
