/**
 * THE HUD LOOK LIVES HERE. This is the only file to edit when the display
 * should look different — `draw-hud.ts` just calls `drawDesign`, and
 * `primitives.ts` is a generic drawing library that knows nothing about racing.
 *
 * To change the look: adjust `DESIGN` (positions, levels, thresholds) for a
 * tweak, or rewrite `drawLanes` / `drawBar` / `drawSide` with other primitives
 * for a new shape language. The golden ASCII snapshots in
 * `test/draw-hud.test.ts` pin whatever design is current — a deliberate change
 * updates them in the same commit.
 *
 * Layout (Maxx, 2026-09-04): three lane slots across the top in track order
 * (▼ left, ● middle, ▲ right) with the called one filled and the other two
 * left as faint outlines; the car-behind bar across the middle; a ◀ or ▶ in
 * the bottom band when a car is trying to pass. Every filled area is dithered
 * (`DESIGN.fill`) so the driver is not staring at a solid bright panel.
 */

import type { Lane, Side } from '@g2-race-spotter/protocol';

import {
  fillCircle,
  fillRect,
  fillTriangle,
  strokeCircle,
  strokeTriangle,
  vline,
  type Canvas,
  type Paint,
} from './primitives.ts';

export const HUD_WIDTH = 288;
export const HUD_HEIGHT = 144;

export interface HudState {
  readonly lane: Lane | null;
  /** A car alongside: `inside` → ◀, `outside` → ▶, `null` → nothing. */
  readonly side: Side | null;
  readonly gap: number;
}

export const DESIGN = {
  /** 2x2 checkerboard used for every filled shape — half the glare, same size. */
  fill: { on: 15, off: 6 },
  /** Bar fill above `bar.alertGap`: same dither, dimmer, so the bright
   * outline is what the eye catches. */
  alertFill: { on: 8, off: 3 },
  /**
   * Lane call: three fixed positions so the driver always sees where the call
   * could be, left to right as ▼ ● ▲.
   */
  lanes: {
    slots: [
      { lane: 'bot', centreX: 48 },
      { lane: 'mid', centreX: 144 },
      { lane: 'top', centreX: 240 },
    ],
    topY: 6,
    bottomY: 66,
    /** Triangles: half the base width. */
    halfWidth: 34,
    /** `mid` is a disc rather than a triangle so the three lanes never blur. */
    circleRadius: 30,
    /** The two lanes that were not called: thin, faint, still legible. */
    outlineThickness: 2,
    outlineLevel: 4,
  },
  /** Car-behind bar: outline, dithered fill proportional to `gap`, three ticks. */
  bar: {
    x: 0,
    y: 76,
    width: 288,
    height: 32,
    outlineThickness: 2,
    outlineLevel: 6,
    fillInset: 3,
    fillY: 79,
    fillHeight: 26,
    tickXs: [72, 144, 216],
    tickLevel: 3,
    /** At/above this gap the bar inverts: bright outline, dimmer fill. */
    alertGap: 90,
    alertOutlineLevel: 15,
  },
  /** Pass warning: an arrow hard against the edge the car is on. */
  side: {
    y: 112,
    height: 30,
    /** Point-to-base length; the apex sits `margin` from the canvas edge. */
    length: 34,
    margin: 4,
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
  const { topY, bottomY, halfWidth, circleRadius, outlineThickness } =
    DESIGN.lanes;
  const paint: Paint = active ? DESIGN.fill : DESIGN.lanes.outlineLevel;

  if (lane === 'mid') {
    const centre = { x: centreX, y: (topY + bottomY) / 2 };
    if (active) {
      fillCircle(canvas, centre, circleRadius, paint);
    } else {
      strokeCircle(canvas, centre, circleRadius, paint, outlineThickness);
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

function drawBar(canvas: Canvas, gap: number): void {
  const bar = DESIGN.bar;
  const alert = gap >= bar.alertGap;
  const outlineLevel = alert ? bar.alertOutlineLevel : bar.outlineLevel;
  const fillPaint: Paint = alert ? DESIGN.alertFill : DESIGN.fill;
  const thickness = bar.outlineThickness;

  fillRect(canvas, bar.x, bar.y, bar.width, thickness, outlineLevel);
  fillRect(
    canvas,
    bar.x,
    bar.y + bar.height - thickness,
    bar.width,
    thickness,
    outlineLevel,
  );
  fillRect(canvas, bar.x, bar.y, thickness, bar.height, outlineLevel);
  fillRect(
    canvas,
    bar.x + bar.width - thickness,
    bar.y,
    thickness,
    bar.height,
    outlineLevel,
  );

  const trackWidth = bar.width - 2 * bar.fillInset;
  const clamped = Math.max(0, Math.min(100, gap));
  const fillWidth = Math.round((trackWidth * clamped) / 100);
  fillRect(
    canvas,
    bar.x + bar.fillInset,
    bar.fillY,
    fillWidth,
    bar.fillHeight,
    fillPaint,
  );

  // Ticks mark the quarters, but only where the fill has not reached yet:
  // inside the fill they would read as gaps in a solid bar.
  const fillEnd = bar.x + bar.fillInset + fillWidth;
  for (const tickX of bar.tickXs) {
    if (tickX >= fillEnd) {
      vline(canvas, tickX, bar.fillY, bar.fillHeight, bar.tickLevel);
    }
  }
}

function drawSide(canvas: Canvas, side: Side | null): void {
  if (side === null) {
    return;
  }

  const { y, height, length, margin } = DESIGN.side;
  const centreY = y + height / 2;
  const apexX = side === 'inside' ? margin : HUD_WIDTH - 1 - margin;
  const baseX =
    side === 'inside' ? margin + length : HUD_WIDTH - 1 - margin - length;

  fillTriangle(
    canvas,
    { x: apexX, y: centreY },
    { x: baseX, y },
    { x: baseX, y: y + height },
    DESIGN.fill,
  );
}

/** Composes the current look onto `canvas`. Pure apart from the canvas it fills. */
export function drawDesign(canvas: Canvas, state: HudState): void {
  drawLanes(canvas, state.lane);
  drawBar(canvas, state.gap);
  drawSide(canvas, state.side);
}
