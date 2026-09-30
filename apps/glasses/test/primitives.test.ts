import { describe, expect, it } from 'vitest';

import {
  createCanvas,
  fillRingSector,
  insetRingSector,
  strokeRingSector,
  type Canvas,
  type RingSector,
} from '../src/render/primitives.ts';

/**
 * The ring-sector primitives behind the corner car bars (Maxx, design rounds
 * 5 and 5b). Rasterised at pixel centres with plain integer indexing: every pixel
 * stays 0..15, nothing is written off the canvas, and the outline is closed.
 */

const W = 200;
const H = 120;

const SECTORS: readonly RingSector[] = [
  // The HUD's corner segments (round 5b): quarter rings centred INSIDE the
  // strip, sweeping the quadrant that faces the bottom corner — left 180..270,
  // right 270..360 — so the angles run past 180.
  {
    centre: { x: 88, y: 8 },
    innerRadius: 60,
    outerRadius: 88,
    startAngle: 240,
    endAngle: 270,
    edgeInset: 1,
  },
  {
    centre: { x: 88, y: 8 },
    innerRadius: 60,
    outerRadius: 88,
    startAngle: 180,
    endAngle: 210,
    edgeInset: 1,
  },
  {
    centre: { x: 112, y: 8 },
    innerRadius: 60,
    outerRadius: 88,
    startAngle: 270,
    endAngle: 300,
    edgeInset: 1,
  },
  {
    centre: { x: 112, y: 8 },
    innerRadius: 60,
    outerRadius: 88,
    startAngle: 330,
    endAngle: 360,
    edgeInset: 1,
  },
  // The round-5 corner segments, centred on the bottom corners (curve towards
  // the screen centre), kept because the primitive must not care.
  {
    centre: { x: 0, y: 96 },
    innerRadius: 60,
    outerRadius: 88,
    startAngle: 0,
    endAngle: 30,
    edgeInset: 1,
  },
  {
    centre: { x: 0, y: 96 },
    innerRadius: 60,
    outerRadius: 88,
    startAngle: 60,
    endAngle: 90,
    edgeInset: 1,
  },
  {
    centre: { x: 200, y: 96 },
    innerRadius: 60,
    outerRadius: 88,
    startAngle: 120,
    endAngle: 150,
    edgeInset: 1,
  },
  // Fractional centre and radii, a wide sweep, a half ring, a thin one.
  {
    centre: { x: 100.3, y: 60.7 },
    innerRadius: 20.5,
    outerRadius: 50.2,
    startAngle: 17,
    endAngle: 163,
  },
  {
    centre: { x: 100, y: 100 },
    innerRadius: 30,
    outerRadius: 60,
    startAngle: 0,
    endAngle: 180,
  },
  {
    centre: { x: 100, y: 110 },
    innerRadius: 40,
    outerRadius: 48,
    startAngle: 40,
    endAngle: 80,
  },
];

function levels(canvas: Canvas): Set<number> {
  return new Set(canvas.data);
}

function inside(canvas: Canvas, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < canvas.width && y < canvas.height;
}

/**
 * 4-connected flood fill over dark pixels from `seed`. Returns every pixel it
 * reached; a closed outline keeps it from reaching `escape`.
 */
function flood(canvas: Canvas, seed: { x: number; y: number }): Set<number> {
  const seen = new Set<number>();
  const stack = [seed];
  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    const index = y * canvas.width + x;
    if (!inside(canvas, x, y) || seen.has(index) || canvas.data[index] !== 0) {
      continue;
    }
    seen.add(index);
    stack.push(
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    );
  }
  return seen;
}

/** A pixel on the sector's centre line, halfway between its arcs. */
function midPoint(sector: RingSector): { x: number; y: number } {
  const angle = (((sector.startAngle + sector.endAngle) / 2) * Math.PI) / 180;
  const radius = (sector.innerRadius + sector.outerRadius) / 2;
  return {
    x: Math.floor(sector.centre.x + radius * Math.cos(angle)),
    y: Math.floor(sector.centre.y - radius * Math.sin(angle)),
  };
}

