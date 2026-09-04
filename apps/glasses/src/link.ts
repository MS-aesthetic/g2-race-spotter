/**
 * NO LINK watchdog and the status strip strings.
 *
 * Constitution §1: the driver never sees stale data as live. `lastFrameAt` is
 * per socket session in `RoomClient` (`undefined` until the current socket has
 * delivered a frame), so a reconnect blip legitimately shows NO LINK and a
 * dimmed HUD until the replayed `state` lands.
 */

import {
  CLOSE_CODE_AUTH,
  CLOSE_CODE_BAD_HELLO,
  CLOSE_CODE_DRIVER_EVICTED,
  CLOSE_CODE_VERSION,
  DRIVER_NO_LINK_MS,
  type ConnectionState,
  type ErrorCode,
} from '@g2-race-spotter/protocol';

import { glyph } from './render/glyphs.ts';

export const STATUS_NO_ROOM = 'ROOM ?';

/** Blink period of the `L` while the link is down (Maxx, 2026-09-04). */
export const STATUS_BLINK_MS = 700;

export function statusConnecting(): string {
  return `CONNECTING${glyph('ellipsis')}`;
}

/**
 * The whole steady-state strip, two letters in fixed columns (Maxx,
 * 2026-09-04): `L` for the link — solid when it is up, blinking when it is not
 * — and `S`, present only while the spotter is connected. The letter's column
 * never moves, so a blinking `L` reads as a blink and not as a re-layout.
 *
 * `blinkOn` is the phase of that blink and is ignored while the link is up.
 */
export function statusStrip(
  linkOk: boolean,
  spotterOnline: boolean,
  blinkOn = true,
): string {
  const link = linkOk || blinkOn ? 'L' : ' ';
  const strip = spotterOnline ? `${link} S` : link;
  return strip.trimEnd();
}

/** `true` while the current socket session has produced a frame recently. */
export function isLinkOk(
  lastFrameAt: number | undefined,
  now: number,
): boolean {
  return lastFrameAt !== undefined && now - lastFrameAt <= DRIVER_NO_LINK_MS;
}

export interface TerminalClose {
  readonly code?: number | undefined;
  readonly error?: ErrorCode | undefined;
}

/** A terminal close is reported, not retried: the app must not spin. */
export function statusTerminal(close: TerminalClose): string {
  if (close.error === 'auth' || close.code === CLOSE_CODE_AUTH) {
    return 'PIN REJECTED';
  }
  if (
    close.error === 'role_taken' ||
    close.code === CLOSE_CODE_DRIVER_EVICTED
  ) {
    return 'DRIVER REPLACED';
  }
  if (close.error === 'version' || close.code === CLOSE_CODE_VERSION) {
    return 'UPDATE APP';
  }
  if (close.error === 'bad_frame' || close.code === CLOSE_CODE_BAD_HELLO) {
    return 'LINK ERROR';
  }

  return 'DISCONNECTED';
}

export interface StatusInput {
  readonly hasRoom: boolean;
  readonly connection: ConnectionState;
  readonly linkOk: boolean;
  readonly spotterOnline: boolean;
  /** Any frame received since app start — before that, the app is connecting. */
  readonly everLinked: boolean;
  readonly terminal?: TerminalClose | undefined;
  /** Phase of the NO-LINK blink; `true` (letter shown) unless a timer says so. */
  readonly blinkOn?: boolean | undefined;
}

export function statusLine(input: StatusInput): string {
  if (!input.hasRoom) {
    return STATUS_NO_ROOM;
  }
  if (input.terminal !== undefined) {
    return statusTerminal(input.terminal);
  }
  if (input.linkOk) {
    return statusStrip(true, input.spotterOnline);
  }
  if (!input.everLinked && input.connection !== 'closed') {
    return statusConnecting();
  }

  return statusStrip(false, input.spotterOnline, input.blinkOn ?? true);
}

/** Whether {@link statusLine} for this input is a phase of the blink — the
 * only state in which the driver app runs the blink timer. */
export function statusBlinks(input: StatusInput): boolean {
  return (
    input.hasRoom &&
    input.terminal === undefined &&
    !input.linkOk &&
    (input.everLinked || input.connection === 'closed')
  );
}

export interface LinkWatchdogOptions {
  readonly now: () => number;
  readonly lastFrameAt: () => number | undefined;
  readonly onChange: (linkOk: boolean) => void;
}

export interface LinkWatchdog {
  readonly linkOk: boolean;
  /** Re-evaluates the link; fires `onChange` only on a transition. */
  check(): boolean;
}

export function createLinkWatchdog(options: LinkWatchdogOptions): LinkWatchdog {
  let linkOk = false;

  return {
    get linkOk(): boolean {
      return linkOk;
    },
    check(): boolean {
      const next = isLinkOk(options.lastFrameAt(), options.now());
      if (next !== linkOk) {
        linkOk = next;
        options.onChange(next);
      }

      return next;
    },
  };
}
