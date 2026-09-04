import {
  CLOSE_CODE_AUTH,
  CLOSE_CODE_BAD_HELLO,
  CLOSE_CODE_DRIVER_EVICTED,
  CLOSE_CODE_VERSION,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  isErrorMessage,
  isServerMessage,
  isState,
  type Clear,
  type Ack,
  type ClientMessage,
  type ErrorMessage,
  type Hello,
  type Role,
  type SetGap,
  type SetLane,
  type SetMsg,
  type State,
} from './index.ts';

export type ConnectionState = 'connecting' | 'open' | 'closed';
/**
 * User-originated frames accepted by the shared client.  Acknowledgements
 * are deliberately dropped while offline: unlike lane/gap/msg/clear they
 * are not a durable user intent and must not acknowledge a later message
 * after the room replay establishes the current state.
 */
export type RoomClientIntent = SetLane | SetGap | SetMsg | Clear | Ack;

/**
 * Second argument to every `onConnection` callback. Only meaningful when
 * `state === 'closed'`: `code` is the WebSocket close code (`undefined` when
 * the transport never supplied one, e.g. a bare `error` event with no
 * matching `close`), and `terminal` is `isTerminalClose(code)` — true for
 * 4400/4401/4409/4426, the codes after which the client does not reconnect.
 * Added as a second parameter (not a replacement payload) so existing
 * single-argument `onConnection` subscribers keep compiling and running
 * unchanged; UIs that need to distinguish a terminal rejection (show the PIN
 * prompt / reload prompt) from a reconnecting drop read this argument.
 */
export interface ConnectionCloseDetail {
  code: number | undefined;
  terminal: boolean;
}

const NON_CLOSE_DETAIL: ConnectionCloseDetail = {
  code: undefined,
  terminal: false,
};

export interface WebSocketMessageEvent {
  data: unknown;
}

export interface WebSocketCloseEvent {
  code?: number;
}

export interface RoomWebSocket {
  send(data: string): void;
  close?(code?: number, reason?: string): void;
  addEventListener?(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: unknown) => void,
  ): void;
  on?(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (...args: unknown[]) => void,
  ): void;
}

export interface RoomWebSocketConstructor {
  new (url: string): RoomWebSocket;
}

export interface RoomClientTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  setInterval(callback: () => void, delayMs: number): number;
  clearInterval(handle: number): void;
}

export interface RoomClientOptions {
  WebSocket: RoomWebSocketConstructor;
  role: Role;
  name?: string;
  timers?: RoomClientTimers;
  now?: () => number;
  random?: () => number;
}

const browserTimers: RoomClientTimers = {
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  setInterval: (callback, delayMs) =>
    globalThis.setInterval(callback, delayMs) as unknown as number,
  clearInterval: (handle) => globalThis.clearInterval(handle),
};

function textFrame(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(value);
  }

  return undefined;
}

function eventData(event: unknown): unknown {
  if (typeof event === 'object' && event !== null && 'data' in event) {
    return (event as WebSocketMessageEvent).data;
  }

  return event;
}

function closeCode(event: unknown): number | undefined {
  if (typeof event === 'number') {
    return event;
  }

  if (typeof event !== 'object' || event === null || !('code' in event)) {
    return undefined;
  }

  const { code } = event as WebSocketCloseEvent;
  return typeof code === 'number' ? code : undefined;
}

function isTerminalClose(event: unknown): boolean {
  const code = closeCode(event);
  return (
    code === CLOSE_CODE_BAD_HELLO ||
    code === CLOSE_CODE_AUTH ||
    code === CLOSE_CODE_DRIVER_EVICTED ||
    code === CLOSE_CODE_VERSION
  );
}

/**
 * Transport-only client shared by the PWA and glasses WebView. Room state
 * remains authoritative: reconnects wait for the relay's state replay before
 * sending intents that were issued while a socket was unavailable.
 */
