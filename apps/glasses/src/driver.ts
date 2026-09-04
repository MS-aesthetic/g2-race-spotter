/**
 * Wires the pieces together: room state → store → queue, the NO LINK watchdog,
 * and glasses input. `main.ts` only builds the real bridge, client and queue and
 * hands them here, so the wiring itself is what the tests exercise.
 */

import type {
  Ack,
  ConnectionCloseDetail,
  ConnectionState,
  ErrorMessage,
  State,
} from '@g2-race-spotter/protocol';

import { HudApp, MSG_AUTO_ACK_MS, type RenderSink } from './app.ts';
import type { Bridge, BridgeLogger } from './bridge.ts';
import { createInputHandler } from './input.ts';
import { createLinkWatchdog, STATUS_BLINK_MS } from './link.ts';

/** How often the watchdog re-checks a quiet socket. */
export const LINK_CHECK_MS = 1_000;

/** The `RoomClient` surface the driver app uses. */
export interface DriverClient {
  readonly lastFrameAt: number | undefined;
  onState(listener: (state: State) => void): () => void;
  onConnection(
    listener: (state: ConnectionState, detail: ConnectionCloseDetail) => void,
  ): () => void;
  onError(listener: (error: ErrorMessage) => void): () => void;
  send(intent: Ack): void;
  disconnect(): void;
}

