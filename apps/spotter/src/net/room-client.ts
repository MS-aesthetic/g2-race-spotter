import {
  RoomClient,
  isPong,
  type RoomWebSocket,
  type RoomWebSocketConstructor,
} from '@g2-race-spotter/protocol';

import type { JoinForm } from '../model.ts';

/** EWMA window from the `spotter-ui` skill: five samples. */
export const LATENCY_SAMPLES = 5;
const LATENCY_ALPHA = 2 / (LATENCY_SAMPLES + 1);

/**
 * Exponentially weighted mean over ~5 samples. The first sample seeds the
 * average outright, so the header shows a number after one ping rather than
 * creeping up from zero.
 */
export function nextLatency(previous: number | null, sampleMs: number): number {
  const sample = Math.max(0, Math.round(sampleMs));
  if (previous === null) {
    return sample;
  }

  return Math.round(previous + LATENCY_ALPHA * (sample - previous));
}

/**
 * `RoomClient` owns the ping loop but exposes no round-trip hook: it drops
 * `pong` frames after using them as liveness proof. Rather than fork or edit
 * `packages/protocol` (which the glasses app also depends on), the wrapper
 * hands `RoomClient` a WebSocket constructor that tees every inbound frame to
 * an observer first. `pong.ts` is the client's own send timestamp, so the
 * round trip is simply `now() - pong.ts`.
 */
function observingWebSocket(
  Base: RoomWebSocketConstructor,
  onFrame: (event: unknown) => void,
): RoomWebSocketConstructor {
  return class ObservingWebSocket implements RoomWebSocket {
    private readonly inner: RoomWebSocket;

    constructor(url: string) {
      this.inner = new Base(url);
    }

    send(data: string): void {
      this.inner.send(data);
    }

    close(code?: number, reason?: string): void {
      this.inner.close?.(code, reason);
    }

    addEventListener(
      type: 'open' | 'close' | 'error' | 'message',
      listener: (event: unknown) => void,
    ): void {
      const wrapped =
        type === 'message'
          ? (event: unknown): void => {
              onFrame(event);
              listener(event);
            }
          : listener;

      if (this.inner.addEventListener) {
        this.inner.addEventListener(type, wrapped);
        return;
      }

      this.inner.on?.(type, (...args) => wrapped(args[0]));
    }
  };
}

function frameText(event: unknown): string | undefined {
  const data =
    typeof event === 'object' && event !== null && 'data' in event
      ? (event as { data: unknown }).data
      : event;

  return typeof data === 'string' ? data : undefined;
}

export interface SpotterClientOptions {
  WebSocket: RoomWebSocketConstructor;
  name?: string;
  now?: () => number;
  /** Called with one round-trip sample in ms per `pong`. */
  onLatency(sampleMs: number): void;
}

export function createSpotterClient(options: SpotterClientOptions): RoomClient {
  const now = options.now ?? Date.now;

  const observe = (event: unknown): void => {
    const text = frameText(event);
    if (text === undefined) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    if (isPong(parsed)) {
      options.onLatency(Math.max(0, now() - parsed.ts));
    }
  };

  return new RoomClient({
    WebSocket: observingWebSocket(options.WebSocket, observe),
    role: 'spotter',
    ...(options.name === undefined || options.name === ''
      ? {}
      : { name: options.name }),
    now,
  });
}

/** `wss://<host>/room/<ROOM>?role=spotter&token=<PIN?>&name=<name?>`. */
export function roomUrl(origin: string, form: JoinForm): string {
  const query = new URLSearchParams({ role: 'spotter' });
  if (form.pin !== '') {
    query.set('token', form.pin);
  }
  if (form.name !== '') {
    query.set('name', form.name);
  }

  return `${origin.replace(/\/+$/, '')}/room/${form.room}?${query.toString()}`;
}

/** Same origin as the served app unless `VITE_RELAY_URL` overrides it. */
export function relayOrigin(
  location: { protocol: string; host: string },
  override?: string,
): string {
  if (override !== undefined && override !== '') {
    return override.replace(/\/+$/, '');
  }

  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}`;
}
