import { GAP_SEND_MIN_MS, MSG_MAX_CHARS } from '@g2-race-spotter/protocol';

export interface GapThrottleOptions {
  send(value: number): void;
  now?: () => number;
  /** Defaults to the protocol's `GAP_SEND_MIN_MS`; only tests override it. */
  minIntervalMs?: number;
}

export interface GapThrottle {
  /** Call for every `input` event while the spotter drags. */
  input(value: number): void;
  /** Call once on `change` (finger lifted) or for a quick-set chip. */
  release(value: number): void;
  /** Forget the last sent value, e.g. after a room change. */
  reset(): void;
}

function clampGap(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Leading-edge throttle for `gap`: one send the instant the drag starts, then
 * at most one per `GAP_SEND_MIN_MS`, then exactly one on release so the value
 * the spotter's finger stopped on is always the value the driver sees.
 *
 * Deliberately timer-free. A trailing timer would add a send the relay's rate
 * budget does not need (the release send already covers the tail) and would
 * make the throttle untestable without fake timers; here the caller's clock is
 * the only input, which is what AC-2 drives.
 */
export function createGapThrottle(options: GapThrottleOptions): GapThrottle {
  const now = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs ?? GAP_SEND_MIN_MS;
  let lastSentValue: number | undefined;
  let lastSentAt = Number.NEGATIVE_INFINITY;

  function emit(value: number): void {
    lastSentValue = value;
    lastSentAt = now();
    options.send(value);
  }

  return {
    input(value: number): void {
      const next = clampGap(value);
      // Sub-1-point jitter is not news; neither is a repeat of what the relay
      // already holds.
      if (next === lastSentValue) {
        return;
      }

      if (now() - lastSentAt < minIntervalMs) {
        return;
      }

      emit(next);
    },
    release(value: number): void {
      const next = clampGap(value);
      if (next === lastSentValue) {
        return;
      }

      emit(next);
    },
    reset(): void {
      lastSentValue = undefined;
      lastSentAt = Number.NEGATIVE_INFINITY;
    },
  };
}

/**
 * Trim and cap to `MSG_MAX_CHARS`, then re-trim: slicing an 80-char boundary
 * can leave a trailing space, and `isSetMsg` rejects untrimmed text outright.
 */
export function normaliseMessage(text: string): string {
  return text.trim().slice(0, MSG_MAX_CHARS).trim();
}
