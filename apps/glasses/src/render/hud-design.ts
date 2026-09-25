/**
 * THE HUD LOOK LIVES HERE. This is the only file to edit when the display
 * should look different — `draw-hud.ts` just calls `drawDesign`, and
 * `primitives.ts` is a generic drawing library that knows nothing about racing.
 *
 * To change the look: adjust `DESIGN` (positions, sizes, levels) for a tweak,
 * or rewrite `drawLanes` / `drawCars` with other primitives for a new shape
 * language. The golden ASCII snapshots in `test/draw-hud.test.ts` pin whatever
 * design is current — a deliberate change updates them in the same commit.
 *
 * Layout (Maxx, 2026-09-25 design round 3): the image sits at the TOP of the
 * glasses canvas. Its top row holds the three lane icons at half the round-1
 * size, in track order (▼ left, ▬ middle, ▲ right) — the called one
 * dithered-filled, the other two thin outlines. Its bottom row holds three
 * hollow car-behind bars (left / middle / right), each split into three
 * segments that fill LEFT-TO-RIGHT with `cars[i]`; a bar at level 3 gets the
 * bright alert outline. Every filled area is dithered (`DESIGN.fill`) so the
 * driver is not staring at a solid bright panel.
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

export const HUD_WIDTH = 288;
export const HUD_HEIGHT = 144;

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
   * Lane call along the top edge: three fixed positions so the driver always
   * sees where a call could be, left to right as ▼ ▬ ▲. Half the round-1 size:
   * triangles 30 px tall and 34 px wide, the middle a 40×10 dash.
   */
  lanes: {
    slots: [
      { lane: 'bot', centreX: 48 },
      { lane: 'mid', centreX: 144 },
      { lane: 'top', centreX: 240 },
    ],
    topY: 4,
    bottomY: 34,
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
   * Cars behind along the bottom edge: one hollow bar per `cars` slot, centred
   * under the lane icon of the same side (x centres 48 / 144 / 240). Each bar
   * is three `segmentWidth` cells between 2 px dividers; `cars[i]` fills that
   * many cells LEFT-TO-RIGHT (the same direction as the spotter's segments).
   */
  cars: {
    xs: [5, 101, 197],
    y: 114,
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

/** Composes the current look onto `canvas`. Pure apart from the canvas it fills. */
export function drawDesign(canvas: Canvas, state: HudState): void {
  drawLanes(canvas, state.lane);
  drawCars(canvas, state.cars);
}
