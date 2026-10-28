import { DurableObject } from 'cloudflare:workers';

import { earlierAlarmAt, nextAlarmAt, staleClearDue } from './alarm.js';

import {
  CLOSE_CODE_AUTH,
  CLOSE_CODE_BAD_HELLO,
  CLOSE_CODE_DRIVER_EVICTED,
  CLOSE_CODE_SILENT_PEER,
  CLOSE_CODE_VERSION,
  createInitialState,
  FRAME_MAX_BYTES,
  isClientMessage,
  isClientMessageType,
  isHello,
  isPing,
  isState,
  PEER_OFFLINE_MS,
  PROTOCOL_VERSION,
  reduce,
  ROOM_TTL_MS,
  senderRole,
  type ErrorMessage,
  type Role,
  type State,
} from '@g2-race-spotter/protocol';

interface SocketAttachment {
  readonly role: Role | null;
  readonly name: string | undefined;
  readonly token: string | null;
  readonly tokenPresent: boolean;
  readonly lastPing: number;
  readonly ready: boolean;
  readonly rejected?: boolean;
}

interface StoredPin {
  readonly value: string | null;
}

function serialize(message: object): string {
  return JSON.stringify(message);
}

const encoder = new TextEncoder();

/** `FRAME_MAX_BYTES` is a UTF-8 byte cap, checked before `JSON.parse`. */
function oversized(raw: string): boolean {
  // A string longer than the cap in UTF-16 units is over it in bytes too;
  // skip encoding pathological frames.
  return (
    raw.length > FRAME_MAX_BYTES || encoder.encode(raw).length > FRAME_MAX_BYTES
  );
}

/** An empty `name` (URL or hello) means "no name". */
function presentName(name: string | null | undefined): string | undefined {
  return name === null || name === undefined || name === '' ? undefined : name;
}

type DropReason =
  | 'unknown_t'
  | 'wrong_role'
  | 'bad_frame'
  | 'oversized'
  | 'binary'
  | 'silent_peer';

/**
 * Dropped/rejected frames are counted as one structured log line each, never
 * with the frame body (020 AC-9; 060 R4 shape).
 */
function logDrop(reason: DropReason, role: Role | null, t?: string): void {
  console.log(
    JSON.stringify({
      ev: 'drop',
      reason,
      role,
      ...(t === undefined ? {} : { t }),
    }),
  );
}

function frameType(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const t = (value as { t?: unknown }).t;
  return typeof t === 'string' ? t : undefined;
}

function isSocketAttachment(value: unknown): value is SocketAttachment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const attachment = value as Record<string, unknown>;
  return (
    (attachment.role === 'spotter' ||
      attachment.role === 'driver' ||
      attachment.role === null) &&
    (attachment.name === undefined || typeof attachment.name === 'string') &&
    (attachment.token === null || typeof attachment.token === 'string') &&
    typeof attachment.tokenPresent === 'boolean' &&
    typeof attachment.lastPing === 'number' &&
    typeof attachment.ready === 'boolean' &&
    (attachment.rejected === undefined ||
      typeof attachment.rejected === 'boolean')
  );
}

export class RaceRoom extends DurableObject<Env> {
  private state: State | undefined;

  private async loadState(): Promise<State> {
    if (this.state === undefined) {
      // Storage outlives a deploy: a room written by an older relay (v1:
      // `gap`/`side`, no `cars`/`calledAt`) must not be replayed — no v2
      // client would accept it and `alarm()` would throw on it. Start the
      // room's state fresh; `pin` and `createdAt` are separate keys and stay.
      const stored = await this.ctx.storage.get('state');
      if (stored !== undefined && !isState(stored)) {
        console.warn(
          'g2rs: discarding stored room state with an unknown shape (older protocol?)',
        );
      }
      if (isState(stored)) {
        // A v2 room stored before presets existed (additive field) keeps its
        // lane/cars/msg and simply has none saved yet.
        this.state =
          stored.presets === undefined ? { ...stored, presets: [] } : stored;
      } else {
        // Keep the old room's clock so a v1 room nobody rejoins still gets
        // its full TTL instead of expiring (and dropping its PIN) at once.
        const updatedAt =
          typeof stored === 'object' &&
          stored !== null &&
          typeof (stored as { updatedAt?: unknown }).updatedAt === 'number' &&
          Number.isFinite((stored as { updatedAt: number }).updatedAt)
            ? (stored as { updatedAt: number }).updatedAt
            : 0;
        this.state = { ...createInitialState(), updatedAt };
      }
    }
    return this.state;
  }

