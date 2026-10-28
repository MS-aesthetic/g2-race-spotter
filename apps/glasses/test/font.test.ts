import { describe, expect, it } from 'vitest';

import {
  drawText,
  drawTextBlock,
  layoutTextBlock,
  measureTextBlock,
  wrapText,
  type TextBlockPlacement,
  FALLBACK_CHAR,
  fitText,
  FONT,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  glyphRows,
  layoutText,
  measureText,
  normaliseText,
  TRUNCATION_CHAR,
  type TextPlacement,
} from '../src/render/font.ts';
import { createCanvas, type Canvas } from '../src/render/primitives.ts';

/**
 * The 5×7 bitmap font the image-mode message is drawn with (Maxx, 2026-10-01
 * design round 6), at the HUD's ×6 scale: 30×42-px glyphs, 6-px gaps — and,
 * since round 7 (2026-10-28), set as a block of up to two lines.
 */

const STYLE = { scale: 6, gap: 6 } as const;
const PLACEMENT: TextPlacement = {
  ...STYLE,
  centreX: 288,
  top: 51,
  maxWidth: 576,
};

function litBox(canvas: Canvas): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
} {
  const box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    count: 0,
  };
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if ((canvas.data[y * canvas.width + x] as number) > 0) {
        box.minX = Math.min(box.minX, x);
        box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y);
        box.maxY = Math.max(box.maxY, y);
        box.count += 1;
      }
    }
  }
  return box;
}

