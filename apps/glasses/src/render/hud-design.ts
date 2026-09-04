/**
 * THE HUD LOOK LIVES HERE. This is the only file to edit when the display
 * should look different — `draw-hud.ts` just calls `drawDesign`, and
 * `primitives.ts` is a generic drawing library that knows nothing about racing.
 *
 * To change the look: adjust `DESIGN` (positions, levels, thresholds) for a
 * tweak, or rewrite `drawSymbol` / `drawBar` with other primitives for a new
 * shape language (e.g. triangles built from bar segments). The golden ASCII
 * snapshots in `test/draw-hud.test.ts` pin whatever design is current — a
 * deliberate change updates them in the same commit.
 */

import type { Lane } from '@g2-race-spotter/protocol';

import {
  fillCircle,
  fillRect,
  fillTriangle,
  vline,
  type Canvas,
} from './primitives.ts';

export const HUD_WIDTH = 288;
export const HUD_HEIGHT = 144;

export interface HudState {
  readonly lane: Lane | null;
  readonly gap: number;
}

export const DESIGN = {
  /** Lane symbol: one glanceable shape, vertically above the bar. */
  symbol: {
    centreX: 144,
    /** Triangles: apex row, base row, and half the base width. */
    apexY: 6,
    baseY: 92,
    halfWidth: 60,
    /** `mid` is a disc rather than a triangle so the three lanes never blur. */
    circleCentreY: 49,
    circleRadius: 42,
    level: 15,
  },
  /** Car-behind bar: outline, fill proportional to `gap`, three ticks. */
  bar: {
    x: 0,
    y: 108,
    width: 288,
    height: 32,
    outlineThickness: 2,
    outlineLevel: 6,
    fillInset: 3,
    fillY: 111,
    fillHeight: 26,
    fillLevel: 15,
    tickXs: [72, 144, 216],
    tickLevel: 3,
    /** At/above this gap the bar inverts: bright outline, dimmer fill. */
    alertGap: 90,
    alertOutlineLevel: 15,
    alertFillLevel: 8,
  },
} as const;

function drawSymbol(canvas: Canvas, lane: Lane | null): void {
  const {
    centreX,
    apexY,
    baseY,
    halfWidth,
    circleCentreY,
    circleRadius,
    level,
  } = DESIGN.symbol;

  if (lane === 'top') {
    fillTriangle(
      canvas,
      { x: centreX, y: apexY },
      { x: centreX - halfWidth, y: baseY },
      { x: centreX + halfWidth, y: baseY },
      level,
    );
    return;
  }

  if (lane === 'bot') {
    fillTriangle(
      canvas,
      { x: centreX - halfWidth, y: apexY },
      { x: centreX + halfWidth, y: apexY },
      { x: centreX, y: baseY },
      level,
    );
    return;
  }

  if (lane === 'mid') {
    fillCircle(canvas, { x: centreX, y: circleCentreY }, circleRadius, level);
  }

  // lane === null draws nothing: an empty symbol region is the "no call" state.
}

function drawBar(canvas: Canvas, gap: number): void {
  const bar = DESIGN.bar;
  const alert = gap >= bar.alertGap;
  const outlineLevel = alert ? bar.alertOutlineLevel : bar.outlineLevel;
  const fillLevel = alert ? bar.alertFillLevel : bar.fillLevel;
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
    fillLevel,
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

/** Composes the current look onto `canvas`. Pure apart from the canvas it fills. */
export function drawDesign(canvas: Canvas, state: HudState): void {
  drawSymbol(canvas, state.lane);
  drawBar(canvas, state.gap);
}
