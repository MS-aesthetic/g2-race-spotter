/**
 * Renders a HUD bitmap as ASCII so the golden snapshots in
 * `test/draw-hud.test.ts` are eyeballable in a diff: `#` for level >= 8,
 * `+` for 1..7, `.` for 0, one character per `SNAPSHOT_SCALE`-pixel block.
 *
 * A block takes the brightest pixel in it rather than a corner sample, so
 * thin features (the 2 px bar outline, the 1 px ticks) survive the 4x
 * reduction instead of falling between samples.
 */

import { HUD_HEIGHT, HUD_WIDTH } from './hud-design.ts';

export const SNAPSHOT_SCALE = 4;

export interface AsciiOptions {
  readonly width?: number;
  readonly height?: number;
  readonly scale?: number;
}

function cell(level: number): string {
  if (level >= 8) {
    return '#';
  }

  return level > 0 ? '+' : '.';
}

export function toAscii(frame: Uint8Array, options: AsciiOptions = {}): string {
  const width = options.width ?? HUD_WIDTH;
  const height = options.height ?? HUD_HEIGHT;
  const scale = options.scale ?? SNAPSHOT_SCALE;
  const rows: string[] = [];

  for (let y = 0; y < height; y += scale) {
    let row = '';
    for (let x = 0; x < width; x += scale) {
      let brightest = 0;
      for (let dy = 0; dy < scale && y + dy < height; dy += 1) {
        for (let dx = 0; dx < scale && x + dx < width; dx += 1) {
          brightest = Math.max(
            brightest,
            frame[(y + dy) * width + x + dx] as number,
          );
        }
      }
      row += cell(brightest);
    }
    rows.push(row);
  }

  return rows.join('\n');
}
