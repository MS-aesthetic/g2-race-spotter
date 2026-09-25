/**
 * THE HUD LOOK LIVES HERE. This is the only file to edit when the display
 * should look different — `draw-hud.ts` just calls the two
 * `draw…StripDesign` functions below, and `primitives.ts` is a generic drawing
 * library that knows nothing about racing.
 *
 * To change the look: adjust `DESIGN` (positions, sizes, levels) for a tweak,
 * or rewrite `drawLanes` / `drawCars` with other primitives for a new shape
 * language. The golden ASCII snapshots in `test/draw-hud.test.ts` pin whatever
 * design is current — a deliberate change updates them in the same commit.
 *
 * Layout (Maxx, 2026-09-25 design round 4 — "I want the icons to be close to
 * the perimeter so it's not directly in line of sight. Separate the bars on
 * the glasses. Use corners on the glasses, then the top border and bottom
 * borders for the 'middle' icons."): the HUD is two 576×48 STRIPS, one
 * along the top edge of the glasses canvas and one along the bottom edge, and
 * the centre of the screen stays empty. The pinned SDK caps a page at four
 * image containers of at most 288×144, so each strip is drawn once on a
 * virtual 576-px-wide canvas and split down the middle (x 288) into two
 * pixel-adjacent 288×48 image containers (`splitStrip` in `draw-hud.ts`).
 *
 * Top strip: the three lane icons in track order — ▼ in the top-left corner,
 * ▬ centred on the seam, ▲ in the top-right corner — the called one
 * dithered-filled, the other two thin outlines. Bottom strip: three hollow
 * car-behind bars — LEFT in the bottom-left corner, MIDDLE centred on the
 * seam, RIGHT in the bottom-right corner — each split into three segments that
 * fill LEFT-TO-RIGHT with `cars[i]`; a bar at level 3 gets the bright alert
 * outline. Every filled area is dithered (`DESIGN.fill`) so the driver is not
 * staring at a solid bright panel. Coordinates below are strip coordinates
 * (x 0..575, y 0..47); the strips' place on the canvas is `STRIP_Y`.
 */

import { CAR_LEVEL_MAX, type Cars, type Lane } from '@g2-race-spotter/protocol';

import {
  fillRect,
  fillTriangle,
  strokeRect,
  strokeTriangle,
  type Canvas,
  type Paint,
} from './primitives.ts';

/** The glasses canvas. */
export const CANVAS_WIDTH = 576;
export const CANVAS_HEIGHT = 288;

/** One strip spans the whole canvas width; it is split into two images. */
export const STRIP_WIDTH = CANVAS_WIDTH;
export const STRIP_HEIGHT = 48;
/** Each image container is one half of a strip: 288×48. */
export const HALF_WIDTH = STRIP_WIDTH / 2;

export type StripId = 'top' | 'bottom';

/** Where each strip sits on the canvas (its image containers' `yPosition`). */
export const STRIP_Y: Readonly<Record<StripId, number>> = {
  top: 0,
  bottom: CANVAS_HEIGHT - STRIP_HEIGHT,
};

export interface HudState {
  readonly lane: Lane | null;
  /** Cars behind `[left, mid, right]`, each 0..3 (0 = none, 3 = bumper). */
  readonly cars: Readonly<Cars>;
}

export const DESIGN = {
  /** 2x2 checkerboard used for every filled shape — half the glare, same size. */
  fill: { on: 15, off: 6 },
  /** Fill of a bar at level 3: same dither, dimmer, so the bright outline is
   * what the eye catches. */
  alertFill: { on: 8, off: 3 },
  /**
   * Lane call along the TOP strip: three fixed positions so the driver always
   * sees where a call could be, left to right as ▼ ▬ ▲. ▼ and ▲ sit in the
   * corners, ▬ is centred on the seam at x 288 (half in each image). Same size
   * as design round 3: triangles 30 px tall and 34 px wide, the middle a 40×10
   * dash.
   */
  lanes: {
    slots: [
      { lane: 'bot', centreX: 51 },
      { lane: 'mid', centreX: 288 },
      { lane: 'top', centreX: 525 },
    ],
    topY: 9,
    bottomY: 39,
    /** Triangles: half the base width. */
    halfWidth: 17,
    /** `mid` is a dash, so it can never be mistaken for either arrow. */
    dashWidth: 40,
    dashHeight: 10,
    /** The two lanes that were not called: thin, faint, still legible. */
    outlineThickness: 2,
    outlineLevel: 4,
  },
  /**
   * Cars behind along the BOTTOM strip: one hollow bar per `cars` slot, each
   * under the lane icon of the same side (x centres 51 / 288 / 525) — LEFT in
   * the corner, MIDDLE straddling the seam, RIGHT in the other corner. Each bar
   * is three `segmentWidth` cells between 2 px dividers; `cars[i]` fills that
   * many cells LEFT-TO-RIGHT (the same direction as the spotter's segments).
   */
  cars: {
    xs: [8, 245, 482],
    y: 10,
    /** 2 + 3 × 26 + 2 × 2 + 2: outline, three cells, two dividers. */
    width: 86,
    height: 28,
    outlineThickness: 2,
    outlineLevel: 6,
    segmentWidth: 26,
    /** Dark gap between a cell's walls and its fill. */
    fillInset: 1,
    fillDirection: 'left-to-right',
    /** At this level the bar swaps to the bright outline and dimmer fill. */
    alertLevel: CAR_LEVEL_MAX,
    alertOutlineLevel: 15,
  },
} as const;