export interface IntervalTimers {
  setInterval(callback: () => void, delayMs: number): number;
  clearInterval(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

const browserIntervals: IntervalTimers = {
  setInterval: (callback, delayMs) =>
    globalThis.setInterval(callback, delayMs) as unknown as number,
  clearInterval: (handle) => globalThis.clearInterval(handle),
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export interface DriverOptions {
  readonly bridge: Bridge;
  readonly client: DriverClient;
  readonly queue: RenderSink;
  readonly hasRoom: boolean;
  /** Status text already on the startup page (see `HudAppOptions`). */
  readonly initialStatus?: string | undefined;
  readonly now: () => number;
  /** Re-arms the socket on `FOREGROUND_ENTER_EVENT`. */
  readonly connect: () => void;
  readonly timers?: IntervalTimers;
  readonly log?: BridgeLogger;
}

export interface Driver {
  readonly app: HudApp;
  /** Re-evaluates the link now; the interval does this on its own. */
  checkLink(): void;
  stop(): void;
}

export function startDriver(options: DriverOptions): Driver {
  const { bridge, client, queue } = options;
  const timers = options.timers ?? browserIntervals;

  const app = new HudApp({
    queue,
    ack: (msgId) => {
      client.send({ t: 'ack', msgId });
    },
    hasRoom: options.hasRoom,
    initialStatus: options.initialStatus,
  });

  // True only while a `state` frame is being applied: the link check that runs
  // first would otherwise render the PREVIOUS lane/gap un-dimmed, costing a
  // second image send per recovery and flashing a stale gap at full intensity.
  let applyingState = false;

  // The `L` blinks only while the link is down, and the timer exists only for
  // as long as it blinks: a free-running interval would repaint the strip (one
  // bridge call each) for the whole of a healthy session.
  let blinkTimer: number | undefined;
  const syncBlink = (): void => {
    if (app.statusBlinking) {
      blinkTimer ??= timers.setInterval(() => {
        app.tickBlink();
      }, STATUS_BLINK_MS);
      return;
    }

    if (blinkTimer !== undefined) {
      timers.clearInterval(blinkTimer);
      blinkTimer = undefined;
    }
    app.resetBlink();
  };

  // A message clears itself `MSG_AUTO_ACK_MS` after it first reached the
  // screen, and acks itself on the way out so the relay's state and the
  // spotter's tick agree with what the driver can actually see. The timer is
  // per message id: a re-render of the same message must not extend its life,
  // and a new message starts a fresh five seconds.
  let msgTimer: number | undefined;
  let msgTimerFor: string | undefined;
  let shownMsgId: string | undefined;
  let shownAt = 0;
  /** Message this session has already acked — from a tap or from the timer. */
  let settledMsgId: string | undefined;

  const clearMsgTimer = (): void => {
    if (msgTimer !== undefined) {
      timers.clearTimeout(msgTimer);
      msgTimer = undefined;
    }
    msgTimerFor = undefined;
  };

  const syncMessageTimer = (): void => {
    const msgId = app.unackedMessageId();
    if (msgId === undefined) {
      clearMsgTimer();
      shownMsgId = undefined;
      return;
    }

    if (msgId !== shownMsgId) {
      shownMsgId = msgId;
      shownAt = options.now();
    }

    if (msgId === settledMsgId) {
      clearMsgTimer();
      return;
    }

    if (msgTimerFor === msgId) {
      return;
    }

    clearMsgTimer();
    msgTimerFor = msgId;
    // Measured from first render, not from this frame: an unrelated `state`
    // (a gap change, say) must not buy the message another five seconds.
    const remaining = Math.max(0, MSG_AUTO_ACK_MS - (options.now() - shownAt));
    msgTimer = timers.setTimeout(() => {
      msgTimer = undefined;
      msgTimerFor = undefined;
      const stillUnacked = app.unackedMessageId() === msgId;
      settledMsgId = msgId;
      app.hideMessage(msgId);
      if (stillUnacked) {
        app.ack(msgId);
      }
    }, remaining);
  };

  const watchdog = createLinkWatchdog({
    now: options.now,
    lastFrameAt: () => client.lastFrameAt,
    onChange: (linkOk) => {
      app.setLinkOk(linkOk, { render: !applyingState });
    },
  });

  const input = createInputHandler({
    now: options.now,
    shutDownPageContainer: (exitMode) => bridge.shutDownPageContainer(exitMode),
    ack: (msgId) => {
      // The tap is the ack; the auto-clear timer has nothing left to do. The
      // text still stays up until the relay's next `state` says `ackedAt`.
      settledMsgId = msgId;
      clearMsgTimer();
      app.ack(msgId);
    },
    unackedMessageId: () => app.unackedMessageId(),
    reconnect: () => {
      options.connect();
      app.render();
    },
    disconnect: () => {
      client.disconnect();
    },
    ...(options.log === undefined ? {} : { log: options.log }),
  });

  const unsubscribe = [
    client.onState((state) => {
      // Check the link first — this frame is what clears NO LINK — but let the
      // state render carry the verdict, so one frame means one HUD job.
      applyingState = true;
      try {
        watchdog.check();
        app.applyState(state);
      } finally {
        applyingState = false;
      }
      syncBlink();
      syncMessageTimer();

      // Fresh truth from the relay: an ack that never left is tappable again.
      input.resetAckGuard();
    }),
    client.onConnection((connection, detail) => {
      app.setConnection(connection, detail);
      watchdog.check();
      syncBlink();
      if (connection !== 'open') {
        // `RoomClient.send` drops an ack while the socket is down, so the one
        // this session "settled" may never have left. Forget it: the replayed
        // state re-arms the timer and the message clears on the next window.
        input.resetAckGuard();
        settledMsgId = undefined;
        syncMessageTimer();
      }
    }),
    client.onError((error) => {
      app.setError(error);
      syncBlink();
    }),
    bridge.onEvenHubEvent(input.handle),
  ];

  const interval = timers.setInterval(() => {
    watchdog.check();
    // Catch-all: anything else that changed the strip (a room configured from
    // the companion, say) starts or stops the blink within one tick.
    syncBlink();
  }, LINK_CHECK_MS);

  app.render();
  syncBlink();

  return {
    app,
    checkLink: () => {
      watchdog.check();
      syncBlink();
    },
    stop: () => {
      timers.clearInterval(interval);
      if (blinkTimer !== undefined) {
        timers.clearInterval(blinkTimer);
        blinkTimer = undefined;
      }
      clearMsgTimer();
      for (const off of unsubscribe) {
        off();
      }
    },
  };
}
