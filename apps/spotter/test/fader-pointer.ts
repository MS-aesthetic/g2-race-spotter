/**
 * Synthetic pointer input for the faders under jsdom, which has neither
 * layout nor `PointerEvent`: a `MouseEvent` carries `clientY`, `pointerId` is
 * pinned on, and each track reports a fixed box (top 100, 150 tall), so
 * detent n sits at y = 250 − 50·n.
 */
import { expect } from 'vitest';

export const TRACK_TOP = 100;
export const TRACK_HEIGHT = 150;

/** The y of detent `level` (0 bottom … 3 top) — or of any fraction 0..1. */
export function yAt(position: number): number {
  return TRACK_TOP + TRACK_HEIGHT * (1 - position);
}

/** The fader's panel: the pointer target (`data-act="fader"`). */
export function panel(row: 0 | 1 | 2): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-act="fader"][data-arg="${row}"]`,
  );
  expect(el).not.toBeNull();
  return el!;
}

/** The inner track: the knob's travel, whose box the finger is measured on. */
export function track(row: 0 | 1 | 2): HTMLElement {
  const el = panel(row).querySelector<HTMLElement>('.fader__track');
  expect(el).not.toBeNull();
  return el!;
}

/** Give every fader track a layout box (the renderer keeps the elements). */
export function stubTrackBoxes(): void {
  for (const row of [0, 1, 2] as const) {
    Object.defineProperty(track(row), 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({
          top: TRACK_TOP,
          bottom: TRACK_TOP + TRACK_HEIGHT,
          height: TRACK_HEIGHT,
          left: 0,
          right: 100,
          width: 100,
          x: 0,
          y: TRACK_TOP,
          toJSON: () => ({}),
        }) satisfies DOMRect,
    });
  }
}

export function pointer(
  type: string,
  target: EventTarget,
  clientY: number,
  pointerId = 1,
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  target.dispatchEvent(event);
}

/** A tap: down and up at the same spot on one track. */
export function tapFader(row: 0 | 1 | 2, level: number): void {
  pointer('pointerdown', track(row), yAt(level / 3));
  pointer('pointerup', track(row), yAt(level / 3));
}