  private async persistAndBroadcast(
    next: State,
    exclude?: WebSocket,
  ): Promise<void> {
    await this.ctx.storage.put('state', next);
    this.state = next;
    const frame = serialize(next);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== exclude && this.isLive(socket)) {
        socket.send(frame);
      }
    }
  }

  private async scheduleAlarm(
    state?: State,
    unavailable?: WebSocket,
  ): Promise<void> {
    const current = state ?? (await this.loadState());
    const socketCount = this.ctx
      .getWebSockets()
      .filter(
        (socket) =>
          socket !== unavailable && this.attachment(socket)?.rejected !== true,
      ).length;
    await this.ctx.storage.setAlarm(
      nextAlarmAt(socketCount, current, Date.now()),
    );
  }

  /**
   * A state change may pull the armed alarm EARLIER to its stale-clear
   * target, never later — so a spotter call cannot postpone the tick, and
   * the tick cannot postpone the clear.
   */
  private async pullAlarmEarlier(state: State): Promise<void> {
    const target = earlierAlarmAt(await this.ctx.storage.getAlarm(), state);
    if (target !== undefined) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  private attachment(socket: WebSocket): SocketAttachment | undefined {
    const attachment = socket.deserializeAttachment();
    return isSocketAttachment(attachment) ? attachment : undefined;
  }

  private hasReadyPeer(role: Role, unavailable?: WebSocket): boolean {
    return this.ctx
      .getWebSockets(role)
      .some((socket) => socket !== unavailable && this.isLive(socket));
  }

  /** A joined socket the relay has not rejected, evicted or reaped. */
  private isLive(socket: WebSocket): boolean {
    const attachment = this.attachment(socket);
    return attachment?.ready === true && attachment.rejected !== true;
  }

  private async reconcilePeers(
    exclude?: WebSocket,
    unavailable?: WebSocket,
  ): Promise<{ readonly state: State; readonly changed: boolean }> {
    const state = await this.loadState();
    const context = { now: Date.now(), newId: () => crypto.randomUUID() };
    let next = state;
    for (const role of ['spotter', 'driver'] as const) {
      next = reduce(
        next,
        { t: 'peer', role, online: this.hasReadyPeer(role, unavailable) },
        context,
      );
    }
    if (next !== state) {
      await this.persistAndBroadcast(next, exclude);
    }
    return { state: next, changed: next !== state };
  }

  private sendBadHello(socket: WebSocket, attachment?: SocketAttachment): void {
    if (attachment !== undefined) {
      socket.serializeAttachment({ ...attachment, rejected: true });
    }
    const error: ErrorMessage = { t: 'error', code: 'bad_frame' };
    socket.send(serialize(error));
    socket.close(CLOSE_CODE_BAD_HELLO, 'hello must match URL');
  }

  /** Malformed frame on a joined socket: report it, keep the socket (AC-9). */
  private sendBadFrame(
    socket: WebSocket,
    role: Role | null,
    reason: DropReason,
    t?: string,
  ): void {
    logDrop(reason, role, t);
    const error: ErrorMessage = { t: 'error', code: 'bad_frame' };
    socket.send(serialize(error));
  }

  private rejectSocket(
    socket: WebSocket,
    attachment: SocketAttachment,
    error: ErrorMessage,
    code: number,
    reason: string,
  ): void {
    socket.serializeAttachment({ ...attachment, rejected: true });
    socket.send(serialize(error));
    socket.close(code, reason);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('X-G2RS-Internal-Debug') === '1') {
      const state = await this.loadState();
      const url = new URL(request.url);
      if (url.searchParams.has('alarm')) {
        return Response.json({
          state,
          alarm: await this.ctx.storage.getAlarm(),
          createdAt: (await this.ctx.storage.get<number>('createdAt')) ?? null,
        });
      }
      return Response.json(state);
    }

    const url = new URL(request.url);
    const requestedRole = url.searchParams.get('role');
    const role: Role | null =
      requestedRole === 'spotter' || requestedRole === 'driver'
        ? requestedRole
        : null;

    const name = presentName(url.searchParams.get('name'));
    const tokenPresent = url.searchParams.has('token');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      role,
      name,
      token: tokenPresent ? url.searchParams.get('token') : null,
      tokenPresent,
      lastPing: Date.now(),
      ready: false,
    };
    this.ctx.acceptWebSocket(server, role === null ? [] : [role]);
    server.serializeAttachment(attachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    socket: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = this.attachment(socket);
    if (attachment?.rejected === true) {
      return;
    }
    if (attachment === undefined) {
      this.sendBadHello(socket, attachment);
      return;
    }

    // A joined socket survives malformed frames (020 AC-9); before `hello`
    // anything but a valid hello still closes 4400.
    if (typeof raw !== 'string') {
      if (attachment.ready) {
        this.sendBadFrame(socket, attachment.role, 'binary');
      } else {
        this.sendBadHello(socket, attachment);
      }
      return;
    }

    if (oversized(raw)) {
      if (attachment.ready) {
        this.sendBadFrame(socket, attachment.role, 'oversized');
      } else {
        this.sendBadHello(socket, attachment);
      }
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      if (attachment.ready) {
        this.sendBadFrame(socket, attachment.role, 'bad_frame');
      } else {
        this.sendBadHello(socket, attachment);
      }
      return;
    }

    if (!attachment.ready) {
      if (!isHello(value)) {
        this.sendBadHello(socket, attachment);
        return;
      }

      if (value.v !== PROTOCOL_VERSION) {
        this.rejectSocket(
          socket,
          attachment,
          { t: 'error', code: 'version' },
          CLOSE_CODE_VERSION,
          'protocol version does not match room',
        );
        return;
      }

      if (
        attachment.role === null ||
        value.role !== attachment.role ||
        presentName(value.name) !== attachment.name
      ) {
        this.sendBadHello(socket, attachment);
        return;
      }

      if (
        attachment.tokenPresent &&
        (attachment.token === null || !/^\d{4}$/.test(attachment.token))
      ) {
        this.rejectSocket(
          socket,
          attachment,
          { t: 'error', code: 'auth' },
          CLOSE_CODE_AUTH,
          'PIN must be four digits',
        );
        return;
      }

      const pin = await this.ctx.storage.get<StoredPin>('pin');
      if (pin === undefined) {
        const createdAt = Date.now();
        await this.ctx.storage.put({
          pin: { value: attachment.token },
          createdAt,
        });
      } else if (pin.value !== null && pin.value !== attachment.token) {
        this.rejectSocket(
          socket,
          attachment,
          { t: 'error', code: 'auth' },
          CLOSE_CODE_AUTH,
          'PIN does not match room',
        );
        return;
      }

      if (attachment.role === 'driver') {
        const staleDrivers = this.ctx
          .getWebSockets('driver')
          .filter((existing) => {
            if (existing === socket) {
              return false;
            }
            const existingAttachment = this.attachment(existing);
            return (
              existingAttachment?.ready === true &&
              existingAttachment.rejected !== true
            );
          });
        for (const stale of staleDrivers) {
          const staleAttachment = this.attachment(stale);
          if (staleAttachment !== undefined) {
            this.rejectSocket(
              stale,
              staleAttachment,
              { t: 'error', code: 'role_taken' },
              CLOSE_CODE_DRIVER_EVICTED,
              'driver role taken by a newer connection',
            );
          }
        }
      }

      socket.serializeAttachment({
        ...attachment,
        ready: true,
        lastPing: Date.now(),
      });
      const peers = await this.reconcilePeers(socket);
      socket.send(serialize(peers.state));
      await this.scheduleAlarm(peers.state);
      return;
    }

    if (attachment.role === null) {
      this.sendBadHello(socket, attachment);
      return;
    }

    const t = frameType(value);
    if (t === undefined) {
      // Valid JSON but not a frame at all.
      this.sendBadFrame(socket, attachment.role, 'bad_frame');
      return;
    }
    if (!isClientMessageType(t)) {
      // Unknown `t`: ignore and count — a newer client may send frames this
      // relay does not know yet.
      // Client-chosen text: log a short prefix only, never a body fragment.
      logDrop('unknown_t', attachment.role, t.slice(0, 16));
      return;
    }

    if (!isClientMessage(value)) {
      this.sendBadFrame(socket, attachment.role, 'bad_frame', t);
      return;
    }

    if (value.t === 'hello') {
      return;
    }

    const allowed = senderRole(value.t);
    if (allowed !== null && allowed !== attachment.role) {
      logDrop('wrong_role', attachment.role, value.t);
      return;
    }

    if (isPing(value)) {
      const serverTs = Date.now();
      socket.serializeAttachment({ ...attachment, lastPing: serverTs });
      socket.send(serialize({ t: 'pong', ts: value.ts, serverTs }));
      return;
    }

    const state = await this.loadState();
    const next = reduce(
      state,
      { ...value, role: attachment.role },
      { now: Date.now(), newId: () => crypto.randomUUID() },
    );
    if (next !== state) {
      await this.persistAndBroadcast(next);
      await this.pullAlarmEarlier(next);
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = this.attachment(socket);
    if (attachment?.rejected === true) {
      return;
    }
    let state = await this.loadState();
    if (attachment?.ready === true && attachment.role !== null) {
      const peers = await this.reconcilePeers(undefined, socket);
      state = peers.state;
    }
    await this.scheduleAlarm(state, socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const attachment = this.attachment(socket);
    if (attachment?.rejected === true) {
      return;
    }
    let state = await this.loadState();
    if (attachment?.ready === true && attachment.role !== null) {
      const peers = await this.reconcilePeers(undefined, socket);
      state = peers.state;
    }
    await this.scheduleAlarm(state, socket);
  }

  private async expireRoom(state: State): Promise<void> {
    const expired = reduce(
      state,
      { t: 'expire' },
      { now: Date.now(), newId: () => crypto.randomUUID() },
    );
    await this.persistAndBroadcast(expired);
    await this.ctx.storage.deleteAll();
    this.state = undefined;
  }

  /**
   * Closes every socket that has not pinged for `PEER_OFFLINE_MS` — or never
   * sent `hello` within it — with 4408 (020 R4/AC-7). The peer's offline
   * presence is broadcast to the remaining sockets BEFORE the close: a
   * server-side close does not fire `webSocketClose` here, and the reaped
   * sockets are marked rejected so a late close event is ignored.
   */
  private async reapSilentPeers(now: number): Promise<State | undefined> {
    const silent = this.ctx.getWebSockets().filter((socket) => {
      const attachment = this.attachment(socket);
      return (
        attachment !== undefined &&
        attachment.rejected !== true &&
        now - attachment.lastPing > PEER_OFFLINE_MS
      );
    });
    if (silent.length === 0) {
      return undefined;
    }

    for (const socket of silent) {
      const attachment = this.attachment(socket);
      if (attachment !== undefined) {
        socket.serializeAttachment({ ...attachment, rejected: true });
        logDrop('silent_peer', attachment.role);
      }
    }
    const { state } = await this.reconcilePeers();
    for (const socket of silent) {
      try {
        socket.close(CLOSE_CODE_SILENT_PEER, 'no ping');
      } catch {
        // Already closing; nothing to do.
      }
    }
    return state;
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let state = (await this.reapSilentPeers(now)) ?? (await this.loadState());
    const open = this.ctx
      .getWebSockets()
      .filter((socket) => this.attachment(socket)?.rejected !== true);
    if (open.length === 0) {
      if (now >= state.updatedAt + ROOM_TTL_MS) {
        await this.expireRoom(state);
        return;
      }
    }

    if (staleClearDue(state, now)) {
      state = reduce(
        state,
        { t: 'stale' },
        { now, newId: () => crypto.randomUUID() },
      );
      await this.persistAndBroadcast(state);
    }

    await this.scheduleAlarm(state);
  }
}
