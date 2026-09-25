/**
 * The single writer to the glasses. One bridge call in flight, ever.
 *
 * - a new `hud` job REPLACES a pending one (latest wins, never queued behind
 *   another HUD job);
 * - cars-only changes wait out `HUD_GAP_FLUSH_MS` (the old gap floor: at most
 *   one image send per 250 ms while the spotter taps through segments); a lane
 *   change or a link-state change bypasses the debounce (the driver must see
 *   those now) — the relay's stale clear resets the lane, so it is immediate
 *   whenever a lane was up;
 * - `msg` → container 3, `status` → container 4, both `textContainerUpgrade`;
 * - every call is timed and logged `{call, ms, result}` (030 R7);
 * - three consecutive `sendFailed` rebuild the page with a text HUD and the app
 *   stays in text mode until restart (050 R3).
 */

import { HUD_GAP_FLUSH_MS } from '@g2-race-spotter/protocol';

import {
  consoleBridgeLogger,
  type Bridge,
  type BridgeLogger,
} from '../bridge.ts';
import {
  buildPage,
  CONTAINER_HUD,
  CONTAINER_MSG,
  CONTAINER_NAMES,
  CONTAINER_STATUS,
} from '../startup-page.ts';
import { drawHud, HUD_HEIGHT, HUD_WIDTH, type HudState } from './draw-hud.ts';
import { pack } from './gray4.ts';
import type { RenderMode } from './mode.ts';
import { imageRawDataPayload } from './sdk-quirks.ts';
import { renderText } from './text.ts';

export const SEND_FAILED_LIMIT = 3;

export interface QueueTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

