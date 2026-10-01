/**
 * The message blink (Maxx, 2026-10-01 design round 6: "make text blink every
 * second for 5 seconds").
 *
 * A message is visible for `MSG_BLINK_MS`, hidden for one, visible, hidden,
 * visible — visible at 0, 2 and 4 s, hidden at 1 and 3 s — and at
 * `MSG_AUTO_ACK_MS` (5 s, `app.ts`) the driver's auto-clear takes it off the
 * screen and acks it exactly as before. The first phase is the render that
 * shows the message (no extra frame); each later phase is one re-render
 * (`driver.ts` coalesces it with a lane-blink phase due at the same instant),
 * which the queue turns into sends of only the top-strip halves whose pixels
 * changed (the message straddles the seam, so usually both) — never the cars
 * strip. In text mode a phase changes nothing the `msg` container shows, and
 * costs nothing.
 *
 * The blink is keyed on the message id: a new message restarts it, and a
 * phase can only ever hide the message it was started for.
 */

/** One phase of the message blink. */
export const MSG_BLINK_MS = 1_000;

/** Visibility per phase; the first is drawn with the state that showed it. */
export const MSG_BLINK_PHASES: readonly boolean[] = [
  true,
  false,
  true,
  false,
  true,
];

export interface MessageBlinkTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface MessageBlinkOptions {
  readonly timers: MessageBlinkTimers;
  /**
   * Applies a phase to message `msgId`. `render: false` when the caller has
   * nothing to draw (the message is gone, or the app is stopping).
   */
  readonly setVisible: (
    msgId: string,
    visible: boolean,
    render: boolean,
  ) => void;
}

export interface MessageBlink {
  /** (Re)starts the sequence for `msgId`, which is on screen and visible. */
  start(msgId: string): void;
  /** Stops the sequence and leaves the message visible, without rendering. */
  cancel(): void;
}

export function createMessageBlink(options: MessageBlinkOptions): MessageBlink {
  const { timers, setVisible } = options;
  let timer: number | undefined;
  let current: string | undefined;
  let phase = 0;

  const clear = (): void => {
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      timer = undefined;
    }
  };

  const next = (msgId: string): void => {
    timer = timers.setTimeout(() => {
      timer = undefined;
      phase += 1;
      setVisible(msgId, MSG_BLINK_PHASES[phase] ?? true, true);
      if (phase < MSG_BLINK_PHASES.length - 1) {
        next(msgId);
      }
    }, MSG_BLINK_MS);
  };

  return {
    start(msgId: string): void {
      clear();
      current = msgId;
      phase = 0;
      setVisible(msgId, MSG_BLINK_PHASES[0] ?? true, false);
      next(msgId);
    },
    cancel(): void {
      clear();
      if (current !== undefined) {
        setVisible(current, true, false);
        current = undefined;
      }
    },
  };
}
