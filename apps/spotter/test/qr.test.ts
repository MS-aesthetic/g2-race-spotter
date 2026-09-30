import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { encodeQr, qrPath, type QrMatrix } from '../src/ui/qr.ts';

/**
 * Goldens are SHA-256 of the module matrix ("0"/"1" per module, rows joined
 * by "\n") produced by Project Nayuki's reference `qrcodegen` 1.8.0 (Python):
 * `QrCode.encode_segments([QrSegment.make_bytes(text)], Ecc.MEDIUM, 1, 10,
 * -1, False)`. The same comparison was run over 76 inputs of 1–213 bytes
 * while vendoring the encoder, mask choice included; decoding the rendered
 * overlay with zxing-cpp returned the exact URL.
 */
const GOLDENS = [
  {
    text: 'https://g2-race-relay.maxx-384.workers.dev/glasses/?room=ABC123&pin=1234&name=driver',
    version: 5,
    sha256: '93f9a7d80a00fe3e7b98dbc6c912dbe85c4036c42ed77547126deca688189ec5',
  },
  {
    text: 'HELLO',
    version: 1,
    sha256: 'c346c75add5698735afe3f7eb4f3e6c57ccefd9563f45f65c6d76aa518fb6f91',
  },
  {
    // Version 7+ carries the 18-bit version blocks.
    text: `https://spot.example.com/glasses/?room=Q7X2KD&pin=0042&name=driver&${'x'.repeat(80)}`,
    version: 8,
    sha256: '304fcf1646c6420369781a9543c3e4d37a9b3a7021973441b471664b7ec17e6f',
  },
];

function digest(matrix: QrMatrix): string {
  const text = matrix
    .map((row) => row.map((dark) => (dark ? '1' : '0')).join(''))
    .join('\n');
  return createHash('sha256').update(text).digest('hex');
}

/** The 7×7 finder: dark ring, light ring, dark 3×3 core. */
function finderAt(matrix: QrMatrix, x0: number, y0: number): boolean {
  for (let dy = 0; dy < 7; dy += 1) {
    for (let dx = 0; dx < 7; dx += 1) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (matrix[y0 + dy]![x0 + dx] !== (ring !== 2)) {
        return false;
      }
    }
  }
  return true;
}

describe('vendored QR encoder', () => {
  for (const golden of GOLDENS) {
    it(`matches the reference encoder for a ${golden.text.length}-byte payload (version ${golden.version})`, () => {
      const matrix = encodeQr(golden.text);
      expect(matrix).toHaveLength(golden.version * 4 + 17);
      expect(digest(matrix)).toBe(golden.sha256);
    });
  }

  it('draws the three finder patterns and the dark module', () => {
    const matrix = encodeQr(GOLDENS[0]!.text);
    const size = matrix.length;
    expect(finderAt(matrix, 0, 0)).toBe(true);
    expect(finderAt(matrix, size - 7, 0)).toBe(true);
    expect(finderAt(matrix, 0, size - 7)).toBe(true);
    expect(matrix[size - 8]![8]).toBe(true);
  });

  it('refuses a payload past version 10 instead of drawing garbage', () => {
    expect(() => encodeQr('x'.repeat(214))).toThrow(RangeError);
    expect(encodeQr('x'.repeat(213))).toHaveLength(57);
  });

  it('turns every dark module into exactly one unit of path area inside the quiet zone', () => {
    const matrix = encodeQr('HELLO');
    const path = qrPath(matrix);
    let area = 0;
    for (const run of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      expect(Number(run[3])).toBe(Number(run[4]));
      expect(Number(run[1])).toBeGreaterThanOrEqual(4);
      expect(Number(run[2])).toBeGreaterThanOrEqual(4);
      area += Number(run[3]);
    }
    const dark = matrix.flat().filter(Boolean).length;
    expect(area).toBe(dark);
    expect(path.replace(/M\d+ \d+h\d+v1h-\d+z/g, '')).toBe('');
  });
});
