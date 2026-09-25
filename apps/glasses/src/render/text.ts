/**
 * ASCII text HUD — the permanent fallback (startup override, or the mid-session
 * switch after three `sendFailed`). ASCII only: spec 030 AC-9 was dropped
 * precisely so no glyph here needs hardware verification.
 *
 * Line 1 mirrors the bitmap's lane row in track order (v left, - middle,
 * ^ right): the called lane shows its marker, the other two a `.`. Line 2 is
 * the three car-behind bars `[left] [mid] [right]`, three cells each, filled
 * left to right like the bitmap:
 *
 *   . . ^
 *   [#  ] [## ] [###]
 */

import { CAR_LEVEL_MAX, type Lane } from '@g2-race-spotter/protocol';

import type { HudState } from './hud-design.ts';

const LANE_ORDER: readonly Lane[] = ['bot', 'mid', 'top'];
const LANE_MARKER = { bot: 'v', mid: '-', top: '^' } as const;
export const TEXT_LANE_EMPTY = '.';

export const TEXT_FILLED = '#';
export const TEXT_EMPTY = ' ';

function carBar(level: number): string {
  const filled = Math.max(0, Math.min(CAR_LEVEL_MAX, Math.round(level)));
  return `[${TEXT_FILLED.repeat(filled)}${TEXT_EMPTY.repeat(CAR_LEVEL_MAX - filled)}]`;
}

/** `state → string` for the single text container that replaces the bitmap. */
export function renderText(state: HudState): string {
  const lanes = LANE_ORDER.map((lane) =>
    lane === state.lane ? LANE_MARKER[lane] : TEXT_LANE_EMPTY,
  ).join(' ');
  const cars = [0, 1, 2].map((index) => carBar(state.cars[index] ?? 0));

  return `${lanes}\n${cars.join(' ')}`;
}
