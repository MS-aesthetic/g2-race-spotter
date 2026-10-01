import { describe, expect, it } from 'vitest';

import {
  drawText,
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
 * design round 6), at the HUD's ×6 scale: 30×42-px glyphs, 6-px gaps.
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