const browserTimers: QueueTimers = {
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export interface HudJob {
  readonly kind: 'hud';
  readonly state: HudState;
  readonly linkOk: boolean;
}

export interface MessageJob {
  readonly kind: 'msg';
  readonly text: string;
}

export interface StatusJob {
  readonly kind: 'status';
  readonly text: string;
}

export type RenderJob = HudJob | MessageJob | StatusJob;

export interface RenderQueueOptions {
  readonly bridge: Bridge;
  readonly mode: RenderMode;
  readonly timers?: QueueTimers;
  readonly now?: () => number;
  readonly log?: BridgeLogger;
  /** Notified when the `sendFailed` fallback switches the app to text mode. */
  readonly onModeChange?: (mode: RenderMode) => void;
}

interface PendingHud extends HudJob {
  /** Skips the cars debounce: a lane or link-state change, or the first frame. */
  readonly immediate: boolean;
}

interface Outcome<T> {
  readonly value?: T;
  readonly failed: boolean;
}

export class RenderQueue {
  private readonly bridge: Bridge;
  private readonly timers: QueueTimers;
  private readonly now: () => number;
  private readonly log: BridgeLogger;
  private readonly onModeChange: ((mode: RenderMode) => void) | undefined;
  private readonly textJobs: Array<MessageJob | StatusJob> = [];

  private currentMode: RenderMode;
  private pendingHud: PendingHud | undefined;
  private dispatchedHud: HudJob | undefined;
  private lastHudAt = Number.NEGATIVE_INFINITY;
  private timer: number | undefined;
  private running: Promise<void> | undefined;
  private wake = false;
  private sendFailures = 0;
  private lastStatus = '';
  private lastMessage = '';

  constructor(options: RenderQueueOptions) {
    this.bridge = options.bridge;
    this.timers = options.timers ?? browserTimers;
    this.now = options.now ?? (() => performance.now());
    this.log = options.log ?? consoleBridgeLogger;
    this.onModeChange = options.onModeChange;
    this.currentMode = options.mode;
  }

  get mode(): RenderMode {
    return this.currentMode;
  }

  /** Consecutive `sendFailed` results; reset by any other outcome. */
  get consecutiveSendFailures(): number {
    return this.sendFailures;
  }

  push(job: RenderJob): void {
    if (job.kind === 'hud') {
      this.pendingHud = {
        ...job,
        immediate: this.isImmediate(job) || this.pendingHud?.immediate === true,
      };
    } else {
      this.textJobs.push(job);
    }

    this.schedule();
  }

  /** Resolves once nothing is in flight — the seam tests drive the worker on. */
  async whenIdle(): Promise<void> {
    while (this.running !== undefined) {
      await this.running;
    }
  }

  private isImmediate(job: HudJob): boolean {
    const last = this.dispatchedHud;
    return (
      last === undefined ||
      last.state.lane !== job.state.lane ||
      last.linkOk !== job.linkOk
    );
  }

  private hudDelay(job: PendingHud): number {
    if (job.immediate) {
      return 0;
    }

    return this.lastHudAt + HUD_GAP_FLUSH_MS - this.now();
  }

  private schedule(): void {
    if (this.running !== undefined) {
      // The worker is between an await and its own teardown; make sure it takes
      // another lap rather than dropping this wake-up.
      this.wake = true;
      return;
    }

    this.running = this.run();
  }

  private async run(): Promise<void> {
    try {
      do {
        this.wake = false;
        await this.pump();
      } while (this.wake);
    } finally {
      this.running = undefined;
    }
  }

  private arm(delayMs: number): void {
    if (this.timer !== undefined) {
      return;
    }

    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        this.schedule();
      },
      Math.max(0, delayMs),
    );
  }

  private async pump(): Promise<void> {
    for (;;) {
      const hud = this.pendingHud;
      if (hud !== undefined && this.hudDelay(hud) <= 0) {
        this.pendingHud = undefined;
        await this.sendHud(hud);
        continue;
      }

      const textJob = this.textJobs.shift();
      if (textJob !== undefined) {
        await this.sendTextJob(textJob);
        continue;
      }

      if (this.pendingHud !== undefined) {
        this.arm(this.hudDelay(this.pendingHud));
      }

      return;
    }
  }

  private async sendHud(job: HudJob): Promise<void> {
    if (this.currentMode === 'image') {
      await this.sendHudImage(job);
    } else {
      await this.sendHudText(job);
    }

    this.dispatchedHud = job;
    this.lastHudAt = this.now();
  }

  private async sendHudImage(job: HudJob): Promise<void> {
    const frame = drawHud(job.state, { linkOk: job.linkOk });
    const payload = imageRawDataPayload({
      containerID: CONTAINER_HUD,
      containerName: CONTAINER_NAMES[CONTAINER_HUD],
      imageData: pack(frame),
      imageWidth: HUD_WIDTH,
      imageHeight: HUD_HEIGHT,
    });

    const outcome = await this.timed('updateImageRawData', () =>
      this.bridge.updateImageRawData(payload),
    );

    // Only `sendFailed` counts toward the fallback: an oversize or malformed
    // image is a bug in this app, not a dead image channel (050 R3).
    if (outcome.value === 'sendFailed') {
      this.sendFailures += 1;
      if (this.sendFailures >= SEND_FAILED_LIMIT) {
        await this.fallbackToTextMode(job);
      }
      return;
    }

    this.sendFailures = 0;
  }

  private async sendHudText(job: HudJob): Promise<void> {
    await this.timed('textContainerUpgrade', () =>
      this.bridge.textContainerUpgrade({
        containerID: CONTAINER_HUD,
        containerName: CONTAINER_NAMES[CONTAINER_HUD],
        content: renderText(job.state),
      }),
    );
  }

  private async sendTextJob(job: MessageJob | StatusJob): Promise<void> {
    const containerID = job.kind === 'msg' ? CONTAINER_MSG : CONTAINER_STATUS;
    if (job.kind === 'msg') {
      this.lastMessage = job.text;
    } else {
      this.lastStatus = job.text;
    }

    await this.timed('textContainerUpgrade', () =>
      this.bridge.textContainerUpgrade({
        containerID,
        containerName: CONTAINER_NAMES[containerID],
        content: job.text,
      }),
    );
  }

  /**
   * The one rebuild the app ever performs: swap the image container for a text
   * one and stay there. The image channel does not recover mid-session.
   */
  private async fallbackToTextMode(job: HudJob): Promise<void> {
    this.currentMode = 'text';
    this.sendFailures = 0;

    await this.timed('rebuildPageContainer', () =>
      this.bridge.rebuildPageContainer(
        buildPage({
          mode: 'text',
          status: this.lastStatus,
          message: this.lastMessage,
          hud: renderText(job.state),
        }),
      ),
    );

    this.onModeChange?.('text');
  }

  private async timed<T>(
    call: string,
    run: () => Promise<T>,
  ): Promise<Outcome<T>> {
    const startedAt = this.now();

    try {
      const value = await run();
      this.log({ call, ms: this.now() - startedAt, result: value });
      return { value, failed: false };
    } catch (error) {
      // A throwing bridge must not kill the worker: log it and keep draining.
      this.log({ call, ms: this.now() - startedAt, result: { error } });
      return { failed: true };
    }
  }
}
