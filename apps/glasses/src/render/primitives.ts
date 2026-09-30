/**
 * Tiny pure drawing library for the 4-bit grey HUD bitmap.
 *
 * Nothing here knows what the HUD looks like — that is `hud-design.ts`. Every
 * op mutates the canvas in place, clips to its bounds and clamps levels to
 * 0..15, so a design can be written without defensive bounds checks.
 *
 * Every fill takes a {@link Paint}: a flat level, or a {@link Checker} that
 * alternates two levels on a 2x2 grid (the HUD's dither).
 */

export const MAX_LEVEL = 15;

export interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * 2x2 ordered dither: `on` where `(x + y)` is even, `off` where it is odd. One
 * pixel is the finest period this raster can carry, so a large shape reads as
 * an even mid tone on the waveguide instead of a glare panel, and no coarser
 * pattern (a 4x4 Bayer cell, say) leaves visible texture on a 60 px symbol.
 */
export interface Checker {
  readonly on: number;
  readonly off: number;
}

export type Paint = number | Checker;

export function createCanvas(width: number, height: number): Canvas {
  return { width, height, data: new Uint8Array(width * height) };
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }

  return Math.max(0, Math.min(MAX_LEVEL, Math.round(level)));
}

function levelAt(paint: Paint, x: number, y: number): number {
  if (typeof paint === 'number') {
    return clampLevel(paint);
  }

  return clampLevel((x + y) % 2 === 0 ? paint.on : paint.off);
}

export function pixel(
  canvas: Canvas,
  x: number,
  y: number,
  paint: Paint,
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
    return;
  }

  canvas.data[py * canvas.width + px] = levelAt(paint, px, py);
}

/** Horizontal run from `x` for `width` pixels on row `y`. */
export function hline(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  paint: Paint,
): void {
  fillRect(canvas, x, y, width, 1, paint);
}

/** Vertical run from `y` for `height` pixels on column `x`. */
export function vline(
  canvas: Canvas,
  x: number,
  y: number,
  height: number,
  paint: Paint,
): void {
  fillRect(canvas, x, y, 1, height, paint);
}

export function fillRect(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  paint: Paint,
): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(canvas.width, Math.round(x) + Math.round(width));
  const y1 = Math.min(canvas.height, Math.round(y) + Math.round(height));

  if (typeof paint === 'number') {
    const value = clampLevel(paint);
    for (let row = y0; row < y1; row += 1) {
      canvas.data.fill(value, row * canvas.width + x0, row * canvas.width + x1);
    }
    return;
  }

  for (let row = y0; row < y1; row += 1) {
    for (let column = x0; column < x1; column += 1) {
      canvas.data[row * canvas.width + column] = levelAt(paint, column, row);
    }
  }
}

/**
 * Rectangle outline `thickness` pixels wide, inside the `width`×`height` box.
 * Like the other strokes it leaves the interior untouched.
 */
export function strokeRect(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  paint: Paint,
  thickness: number,
): void {
  const t = Math.max(1, Math.min(thickness, width / 2, height / 2));
  fillRect(canvas, x, y, width, t, paint);
  fillRect(canvas, x, y + height - t, width, t, paint);
  fillRect(canvas, x, y + t, t, height - 2 * t, paint);
  fillRect(canvas, x + width - t, y + t, t, height - 2 * t, paint);
}

/** Inclusive horizontal span — the shape helpers below think in edges, not widths. */
function span(
  canvas: Canvas,
  xFrom: number,
  xTo: number,
  y: number,
  paint: Paint,
): void {
  const left = Math.round(Math.min(xFrom, xTo));
  const right = Math.round(Math.max(xFrom, xTo));
  fillRect(canvas, left, y, right - left + 1, 1, paint);
}

function edgeX(y: number, a: Point, b: Point): number | undefined {
  if (a.y === b.y) {
    return undefined;
  }

  const top = a.y < b.y ? a : b;
  const bottom = a.y < b.y ? b : a;
  if (y < top.y || y > bottom.y) {
    return undefined;
  }

  return top.x + ((bottom.x - top.x) * (y - top.y)) / (bottom.y - top.y);
}

interface Span {
  readonly left: number;
  readonly right: number;
}

/** Where row `y` crosses the triangle, or `undefined` if it misses it. */
function triangleSpan(
  y: number,
  a: Point,
  b: Point,
  c: Point,
): Span | undefined {
  const crossings = [edgeX(y, a, b), edgeX(y, b, c), edgeX(y, c, a)].filter(
    (value): value is number => value !== undefined,
  );
  if (crossings.length === 0) {
    return undefined;
  }

  return { left: Math.min(...crossings), right: Math.max(...crossings) };
}

