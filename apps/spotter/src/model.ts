import type {
  Cars,
  ConnectionState,
  Lane,
  State,
} from '@g2-race-spotter/protocol';

/** How long an optimistic lane or cars highlight survives before the server's
 * `state` frame is the only truth again (constitution §2 keeps the *glasses*
 * free of optimism; the spotter may pre-light its own button for one beat). */
export const OPTIMISTIC_LANE_MS = 300;

/** Latency older than this is shown greyed: the number is no longer evidence
 * the link is quick, only that it once was. */
export const LATENCY_STALE_MS = 10_000;

export interface JoinForm {
  room: string;
  pin: string;
  name: string;
}

export interface OptimisticLane {
  lane: Lane | null;
  at: number;
}

export interface OptimisticCars {
  cars: Cars;
  at: number;
}

export interface Model {
  screen: 'join' | 'console';
  form: JoinForm;
  /** Join-screen message, e.g. the "wrong PIN" bounce from close 4401. */
  notice: string | null;
  /** Relay origin in small print so a wrong deployment is obvious. */
  relayHost: string;
  conn: ConnectionState;
  /** Last replayed room state; `null` until the first `state` frame. */
  state: State | null;
  draft: string;
  recent: readonly string[];
  latencyMs: number | null;
  latencyAt: number | null;
  optimisticLane: OptimisticLane | null;
  optimisticCars: OptimisticCars | null;
  now: number;
  updateReady: boolean;
  showInstallHint: boolean;
}

export function createModel(overrides: Partial<Model> = {}): Model {
  return {
    screen: 'join',
    form: { room: '', pin: '', name: '' },
    notice: null,
    relayHost: '',
    conn: 'closed',
    state: null,
    draft: '',
    recent: [],
    latencyMs: null,
    latencyAt: null,
    optimisticLane: null,
    optimisticCars: null,
    now: 0,
    updateReady: false,
    showInstallHint: false,
    ...overrides,
  };
}

/**
 * Which lane the console highlights: the optimistic tap for its first
 * `OPTIMISTIC_LANE_MS`, then whatever the relay last said.
 */
export function selectedLane(model: Model): Lane | null {
  const optimistic = model.optimisticLane;
  if (optimistic !== null && model.now - optimistic.at < OPTIMISTIC_LANE_MS) {
    return optimistic.lane;
  }

  return model.state?.lane ?? null;
}

const NO_CARS: Readonly<Cars> = [0, 0, 0];

/**
 * The room's cars triple as best this client knows it, and what the car rows
 * light: the triple the spotter just sent while its optimistic window is
 * open, otherwise whatever the relay last said. A tap is computed against
 * this, so two quick taps on different rows compose instead of the second
 * undoing the first.
 */
export function selectedCars(model: Model): Readonly<Cars> {
  const optimistic = model.optimisticCars;
  if (optimistic !== null && model.now - optimistic.at < OPTIMISTIC_LANE_MS) {
    return optimistic.cars;
  }

  return model.state?.cars ?? NO_CARS;
}

/** The console is trustworthy only when the socket is open *and* the room has
 * replayed its state; anything else is still reconnecting/syncing. */
export function isLive(model: Model): boolean {
  return model.conn === 'open' && model.state !== null;
}

export function isLatencyStale(model: Model): boolean {
  return (
    model.latencyAt === null || model.now - model.latencyAt > LATENCY_STALE_MS
  );
}
