/**
 * THE HUD LOOK LIVES HERE. This is the only file to edit when the display
 * should look different — `draw-hud.ts` just calls the two
 * `draw…StripDesign` functions below, and `primitives.ts` / `font.ts` are
 * generic drawing code that knows nothing about racing.
 *
 * To change the look: adjust `DESIGN` (positions, sizes, levels) for a tweak,
 * or rewrite `drawLanes` / `drawMessage` / `drawCars` with other primitives
 * for a new shape language. The golden ASCII snapshots in
 * `test/draw-hud.test.ts` pin whatever design is current — a deliberate change
 * updates them in the same commit.
 *
 * Layout (Maxx, 2026-10-01 design round 6, approved mock
 * `docs/reviews/hud-design-round6.png`, on the round-4 perimeter layout): the
 * HUD is two STRIPS the full 576-px canvas width — a 576×96 one along the top
 * edge and a 576×144 one along the bottom edge — and the middle band of the
 * screen (canvas y 96–143) holds only the `status` letters on the right
 * border. The pinned SDK caps a page at four image containers of at most
 * 288×144, so each strip is drawn once on a virtual canvas and split down the
 * middle (x 288) into two pixel-adjacent image containers (`splitStrip` in
 * `draw-hud.ts`): 288×96 on top, 288×144 (the SDK maximum) below.
 *
 * Top strip, rows 3–45 — ◀ at the far left (bottom lane), ▲ centred on the
 * seam (middle lane), ▶ at the far right (top lane), 42 px along the pointing
 * axis and 42 across (43 lit rows); the called one solid, the other two thin
 * outlines. On a new call the called icon blinks outline/filled every 500 ms
 * for 4 s (`LaneStyle`, driven by `blink.ts`).
 * Top strip, rows 51–92 — the MESSAGE ("put text upper middle below the top
 * rectangle … larger and centered, like 3x the current size … blink every
 * second for 5 seconds"): a 5×7 bitmap font (`font.ts`) drawn ×6 (30×42-px
 * glyphs, 6-px gaps) centred on x 288 under the ▲, truncated with a `.` when
 * it would not fit the strip. `msgVisible: false` (the hidden phases of
 * `msg-blink.ts`) leaves the rows dark.
 *
 * Bottom strip — "I want the curved things like it was before … extend the
 * bars touching the bottom and sides … make bottom middle bar shorter and
 * corner bars longer & taller but same width … expands from the center out":
 * LEFT = an L flush with the left and bottom edges (both arms 136 long, 28
 * thick) whose inner elbow is a concave fillet of radius 60, RIGHT = its pixel
 * mirror, each cut into three EQUAL-AREA segments (bottom arm, elbow, side arm
 * — filled in that order by `cars[i]`) by two straight cuts through the
 * fillet centre, 2 px parallel-sided gaps, every segment its own 2 px outline
 * with the fill 1 px inside it. MIDDLE = one horizontal 180×28 bar on the seam,
 * a 2 px outline and two 2 px dividers making cells 70 / 40 / 70, whose fill
 * grows from the centre out: 40, 110, 180 px for 1, 2, 3 cars, the dividers
 * staying visible over it. A bar at level 3 gets the bright alert outline and
 * the dimmer alert fill.
 *
 * Equal-area cuts (`DESIGN.cars.corner.cutAngles`): both cuts are rays from
 * the fillet centre, angles in the maths sense (0 = +x, 90 = up) on the LEFT
 * L. The L is symmetric about the 225° diagonal through its outer corner, so
 * the cuts are 225 ± δ and the two arm segments are mirror images of each
 * other — equal by construction. `equalAreaCutAngles()` finds δ by bisection
 * on the RASTERISED segments (the pixels `regionArea` counts, gaps excluded)
 * until the elbow segment holds as many pixels as an arm segment, and rounds
 * it to 0.01°: δ = 17.02°, 2 482 px per segment — equal INCLUDING the
 * outlines; the fills are 1 810 / 1 932 / 1 810 px (elbow ~7 % more). The
 * result is RECORDED in `DESIGN` rather than searched at run time (the
 * search costs ~30–60 ms in Node, more in the phone's WebView, on the first
 * frame), and
 * `test/draw-hud.test.ts` re-runs the search and requires the recorded
 * angles to equal it — change the L's size and that test prints the new
 * angles to record.
 *
 * Every filled area is a solid level (`DESIGN.fill`, `DESIGN.alertFill`); both
 * are `Paint`s, so a dither can be re-enabled by editing those two values.
 * Coordinates below are STRIP coordinates (x 0..575, y 0..height-1); the
 * strips' place on the canvas is `STRIP_Y`.
 */

