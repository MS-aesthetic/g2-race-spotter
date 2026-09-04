/**
 * ASCII text HUD — the permanent fallback (startup override, or the mid-session
 * switch after three `sendFailed`). ASCII only: spec 030 AC-9 was dropped
 * precisely so no glyph here needs hardware verification.
 *
 *   ^
 *   ############--------  62
 *   <
 */

import type { HudState } from './hud-design.ts';

export const TEXT_BAR_CELLS = 20;
export const TEXT_ALERT_GAP = 90;

const LANE_SYMBOL = { top: '^', mid: 'o', bot: 'v' } as const;
/** The bitmap's ◀ / ▶ pass warning, in ASCII. */
const SIDE_SYMBOL = { inside: '<', outside: '>' } as const;

export const TEXT_FILLED = '#';
export const TEXT_EMPTY = '-';

/** `state → string` for the single text container that replaces the bitmap. */
export function renderText(state: HudState): string {
  const symbol = state.lane === null ? '' : LANE_SYMBOL[state.lane];
  const side = state.side === null ? '' : SIDE_SYMBOL[state.side];
  const gap = Math.max(0, Math.min(100, Math.round(state.gap)));
  const filled = Math.min(TEXT_BAR_CELLS, Math.round(gap / 5));
  const bar =
    TEXT_FILLED.repeat(filled) + TEXT_EMPTY.repeat(TEXT_BAR_CELLS - filled);
  const prefix = gap >= TEXT_ALERT_GAP ? '!!' : '';

  return `${symbol}\n${prefix}${bar}  ${gap}\n${side}`;
}
