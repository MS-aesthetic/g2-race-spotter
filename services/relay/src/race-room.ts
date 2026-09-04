import { DurableObject } from 'cloudflare:workers';

import { nextAlarmAt } from './alarm.js';

import {
  CLOSE_CODE_AUTH,
  CLOSE_CODE_BAD_HELLO,
  CLOSE_CODE_DRIVER_EVICTED,
  CLOSE_CODE_VERSION,
  createInitialState,
  isClientMessage,
  isHello,
  isPing,
  PROTOCOL_VERSION,
  reduce,
  ROOM_TTL_MS,
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
      this.state =
        (await this.ctx.storage.get<State>('state')) ?? createInitialState();
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
      if (socket !== exclude && this.attachment(socket)?.ready === true) {
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
      .filter((socket) => socket !== unavailable).length;
    await this.ctx.storage.setAlarm(
      nextAlarmAt(socketCount, current, Date.now()),
    );
  }

  private attachment(socket: WebSocket): SocketAttachment | undefined {
    const attachment = socket.deserializeAttachment();
    return isSocketAttachment(attachment) ? attachment : undefined;
  }

  private hasReadyPeer(role: Role, unavailable?: WebSocket): boolean {
    return this.ctx
      .getWebSockets(role)
      .some(
        (socket) =>
          socket !== unavailable && this.attachment(socket)?.ready === true,
      );
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

    const name = url.searchParams.get('name') ?? undefined;
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
    if (attachment === undefined || typeof raw !== 'string') {
      this.sendBadHello(socket, attachment);
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.sendBadHello(socket, attachment);
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
        value.name !== attachment.name
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

      socket.serializeAttachment({ ...attachment, ready: true });
      const peers = await this.reconcilePeers(socket);
      socket.send(serialize(peers.state));
      await this.scheduleAlarm(peers.state);
      return;
    }

    if (!isClientMessage(value) || value.t === 'hello') {
      return;
    }

    if (attachment.role === null) {
      this.sendBadHello(socket, attachment);
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

  async alarm(): Promise<void> {
    const state = await this.loadState();
    if (this.ctx.getWebSockets().length === 0) {
      if (Date.now() >= state.updatedAt + ROOM_TTL_MS) {
        await this.expireRoom(state);
        return;
      }
    }

    await this.scheduleAlarm(state);
  }
}