describe('5x7 bitmap font', () => {
  it('has every glyph exactly 5 wide and 7 tall, drawn with # and . only', () => {
    expect([GLYPH_WIDTH, GLYPH_HEIGHT]).toEqual([5, 7]);
    for (const [char, rows] of Object.entries(FONT)) {
      expect(rows, char).toHaveLength(GLYPH_HEIGHT);
      for (const row of rows) {
        expect(row, char).toMatch(/^[#.]{5}$/);
      }
      // Everything but the space draws something.
      expect(rows.join('').includes('#'), char).toBe(char !== ' ');
    }
  });

  it("covers A-Z, 0-9, space and . , - ! ? / '", () => {
    const wanted = [
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      ...'0123456789',
      ..." .,-!?/'",
    ];
    expect(Object.keys(FONT).sort()).toEqual([...wanted].sort());
    // No two glyphs look the same.
    const shapes = Object.values(FONT).map((rows) => rows.join('|'));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('draws lower case as upper case and anything unknown as ?', () => {
    expect(normaliseText('box this lap')).toBe('BOX THIS LAP');
    expect(normaliseText('P1 → P2 ✓\t')).toBe('P1 ? P2 ??');
    expect(glyphRows('q')).toBe(FONT.Q);
    expect(glyphRows('€')).toBe(FONT[FALLBACK_CHAR]);
  });

  it('scales a glyph by 6: a full-cell letter is 30 x 42 px, every font pixel a 6x6 block', () => {
    const canvas = createCanvas(60, 60);
    drawText(canvas, 'B', { ...STYLE, centreX: 30, top: 5, maxWidth: 60 }, 15);
    const box = litBox(canvas);

    expect([box.maxX - box.minX + 1, box.maxY - box.minY + 1]).toEqual([
      30, 42,
    ]);
    const fontPixels = FONT.B!.join('').split('#').length - 1;
    expect(box.count).toBe(fontPixels * 36);
    expect(new Set(canvas.data)).toEqual(new Set([0, 15]));
  });

  it('measures n glyphs as n x 30 + (n - 1) x 6 px', () => {
    expect(measureText(0, STYLE)).toBe(0);
    expect(measureText(1, STYLE)).toBe(30);
    expect(measureText(3, STYLE)).toBe(102);
    expect(measureText(16, STYLE)).toBe(570);
    expect(measureText(17, STYLE)).toBe(606);
  });

  it('centres the text on centreX within 1 px', () => {
    for (const text of ['BOX', 'PIT NOW', 'BOX THIS LAP', 'W', 'MM']) {
      const canvas = createCanvas(576, 96);
      const layout = drawText(canvas, text, PLACEMENT, 15);
      const box = litBox(canvas);

      expect(layout.width).toBe(measureText(text.length, STYLE));
      expect(layout.y).toBe(51);
      // These texts start and end on a glyph with a lit outer column, so
      // the lit box is the layout box.
      expect([box.minX, box.maxX]).toEqual([
        layout.x,
        layout.x + layout.width - 1,
      ]);
      expect(Math.abs((box.minX + box.maxX) / 2 - 288)).toBeLessThanOrEqual(1);
      expect([box.minY, box.maxY]).toEqual([51, 92]);
    }
  });

  it('truncates text wider than maxWidth, the last glyph that fits becoming .', () => {
    expect(TRUNCATION_CHAR).toBe('.');
    // 16 glyphs (570 px) fit the 576-px strip; 17 do not.
    expect(fitText('ABCDEFGHIJKLMNOP', 576, STYLE)).toBe('ABCDEFGHIJKLMNOP');
    expect(fitText('ABCDEFGHIJKLMNOPQ', 576, STYLE)).toBe('ABCDEFGHIJKLMNO.');
    expect(fitText('slow down, car inside!', 576, STYLE)).toBe(
      'SLOW DOWN, CAR .',
    );
    expect(fitText('AB', 29, STYLE)).toBe('');
    expect(fitText('AB', 30, STYLE)).toBe('.');

    const canvas = createCanvas(576, 96);
    const layout = layoutText('THIS MESSAGE IS FAR TOO LONG', PLACEMENT);
    expect(layout.text).toBe('THIS MESSAGE IS.');
    expect(layout.width).toBeLessThanOrEqual(576);
    drawText(canvas, 'THIS MESSAGE IS FAR TOO LONG', PLACEMENT, 15);
    const box = litBox(canvas);
    expect(box.minX).toBeGreaterThanOrEqual(0);
    expect(box.maxX).toBeLessThanOrEqual(575);
  });

  it('draws nothing for an empty string', () => {
    const canvas = createCanvas(576, 96);
    const layout = drawText(canvas, '', PLACEMENT, 15);
    expect(layout.width).toBe(0);
    expect(litBox(canvas).count).toBe(0);
  });
});

describe('text blocks (round 7: up to two lines)', () => {
  /** 8 glyphs = 282 px fit; 9 = 318 do not. */
  const WIDTH = 288;
  const lines = (text: string, maxLines = 2): string[] =>
    wrapText(text, WIDTH, STYLE, maxLines);
  const BLOCK: TextBlockPlacement = {
    ...STYLE,
    centreX: 288,
    top: 6,
    maxWidth: WIDTH,
    lineGap: 8,
    maxLines: 2,
  };

  it('splits on \\n before normalising, so a line break never draws a ?', () => {
    expect(normaliseText('A\nB')).toBe('A?B');
    expect(lines('GO LOW\nEXIT')).toEqual(['GO LOW', 'EXIT']);
    expect(lines('go top\r\nentry')).toEqual(['GO TOP', 'ENTRY']);
    // Blank lines and runs of spaces disappear.
    expect(lines('\n  PITS  \n')).toEqual(['PITS']);
    expect(lines('')).toEqual([]);
    expect(lines(' \n ')).toEqual([]);
  });

  it('word-wraps a line wider than maxWidth greedily on spaces', () => {
    expect(lines('CATCHING UP')).toEqual(['CATCHING', 'UP']);
    expect(lines('LEADERS BEHIND')).toEqual(['LEADERS', 'BEHIND']);
    expect(lines('PULLING AWAY')).toEqual(['PULLING', 'AWAY']);
    expect(lines('GO TO P2')).toEqual(['GO TO P2']);
    expect(lines('PITS')).toEqual(['PITS']);
    // An explicit line still wraps if it is too wide on its own.
    expect(lines('BOX\nTHIS LAP NOW', 3)).toEqual(['BOX', 'THIS LAP', 'NOW']);
  });

  it('keeps at most maxLines: the rest joins the last line, cut with a .', () => {
    expect(lines('A\nB\nC')).toEqual(['A', 'B C']);
    expect(lines('BOX\nTHIS LAP NOW')).toEqual(['BOX', 'THIS LA.']);
    expect(lines('ONE TWO THREE FOUR', 1)).toEqual(['ONE TWO.']);
    // A single word too wide is cut on its own line.
    expect(lines('OVERTAKING')).toEqual(['OVERTAK.']);
    for (const line of lines('SLOW DOWN, CAR INSIDE AT TURN 4')) {
      expect(measureText(line.length, STYLE)).toBeLessThanOrEqual(WIDTH);
    }
  });

  it('measures a block as n x 42 + (n - 1) x 8 px', () => {
    expect(measureTextBlock(0, BLOCK)).toBe(0);
    expect(measureTextBlock(1, BLOCK)).toBe(42);
    expect(measureTextBlock(2, BLOCK)).toBe(92);
  });

  it('lays two lines from the top of the band and centres one line in it', () => {
    const two = layoutTextBlock('GO LOW\nEXIT', BLOCK);
    expect(two.lines.map((line) => [line.text, line.y])).toEqual([
      ['GO LOW', 6],
      ['EXIT', 56],
    ]);
    const one = layoutTextBlock('PITS', BLOCK);
    expect(one.lines.map((line) => [line.text, line.y])).toEqual([
      ['PITS', 31],
    ]);
    expect(layoutTextBlock('', BLOCK).lines).toEqual([]);
  });

  it('draws every line centred on centreX', () => {
    const canvas = createCanvas(576, 144);
    const layout = drawTextBlock(canvas, 'CATCHING UP', BLOCK, 15);
    expect(layout.lines.map((line) => line.text)).toEqual(['CATCHING', 'UP']);
    const box = litBox(canvas);
    expect([box.minY, box.maxY]).toEqual([6, 97]);
    expect([box.minX, box.maxX]).toEqual([147, 428]);
    for (const line of layout.lines) {
      expect(Math.abs(line.x + line.width / 2 - 288)).toBeLessThanOrEqual(1);
    }
  });
});
