/**
 * The driver-side store: the last room `state`, the link verdict and the
 * connection status, turned into render jobs.
 *
 * Constitution §2 — the glasses render only room state. Nothing here is drawn
 * from a local intent: an ack is sent and the message stays on screen until the
 * relay's next `state` carries `ackedAt`.
 */

import type {
  ConnectionCloseDetail,
  ConnectionState,
  ErrorCode,
  ErrorMessage,
  State,
} from '@g2-race-spotter/protocol';

import { statusLine, type TerminalClose } from './link.ts';
import type { HudState } from './render/draw-hud.ts';
import type { RenderJob } from './render/queue.ts';

export interface RenderSink {
  push(job: RenderJob): void;
}

export interface HudAppOptions {
  readonly queue: RenderSink;
  /** Sends an `ack` frame through `RoomClient`. */
  readonly ack: (msgId: string) => void;
  /** False until a room code is configured — the status strip shows `ROOM ?`. */
  readonly hasRoom: boolean;
  /**
   * Status text already baked into the startup page, so the first render does
   * not spend a bridge call re-sending what the glasses are showing.
   */
  readonly initialStatus?: string | undefined;
}

export class HudApp {
  private readonly queue: RenderSink;
  private readonly ackFrame: (msgId: string) => void;

  private state: State | undefined;
  private connection: ConnectionState = 'connecting';
  private terminal: TerminalClose | undefined;
  private linkOkFlag = false;
  private everLinked = false;
  private hasRoomFlag: boolean;

  private lastHud: (HudState & { linkOk: boolean }) | undefined;
  /** The startup page always carries an empty message container. */
  private lastMessage: string | undefined = '';
  private lastStatus: string | undefined;

  constructor(options: HudAppOptions) {
    this.queue = options.queue;
    this.ackFrame = options.ack;
    this.hasRoomFlag = options.hasRoom;
    this.lastStatus = options.initialStatus;
  }

  get linkOk(): boolean {
    return this.linkOkFlag;
  }

  get currentState(): State | undefined {
    return this.state;
  }

  setHasRoom(hasRoom: boolean): void {
    this.hasRoomFlag = hasRoom;
    this.render();
  }

  applyState(state: State): void {
    this.state = state;
    this.everLinked = true;
    this.render();
  }

  setConnection(
    connection: ConnectionState,
    detail?: ConnectionCloseDetail,
  ): void {
    this.connection = connection;
    // Only a terminal close (4400/4401/4409/4426) is reported and left alone; a
    // reconnecting drop is NO LINK, not an error, and must not stick.
    this.terminal =
      connection === 'closed' && detail?.terminal === true
        ? { code: detail.code }
        : undefined;
    this.render();
  }

  setError(error: ErrorMessage): void {
    if (isTerminalErrorCode(error.code)) {
      this.terminal = { error: error.code };
      this.render();
    }
  }

  setLinkOk(linkOk: boolean): void {
    if (linkOk) {
      this.everLinked = true;
    }
    this.linkOkFlag = linkOk;
    this.render();
  }

  /** Id of the message currently on screen and unacknowledged. */
  unackedMessageId(): string | undefined {
    const message = this.state?.msg;
    return message !== null && message !== undefined && message.ackedAt === null
      ? message.id
      : undefined;
  }

  ack(msgId: string): void {
    this.ackFrame(msgId);
  }

  /** Pushes whatever changed since the last render. Safe to call at any time. */
  render(): void {
    const hud = {
      lane: this.state?.lane ?? null,
      gap: this.state?.gap ?? 0,
      linkOk: this.linkOkFlag,
    };

    if (
      this.lastHud === undefined ||
      this.lastHud.lane !== hud.lane ||
      this.lastHud.gap !== hud.gap ||
      this.lastHud.linkOk !== hud.linkOk
    ) {
      this.lastHud = hud;
      this.queue.push({
        kind: 'hud',
        state: { lane: hud.lane, gap: hud.gap },
        linkOk: hud.linkOk,
      });
    }

    const message = this.messageText();
    if (message !== this.lastMessage) {
      this.lastMessage = message;
      this.queue.push({ kind: 'msg', text: message });
    }

    const status = statusLine({
      hasRoom: this.hasRoomFlag,
      connection: this.connection,
      linkOk: this.linkOkFlag,
      spotterOnline: this.state?.spotterOnline ?? false,
      everLinked: this.everLinked,
      terminal: this.terminal,
    });
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.queue.push({ kind: 'status', text: status });
    }
  }

  private messageText(): string {
    const message = this.state?.msg;
    if (message === null || message === undefined || message.ackedAt !== null) {
      return '';
    }

    return message.text;
  }
}

function isTerminalErrorCode(code: ErrorCode): boolean {
  return code === 'auth' || code === 'role_taken' || code === 'version';
}
