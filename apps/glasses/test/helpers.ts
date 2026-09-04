/**
 * Test doubles for the glasses app: a fake `Bridge` and a manual clock.
 *
 * Nothing here (and nothing that imports it) loads
 * `@evenrealities/even_hub_sdk` — `src/even-bridge.ts` is the only file that
 * does, and no test imports it.
 */

import type { RoomClientTimers, State } from '@g2-race-spotter/protocol';

import type {
  Bridge,
  BridgeCallLog,
  ImageRawData,
  ImageSendResult,
  PageContainer,
  TextUpgrade,
} from '../src/bridge.ts';
import type { QueueTimers } from '../src/render/queue.ts';

export interface RecordedCall {
  readonly call: string;
  readonly payload: unknown;
}

export class FakeBridge implements Bridge {
  readonly calls: RecordedCall[] = [];
  readonly storage = new Map<string, string>();

  startUpResult = 0;
  rebuildResult = true;
  textResult = true;
  shutDownResult = true;
  /** Result of the nth (0-based) `updateImageRawData`. */
  imageResult: (index: number) => ImageSendResult = () => 'success';

  /** While true, every call parks until `release()` — proves serialisation. */
  paused = false;
  private gates: Array<() => void> = [];
  private imageCalls = 0;
  private eventListeners: Array<(event: unknown) => void> = [];

  callsNamed(call: string): RecordedCall[] {
    return this.calls.filter((entry) => entry.call === call);
  }

  release(): void {
    const gates = this.gates;
    this.gates = [];
    for (const gate of gates) {
      gate();
    }
  }

  emit(event: unknown): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  async createStartUpPageContainer(page: PageContainer): Promise<number> {
    return this.record('createStartUpPageContainer', page, this.startUpResult);
  }

  async rebuildPageContainer(page: PageContainer): Promise<boolean> {
    return this.record('rebuildPageContainer', page, this.rebuildResult);
  }

  async updateImageRawData(payload: ImageRawData): Promise<ImageSendResult> {
    const result = this.imageResult(this.imageCalls);
    this.imageCalls += 1;
    return this.record('updateImageRawData', payload, result);
  }

  async textContainerUpgrade(update: TextUpgrade): Promise<boolean> {
    return this.record('textContainerUpgrade', update, this.textResult);
  }

  async shutDownPageContainer(exitMode: number): Promise<boolean> {
    return this.record('shutDownPageContainer', exitMode, this.shutDownResult);
  }

  async getLocalStorage(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async setLocalStorage(key: string, value: string): Promise<boolean> {
    this.storage.set(key, value);
    return true;
  }

  onEvenHubEvent(listener: (event: unknown) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter(
        (entry) => entry !== listener,
      );
    };
  }

  private async record<T>(
    call: string,
    payload: unknown,
    result: T,
  ): Promise<T> {
    this.calls.push({ call, payload });
    if (this.paused) {
      await new Promise<void>((resolve) => this.gates.push(resolve));
    }

    return result;
  }
}

interface ScheduledTimer {
  readonly handle: number;
  at: number;
  readonly callback: () => void;
  readonly repeatMs?: number;
}

/** Manual clock: nothing in these tests waits on real time. */
export class FakeClock {
  ms = 0;

  private nextHandle = 1;
  private scheduled: ScheduledTimer[] = [];

  readonly now = (): number => this.ms;

  readonly timers: QueueTimers = {
    setTimeout: (callback: () => void, delayMs: number): number =>
      this.add(callback, delayMs),
    clearTimeout: (handle: number): void => this.remove(handle),
  };

  /** `RoomClientTimers`-shaped view of the same clock. */
  readonly roomTimers: RoomClientTimers = {
    setTimeout: (callback: () => void, delayMs: number): number =>
      this.add(callback, delayMs),
    clearTimeout: (handle: number): void => this.remove(handle),
    setInterval: (callback: () => void, delayMs: number): number =>
      this.add(callback, delayMs, delayMs),
    clearInterval: (handle: number): void => this.remove(handle),
  };

  /** Moves time forward, firing timers in order and draining microtasks. */
  async advance(ms: number): Promise<void> {
    const target = this.ms + ms;

    for (;;) {
      const due = this.scheduled
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }

      this.ms = Math.max(this.ms, due.at);
      if (due.repeatMs === undefined) {
        this.scheduled = this.scheduled.filter((timer) => timer !== due);
      } else {
        due.at = this.ms + due.repeatMs;
      }

      due.callback();
      await flush();
    }

    this.ms = target;
    await flush();
  }

  private add(
    callback: () => void,
    delayMs: number,
    repeatMs?: number,
  ): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.scheduled.push({
      handle,
      at: this.ms + Math.max(0, delayMs),
      callback,
      ...(repeatMs === undefined ? {} : { repeatMs: Math.max(1, repeatMs) }),
    });

    return handle;
  }

  private remove(handle: number): void {
    this.scheduled = this.scheduled.filter((timer) => timer.handle !== handle);
  }
}

/** Minimal `RoomWebSocket` double, mirroring packages/protocol's client tests. */
export class FakeSocket {
  readonly sent: string[] = [];
  closed = false;

  private readonly listeners = new Map<
    string,
    Array<(event: unknown) => void>
  >();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closed = true;
    this.emit('close', { code });
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open(): void {
    this.emit('open');
  }

  receive(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  frames(): unknown[] {
    return this.sent.map((frame) => JSON.parse(frame) as unknown);
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

export class FakeWebSocket {
  static readonly sockets: FakeSocket[] = [];

  constructor() {
    const socket = new FakeSocket();
    FakeWebSocket.sockets.push(socket);
    return socket as unknown as FakeWebSocket;
  }

  static reset(): void {
    FakeWebSocket.sockets.length = 0;
  }

  static last(): FakeSocket {
    const socket = FakeWebSocket.sockets.at(-1);
    if (socket === undefined) {
      throw new Error('no socket was opened');
    }

    return socket;
  }
}

/** Lets every already-queued promise continuation run. */
export async function flush(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

export function collectLogs(): {
  log: (entry: BridgeCallLog) => void;
  entries: BridgeCallLog[];
} {
  const entries: BridgeCallLog[] = [];
  return {
    entries,
    log: (entry) => {
      entries.push(entry);
    },
  };
}

/** A room `state` frame with sensible defaults. */
export function stateFrame(overrides: Partial<State> = {}): State {
  return {
    t: 'state',
    seq: 1,
    lane: null,
    gap: 0,
    msg: null,
    spotterOnline: true,
    driverOnline: true,
    updatedAt: 1_000,
    ...overrides,
  };
}