export class RoomClient {
  private readonly WebSocket: RoomWebSocketConstructor;
  private readonly role: Role;
  private readonly name: string | undefined;
  private readonly timers: RoomClientTimers;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly stateListeners = new Set<(state: State) => void>();
  private readonly errorListeners = new Set<(error: ErrorMessage) => void>();
  private readonly connectionListeners = new Set<
    (state: ConnectionState, detail: ConnectionCloseDetail) => void
  >();
  private socket: RoomWebSocket | undefined;
  private url: string | undefined;
  private pingTimer: number | undefined;
  private reconnectTimer: number | undefined;
  private reconnectAttempt = 0;
  private status: ConnectionState = 'closed';
  private replayed = false;
  private pendingLane: SetLane | undefined;
  private pendingGap: SetGap | undefined;
  private readonly pendingMessages: Array<SetMsg | Clear> = [];

  /** Most recent accepted state sequence for the current socket only. */
  lastSeen = 0;

  /**
   * Local receive time of the last frame from the *current* socket session,
   * for the NO LINK UI. `undefined` until that session delivers its first
   * frame: a previous session's frames never vouch for a new socket.
   */
  lastFrameAt: number | undefined;

  constructor(options: RoomClientOptions) {
    this.WebSocket = options.WebSocket;
    this.role = options.role;
    this.name = options.name;
    this.timers = options.timers ?? browserTimers;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  connect(url: string): void {
    // Only a session that has already replayed its `state` counts as
    // "healthy" for the same-URL no-op: a socket still CONNECTING (or open
    // but not yet replayed) may never open at all (e.g. a zombie left behind
    // by a suspended tab), and a foreground reconnect must not be blocked by
    // it. `retireSocket`/`openSocket` below replace it immediately rather
    // than waiting for its `close` — the socket-identity guard in
    // handleOpen/handleMessage/handleClose already ignores events from a
    // socket that is no longer `this.socket`, so the old socket's handlers
    // cannot leak state into the new session even though they are not
    // explicitly removed.
    if (this.url === url && this.socket !== undefined && this.replayed) {
      return;
    }

    const urlChanged = this.url !== undefined && this.url !== url;
    this.url = url;
    this.clearReconnectTimer();
    this.clearPingTimer();
    this.retireSocket();
    if (urlChanged) {
      this.clearPending();
    }
    this.openSocket();
  }

  disconnect(): void {
    this.url = undefined;
    this.clearReconnectTimer();
    this.clearPingTimer();

    this.retireSocket();
    this.replayed = false;
    this.lastFrameAt = undefined;
    this.clearPending();
    this.setConnectionState('closed');
  }

  onState(listener: (state: State) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onConnection(
    listener: (state: ConnectionState, detail: ConnectionCloseDetail) => void,
  ): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  /** Subscribes to `error` frames (`{t:'error', code, detail?}`). Multiple
   * subscribers allowed; returns an unsubscribe function, matching
   * `onState`/`onConnection`. */
  onError(listener: (error: ErrorMessage) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  send(intent: RoomClientIntent): void {
    if (!this.socket || !this.replayed) {
      if (intent.t !== 'ack') {
        this.queue(intent);
      }
      return;
    }

    this.sendFrame(intent);
  }

  private openSocket(): void {
    if (!this.url) {
      return;
    }

    this.clearPingTimer();
    this.replayed = false;
    this.lastSeen = 0;
    this.lastFrameAt = undefined;
    this.setConnectionState('connecting');

    const socket = new this.WebSocket(this.url);
    this.socket = socket;
    this.listen(socket, 'open', () => this.handleOpen(socket));
    this.listen(socket, 'message', (event) =>
      this.handleMessage(socket, event),
    );
    this.listen(socket, 'close', (event) => this.handleClose(socket, event));
    this.listen(socket, 'error', () => undefined);
  }

  private listen(
    socket: RoomWebSocket,
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: unknown) => void,
  ): void {
    if (socket.addEventListener) {
      socket.addEventListener(type, listener);
      return;
    }

    socket.on?.(type, (...args) => listener(args[0]));
  }

  private handleOpen(socket: RoomWebSocket): void {
    if (this.socket !== socket || !this.url) {
      return;
    }

    this.lastSeen = 0;
    this.replayed = false;
    this.setConnectionState('open');
    this.sendFrame(this.hello());
    this.pingTimer = this.timers.setInterval(
      () => this.sendPing(socket),
      PING_INTERVAL_MS,
    );
  }

  private handleMessage(socket: RoomWebSocket, event: unknown): void {
    if (this.socket !== socket) {
      return;
    }

    // Every frame from the current socket proves the transport is alive,
    // including malformed/unknown frames that are not safe to render.
    this.lastFrameAt = this.now();

    const frame = textFrame(eventData(event));
    if (frame === undefined) {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(frame);
    } catch {
      return;
    }

    if (!isServerMessage(message)) {
      return;
    }

    if (isErrorMessage(message)) {
      for (const listener of this.errorListeners) {
        listener(message);
      }
      return;
    }

    if (!isState(message) || message.seq <= this.lastSeen) {
      return;
    }

    this.lastSeen = message.seq;
    for (const listener of this.stateListeners) {
      listener(message);
    }

    if (!this.replayed) {
      this.replayed = true;
      this.reconnectAttempt = 0;
      this.flushPending();
    }
  }

  private handleClose(socket: RoomWebSocket, event: unknown): void {
    if (this.socket !== socket) {
      return;
    }

    this.socket = undefined;
    this.replayed = false;
    this.clearPingTimer();
    const terminal = isTerminalClose(event);
    const code = closeCode(event);
    if (terminal) {
      // No reconnect follows a terminal close (4400/4401/4409/4426): the
      // last frame of the dead session must not keep the NO LINK watchdog
      // quiet, and anything queued while this rejected session was down
      // must not leak into a later session — there is no later session.
      this.lastFrameAt = undefined;
      this.clearPending();
    }
    this.setConnectionState('closed', { code, terminal });
    if (!terminal) {
      this.scheduleReconnect();
    }
  }

  private sendPing(socket: RoomWebSocket): void {
    if (this.socket !== socket) {
      return;
    }

    this.sendFrame({ t: 'ping', ts: this.now() });
  }

  private hello(): Hello {
    return {
      t: 'hello',
      v: PROTOCOL_VERSION,
      role: this.role,
      ...(this.name === undefined ? {} : { name: this.name }),
    };
  }

  private sendFrame(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  private queue(intent: Exclude<RoomClientIntent, Ack>): void {
    if (intent.t === 'lane') {
      this.pendingLane = intent;
      return;
    }

    if (intent.t === 'gap') {
      this.pendingGap = intent;
      return;
    }

    this.pendingMessages.push(intent);
  }

  private flushPending(): void {
    const pending = [
      this.pendingLane,
      this.pendingGap,
      ...this.pendingMessages,
    ].filter(
      (message): message is Exclude<RoomClientIntent, Ack> =>
        message !== undefined,
    );

    this.pendingLane = undefined;
    this.pendingGap = undefined;
    this.pendingMessages.length = 0;

    for (const intent of pending) {
      this.sendFrame(intent);
    }
  }

  private scheduleReconnect(): void {
    if (!this.url || this.reconnectTimer !== undefined) {
      return;
    }

    const baseDelay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_MIN_MS * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    const jitteredDelay = Math.max(
      RECONNECT_MIN_MS,
      Math.min(RECONNECT_MAX_MS, Math.round(baseDelay * (0.5 + this.random()))),
    );
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, jitteredDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) {
      return;
    }

    this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearPingTimer(): void {
    if (this.pingTimer === undefined) {
      return;
    }

    this.timers.clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private retireSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    socket?.close?.();
  }

  private clearPending(): void {
    this.pendingLane = undefined;
    this.pendingGap = undefined;
    this.pendingMessages.length = 0;
  }

  private setConnectionState(
    next: ConnectionState,
    detail: ConnectionCloseDetail = NON_CLOSE_DETAIL,
  ): void {
    if (this.status === next) {
      return;
    }

    this.status = next;
    for (const listener of this.connectionListeners) {
      listener(next, detail);
    }
  }
}
