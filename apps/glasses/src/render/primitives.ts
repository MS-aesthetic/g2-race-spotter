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
 * Halves every pixel (`v >> 1`). The stale/NO LINK rendering: the shape stays,
 * the intensity obviously does not.
 */
export function dim(canvas: Canvas): void {
  for (let index = 0; index < canvas.data.length; index += 1) {
    canvas.data[index] = (canvas.data[index] as number) >> 1;
  }
}