const LANE_SLOTS: ReadonlyArray<{
  readonly lane: Lane;
  readonly centreX: number;
}> = DESIGN.lanes.slots;

function laneShape(
  canvas: Canvas,
  lane: Lane,
  centreX: number,
  active: boolean,
): void {
  const { topY, bottomY, halfWidth, dashWidth, dashHeight, outlineThickness } =
    DESIGN.lanes;
  const paint: Paint = active ? DESIGN.fill : DESIGN.lanes.outlineLevel;

  if (lane === 'mid') {
    const x = centreX - dashWidth / 2;
    const y = Math.round((topY + bottomY - dashHeight) / 2);
    if (active) {
      fillRect(canvas, x, y, dashWidth, dashHeight, paint);
    } else {
      strokeRect(canvas, x, y, dashWidth, dashHeight, paint, outlineThickness);
    }
    return;
  }

  // `top` points up (apex at the top row), `bot` points down.
  const apex =
    lane === 'top' ? { x: centreX, y: topY } : { x: centreX, y: bottomY };
  const baseY = lane === 'top' ? bottomY : topY;
  const left = { x: centreX - halfWidth, y: baseY };
  const right = { x: centreX + halfWidth, y: baseY };

  if (active) {
    fillTriangle(canvas, apex, left, right, paint);
    return;
  }

  strokeTriangle(canvas, apex, left, right, paint, outlineThickness);
}

function drawLanes(canvas: Canvas, lane: Lane | null): void {
  // Every slot is drawn on every frame: an empty position would be read as "no
  // call there", which is exactly the same picture as "no call at all".
  for (const slot of LANE_SLOTS) {
    laneShape(canvas, slot.lane, slot.centreX, slot.lane === lane);
  }
}

function drawCarBar(canvas: Canvas, x: number, level: number): void {
  const bar = DESIGN.cars;
  const filled = Math.max(0, Math.min(CAR_LEVEL_MAX, Math.round(level)));
  const alert = filled >= bar.alertLevel;
  const outline = alert ? bar.alertOutlineLevel : bar.outlineLevel;
  const fill: Paint = alert ? DESIGN.alertFill : DESIGN.fill;
  const wall = bar.outlineThickness;

  strokeRect(canvas, x, bar.y, bar.width, bar.height, outline, wall);

  const innerY = bar.y + wall;
  const innerHeight = bar.height - 2 * wall;
  for (let cell = 0; cell < CAR_LEVEL_MAX; cell += 1) {
    const cellX = x + wall + cell * (bar.segmentWidth + wall);
    if (cell > 0) {
      // The divider in front of this cell is part of the outline.
      fillRect(canvas, cellX - wall, innerY, wall, innerHeight, outline);
    }
    if (cell < filled) {
      fillRect(
        canvas,
        cellX + bar.fillInset,
        innerY + bar.fillInset,
        bar.segmentWidth - 2 * bar.fillInset,
        innerHeight - 2 * bar.fillInset,
        fill,
      );
    }
  }
}

function drawCars(canvas: Canvas, cars: Readonly<Cars>): void {
  DESIGN.cars.xs.forEach((x, index) => {
    drawCarBar(canvas, x, cars[index] ?? 0);
  });
}

/** Paints the lane icons onto a 576×48 top-strip canvas. Pure apart from it. */
export function drawTopStripDesign(canvas: Canvas, lane: Lane | null): void {
  drawLanes(canvas, lane);
}

/** Paints the three car bars onto a 576×48 bottom-strip canvas. */
export function drawBottomStripDesign(
  canvas: Canvas,
  cars: Readonly<Cars>,
): void {
  drawCars(canvas, cars);
}
