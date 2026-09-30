/**
 * The lane-call blink (Maxx, 2026-09-30 design round 5: "when the user presses
 * the app button on the phone make the glasses image blink. Empty outline then
 * filled outline.").
 *
 * When the applied `state.lane` changes to a lane, the newly called icon is
 * drawn outline → filled → outline → filled, `LANE_BLINK_MS` per phase, and
 * ends filled. The first phase is drawn by the very render that applies the
 * new state (so the call itself costs no extra frame); each later phase is one
 * re-render, which the queue turns into top-strip sends only — lane-immediate,
 * and nothing at all for the cars strip. A newer lane, a clear, NO LINK or
 * `stop()` cancels it (`cancel`), leaving the icon filled.
 *
 * Only the style of the icon the relay already called changes: constitution §2
 * holds — which lane is lit still comes from `state` alone.
 */

import type { LaneStyle } from './render/hud-design.ts';

/** One phase of the blink. Unverified on hardware: each phase is ≥ 1 send. */
export const LANE_BLINK_MS = 300;

/** The phases in order; the first is drawn with the state that started it. */
export const LANE_BLINK_PHASES: readonly LaneStyle[] = [
  'outline',
  'filled',
  'outline',
  'filled',
];

export interface BlinkTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface LaneBlinkOptions {
  readonly timers: BlinkTimers;
  /**
   * Applies a phase. `render: false` when the caller is about to render anyway
   * (the state that starts the blink, the verdict that cancels it) — one
   * event, one HUD job.
   */
  readonly setStyle: (style: LaneStyle, render: boolean) => void;
}

export interface LaneBlink {
  /** Whether a blink sequence is under way. */
  readonly running: boolean;
  /** (Re)starts the sequence; sets phase 0 without rendering it. */
  start(): void;
  /** Stops the sequence and sets `filled`, without rendering. */
  cancel(): void;
}

export function createLaneBlink(options: LaneBlinkOptions): LaneBlink {
  const { timers, setStyle } = options;
  let timer: number | undefined;
  let phase = 0;

  const clear = (): void => {
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      timer = undefined;
    }
  };

  const next = (): void => {
    timer = timers.setTimeout(() => {
      timer = undefined;
      phase += 1;
      setStyle(LANE_BLINK_PHASES[phase] ?? 'filled', true);
      if (phase < LANE_BLINK_PHASES.length - 1) {
        next();
      }
    }, LANE_BLINK_MS);
  };

  return {
    get running(): boolean {
      return timer !== undefined;
    },
    start(): void {
      clear();
      phase = 0;
      setStyle(LANE_BLINK_PHASES[0] ?? 'filled', false);
      next();
    },
    cancel(): void {
      clear();
      setStyle('filled', false);
    },
  };
}
