/**
 * A 5×7 bitmap font for text drawn INTO a HUD image (Maxx, 2026-10-01 design
 * round 6: "make text larger and centered, like 3x the current size" — the SDK
 * text container has one fixed font, so in image mode the message is pixels).
 *
 * Upper case, digits, space and `.,-!?/'`. Lower case is drawn upper case;
 * anything else is drawn as `?` — the glasses never show a missing glyph as a
 * gap. Since design round 7 (2026-10-28) a text may also be set as a block of
 * up to `maxLines` lines ({@link wrapText}): its own line breaks if it has
 * any, otherwise word-wrapped to the width it is given. Glyph rows are strings, `#` lit and `.` dark, so the table reads as the
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
 * that something was cut. A space left in front of the `.` is dropped
 * (`"SLOW DOWN, CAR."`, not `"SLOW DOWN, CAR ."`).
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

  return fits === 0
    ? ''
    : glyphs
        .slice(0, fits - 1)
        .join('')
        .trimEnd() + TRUNCATION_CHAR;
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

/** Splits on every line break (`\r\n`, `\r`, `\n`); other whitespace → ' '. */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).map((line) => line.replace(/\s/g, ' '));
}

/** A line normalised for the font, its runs of spaces collapsed. */
function normaliseLine(line: string): string {
  return normaliseText(line)
    .split(' ')
    .filter((word) => word !== '')
    .join(' ');
}

/**
 * `text` as at most `maxLines` lines that each fit `maxWidth` (Maxx, design
 * round 7, 2026-10-28: the phone sends texts like `"GO LOW\nEXIT"` — the
 * action, then the corner phase):
 *
 * 1. split on every line break (`\r\n`, `\r`, `\n`) and turn any other
 *    whitespace (a tab, …) into a space BEFORE normalising, because
 *    {@link normaliseText} turns any character the font lacks — `\n`
 *    included — into `?`; then normalise each line, collapse runs of spaces
 *    and drop blank lines;
 * 2. two or more lines left: the line breaks ARE the layout — line 1 stays
 *    line 1, line 2 stays line 2, each cut on its own by {@link fitText}
 *    (`"PULLING AWAY\nEXIT"` → `PULLING.` / `EXIT`); nothing is word-wrapped
 *    across them. Lines past `maxLines` join the last line with spaces
 *    before it is cut (`"A\nB\nC"` → `A` / `B C`);
 * 3. one line left (no line break in the message): word-wrap it greedily on
 *    spaces into at most `maxLines` lines — everything that does not fit the
 *    earlier lines joins the last one — and cut every line still too wide (a
 *    single word longer than the width, the joined overflow) by
 *    {@link fitText}, ending in `.`.
 *
 * `[]` for a text with nothing to draw.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  style: TextStyle,
  maxLines: number,
): string[] {
  const limit = Math.max(1, Math.floor(maxLines));
  const keep = (lines: readonly string[]): string[] =>
    (lines.length > limit
      ? [...lines.slice(0, limit - 1), lines.slice(limit - 1).join(' ')]
      : [...lines]
    ).map((line) => fitText(line, maxWidth, style));

  const explicit = splitLines(text)
    .map(normaliseLine)
    .filter((line) => line !== '');
  if (explicit.length !== 1) {
    return keep(explicit);
  }

  const fits = (line: string): boolean =>
    measureText([...line].length, style) <= maxWidth;
  const wrapped: string[] = [];
  let current = '';
  for (const word of (explicit[0] as string).split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || fits(candidate)) {
      current = candidate;
    } else {
      wrapped.push(current);
      current = word;
    }
  }
  wrapped.push(current);
  return keep(wrapped);
}

export interface TextBlockPlacement extends TextPlacement {
  /** Dark rows between two lines. */
  readonly lineGap: number;
  /** Lines the block may hold; the band is sized for this many. */
  readonly maxLines: number;
}

export interface TextBlockLayout {
  /** One layout per line, top to bottom; empty for no text. */
  readonly lines: readonly TextLayout[];
}

/** Height of `count` lines set in `placement`, gaps included; 0 for none. */
export function measureTextBlock(
  count: number,
  placement: Pick<TextBlockPlacement, 'scale' | 'lineGap'>,
): number {
  return count <= 0
    ? 0
    : count * GLYPH_HEIGHT * placement.scale + (count - 1) * placement.lineGap;
}

/**
 * Where a block of text goes: {@link wrapText}'s lines, each centred on
 * `centreX`, the block centred vertically in the band that starts at `top`
 * and is {@link measureTextBlock}(`maxLines`) tall (half a pixel up for an
 * odd remainder). A full block starts at `top`.
 */
export function layoutTextBlock(
  text: string,
  placement: TextBlockPlacement,
): TextBlockLayout {
  const lines = wrapText(
    text,
    placement.maxWidth,
    placement,
    placement.maxLines,
  );
  const band = measureTextBlock(placement.maxLines, placement);
  const block = measureTextBlock(lines.length, placement);
  const top = placement.top + Math.floor((band - block) / 2);
  const advance = GLYPH_HEIGHT * placement.scale + placement.lineGap;

  return {
    lines: lines.map((line, index) =>
      layoutText(line, { ...placement, top: top + index * advance }),
    ),
  };
}

/** Draws a block of text per `placement`; returns the layout it used. */
export function drawTextBlock(
  canvas: Canvas,
  text: string,
  placement: TextBlockPlacement,
  paint: Paint,
): TextBlockLayout {
  const layout = layoutTextBlock(text, placement);
  for (const line of layout.lines) {
    drawText(canvas, line.text, { ...placement, top: line.y }, paint);
  }
  return layout;
}