function triangleRows(canvas: Canvas, a: Point, b: Point, c: Point): Span {
  return {
    left: Math.max(0, Math.round(Math.min(a.y, b.y, c.y))),
    right: Math.min(canvas.height - 1, Math.round(Math.max(a.y, b.y, c.y))),
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The same triangle with every edge moved `inset` pixels inward — the vertices
 * scale toward the incentre by `1 - inset / inradius`, which is exactly a
 * parallel offset of all three edges. `undefined` once the triangle closes up.
 */
function insetTriangle(
  a: Point,
  b: Point,
  c: Point,
  inset: number,
): [Point, Point, Point] | undefined {
  const la = distance(b, c);
  const lb = distance(c, a);
  const lc = distance(a, b);
  const perimeter = la + lb + lc;
  if (perimeter === 0) {
    return undefined;
  }

  const area =
    Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  const inradius = (2 * area) / perimeter;
  const scale = 1 - inset / inradius;
  if (!Number.isFinite(scale) || scale <= 0) {
    return undefined;
  }

  const centre: Point = {
    x: (la * a.x + lb * b.x + lc * c.x) / perimeter,
    y: (la * a.y + lb * b.y + lc * c.y) / perimeter,
  };
  const pull = (point: Point): Point => ({
    x: centre.x + (point.x - centre.x) * scale,
    y: centre.y + (point.y - centre.y) * scale,
  });

  return [pull(a), pull(b), pull(c)];
}

/** Solid triangle through three vertices (scanline, inclusive of the vertices). */
export function fillTriangle(
  canvas: Canvas,
  a: Point,
  b: Point,
  c: Point,
  paint: Paint,
): void {
  const rows = triangleRows(canvas, a, b, c);

  for (let y = rows.left; y <= rows.right; y += 1) {
    const row = triangleSpan(y, a, b, c);
    if (row === undefined) {
      continue;
    }

    span(canvas, row.left, row.right, y, paint);
  }
}

/**
 * Triangle outline `thickness` pixels wide, drawn as the difference between the
 * triangle and its inset copy — nothing inside the ring is touched, so an
 * outline may be laid over other content without punching a hole in it.
 */
export function strokeTriangle(
  canvas: Canvas,
  a: Point,
  b: Point,
  c: Point,
  paint: Paint,
  thickness: number,
): void {
  const inner = insetTriangle(a, b, c, thickness);
  if (inner === undefined) {
    fillTriangle(canvas, a, b, c, paint);
    return;
  }

  const rows = triangleRows(canvas, a, b, c);
  for (let y = rows.left; y <= rows.right; y += 1) {
    const outer = triangleSpan(y, a, b, c);
    if (outer === undefined) {
      continue;
    }

    const hole = triangleSpan(y, inner[0], inner[1], inner[2]);
    ringRow(canvas, outer, hole, y, paint);
  }
}

/** One scanline of a ring: the outer span minus the hole it encloses. */
function ringRow(
  canvas: Canvas,
  outer: Span,
  hole: Span | undefined,
  y: number,
  paint: Paint,
): void {
  const left = Math.round(outer.left);
  const right = Math.round(outer.right);
  if (hole === undefined) {
    span(canvas, left, right, y, paint);
    return;
  }

  const holeLeft = Math.round(hole.left);
  const holeRight = Math.round(hole.right);
  if (holeLeft - 1 >= left) {
    span(canvas, left, holeLeft - 1, y, paint);
  }
  if (holeRight + 1 <= right) {
    span(canvas, holeRight + 1, right, y, paint);
  }
}

function circleSpan(
  y: number,
  centre: Point,
  radius: number,
): Span | undefined {
  const dy = y - centre.y;
  if (Math.abs(dy) > radius) {
    return undefined;
  }

  const halfWidth = Math.sqrt(Math.max(0, radius * radius - dy * dy));
  return { left: centre.x - halfWidth, right: centre.x + halfWidth };
}

export function fillCircle(
  canvas: Canvas,
  centre: Point,
  radius: number,
  paint: Paint,
): void {
  const yTop = Math.max(0, Math.round(centre.y - radius));
  const yBottom = Math.min(canvas.height - 1, Math.round(centre.y + radius));

  for (let y = yTop; y <= yBottom; y += 1) {
    const row = circleSpan(y, centre, radius);
    if (row === undefined) {
      continue;
    }

    span(canvas, row.left, row.right, y, paint);
  }
}

/** Ring `thickness` pixels wide; like {@link strokeTriangle}, it leaves the
 * interior untouched. */
export function strokeCircle(
  canvas: Canvas,
  centre: Point,
  radius: number,
  paint: Paint,
  thickness: number,
): void {
  const yTop = Math.max(0, Math.round(centre.y - radius));
  const yBottom = Math.min(canvas.height - 1, Math.round(centre.y + radius));
  const innerRadius = radius - thickness;

  for (let y = yTop; y <= yBottom; y += 1) {
    const outer = circleSpan(y, centre, radius);
    if (outer === undefined) {
      continue;
    }

    const hole =
      innerRadius > 0 ? circleSpan(y, centre, innerRadius) : undefined;
    ringRow(canvas, outer, hole, y, paint);
  }
}

/**
 * A slice of an annulus: every point between `innerRadius` and `outerRadius`
 * of `centre` whose direction lies between `startAngle` and `endAngle`.
 *
 * Angles are in degrees in the usual maths sense on a y-DOWN raster: 0 points
 * right (+x), 90 points UP (-y), counter-clockwise; `endAngle` > `startAngle`
 * and the sweep is at most 180. `edgeInset` moves both straight edges that many
 * pixels inward, parallel to themselves — half of a constant-width gap between
 * neighbouring segments, so a 2 px gap is `edgeInset: 1` on each side.
 */
export interface RingSector {
  readonly centre: Point;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly edgeInset?: number;
}

/** The same sector with all four edges moved `inset` pixels inward. */
export function insetRingSector(sector: RingSector, inset: number): RingSector {
  return {
    ...sector,
    innerRadius: sector.innerRadius + inset,
    outerRadius: sector.outerRadius - inset,
    edgeInset: (sector.edgeInset ?? 0) + inset,
  };
}

/** `cos`/`sin` in degrees, snapped so 0/90/180 come out exact (no 6e-17). */
function unit(degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const snap = (value: number): number =>
    Math.abs(value - Math.round(value)) < 1e-12 ? Math.round(value) : value;
  return { x: snap(Math.cos(radians)), y: snap(Math.sin(radians)) };
}

interface SectorTest {
  readonly start: Point;
  readonly end: Point;
  readonly inner2: number;
  readonly outer2: number;
  readonly edge: number;
  readonly centre: Point;
}

function sectorTest(sector: RingSector): SectorTest | undefined {
  const sweep = sector.endAngle - sector.startAngle;
  if (
    !(sweep > 0 && sweep <= 180) ||
    sector.outerRadius <= Math.max(0, sector.innerRadius)
  ) {
    return undefined;
  }

  const inner = Math.max(0, sector.innerRadius);
  return {
    start: unit(sector.startAngle),
    end: unit(sector.endAngle),
    inner2: inner * inner,
    outer2: sector.outerRadius * sector.outerRadius,
    edge: sector.edgeInset ?? 0,
    centre: sector.centre,
  };
}

/**
 * Whether pixel (x, y) belongs to the sector, judged at the pixel CENTRE
 * (x + 0.5, y + 0.5). Sampling at centres makes a shape and its mirror image
 * about any integer x rasterise to exact mirror pixels, and no pixel can be
 * claimed twice or missed on a shared edge.
 */
function inSector(test: SectorTest, x: number, y: number): boolean {
  const px = x + 0.5 - test.centre.x;
  // Maths orientation: up is +.
  const py = test.centre.y - (y + 0.5);
  const r2 = px * px + py * py;
  if (r2 < test.inner2 || r2 > test.outer2) {
    return false;
  }

  // Signed distance to each straight edge, positive on the inside. For a sweep
  // of at most 180 the wedge is exactly where both are non-negative.
  const fromStart = test.start.x * py - test.start.y * px;
  const fromEnd = px * test.end.y - py * test.end.x;
  return fromStart >= test.edge && fromEnd >= test.edge;
}

function sectorBox(
  canvas: Canvas,
  sector: RingSector,
): { x0: number; y0: number; x1: number; y1: number } {
  const r = Math.ceil(sector.outerRadius) + 1;
  return {
    x0: Math.max(0, Math.floor(sector.centre.x - r)),
    y0: Math.max(0, Math.floor(sector.centre.y - r)),
    x1: Math.min(canvas.width - 1, Math.ceil(sector.centre.x + r)),
    y1: Math.min(canvas.height - 1, Math.ceil(sector.centre.y + r)),
  };
}

/** Solid ring sector (see {@link RingSector}); clips to the canvas. */
export function fillRingSector(
  canvas: Canvas,
  sector: RingSector,
  paint: Paint,
): void {
  const test = sectorTest(sector);
  if (test === undefined) {
    return;
  }

  const box = sectorBox(canvas, sector);
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      if (inSector(test, x, y)) {
        canvas.data[y * canvas.width + x] = levelAt(paint, x, y);
      }
    }
  }
}

/**
 * Ring-sector outline `thickness` pixels wide: the sector minus its copy inset
 * by `thickness` on all four edges. Like the other strokes it leaves the
 * interior untouched; a sector too thin for a hole is filled.
 */
export function strokeRingSector(
  canvas: Canvas,
  sector: RingSector,
  paint: Paint,
  thickness: number,
): void {
  const outer = sectorTest(sector);
  if (outer === undefined) {
    return;
  }

  const hole = sectorTest(insetRingSector(sector, Math.max(1, thickness)));
  const box = sectorBox(canvas, sector);
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      if (
        inSector(outer, x, y) &&
        (hole === undefined || !inSector(hole, x, y))
      ) {
        canvas.data[y * canvas.width + x] = levelAt(paint, x, y);
      }
    }
  }
}

/**
 * Halves every pixel (`v >> 1`). The stale/NO LINK rendering: the shape stays,
 * the intensity obviously does not.
 */
export function dim(canvas: Canvas): void {
  for (let index = 0; index < canvas.data.length; index += 1) {
    canvas.data[index] = (canvas.data[index] as number) >> 1;
  }
}