import { CAR_LEVEL_MAX, type Cars, type Lane } from '@g2-race-spotter/protocol';

import { drawText, type TextLayout } from './font.ts';
import {
  fillRect,
  fillRegion,
  fillTriangle,
  regionArea,
  strokeRect,
  strokeRegion,
  strokeTriangle,
  type Canvas,
  type Paint,
  type Point,
  type Region,
} from './primitives.ts';

/** The glasses canvas. */
export const CANVAS_WIDTH = 576;
export const CANVAS_HEIGHT = 288;

/** Both strips span the whole canvas width; each is split into two images. */
export const STRIP_WIDTH = CANVAS_WIDTH;
/** Each image container is one half of a strip: 288 wide. */
export const HALF_WIDTH = STRIP_WIDTH / 2;

export type StripId = 'top' | 'bottom';

/** Strip heights: lane icons + message need 96 px, the corner Ls 144. */
export const STRIP_HEIGHTS: Readonly<Record<StripId, number>> = {
  top: 96,
  bottom: 144,
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
   * Lane call along the TOP strip: three fixed positions so the driver always
   * sees where a call could be. ◀ (bottom lane) and ▶ (top lane) point
   * outwards from the far left and far right, ▲ (middle lane) sits on the seam
   * at x 288, half in each image. 42 px along the direction the triangle
   * points and 42 px between the base vertices (43 lit rows): rows 3..45.
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
   * The message, in the TOP strip under the ▲: 5×7 font ×6 = 30×42-px glyphs
   * with 6-px gaps (16 characters fit the 576-px strip), cell rows 51..92 —
   * 5 px below the lane icons, 3 px above the strip's bottom edge.
   */
  message: {
    centreX: HALF_WIDTH,
    top: 51,
    scale: 6,
    gap: 6,
    maxWidth: STRIP_WIDTH,
    level: 15,
  },
  /**
   * Cars behind along the BOTTOM strip (144 tall). LEFT and RIGHT: an L flush
   * with the side and bottom edges, both arms `armLength` long and `thickness`
   * thick, the inner elbow a concave fillet of `filletRadius` centred at
   * (thickness + r, 144 − thickness − r) = (88, 56) / mirror (488, 56); three
   * equal-area segments (see the header). MIDDLE: one 180×28 bar centred on
   * the seam, bottom row 139 (4 px above the strip bottom), cells 70/40/70.
   */
  cars: {
    corner: {
      armLength: 136,
      thickness: 28,
      filletRadius: 60,
      /**
       * `[arm | elbow, elbow | side arm]`, left-L degrees: 225 ± 17.02 —
       * recorded from `equalAreaCutAngles()` (see the header). The segments
       * are equal INCLUDING their outlines (2 482 px each); the fills inside
       * them are not: 1 810 / 1 932 / 1 810 px — the elbow's fill is ~7 %
       * larger, because its outline runs along the short inner fillet arc.
       * Kept deliberately (hud-qa, T063): whole-segment equality is the
       * decision.
       */
      cutAngles: [242.02, 207.98],
    },
    middle: {
      width: 180,
      height: 28,
      /** Last row of the bar. */
      bottomY: 139,
      /** Cell widths left to right, measured between divider centre lines. */
      cells: [70, 40, 70],
      /** Fill width for 1, 2, 3 cars, centred on the seam. */
      fillWidths: [40, 110, 180],
    },
    /** Between two corner segments (parallel-sided). */
    gap: 2,
    /** Outline of every segment, the middle bar and its dividers. */
    outlineThickness: 2,
    outlineLevel: 6,
    /** Dark gap between an outline (or divider) and the fill. */
    fillInset: 1,
    fillDirection: { corner: 'bottom-arm-first', middle: 'centre-out' },
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

/** Draws the message centred under the ▲; returns where it went. */
export function drawMessage(canvas: Canvas, text: string): TextLayout {
  return drawText(canvas, text, DESIGN.message, DESIGN.message.level);
}

interface Look {
  readonly filled: number;
  readonly outline: number;
  readonly fill: Paint;
}

function barLook(level: number): Look {
  const bar = DESIGN.cars;
  const filled = Math.max(0, Math.min(CAR_LEVEL_MAX, Math.round(level)));
  const alert = filled >= bar.alertLevel;
  return {
    filled,
    outline: alert ? bar.alertOutlineLevel : bar.outlineLevel,
    fill: alert ? DESIGN.alertFill : DESIGN.fill,
  };
}

export type CornerSide = 'left' | 'right';

/** Centre of the elbow fillet of the LEFT L (the right one is its mirror). */
export function cornerFilletCentre(
  stripHeight: number = STRIP_HEIGHTS.bottom,
): Point {
  const { thickness, filletRadius } = DESIGN.cars.corner;
  return {
    x: thickness + filletRadius,
    y: stripHeight - thickness - filletRadius,
  };
}

/** Pixel box of the corner L on `side` (inclusive). */
function cornerBox(
  side: CornerSide,
  stripHeight: number,
): Pick<Region, 'x0' | 'y0' | 'x1' | 'y1'> {
  const { armLength } = DESIGN.cars.corner;
  return {
    x0: side === 'left' ? 0 : STRIP_WIDTH - armLength,
    y0: stripHeight - armLength,
    x1: side === 'left' ? armLength - 1 : STRIP_WIDTH - 1,
    y1: stripHeight - 1,
  };
}

/**
 * Whether the point (x, y) — LEFT-L strip coordinates, y down — is inside the
 * whole L shrunk by `inset`. The L is its bounding box (`armLength` square in
 * the corner) minus the region within `filletRadius` of the quarter plane
 * {x ≥ cx, y ≤ cy} (cx, cy = the fillet centre): that region is the inner
 * corner with its elbow rounded, and staying `inset` farther from it is
 * exactly an inward offset of the L, fillet included.
 */
function inCornerL(
  x: number,
  y: number,
  inset: number,
  stripHeight: number,
  centre: Point,
): boolean {
  const { armLength, filletRadius } = DESIGN.cars.corner;
  if (
    x < inset ||
    x > armLength - inset ||
    y > stripHeight - inset ||
    y < stripHeight - armLength + inset
  ) {
    return false;
  }

  const dx = Math.max(0, centre.x - x);
  const dy = Math.max(0, y - centre.y);
  const reach = filletRadius + inset;
  return dx * dx + dy * dy >= reach * reach;
}

/** Signed distance of (x, y) from the line through `centre` at `angle`, as a function. */
function cutLine(
  centre: Point,
  angle: number,
): (x: number, y: number) => number {
  // Once per cut, not per pixel: the region tests run ~20 000 times a strip.
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Maths orientation (y up): positive when the point is counter-clockwise
  // of the ray.
  return (x, y) => cos * (centre.y - y) - sin * (x - centre.x);
}

/**
 * The three segments of the corner L on `side` for the given cut angles
 * (`[arm|elbow, elbow|side arm]`, left-L degrees), bottom-edge arm first.
 */
function cornerRegions(
  side: CornerSide,
  cuts: readonly [number, number],
  stripHeight: number,
): Region[] {
  const centre = cornerFilletCentre(stripHeight);
  const box = cornerBox(side, stripHeight);
  const half = DESIGN.cars.gap / 2;
  const [armCut, sideCut] = cuts;
  const fromArmCut = cutLine(centre, armCut);
  const fromSideCut = cutLine(centre, sideCut);
  // Ordered by angle along the L: the side arm (< sideCut), the elbow
  // (between), the bottom arm (> armCut).
  const tests: Array<(x: number, y: number, edge: number) => boolean> = [
    (x, y, edge) => fromArmCut(x, y) >= edge,
    (x, y, edge) => fromSideCut(x, y) >= edge && -fromArmCut(x, y) >= edge,
    (x, y, edge) => -fromSideCut(x, y) >= edge,
  ];

  return tests.map((cut) => ({
    ...box,
    inside: (px, py, inset) => {
      // The right L is the left one mirrored about the seam: evaluate it at
      // the mirrored point, so the two are pixel-exact mirror images.
      const x = side === 'left' ? px : STRIP_WIDTH - px;
      return (
        inCornerL(x, py, inset, stripHeight, centre) && cut(x, py, half + inset)
      );
    },
  }));
}

/**
 * Searches the two equal-area cut angles of the corner L, `[arm|elbow,
 * elbow|side arm]` in left-L degrees: 225 ± δ (see the header for the
 * method). Deterministic; the app draws with the recorded
 * `DESIGN.cars.corner.cutAngles`, which a test holds equal to this.
 */
export function equalAreaCutAngles(
  stripHeight: number = STRIP_HEIGHTS.bottom,
): readonly [number, number] {
  const axis = 225;
  const box = cornerBox('left', stripHeight);
  const width = box.x1 + 1;
  // Elbow pixels minus arm pixels: grows with δ (the elbow wedge widens).
  const imbalance = (delta: number): number => {
    const [arm, elbow] = cornerRegions(
      'left',
      [axis + delta, axis - delta],
      stripHeight,
    );
    return (
      regionArea(elbow!, width, stripHeight) -
      regionArea(arm!, width, stripHeight)
    );
  };

  let low = 0;
  let high = 45;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (imbalance(middle) < 0) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const best =
    Math.abs(imbalance(low)) <= Math.abs(imbalance(high)) ? low : high;
  const delta = Math.round(best * 100) / 100;
  return [axis + delta, axis - delta];
}

/**
 * The three segments of the corner L on `side`, bottom-edge arm first, then
 * the elbow, then the arm up the side edge — the order `cars[i]` fills them.
 */
export function cornerSegments(
  side: CornerSide,
  stripHeight: number = STRIP_HEIGHTS.bottom,
): Region[] {
  return cornerRegions(side, DESIGN.cars.corner.cutAngles, stripHeight);
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MiddleBar extends Rect {
  /** First column of each 2-px divider, left to right. */
  readonly dividers: readonly number[];
}

/** The horizontal middle bar on the seam: its rect and divider columns. */
export function middleBar(): MiddleBar {
  const { middle, outlineThickness } = DESIGN.cars;
  const x = HALF_WIDTH - middle.width / 2;
  const dividers: number[] = [];
  let edge = 0;
  for (const cell of middle.cells.slice(0, -1)) {
    edge += cell;
    // Centred on the cell boundary: half the divider on each side of it.
    dividers.push(x + edge - outlineThickness / 2);
  }

  return {
    x,
    y: middle.bottomY - middle.height + 1,
    width: middle.width,
    height: middle.height,
    dividers,
  };
}

/** Columns `[from, to]` (inclusive) the fill reaches for `level` cars. */
export function middleFillSpan(
  level: number,
): { readonly from: number; readonly to: number } | undefined {
  const width = DESIGN.cars.middle.fillWidths[level - 1];
  if (width === undefined) {
    return undefined;
  }

  return { from: HALF_WIDTH - width / 2, to: HALF_WIDTH + width / 2 - 1 };
}

function drawCorner(canvas: Canvas, side: CornerSide, level: number): void {
  const bar = DESIGN.cars;
  const look = barLook(level);

  cornerSegments(side, canvas.height).forEach((segment, index) => {
    strokeRegion(canvas, segment, look.outline, bar.outlineThickness);
    if (index < look.filled) {
      fillRegion(
        canvas,
        segment,
        look.fill,
        bar.outlineThickness + bar.fillInset,
      );
    }
  });
}

function drawMiddle(canvas: Canvas, level: number): void {
  const { outlineThickness: t, fillInset } = DESIGN.cars;
  const look = barLook(level);
  const bar = middleBar();
  const inset = t + fillInset;

  strokeRect(canvas, bar.x, bar.y, bar.width, bar.height, look.outline, t);

  const span = middleFillSpan(look.filled);
  if (span !== undefined) {
    const from = Math.max(span.from, bar.x + inset);
    const to = Math.min(span.to, bar.x + bar.width - 1 - inset);
    fillRect(
      canvas,
      from,
      bar.y + inset,
      to - from + 1,
      bar.height - 2 * inset,
      look.fill,
    );
  }

  // Dividers on top of the fill, each with the same dark gap either side as
  // the outline has, so the cells read even when the bar is full.
  for (const x of bar.dividers) {
    fillRect(
      canvas,
      x - fillInset,
      bar.y + t,
      t + 2 * fillInset,
      bar.height - 2 * t,
      0,
    );
    fillRect(canvas, x, bar.y + t, t, bar.height - 2 * t, look.outline);
  }
}

function drawCars(canvas: Canvas, cars: Readonly<Cars>): void {
  drawCorner(canvas, 'left', cars[0] ?? 0);
  drawMiddle(canvas, cars[1] ?? 0);
  drawCorner(canvas, 'right', cars[2] ?? 0);
}

/**
 * Paints the lane icons and (when given and visible) the message onto a
 * 576×96 top-strip canvas. Pure apart from it.
 */
export function drawTopStripDesign(
  canvas: Canvas,
  lane: Lane | null,
  laneStyle: LaneStyle = 'filled',
  message: string | null = null,
  msgVisible = true,
): void {
  drawLanes(canvas, lane, laneStyle);
  if (message !== null && message !== '' && msgVisible) {
    drawMessage(canvas, message);
  }
}

/** Paints the three car bars onto a 576×144 bottom-strip canvas. */
export function drawBottomStripDesign(
  canvas: Canvas,
  cars: Readonly<Cars>,
): void {
  drawCars(canvas, cars);
}
