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

import {
  statusBlinks,
  statusLine,
  type StatusInput,
  type TerminalClose,
} from './link.ts';
import type { HudState } from './render/draw-hud.ts';
import type { RenderJob } from './render/queue.ts';

export interface RenderSink {
  push(job: RenderJob): void;
}

/**
 * How long a message stays on the glasses before it clears itself (Maxx,
 * 2026-09-04 design round 2). Lives here, not in `packages/protocol`: it is a
 * driver-side display rule, not a wire timing, and the relay never sees it.
 */
export const MSG_AUTO_ACK_MS = 5_000;

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
  /** Phase of the NO-LINK `L` blink; the driver's timer flips it. */
  private blinkOn = true;

  private lastHud: (HudState & { linkOk: boolean }) | undefined;
  /** The startup page always carries an empty message container. */
  private lastMessage: string | undefined = '';
  private lastStatus: string | undefined;
  /** Message the auto-clear timer has already taken off the screen. */
  private hiddenMessageId: string | undefined;

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

  /**
   * `render: false` records the verdict without drawing, for the caller that is
   * about to apply the very `state` frame which changed it — one frame must
   * cost one HUD job, not one with the previous values and one with the new.
   */
  setLinkOk(linkOk: boolean, options: { render?: boolean } = {}): void {
    if (linkOk) {
      this.everLinked = true;
    }
    this.linkOkFlag = linkOk;
    if (options.render !== false) {
      this.render();
    }
  }

  /** True while the status strip is a phase of the NO-LINK blink. */
  get statusBlinking(): boolean {
    return statusBlinks(this.statusInput());
  }

  /**
   * Flips the blink phase and repaints the strip. Costs one `status` job and
   * never an image send — the bitmap does not change between phases.
   */
  tickBlink(): void {
    this.blinkOn = !this.blinkOn;
    this.render();
  }

  /** Back to the visible phase, so a strip that stops blinking shows `L`. */
  resetBlink(): void {
    if (this.blinkOn) {
      return;
    }

    this.blinkOn = true;
    this.render();
  }

  /** Id of the message currently on screen and unacknowledged. */
  unackedMessageId(): string | undefined {
    const message = this.state?.msg;
    return message !== null &&
      message !== undefined &&
      message.ackedAt === null &&
      message.id !== this.hiddenMessageId
      ? message.id
      : undefined;
  }

  /**
   * Takes a message off the glasses without waiting for the relay's `ackedAt`
   * — the one thing the driver's side decides on its own, because "the text
   * goes away after 5 s" is a display rule and the timer that enforces it must
   * not depend on a round trip that may never come back (constitution §2 still
   * holds for lane/gap/side: nothing is *drawn* from an unconfirmed intent).
   */
  hideMessage(msgId: string): void {
    if (this.hiddenMessageId === msgId) {
      return;
    }

    this.hiddenMessageId = msgId;
    this.render();
  }

  ack(msgId: string): void {
    this.ackFrame(msgId);
  }

  /** Pushes whatever changed since the last render. Safe to call at any time. */
  render(): void {
    const hud = {
      lane: this.state?.lane ?? null,
      side: this.state?.side ?? null,
      gap: this.state?.gap ?? 0,
      linkOk: this.linkOkFlag,
    };

    if (
      this.lastHud === undefined ||
      this.lastHud.lane !== hud.lane ||
      this.lastHud.side !== hud.side ||
      this.lastHud.gap !== hud.gap ||
      this.lastHud.linkOk !== hud.linkOk
    ) {
      this.lastHud = hud;
      this.queue.push({
        kind: 'hud',
        state: { lane: hud.lane, side: hud.side, gap: hud.gap },
        linkOk: hud.linkOk,
      });
    }

    const message = this.messageText();
    if (message !== this.lastMessage) {
      this.lastMessage = message;
      this.queue.push({ kind: 'msg', text: message });
    }

    // The skill asks for status `textColor: 4` while NO LINK; `textContainerUpgrade`
    // carries content only, so the strip keeps its startup colour and NO LINK is
    // signalled by the blinking `L` plus the dimmed HUD. Deviation for the planner.
    const status = statusLine(this.statusInput());
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.queue.push({ kind: 'status', text: status });
    }
  }

  private statusInput(): StatusInput {
    return {
      hasRoom: this.hasRoomFlag,
      connection: this.connection,
      linkOk: this.linkOkFlag,
      spotterOnline: this.state?.spotterOnline ?? false,
      everLinked: this.everLinked,
      terminal: this.terminal,
      blinkOn: this.blinkOn,
    };
  }

  private messageText(): string {
    const message = this.state?.msg;
    if (
      message === null ||
      message === undefined ||
      message.ackedAt !== null ||
      message.id === this.hiddenMessageId
    ) {
      return '';
    }

    return message.text;
  }
}

function isTerminalErrorCode(code: ErrorCode): boolean {
  return code === 'auth' || code === 'role_taken' || code === 'version';
}
