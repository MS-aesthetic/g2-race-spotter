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
 * Layout (Maxx, 2026-09-30 design rounds 5 and 5b, on the round-4 perimeter layout):
 * the HUD is two STRIPS the full 576-px canvas width — a 576×48 one along the
 * top edge and a 576×96 one along the bottom edge — and the centre of the
 * screen holds only the message. The pinned SDK caps a page at four image
 * containers of at most 288×144, so each strip is drawn once on a virtual
 * canvas and split down the middle (x 288) into two pixel-adjacent image
 * containers (`splitStrip` in `draw-hud.ts`): 288×48 on top, 288×96 below.
 *
 * Top strip — "make left triangle point left, right triangle point right,
 * make middle a triangle pointing up": ◀ at the far left (bottom lane), ▲
 * centred on the seam (middle lane), ▶ at the far right (top lane); the called
 * one solid-filled, the other two thin outlines; round 5b made them larger
 * (42 px along the pointing axis, 42 across (43 lit rows)). On a new call the called icon
 * blinks outline → filled → outline → filled (`LaneStyle`, driven by
 * `blink.ts`).
 *
 * Bottom strip — "bars on the corners with rounded edges … a mix between a
 * banana and an L; middle still a bar but vertical; segments instead of
 * dynamic sliders", then (5b) "flip the corners — the rounded side down towards
 * the corners": LEFT = a rounded L in the bottom-left corner (a quarter ring
 * whose centre is INSIDE the strip, so its curve sits in the corner and its two
 * arms point up the left edge and along the bottom edge), RIGHT = its mirror in
 * the bottom-right corner, MIDDLE = a vertical bar on the seam. Each is three outlined segments with 2 px gaps that fill from the
 * BOTTOM EDGE UP with `cars[i]` (the corner rings from their bottom-edge arm
 * towards their vertical arm — the same direction as the spotter's faders);
 * a bar at level 3 gets the bright alert outline and the dimmer alert fill.
 *
 * Every filled area is a solid level (`DESIGN.fill`, `DESIGN.alertFill`); both
 * are `Paint`s, so a dither can be re-enabled by editing those two values.
 * Coordinates below are STRIP coordinates (x 0..575, y 0..height-1); the
 * strips' place on the canvas is `STRIP_Y`.
 */

import { CAR_LEVEL_MAX, type Cars, type Lane } from '@g2-race-spotter/protocol';

import {
  fillRect,
  fillRingSector,
  fillTriangle,
  insetRingSector,
  strokeRect,
  strokeRingSector,
  strokeTriangle,
  type Canvas,
  type Paint,
  type Point,
  type RingSector,
} from './primitives.ts';

/** The glasses canvas. */
export const CANVAS_WIDTH = 576;
export const CANVAS_HEIGHT = 288;

/** Both strips span the whole canvas width; each is split into two images. */
export const STRIP_WIDTH = CANVAS_WIDTH;
/** Each image container is one half of a strip: 288 wide. */
export const HALF_WIDTH = STRIP_WIDTH / 2;

export type StripId = 'top' | 'bottom';

/** Strip heights: the lane icons need 48 px, the corner rings 96. */
export const STRIP_HEIGHTS: Readonly<Record<StripId, number>> = {
  top: 48,
  bottom: 96,
};

/** Where each strip sits on the canvas (its image containers' `yPosition`). */
export const STRIP_Y: Readonly<Record<StripId, number>> = {
  top: 0,
  bottom: CANVAS_HEIGHT - STRIP_HEIGHTS.bottom,
};

export interface HudState {
  readonly lane: Lane | null;
  /** Cars behind `[left, mid, right]`, each 0..3 (0 = none, 3 = bumper). */
  readonly cars: Readonly<Cars>;
}

/**
 * How the CALLED lane icon is drawn: `filled` normally, `outline` during the
 * hollow phases of the lane-call blink (a bright outline, so the called icon
 * still stands out from the two dim uncalled ones).
 */
export type LaneStyle = 'filled' | 'outline';

export const DESIGN = {
  /**
   * Paint of every filled shape: a SOLID level 15 (Maxx, 2026-09-30: dithering
   * off). `Paint` is `number | {on, off}`, so a 2x2 checkerboard is one edit
   * away — e.g. `{ on: 15, off: 6 }` (the 2026-09-04 look) — and nothing else
   * in the renderer or the tests needs to change.
   */
  fill: 15 as Paint,
  /** Fill of a bar at level 3: solid but dimmer (8), so the bright outline is
   * what the eye catches. Same one-object switch to a dither as `fill`. */
  alertFill: 8 as Paint,
  /**
   * Lane call along the TOP strip (48 tall): three fixed positions so the
   * driver always sees where a call could be. ◀ (bottom lane) and ▶ (top lane)
   * point outwards from the far left and far right, ▲ (middle lane) sits on
   * the seam at x 288, half in each image. Round-5b size (was 30 × 34): 42 px
   * along the direction the triangle points and 42 px between the base
   * vertices (43 lit rows), so the icons span rows 3..45 of the 48 px strip —
   * a 3 px margin above and 2 px below. (44 across would leave 1 px below.)
   */
  lanes: {
    slots: [
      { lane: 'bot', centreX: 51, points: 'left' },
      { lane: 'mid', centreX: 288, points: 'up' },
      { lane: 'top', centreX: 525, points: 'right' },
    ],
    centreY: 24,
    /** Apex to base. */
    length: 42,
    /** Half the base. */
    halfWidth: 21,
    /** The two lanes that were not called: thin, faint, still legible. */
    outlineThickness: 2,
    outlineLevel: 4,
    /** The called lane during an `outline` blink phase: hollow but bright. */
    blinkOutlineLevel: 15,
  },
  /**
   * Cars behind along the BOTTOM strip (96 tall). LEFT and RIGHT are quarter
   * rings centred INSIDE the strip, at local (R, 96 − R) and (576 − R, 96 − R)
   * with R = `outerRadius`, so the outer arc is tangent to the side edge and
   * the bottom edge and the curve sits in the corner; 28 px thick, swept 90°
   * over the quadrant that faces the corner (left: 180°→270°, right:
   * 270°→360°) — a rounded L whose arms point up the side edge and along the
   * bottom edge — and cut into three angular segments with 2 px
   * parallel-sided gaps. MIDDLE is a vertical bar on the seam, three
   * stacked segments with the same gaps. Every segment is its own 2 px outline
   * (level 6) with a 1 px dark gap around its fill.
   */
  cars: {
    corner: {
      innerRadius: 60,
      outerRadius: 88,
    },
    middle: {
      /** Centred on the seam: 14 px in each image. */
      width: 28,
      /** 3 × 27 + 2 × 2. */
      segmentHeight: 27,
      /** Last row of the bottom segment (same 1 px margin as the rings). */
      bottomY: 94,
    },
    /** Between two segments; the rings also keep half of it off the canvas edge. */
    gap: 2,
    outlineThickness: 2,
    outlineLevel: 6,
    /** Dark gap between a segment's outline and its fill. */
    fillInset: 1,
    fillDirection: 'bottom-up',
    /** At this level the bar swaps to the bright outline and dimmer fill. */
    alertLevel: CAR_LEVEL_MAX,
    alertOutlineLevel: 15,
  },
} as const;

type Direction = (typeof DESIGN.lanes.slots)[number]['points'];

/** The three vertices of a lane triangle pointing `direction`. */
function laneTriangle(
  centreX: number,
  direction: Direction,
): [Point, Point, Point] {
  const { centreY, length, halfWidth } = DESIGN.lanes;
  const half = length / 2;

  if (direction === 'up') {
    return [
      { x: centreX, y: centreY - half },
      { x: centreX - halfWidth, y: centreY + half },
      { x: centreX + halfWidth, y: centreY + half },
    ];
  }

  const sign = direction === 'left' ? -1 : 1;
  return [
    { x: centreX + sign * half, y: centreY },
    { x: centreX - sign * half, y: centreY - halfWidth },
    { x: centreX - sign * half, y: centreY + halfWidth },
  ];
}

function drawLanes(
  canvas: Canvas,
  lane: Lane | null,
  laneStyle: LaneStyle,
): void {
  const { outlineThickness, outlineLevel, blinkOutlineLevel } = DESIGN.lanes;

  // Every slot is drawn on every frame: an empty position would be read as "no
  // call there", which is exactly the same picture as "no call at all".
  for (const slot of DESIGN.lanes.slots) {
    const [a, b, c] = laneTriangle(slot.centreX, slot.points);
    if (slot.lane !== lane) {
      strokeTriangle(canvas, a, b, c, outlineLevel, outlineThickness);
    } else if (laneStyle === 'filled') {
      fillTriangle(canvas, a, b, c, DESIGN.fill);
    } else {
      strokeTriangle(canvas, a, b, c, blinkOutlineLevel, outlineThickness);
    }
  }
}

interface Look {
  readonly outline: number;
  readonly fill: Paint;
}

function barLook(level: number): { readonly filled: number } & Look {
  const bar = DESIGN.cars;
  const filled = Math.max(0, Math.min(CAR_LEVEL_MAX, Math.round(level)));
  const alert = filled >= bar.alertLevel;
  return {
    filled,
    outline: alert ? bar.alertOutlineLevel : bar.outlineLevel,
    fill: alert ? DESIGN.alertFill : DESIGN.fill,
  };
}

/**
 * The three segments of a corner ring, bottom-edge arm first. The ring is
 * centred inside the strip at (R, h − R) ('left') or (576 − R, h − R)
 * ('right'), R = outer radius. 'left' sweeps 270°→180° (the bottom-edge arm
 * round to the vertical arm, through the corner); 'right' is its mirror,
 * 270°→360°.
 */
export function cornerSegments(
  side: 'left' | 'right',
  stripHeight: number = STRIP_HEIGHTS.bottom,
): RingSector[] {
  const { corner, gap } = DESIGN.cars;
  const step = 90 / CAR_LEVEL_MAX;
  const centre: Point = {
    x: side === 'left' ? corner.outerRadius : STRIP_WIDTH - corner.outerRadius,
    y: stripHeight - corner.outerRadius,
  };

  return Array.from({ length: CAR_LEVEL_MAX }, (_, index) => {
    // Sweep measured from the bottom-edge arm round to the vertical arm.
    const from = index * step;
    const to = from + step;
    return {
      centre,
      innerRadius: corner.innerRadius,
      outerRadius: corner.outerRadius,
      startAngle: side === 'left' ? 270 - to : 270 + from,
      endAngle: side === 'left' ? 270 - from : 270 + to,
      edgeInset: gap / 2,
    };
  });
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The three segments of the vertical middle bar, bottom first. */
export function middleSegments(): Rect[] {
  const { middle, gap } = DESIGN.cars;
  const x = HALF_WIDTH - middle.width / 2;

  return Array.from({ length: CAR_LEVEL_MAX }, (_, index) => ({
    x,
    y: middle.bottomY + 1 - (index + 1) * middle.segmentHeight - index * gap,
    width: middle.width,
    height: middle.segmentHeight,
  }));
}

function drawCorner(
  canvas: Canvas,
  side: 'left' | 'right',
  level: number,
): void {
  const bar = DESIGN.cars;
  const look = barLook(level);

  cornerSegments(side, canvas.height).forEach((segment, index) => {
    strokeRingSector(canvas, segment, look.outline, bar.outlineThickness);
    if (index < look.filled) {
      fillRingSector(
        canvas,
        insetRingSector(segment, bar.outlineThickness + bar.fillInset),
        look.fill,
      );
    }
  });
}

function drawMiddle(canvas: Canvas, level: number): void {
  const bar = DESIGN.cars;
  const look = barLook(level);
  const inset = bar.outlineThickness + bar.fillInset;

  middleSegments().forEach((segment, index) => {
    strokeRect(
      canvas,
      segment.x,
      segment.y,
      segment.width,
      segment.height,
      look.outline,
      bar.outlineThickness,
    );
    if (index < look.filled) {
      fillRect(
        canvas,
        segment.x + inset,
        segment.y + inset,
        segment.width - 2 * inset,
        segment.height - 2 * inset,
        look.fill,
      );
    }
  });
}

function drawCars(canvas: Canvas, cars: Readonly<Cars>): void {
  drawCorner(canvas, 'left', cars[0] ?? 0);
  drawMiddle(canvas, cars[1] ?? 0);
  drawCorner(canvas, 'right', cars[2] ?? 0);
}

/** Paints the lane icons onto a 576×48 top-strip canvas. Pure apart from it. */
export function drawTopStripDesign(
  canvas: Canvas,
  lane: Lane | null,
  laneStyle: LaneStyle = 'filled',
): void {
  drawLanes(canvas, lane, laneStyle);
}

/** Paints the three car bars onto a 576×96 bottom-strip canvas. */
export function drawBottomStripDesign(
  canvas: Canvas,
  cars: Readonly<Cars>,
): void {
  drawCars(canvas, cars);
}
