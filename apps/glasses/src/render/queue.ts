/**
 * The single writer to the glasses. One bridge call in flight, ever.
 *
 * Image mode (Maxx design round 4): a `hud` job is drawn as the two HUD
 * strips, split into the four image containers and packed; from there every
 * image container is its own job, keyed by container id:
 *
 * - a new job for a container REPLACES its pending job (latest wins);
 * - a container whose packed bytes equal the last bytes the glasses accepted
 *   for it is not sent at all, so a lane change costs at most two sends, a
 *   left/right car change one, a middle car change at most two, and the
 *   relay's stale clear only the containers it actually changes;
 * - the top (lane) strip is always sent immediately; the bottom (cars) strip
 *   is debounced to one flush per `HUD_GAP_FLUSH_MS` — both of its halves go
 *   out together in one flush, so the middle bar never tears across the seam
 *   for a debounce window — except that a link-state change, the first frame
 *   and any change to an all-empty HUD (the relay's stale clear) flush it now;
 * - image sends go before text sends; the lane strip before the car strip,
 *   unless a car-strip flush is half done.
 *
 * Text mode: the whole HUD is one `renderText` string on container 2 with the
 * same replace/debounce rules as before (a lane, link-state or to-blank change
 * bypasses the cars debounce).
 *
 * Both modes: `msg` → container 3, `status` → container 4, both
 * `textContainerUpgrade`; every call is timed and logged
 * `{call, ms, result, container}` (030 R7); three consecutive `sendFailed`
 * (on any image container) rebuild the page with a text HUD and the app stays
 * in text mode until restart (050 R3).
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
  STRIP_CONTAINERS,
  type StripContainer,
} from '../startup-page.ts';
import {
  drawStrips,
  HALF_WIDTH,
  splitStrip,
  STRIP_HEIGHT,
  type HudState,
} from './draw-hud.ts';
import { pack } from './gray4.ts';
import type { RenderMode } from './mode.ts';
import { imageRawDataPayload } from './sdk-quirks.ts';
import { renderText } from './text.ts';

export const SEND_FAILED_LIMIT = 3;

/** Nothing to draw but the empty slots: no lane, no car behind. */
function isBlank(state: HudState): boolean {
  return state.lane === null && state.cars.every((level) => level === 0);
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (a === undefined || a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}

/**
 * The packed gray4 bytes of each image container for one HUD state, keyed by
 * container id. Pure; exported so tests compare against exactly what is sent.
 */
export function packContainers(
  state: HudState,
  linkOk: boolean,
): Map<number, Uint8Array> {
  const strips = drawStrips(state, { linkOk });
  const halves = {
    top: splitStrip(strips.top),
    bottom: splitStrip(strips.bottom),
  };
  const packed = new Map<number, Uint8Array>();

  for (const container of STRIP_CONTAINERS) {
    packed.set(
      container.containerID,
      pack(halves[container.strip][container.half], {
        width: HALF_WIDTH,
        height: STRIP_HEIGHT,
      }),
    );
  }

  return packed;
}

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

const STRIP_BY_ID = new Map<number, StripContainer>(
  STRIP_CONTAINERS.map((container) => [container.containerID, container]),
);

export class RenderQueue {
  private readonly bridge: Bridge;
  private readonly timers: QueueTimers;
  private readonly now: () => number;
  private readonly log: BridgeLogger;
  private readonly onModeChange: ((mode: RenderMode) => void) | undefined;
  private readonly textJobs: Array<MessageJob | StatusJob> = [];

  private currentMode: RenderMode;
  private timer: number | undefined;
  private running: Promise<void> | undefined;
  private wake = false;
  private sendFailures = 0;
  private lastStatus = '';
  private lastMessage = '';
  /** The newest HUD job pushed, whatever mode — the fallback page draws it. */
  private latestHud: HudJob | undefined;

  // Image mode: one job per image container.
  /** What each container should show (packed), from the newest HUD job. */
  private readonly desired = new Map<number, Uint8Array>();
  /** Containers whose `desired` bytes still have to be sent. */
  private readonly dirty = new Set<number>();
  /** Bytes the host last accepted (`success`) per container. */
  private readonly lastSent = new Map<number, Uint8Array>();
  /** Bottom-strip containers taken into the flush that is going out now. */
  private readonly bottomFlush = new Set<number>();
  private bottomImmediate = false;
  /** The HUD job the last bottom-strip flush was taken from. */
  private bottomBasis: HudJob | undefined;
  private lastBottomAt = Number.NEGATIVE_INFINITY;

  // Text mode: the whole HUD is one text job.
  private pendingTextHud: PendingHud | undefined;
  private dispatchedTextHud: HudJob | undefined;
  private lastTextHudAt = Number.NEGATIVE_INFINITY;

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
      this.latestHud = job;
      if (this.currentMode === 'image') {
        this.pushImages(job);
      } else {
        this.pendingTextHud = {
          ...job,
          immediate:
            this.isTextImmediate(job) ||
            this.pendingTextHud?.immediate === true,
        };
      }
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

  /**
   * Replaces each container's pending job with the new bytes, or drops it
   * when they equal the last bytes the host ACCEPTED for that container. A
   * send still in flight is deliberately not compared against: if it fails,
   * the job pushed meanwhile must still go out (a same-bytes push after a
   * success is skipped at send time instead).
   */
  private pushImages(job: HudJob): void {
    const packed = packContainers(job.state, job.linkOk);

    for (const [containerID, bytes] of packed) {
      this.desired.set(containerID, bytes);
      if (sameBytes(this.lastSent.get(containerID), bytes)) {
        this.dirty.delete(containerID);
      } else {
        this.dirty.add(containerID);
      }
    }

    this.bottomImmediate =
      (this.bottomImmediate || this.isBottomImmediate(job)) &&
      this.pendingOf('bottom').length > 0;
  }

  private isBottomImmediate(job: HudJob): boolean {
    const basis = this.bottomBasis;
    return (
      basis === undefined ||
      basis.linkOk !== job.linkOk ||
      // Going blank (the relay's stale clear) is news the driver must see now,
      // not after the cars debounce.
      (isBlank(job.state) && !isBlank(basis.state))
    );
  }

  private isTextImmediate(job: HudJob): boolean {
    const last = this.dispatchedTextHud;
    return (
      last === undefined ||
      last.state.lane !== job.state.lane ||
      last.linkOk !== job.linkOk ||
      (isBlank(job.state) && !isBlank(last.state))
    );
  }

  private pendingOf(strip: StripContainer['strip']): StripContainer[] {
    return STRIP_CONTAINERS.filter(
      (container) =>
        container.strip === strip && this.dirty.has(container.containerID),
    );
  }

  private bottomDelay(): number {
    return this.bottomImmediate
      ? 0
      : this.lastBottomAt + HUD_GAP_FLUSH_MS - this.now();
  }

  /** The image container to send next, or `undefined` if none is due. */
  private nextImage(): number | undefined {
    // Finish a bottom flush that is under way, so the middle bar is whole.
    for (const containerID of this.bottomFlush) {
      if (this.dirty.has(containerID)) {
        return containerID;
      }
      this.bottomFlush.delete(containerID);
    }

    const top = this.pendingOf('top')[0];
    if (top !== undefined) {
      return top.containerID;
    }

    const bottom = this.pendingOf('bottom');
    if (bottom.length === 0 || this.bottomDelay() > 0) {
      return undefined;
    }

    // Open a flush: both halves that are pending now go out back to back.
    for (const container of bottom) {
      this.bottomFlush.add(container.containerID);
    }
    this.lastBottomAt = this.now();
    this.bottomImmediate = false;
    this.bottomBasis = this.latestHud;
    return bottom[0]?.containerID;
  }

  private textHudDelay(job: PendingHud): number {
    if (job.immediate) {
      return 0;
    }

    return this.lastTextHudAt + HUD_GAP_FLUSH_MS - this.now();
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
      if (this.currentMode === 'image') {
        const containerID = this.nextImage();
        if (containerID !== undefined) {
          await this.sendImage(containerID);
          continue;
        }
      } else {
        const hud = this.pendingTextHud;
        if (hud !== undefined && this.textHudDelay(hud) <= 0) {
          this.pendingTextHud = undefined;
          await this.sendHudText(hud);
          continue;
        }
      }

      const textJob = this.textJobs.shift();
      if (textJob !== undefined) {
        await this.sendTextJob(textJob);
        continue;
      }

      if (this.currentMode === 'image') {
        if (this.pendingOf('bottom').length > 0) {
          this.arm(this.bottomDelay());
        }
      } else if (this.pendingTextHud !== undefined) {
        this.arm(this.textHudDelay(this.pendingTextHud));
      }

      return;
    }
  }

  private async sendImage(containerID: number): Promise<void> {
    const container = STRIP_BY_ID.get(containerID);
    const bytes = this.desired.get(containerID);
    this.dirty.delete(containerID);
    this.bottomFlush.delete(containerID);
    if (
      container === undefined ||
      bytes === undefined ||
      sameBytes(this.lastSent.get(containerID), bytes)
    ) {
      return;
    }

    const payload = imageRawDataPayload({
      containerID,
      containerName: container.containerName,
      imageData: bytes,
      imageWidth: HALF_WIDTH,
      imageHeight: STRIP_HEIGHT,
    });

    const outcome = await this.timed(
      'updateImageRawData',
      () => this.bridge.updateImageRawData(payload),
      container.containerName,
    );

    if (outcome.value === 'success') {
      this.lastSent.set(containerID, bytes);
      // A push during the flight that went back to the OLD bytes was dropped
      // as "already shown"; now that these bytes landed, it is not.
      const wanted = this.desired.get(containerID);
      if (wanted !== undefined && !sameBytes(wanted, bytes)) {
        this.dirty.add(containerID);
      } else {
        // A same-bytes push during the flight left a dirty flag behind; it
        // would cost no call but would open an empty flush that resets the
        // cars debounce. Drop it.
        this.dirty.delete(containerID);
      }
    }

    // Only `sendFailed` counts toward the fallback: an oversize or malformed
    // image is a bug in this app, not a dead image channel (050 R3).
    if (outcome.value === 'sendFailed') {
      this.sendFailures += 1;
      if (this.sendFailures >= SEND_FAILED_LIMIT) {
        await this.fallbackToTextMode();
      }
      return;
    }

    this.sendFailures = 0;
  }

  private async sendHudText(job: HudJob): Promise<void> {
    await this.timed(
      'textContainerUpgrade',
      () =>
        this.bridge.textContainerUpgrade({
          containerID: CONTAINER_HUD,
          containerName: CONTAINER_NAMES[CONTAINER_HUD],
          content: renderText(job.state),
        }),
      CONTAINER_NAMES[CONTAINER_HUD],
    );

    this.dispatchedTextHud = job;
    this.lastTextHudAt = this.now();
  }

  private async sendTextJob(job: MessageJob | StatusJob): Promise<void> {
    const containerID = job.kind === 'msg' ? CONTAINER_MSG : CONTAINER_STATUS;
    if (job.kind === 'msg') {
      this.lastMessage = job.text;
    } else {
      this.lastStatus = job.text;
    }

    await this.timed(
      'textContainerUpgrade',
      () =>
        this.bridge.textContainerUpgrade({
          containerID,
          containerName: CONTAINER_NAMES[containerID],
          content: job.text,
        }),
      CONTAINER_NAMES[containerID],
    );
  }

  /**
   * The one rebuild the app ever performs: swap the four image containers for
   * the single text HUD and stay there. The image channel does not recover
   * mid-session.
   */
  private async fallbackToTextMode(): Promise<void> {
    this.currentMode = 'text';
    this.sendFailures = 0;
    this.dirty.clear();
    this.bottomFlush.clear();
    const state = this.latestHud?.state ?? { lane: null, cars: [0, 0, 0] };
    if (this.latestHud !== undefined) {
      this.dispatchedTextHud = this.latestHud;
      this.lastTextHudAt = this.now();
    }

    await this.timed('rebuildPageContainer', () =>
      this.bridge.rebuildPageContainer(
        buildPage({
          mode: 'text',
          status: this.lastStatus,
          message: this.lastMessage,
          hud: renderText(state),
        }),
      ),
    );

    this.onModeChange?.('text');
  }

  private async timed<T>(
    call: string,
    run: () => Promise<T>,
    container?: string,
  ): Promise<Outcome<T>> {
    const startedAt = this.now();
    const target = container === undefined ? {} : { container };

    try {
      const value = await run();
      this.log({ call, ms: this.now() - startedAt, result: value, ...target });
      return { value, failed: false };
    } catch (error) {
      // A throwing bridge must not kill the worker: log it and keep draining.
      this.log({
        call,
        ms: this.now() - startedAt,
        result: { error },
        ...target,
      });
      return { failed: true };
    }
  }
}
