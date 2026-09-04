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

export const STATUS_NO_LINK = 'NO LINK';
export const STATUS_NO_ROOM = 'ROOM ?';

export function statusConnecting(): string {
  return `CONNECTING${glyph('ellipsis')}`;
}

export function statusLinkOk(spotterOnline: boolean): string {
  return `LINK OK ${glyph('separator')} SPOTTER ${spotterOnline ? 'ON' : 'OFF'}`;
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
}

export function statusLine(input: StatusInput): string {
  if (!input.hasRoom) {
    return STATUS_NO_ROOM;
  }
  if (input.terminal !== undefined) {
    return statusTerminal(input.terminal);
  }
  if (input.linkOk) {
    return statusLinkOk(input.spotterOnline);
  }
  if (!input.everLinked && input.connection !== 'closed') {
    return statusConnecting();
  }

  return STATUS_NO_LINK;
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
