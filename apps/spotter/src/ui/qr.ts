/**
 * Minimal QR Code encoder: byte mode, error correction level M, versions
 * 1–10 (up to 213 bytes — a glasses URL is ~85), automatic mask choice.
 * Vendored instead of a dependency to stay inside the 40 KB gz budget (T058).
 *
 * A cut-down TypeScript port of Project Nayuki's QR Code generator library
 * (https://www.nayuki.io/page/qr-code-generator-library): Reed-Solomon over
 * GF(2^8)/0x11D, function patterns, zig-zag codeword placement and the
 * ISO/IEC 18004 mask penalty follow it. `test/qr.test.ts` pins the output to
 * that library's reference Python build (qrcodegen 1.8.0), mask choice
 * included.
 *
 * Copyright (c) Project Nayuki. (MIT License)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising
 *   from, out of or in connection with the Software or the use or other
 *   dealings in the Software.
 */

const MAX_VERSION = 10;
/** Level M, versions 1..10: EC codewords per block and number of blocks. */
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Level M's two format bits (L=01, M=00, Q=11, H=10). */
const FORMAT_M = 0;

/** `true` = dark module; `[y][x]`. */
export type QrMatrix = boolean[][];

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < degree) {
        result[j]! ^= result[j + 1]!;
      }
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i]! ^= gfMul(coef, factor);
    });
  }
  return result;
}

/** Data-carrying modules in a symbol of this version. */
function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
}

function dataCodewords(version: number): number {
  return (
    Math.floor(rawModules(version) / 8) -
    ECC_PER_BLOCK[version - 1]! * BLOCKS[version - 1]!
  );
}

function alignmentPositions(version: number): number[] {
  if (version === 1) {
    return [];
  }
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Data bits → padded data codewords → interleaved data + EC codewords. */
function codewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((value >>> i) & 1);
    }
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));

  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) {
    push(pad, 8);
  }

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }

  const blocks = BLOCKS[version - 1]!;
  const eccLength = ECC_PER_BLOCK[version - 1]!;
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i += 1) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, divisor));
  }

  const result: number[] = [];
  for (let i = 0; i <= shortLength - eccLength; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) {
        result.push(block[i]!);
      }
    }
  }
  for (let i = 0; i < eccLength; i += 1) {
    for (const block of eccBlocks) {
      result.push(block[i]!);
    }
  }
  return result;
}

interface Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
}

function setFixed(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.dark[y]![x] = dark;
  grid.fixed[y]![x] = true;
}

function drawFormat(grid: Grid, mask: number): void {
  const data = (FORMAT_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
  const { size } = grid;

  for (let i = 0; i <= 5; i += 1) setFixed(grid, 8, i, bit(i));
  setFixed(grid, 8, 7, bit(6));
  setFixed(grid, 8, 8, bit(7));
  setFixed(grid, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFixed(grid, 14 - i, 8, bit(i));

  for (let i = 0; i < 8; i += 1) setFixed(grid, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFixed(grid, 8, size - 15 + i, bit(i));
  setFixed(grid, 8, size - 8, true);
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const { size } = grid;
  for (let i = 0; i < size; i += 1) {
    setFixed(grid, 6, i, i % 2 === 0);
    setFixed(grid, i, 6, i % 2 === 0);
  }

  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFixed(grid, x, y, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  const align = alignmentPositions(version);
  const last = align.length - 1;
  align.forEach((cx, i) => {
    align.forEach((cy, j) => {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      ) {
        return;
      }
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          setFixed(
            grid,
            cx + dx,
            cy + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
        }
      }
    });
  });

  // Reserve the format areas (real bits are drawn per mask).
  drawFormat(grid, 0);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFixed(grid, a, b, dark);
      setFixed(grid, b, a, dark);
    }
  }
}

function placeCodewords(grid: Grid, data: readonly number[]): void {
  const { size } = grid;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!grid.fixed[y]![x] && i < data.length * 8) {
          grid.dark[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i += 1;
        }
      }
    }
  }
}

function applyMask(grid: Grid, mask: number): void {
  const test = MASKS[mask]!;
  for (let y = 0; y < grid.size; y += 1) {
    for (let x = 0; x < grid.size; x += 1) {
      if (!grid.fixed[y]![x] && test(x, y)) {
        grid.dark[y]![x] = !grid.dark[y]![x];
      }
    }
  }
}

/** ISO/IEC 18004 §7.8.3 penalty (N1 = 3, N2 = 3, N3 = 40, N4 = 10). */
function penalty(dark: boolean[][]): number {
  const size = dark.length;
  let result = 0;

  const countFinders = (h: number[]): number => {
    const n = h[1]!;
    const core =
      n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (
      (core && h[0]! >= n * 4 && h[6]! >= n ? 1 : 0) +
      (core && h[6]! >= n * 4 && h[0]! >= n ? 1 : 0)
    );
  };
  const addHistory = (length: number, h: number[]): void => {
    h.pop();
    h.unshift(h[0] === 0 ? length + size : length);
  };

  const scanLine = (at: (i: number) => boolean): void => {
    let runColor = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i += 1) {
      if (at(i) === runColor) {
        run += 1;
        if (run === 5) result += 3;
        else if (run > 5) result += 1;
      } else {
        addHistory(run, history);
        if (!runColor) result += countFinders(history) * 40;
        runColor = at(i);
        run = 1;
      }
    }
    if (runColor) {
      addHistory(run, history);
      run = 0;
    }
    addHistory(run + size, history);
    result += countFinders(history) * 40;
  };

  for (let y = 0; y < size; y += 1) scanLine((x) => dark[y]![x]!);
  for (let x = 0; x < size; x += 1) scanLine((y) => dark[y]![x]!);

  let darkCount = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const c = dark[y]![x]!;
      if (c) darkCount += 1;
      if (
        y < size - 1 &&
        x < size - 1 &&
        c === dark[y]![x + 1] &&
        c === dark[y + 1]![x] &&
        c === dark[y + 1]![x + 1]
      ) {
        result += 3;
      }
    }
  }
  const total = size * size;
  result += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return result;
}

/**
 * Encodes `text` (UTF-8) as the smallest level-M QR symbol that fits. Throws
 * past version 10. `mask` forces a mask pattern (tests only).
 */
export function encodeQr(text: string, mask?: number): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (bytes.length + (version < 10 ? 2 : 3) > dataCodewords(version)) {
    version += 1;
    if (version > MAX_VERSION) {
      throw new RangeError(`QR payload too long (${bytes.length} bytes)`);
    }
  }

  const size = version * 4 + 17;
  const grid: Grid = {
    size,
    dark: Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    ),
    fixed: Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    ),
  };
  drawFunctionPatterns(grid, version);
  placeCodewords(grid, codewords(bytes, version));

  let best = mask ?? 0;
  if (mask === undefined) {
    let bestScore = Infinity;
    for (let candidate = 0; candidate < 8; candidate += 1) {
      applyMask(grid, candidate);
      drawFormat(grid, candidate);
      const score = penalty(grid.dark);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
      applyMask(grid, candidate);
    }
  }
  applyMask(grid, best);
  drawFormat(grid, best);
  return grid.dark;
}

/**
 * One SVG path for the dark modules (horizontal runs merged), offset by the
 * 4-module quiet zone. The viewBox is `0 0 n n` with n = size + 8.
 */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (!row[x]) continue;
      let end = x;
      while (end + 1 < row.length && row[end + 1]) end += 1;
      parts.push(`M${x + 4} ${y + 4}h${end - x + 1}v1h${x - end - 1}z`);
      x = end;
    }
  });
  return parts.join('');
}
