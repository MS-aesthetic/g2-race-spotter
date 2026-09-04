import { DurableObject } from 'cloudflare:workers';

import {
  CLOSE_CODE_BAD_HELLO,
  createInitialState,
  isClientMessage,
  isHello,
  reduce,
  type ErrorMessage,
  type Role,
  type State,
} from '@g2-race-spotter/protocol';

interface SocketAttachment {
  readonly role: Role | null;
  readonly name: string | undefined;
  readonly lastPing: number;
  readonly ready: boolean;
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
    typeof attachment.lastPing === 'number' &&
    typeof attachment.ready === 'boolean'
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

  private attachment(socket: WebSocket): SocketAttachment | undefined {
    const attachment = socket.deserializeAttachment();
    return isSocketAttachment(attachment) ? attachment : undefined;
  }

  private hasReadyPeer(role: Role): boolean {
    return this.ctx
      .getWebSockets(role)
      .some((socket) => this.attachment(socket)?.ready === true);
  }

  private async refreshPeer(
    role: Role,
    exclude?: WebSocket,
  ): Promise<{ readonly state: State; readonly changed: boolean }> {
    const state = await this.loadState();
    const next = reduce(
      state,
      { t: 'peer', role, online: this.hasReadyPeer(role) },
      { now: Date.now(), newId: crypto.randomUUID },
    );
    if (next !== state) {
      await this.persistAndBroadcast(next, exclude);
    }
    return { state: next, changed: next !== state };
  }

  private sendBadHello(socket: WebSocket): void {
    const error: ErrorMessage = { t: 'error', code: 'bad_frame' };
    socket.send(serialize(error));
    socket.close(CLOSE_CODE_BAD_HELLO, 'hello must match URL');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('X-G2RS-Internal-Debug') === '1') {
      return Response.json(await this.loadState());
    }

    const url = new URL(request.url);
    const requestedRole = url.searchParams.get('role');
    const role: Role | null =
      requestedRole === 'spotter' || requestedRole === 'driver'
        ? requestedRole
        : null;

    const name = url.searchParams.get('name') ?? undefined;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      role,
      name,
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
    if (
      attachment === undefined ||
      attachment.role === null ||
      typeof raw !== 'string'
    ) {
      this.sendBadHello(socket);
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.sendBadHello(socket);
      return;
    }

    if (!attachment.ready) {
      if (
        !isHello(value) ||
        value.role !== attachment.role ||
        value.name !== attachment.name
      ) {
        this.sendBadHello(socket);
        return;
      }

      socket.serializeAttachment({ ...attachment, ready: true });
      const peer = await this.refreshPeer(attachment.role, socket);
      socket.send(serialize(peer.state));
      return;
    }

    if (!isClientMessage(value) || value.t === 'hello') {
      return;
    }

    const state = await this.loadState();
    const next = reduce(
      state,
      { ...value, role: attachment.role },
      { now: Date.now(), newId: crypto.randomUUID },
    );
    if (next !== state) {
      await this.persistAndBroadcast(next);
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = this.attachment(socket);
    if (attachment?.ready === true && attachment.role !== null) {
      await this.refreshPeer(attachment.role);
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const attachment = this.attachment(socket);
    if (attachment?.ready === true && attachment.role !== null) {
      await this.refreshPeer(attachment.role);
    }
  }
}
