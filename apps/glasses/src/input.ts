/**
 * Glasses input. `toOsEvent` normalises first because the host has shipped the
 * event type as an ordinal, as a full name and as a shorthand, nested under
 * `textEvent` / `sysEvent` / `listEvent` or flat, depending on SDK version.
 *
 * Mapping (g2-hud-display skill): tap = ack, double tap = exit dialogue,
 * foreground enter = re-arm the socket, exit events = close it. Scroll is
 * reserved and does nothing in v1.
 */

import type { BridgeCallLog, BridgeLogger } from './bridge.ts';

export type OsEvent =
  | 'CLICK_EVENT'
  | 'SCROLL_TOP_EVENT'
  | 'SCROLL_BOTTOM_EVENT'
  | 'DOUBLE_CLICK_EVENT'
  | 'FOREGROUND_ENTER_EVENT'
  | 'FOREGROUND_EXIT_EVENT'
  | 'ABNORMAL_EXIT_EVENT'
  | 'SYSTEM_EXIT_EVENT'
  | 'IMU_DATA_REPORT';

/** Index = `OsEventTypeList` ordinal in the pinned SDK. */
const BY_ORDINAL: readonly OsEvent[] = [
  'CLICK_EVENT',
  'SCROLL_TOP_EVENT',
  'SCROLL_BOTTOM_EVENT',
  'DOUBLE_CLICK_EVENT',
  'FOREGROUND_ENTER_EVENT',
  'FOREGROUND_EXIT_EVENT',
  'ABNORMAL_EXIT_EVENT',
  'SYSTEM_EXIT_EVENT',
  'IMU_DATA_REPORT',
];

const NAMES = new Set<string>(BY_ORDINAL);

/** Exit-mode 1: pop the foreground layer and let the driver confirm. */
export const EXIT_MODE_DIALOGUE = 1;

/** A foreground bounce must not reconnect in a loop (030 R2 / input mapping). */
export const FOREGROUND_DEBOUNCE_MS = 1_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function fromValue(value: unknown): OsEvent | undefined {
  if (typeof value === 'number') {
    return BY_ORDINAL[value];
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const name = value
    .trim()
    .toUpperCase()
    .replace(/^OSEVENTTYPELIST\./, '');
  if (NAMES.has(name)) {
    return name as OsEvent;
  }

  const suffixed = `${name}_EVENT`;
  return NAMES.has(suffixed) ? (suffixed as OsEvent) : undefined;
}

/** Best-effort normalisation of whatever shape the host sent. */
export function toOsEvent(raw: unknown): OsEvent | undefined {
  const direct = fromValue(raw);
  if (direct !== undefined) {
    return direct;
  }

  const event = record(raw);
  if (event === undefined) {
    return undefined;
  }

  for (const key of ['textEvent', 'sysEvent', 'listEvent', 'jsonData']) {
    const nested = record(event[key]);
    if (nested === undefined) {
      continue;
    }

    const found = toOsEvent(nested);
    if (found !== undefined) {
      return found;
    }
  }

  return (
    fromValue(event.eventType) ??
    fromValue(event.Event_Type) ??
    fromValue(event.type)
  );
}

export interface InputHandlerOptions {
  readonly now: () => number;
  readonly shutDownPageContainer: (exitMode: number) => Promise<boolean>;
  /** Sends `ack{msgId}` through `RoomClient`. Never clears the message locally. */
  readonly ack: (msgId: string) => void;
  /** Id of the message currently rendered unacked, or undefined. */
  readonly unackedMessageId: () => string | undefined;
  /** Re-arm the socket and re-render the last state. */
  readonly reconnect: () => void;
  /** Close the socket (system/abnormal exit). */
  readonly disconnect: () => void;
  readonly log?: BridgeLogger;
}

export interface InputHandler {
  handle(raw: unknown): void;
  /**
   * Forgets which message this session has already acked. The relay is the only
   * authority on whether an ack landed: `RoomClient.send` silently drops an
   * `ack` while the socket is down or has not replayed, so the guard must be
   * released whenever fresh truth arrives (a `state` frame) or the transport
   * changed underneath it — otherwise one unlucky tap during a blip would
   * swallow every later tap for that message.
   */
  resetAckGuard(): void;
}

export function createInputHandler(options: InputHandlerOptions): InputHandler {
  let lastForegroundAt = Number.NEGATIVE_INFINITY;
  let ackedMessageId: string | undefined;
  const log: BridgeLogger =
    options.log ??
    ((entry: BridgeCallLog) => {
      console.info('g2rs.bridge', entry);
    });

  const handle = (raw: unknown): void => {
    const event = toOsEvent(raw);

    if (event === 'CLICK_EVENT') {
      const msgId = options.unackedMessageId();
      if (msgId !== undefined && msgId !== ackedMessageId) {
        ackedMessageId = msgId;
        options.ack(msgId);
      }
      return;
    }

    if (event === 'DOUBLE_CLICK_EVENT') {
      const startedAt = options.now();
      void options
        .shutDownPageContainer(EXIT_MODE_DIALOGUE)
        .then((result) => {
          log({
            call: 'shutDownPageContainer',
            ms: options.now() - startedAt,
            result,
          });
        })
        .catch((error: unknown) => {
          log({
            call: 'shutDownPageContainer',
            ms: options.now() - startedAt,
            result: { error },
          });
        });
      return;
    }

    if (event === 'FOREGROUND_ENTER_EVENT') {
      const now = options.now();
      if (now - lastForegroundAt < FOREGROUND_DEBOUNCE_MS) {
        return;
      }

      lastForegroundAt = now;
      options.reconnect();
      return;
    }

    if (event === 'SYSTEM_EXIT_EVENT' || event === 'ABNORMAL_EXIT_EVENT') {
      options.disconnect();
    }

    // FOREGROUND_EXIT_EVENT keeps the socket (iOS holds it); scroll and IMU
    // events are reserved for a later version.
  };

  return {
    handle,
    resetAckGuard: () => {
      ackedMessageId = undefined;
    },
  };
}
