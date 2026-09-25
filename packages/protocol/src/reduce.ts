import {
  CAR_LEVEL_MAX,
  isHudEmpty,
  type Ack,
  type CarLevel,
  type Cars,
  type Clear,
  type ClientMessage,
  type Role,
  type RoomMessage,
  type SetCars,
  type SetLane,
  type SetMsg,
  type State,
} from './index.ts';

/** Dependencies supplied by the relay or a deterministic test. */
export interface ReducerContext {
  readonly now: number;
  readonly newId: () => string;
}

/** A client frame after the relay has associated it with its URL-authoritative role. */
export type ClientEvent = ClientMessage & { readonly role: Role };

export interface PeerEvent {
  readonly t: 'peer';
  readonly role: Role;
  readonly online: boolean;
}

export interface ExpireEvent {
  readonly t: 'expire';
}

/**
 * The relay's stale clear: nothing has updated a non-empty room for
 * `HUD_STALE_CLEAR_MS`, so lane, cars and message go blank. Online flags are
 * kept. A room that is already empty is left untouched (no `seq` bump).
 */
export interface StaleEvent {
  readonly t: 'stale';
}

export type ReducerEvent = ClientEvent | PeerEvent | ExpireEvent | StaleEvent;

/** The state for a fresh room. Call {@link createInitialState} for an owned copy. */
export const INITIAL_STATE: Readonly<State> = {
  t: 'state',
  seq: 0,
  lane: null,
  cars: Object.freeze([0, 0, 0]) as Cars,
  msg: null,
  spotterOnline: false,
  driverOnline: false,
  updatedAt: 0,
};

export function createInitialState(): State {
  return { ...INITIAL_STATE, cars: [0, 0, 0] };
}

function changed(
  state: State,
  changes: Partial<
    Pick<State, 'lane' | 'cars' | 'msg' | 'spotterOnline' | 'driverOnline'>
  >,
  now: number,
): State {
  return {
    ...state,
    ...changes,
    seq: state.seq + 1,
    updatedAt: Math.max(state.updatedAt, now),
  };
}

function reduceLane(
  state: State,
  event: SetLane & { readonly role: Role },
  ctx: ReducerContext,
): State {
  if (event.role !== 'spotter' || event.lane === state.lane) {
    return state;
  }

  return changed(state, { lane: event.lane }, ctx.now);
}

function carLevel(value: number): CarLevel {
  return Math.min(CAR_LEVEL_MAX, Math.max(0, Math.round(value))) as CarLevel;
}

function reduceCars(
  state: State,
  event: SetCars & { readonly role: Role },
  ctx: ReducerContext,
): State {
  if (event.role !== 'spotter') {
    return state;
  }

  const cars: Cars = [
    carLevel(event.cars[0]),
    carLevel(event.cars[1]),
    carLevel(event.cars[2]),
  ];
  return cars.every((level, index) => level === state.cars[index])
    ? state
    : changed(state, { cars }, ctx.now);
}

function reduceMessage(
  state: State,
  event: SetMsg & { readonly role: Role },
  ctx: ReducerContext,
): State {
  if (event.role !== 'spotter') {
    return state;
  }

  const text = event.text.trim();
  if (text.length === 0) {
    return state;
  }

  const msg: RoomMessage = {
    id: ctx.newId(),
    text,
    ts: ctx.now,
    ackedAt: null,
  };
  return changed(state, { msg }, ctx.now);
}

function reduceClear(
  state: State,
  event: Clear & { readonly role: Role },
  ctx: ReducerContext,
): State {
  if (event.role !== 'spotter' || state.msg === null) {
    return state;
  }

  return changed(state, { msg: null }, ctx.now);
}

function reduceAck(
  state: State,
  event: Ack & { readonly role: Role },
  ctx: ReducerContext,
): State {
  if (
    event.role !== 'driver' ||
    state.msg === null ||
    state.msg.id !== event.msgId ||
    state.msg.ackedAt !== null
  ) {
    return state;
  }

  return changed(state, { msg: { ...state.msg, ackedAt: ctx.now } }, ctx.now);
}

/**
 * Apply a validated room event without side effects. Events that cannot affect
 * room state (hello, ping, wrong-role and unknown event variants) are no-ops.
 */
export function reduce(
  state: State,
  event: ReducerEvent,
  ctx: ReducerContext,
): State {
  switch (event.t) {
    case 'lane':
      return reduceLane(state, event, ctx);
    case 'cars':
      return reduceCars(state, event, ctx);
    case 'msg':
      return reduceMessage(state, event, ctx);
    case 'clear':
      return reduceClear(state, event, ctx);
    case 'ack':
      return reduceAck(state, event, ctx);
    case 'peer':
      if (event.role === 'spotter') {
        return event.online === state.spotterOnline
          ? state
          : changed(state, { spotterOnline: event.online }, ctx.now);
      }
      if (event.role === 'driver') {
        return event.online === state.driverOnline
          ? state
          : changed(state, { driverOnline: event.online }, ctx.now);
      }
      return state;
    case 'expire':
      return createInitialState();
    case 'stale':
      return isHudEmpty(state)
        ? state
        : changed(state, { lane: null, cars: [0, 0, 0], msg: null }, ctx.now);
    default:
      return state;
  }
}
