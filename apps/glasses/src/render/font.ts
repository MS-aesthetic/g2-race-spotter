/**
 * A 5×7 bitmap font for text drawn INTO a HUD image (Maxx, 2026-10-01 design
 * round 6: "make text larger and centered, like 3x the current size" — the SDK
 * text container has one fixed font, so in image mode the message is pixels).
 *
 * Upper case, digits, space and `.,-!?/'`. Lower case is drawn upper case;
 * anything else is drawn as `?` — the glasses never show a missing glyph as a
 * gap. Glyph rows are strings, `#` lit and `.` dark, so the table reads as the
 * letters it draws. Nothing here knows where the text goes on the HUD: that is
 * `hud-design.ts`.
 */

import { blitBitmap, type Canvas, type Paint } from './primitives.ts';

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

/** Drawn instead of a character the font does not have. */
export const FALLBACK_CHAR = '?';

/** Appended in place of the last glyph that fits when the text is too wide. */
export const TRUNCATION_CHAR = '.';

export const FONT: Readonly<Record<string, readonly string[]>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '/': ['.....', '....#', '...#.', '..#..', '.#...', '#....', '.....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
};

export interface TextStyle {
  /** Every font pixel becomes a `scale`×`scale` block. */
  readonly scale: number;
  /** Dark pixels between two glyphs (already scaled). */
  readonly gap: number;
}

/** The characters the font will actually draw for `text`. */
export function normaliseText(text: string): string {
  return [...text.toUpperCase()]
    .map((char) => (FONT[char] === undefined ? FALLBACK_CHAR : char))
    .join('');
}

/** The glyph rows for one character (upper-cased; `?` if unknown). */
export function glyphRows(char: string): readonly string[] {
  return FONT[char.toUpperCase()] ?? (FONT[FALLBACK_CHAR] as readonly string[]);
}

/** Width in pixels of `length` glyphs set in `style`; 0 for none. */
export function measureText(length: number, style: TextStyle): number {
  return length <= 0
    ? 0
    : length * GLYPH_WIDTH * style.scale + (length - 1) * style.gap;
}

/**
 * `text` normalised and cut to fit `maxWidth`: if it is too wide, as many
 * glyphs as fit are kept and the last of them becomes `.` so the driver sees
 * that something was cut.
 */
export function fitText(
  text: string,
  maxWidth: number,
  style: TextStyle,
): string {
  const glyphs = [...normaliseText(text)];
  if (measureText(glyphs.length, style) <= maxWidth) {
    return glyphs.join('');
  }

  let fits = 0;
  while (measureText(fits + 1, style) <= maxWidth) {
    fits += 1;
  }

  return fits === 0 ? '' : glyphs.slice(0, fits - 1).join('') + TRUNCATION_CHAR;
}

export interface TextPlacement extends TextStyle {
  /** The text block is centred on this x (half a pixel left for odd widths). */
  readonly centreX: number;
  /** First row of the glyph cells. */
  readonly top: number;
  /** Wider text is truncated ({@link fitText}). */
  readonly maxWidth: number;
}

export interface TextLayout {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where `text` goes for `placement`: the fitted string and its cell box. */
export function layoutText(text: string, placement: TextPlacement): TextLayout {
  const fitted = fitText(text, placement.maxWidth, placement);
  const width = measureText([...fitted].length, placement);
  return {
    text: fitted,
    x: placement.centreX - Math.floor(width / 2),
    y: placement.top,
    width,
    height: GLYPH_HEIGHT * placement.scale,
  };
}

/** Draws `text` centred per `placement`; returns the layout it used. */
export function drawText(
  canvas: Canvas,
  text: string,
  placement: TextPlacement,
  paint: Paint,
): TextLayout {
  const layout = layoutText(text, placement);
  const advance = GLYPH_WIDTH * placement.scale + placement.gap;

  [...layout.text].forEach((char, index) => {
    blitBitmap(
      canvas,
      layout.x + index * advance,
      layout.y,
      glyphRows(char),
      placement.scale,
      paint,
    );
  });

  return layout;
}
