/**
 * Tiny pure drawing library for the 4-bit grey HUD bitmap.
 *
 * Nothing here knows what the HUD looks like — that is `hud-design.ts`. Every
 * op mutates the canvas in place, clips to its bounds and clamps levels to
 * 0..15, so a design can be written without defensive bounds checks.
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

export function createCanvas(width: number, height: number): Canvas {
  return { width, height, data: new Uint8Array(width * height) };
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }

  return Math.max(0, Math.min(MAX_LEVEL, Math.round(level)));
}

export function pixel(
  canvas: Canvas,
  x: number,
  y: number,
  level: number,
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
    return;
  }

  canvas.data[py * canvas.width + px] = clampLevel(level);
}

/** Horizontal run from `x` for `width` pixels on row `y`. */
export function hline(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  level: number,
): void {
  fillRect(canvas, x, y, width, 1, level);
}

/** Vertical run from `y` for `height` pixels on column `x`. */
export function vline(
  canvas: Canvas,
  x: number,
  y: number,
  height: number,
  level: number,
): void {
  fillRect(canvas, x, y, 1, height, level);
}

export function fillRect(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  level: number,
): void {
  const value = clampLevel(level);
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(canvas.width, Math.round(x) + Math.round(width));
  const y1 = Math.min(canvas.height, Math.round(y) + Math.round(height));

  for (let row = y0; row < y1; row += 1) {
    canvas.data.fill(value, row * canvas.width + x0, row * canvas.width + x1);
  }
}

/** Inclusive horizontal span — the shape helpers below think in edges, not widths. */
function span(
  canvas: Canvas,
  xFrom: number,
  xTo: number,
  y: number,
  level: number,
): void {
  const left = Math.round(Math.min(xFrom, xTo));
  const right = Math.round(Math.max(xFrom, xTo));
  fillRect(canvas, left, y, right - left + 1, 1, level);
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

/** Solid triangle through three vertices (scanline, inclusive of the vertices). */
export function fillTriangle(
  canvas: Canvas,
  a: Point,
  b: Point,
  c: Point,
  level: number,
): void {
  const yTop = Math.max(0, Math.round(Math.min(a.y, b.y, c.y)));
  const yBottom = Math.min(
    canvas.height - 1,
    Math.round(Math.max(a.y, b.y, c.y)),
  );

  for (let y = yTop; y <= yBottom; y += 1) {
    const crossings = [edgeX(y, a, b), edgeX(y, b, c), edgeX(y, c, a)].filter(
      (value): value is number => value !== undefined,
    );
    if (crossings.length === 0) {
      continue;
    }

    span(canvas, Math.min(...crossings), Math.max(...crossings), y, level);
  }
}

export function fillCircle(
  canvas: Canvas,
  centre: Point,
  radius: number,
  level: number,
): void {
  const yTop = Math.max(0, Math.round(centre.y - radius));
  const yBottom = Math.min(canvas.height - 1, Math.round(centre.y + radius));

  for (let y = yTop; y <= yBottom; y += 1) {
    const dy = y - centre.y;
    const halfWidth = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    span(canvas, centre.x - halfWidth, centre.x + halfWidth, y, level);
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