describe('ring-sector primitives', () => {
  it('writes only levels 0..15, clamping and rounding the paint', () => {
    for (const sector of SECTORS) {
      for (const paint of [15, 99, -3, 7.6, { on: 20, off: -1 }]) {
        const filled = createCanvas(W, H);
        fillRingSector(filled, sector, paint);
        const stroked = createCanvas(W, H);
        strokeRingSector(stroked, sector, paint, 2);

        for (const canvas of [filled, stroked]) {
          expect(canvas.data.length).toBe(W * H);
          for (const value of levels(canvas)) {
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(15);
          }
        }
      }
    }
  });

  it('clips a sector that runs off the canvas', () => {
    const canvas = createCanvas(40, 30);
    expect(() => {
      fillRingSector(canvas, SECTORS[8]!, 9);
      strokeRingSector(canvas, SECTORS[0]!, 9, 2);
    }).not.toThrow();
    expect(canvas.data.length).toBe(40 * 30);
  });

  it('keeps every lit pixel between the radii and inside the wedge', () => {
    for (const sector of SECTORS) {
      const canvas = createCanvas(W, H);
      fillRingSector(canvas, sector, 15);
      let lit = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          if (canvas.data[y * W + x] === 0) {
            continue;
          }
          lit += 1;
          const dx = x + 0.5 - sector.centre.x;
          const dy = sector.centre.y - (y + 0.5);
          const r = Math.hypot(dx, dy);
          expect(r).toBeGreaterThanOrEqual(sector.innerRadius);
          expect(r).toBeLessThanOrEqual(sector.outerRadius);
          let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          // atan2 answers -180..180; sectors may sweep anywhere in 0..360.
          while (angle < sector.startAngle - 1e-9) {
            angle += 360;
          }
          expect(angle).toBeGreaterThanOrEqual(sector.startAngle - 1e-9);
          expect(angle).toBeLessThanOrEqual(sector.endAngle + 1e-9);
        }
      }
      expect(lit).toBeGreaterThan(0);
    }
  });

  it('draws a closed outline: a flood from inside never gets out', () => {
    for (const sector of SECTORS) {
      const canvas = createCanvas(W, H);
      strokeRingSector(canvas, sector, 6, 2);
      const seed = midPoint(sector);
      expect(canvas.data[seed.y * W + seed.x]).toBe(0);

      const reached = flood(canvas, seed);
      const shape = createCanvas(W, H);
      fillRingSector(shape, sector, 1);
      expect(reached.size).toBeGreaterThan(0);
      for (const index of reached) {
        // Every pixel the flood reached belongs to the sector's interior.
        expect(shape.data[index]).toBe(1);
      }
    }
  });

  it('leaves the interior untouched and matches fill minus the inset fill', () => {
    for (const sector of SECTORS) {
      const stroke = createCanvas(W, H);
      stroke.data.fill(3);
      strokeRingSector(stroke, sector, 9, 2);

      const outer = createCanvas(W, H);
      fillRingSector(outer, sector, 1);
      const hole = createCanvas(W, H);
      fillRingSector(hole, insetRingSector(sector, 2), 1);

      for (let index = 0; index < W * H; index += 1) {
        const expected =
          outer.data[index] === 1 && hole.data[index] === 0 ? 9 : 3;
        expect(stroke.data[index]).toBe(expected);
      }
    }
  });

  it('keeps a constant-width gap between two segments sharing an edge', () => {
    const base = { centre: { x: 0, y: 96 }, innerRadius: 60, outerRadius: 88 };
    const canvas = createCanvas(W, H);
    fillRingSector(
      canvas,
      { ...base, startAngle: 0, endAngle: 45, edgeInset: 1 },
      15,
    );
    fillRingSector(
      canvas,
      { ...base, startAngle: 45, endAngle: 90, edgeInset: 1 },
      15,
    );

    // Along the 45° boundary, every pixel within 1 px of the ray is dark.
    const u = Math.SQRT1_2;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = x + 0.5;
        const dy = 96 - (y + 0.5);
        const distance = Math.abs(u * dy - u * dx);
        const r = Math.hypot(dx, dy);
        if (distance < 1 && r > 61 && r < 87) {
          expect(canvas.data[y * W + x]).toBe(0);
        }
      }
    }
  });

  it('draws nothing for an empty or invalid sector', () => {
    const canvas = createCanvas(W, H);
    fillRingSector(
      canvas,
      {
        centre: { x: 50, y: 50 },
        innerRadius: 30,
        outerRadius: 20,
        startAngle: 0,
        endAngle: 90,
      },
      15,
    );
    fillRingSector(
      canvas,
      {
        centre: { x: 50, y: 50 },
        innerRadius: 10,
        outerRadius: 20,
        startAngle: 90,
        endAngle: 90,
      },
      15,
    );
    fillRingSector(
      canvas,
      {
        centre: { x: 50, y: 50 },
        innerRadius: 10,
        outerRadius: 20,
        startAngle: 0,
        endAngle: 270,
      },
      15,
    );
    strokeRingSector(
      canvas,
      {
        centre: { x: 50, y: 50 },
        innerRadius: 30,
        outerRadius: 20,
        startAngle: 0,
        endAngle: 90,
      },
      15,
      2,
    );
    expect(levels(canvas)).toEqual(new Set([0]));
  });
});
