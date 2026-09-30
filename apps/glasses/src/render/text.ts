/**
 * ASCII text HUD — the permanent fallback (startup override, or the mid-session
 * switch after three `sendFailed`). ASCII only: spec 030 AC-9 was dropped
 * precisely so no glyph here needs hardware verification.
 *
 * Line 1 mirrors the bitmap's lane row (Maxx, design round 5): `<` left
 * (bottom lane), `^` middle, `>` right (top lane), always all three — the
 * called one is BRACKETED (`[<]`; ASCII has no filled/hollow pair and no
 * upper-case `<`). Line 2 is the three car-behind bars `[left] [mid] [right]`,
 * three cells each, `#` for each car level. Each lane marker sits in a 5-char
 * slot centred over the bar of the same side, so both lines are 17 wide:
 *
 *     <     ^    [>]
 *   [#  ] [## ] [###]
 */

import { CAR_LEVEL_MAX, type Lane } from '@g2-race-spotter/protocol';

import type { HudState } from './hud-design.ts';

const LANE_ORDER: readonly Lane[] = ['bot', 'mid', 'top'];
const LANE_MARKER = { bot: '<', mid: '^', top: '>' } as const;

export const TEXT_FILLED = '#';
export const TEXT_EMPTY = ' ';

function carBar(level: number): string {
  const filled = Math.max(0, Math.min(CAR_LEVEL_MAX, Math.round(level)));
  return `[${TEXT_FILLED.repeat(filled)}${TEXT_EMPTY.repeat(CAR_LEVEL_MAX - filled)}]`;
}

/** `state → string` for the single text container that replaces the bitmap. */
export function renderText(state: HudState): string {
  const lanes = LANE_ORDER.map((lane) =>
    lane === state.lane
      ? ` [${LANE_MARKER[lane]}] `
      : `  ${LANE_MARKER[lane]}  `,
  ).join(' ');
  const cars = [0, 1, 2].map((index) => carBar(state.cars[index] ?? 0));

  return `${lanes}\n${cars.join(' ')}`;
}
