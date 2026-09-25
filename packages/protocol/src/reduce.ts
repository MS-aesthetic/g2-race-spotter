import {
  CAR_LEVEL_MAX,
  MSG_MAX_CHARS,
  PRESETS_MAX,
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
  type SetPreset,
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
  calledAt: 0,
  presets: Object.freeze([]) as unknown as string[],
};

export function createInitialState(): State {
  return { ...INITIAL_STATE, cars: [0, 0, 0], presets: [] };
}

function changed(
  state: State,
  changes: Partial<
    Pick<
      State,
      | 'lane'
      | 'cars'
      | 'msg'
      | 'spotterOnline'
      | 'driverOnline'
      | 'calledAt'
      | 'presets'
    >
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

/** A spotter call: an ordinary change that also restarts the stale window. */
function called(
  state: State,
  changes: Partial<Pick<State, 'lane' | 'cars' | 'msg'>>,
  now: number,
): State {
  return changed(
    state,
    { ...changes, calledAt: Math.max(state.calledAt, now) },
    now,
  );
}

function reduceLane(
  state: State,
  event: SetLane & { readonly role: Role },
  ctx: ReducerContext,
): State {
  if (event.role !== 'spotter' || event.lane === state.lane) {
    return state;
  }

  return called(state, { lane: event.lane }, ctx.now);
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
    : called(state, { cars }, ctx.now);
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
  return called(state, { msg }, ctx.now);
}

function reduceClear(
  state: State,
  event: Clear & { readonly role: Role },
  ctx: ReducerContext,
): State {
  if (event.role !== 'spotter' || state.msg === null) {
    return state;
  }

  return called(state, { msg: null }, ctx.now);
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
 * Save or forget a custom message. Not a spotter *call*: the HUD does not
 * change, so `calledAt` (the stale-clear clock) is left alone. Adding a text
 * the room already holds, adding past `PRESETS_MAX`, or removing one it does
 * not hold is a no-op.
 */
function reducePreset(
  state: State,
  event: SetPreset & { readonly role: Role },
  ctx: ReducerContext,
): State {
  if (event.role !== 'spotter') {
    return state;
  }

  const presets = state.presets ?? [];
  if ('add' in event) {
    const text = event.add.trim();
    if (
      text.length === 0 ||
      text.length > MSG_MAX_CHARS ||
      presets.includes(text) ||
      presets.length >= PRESETS_MAX
    ) {
      return state;
    }

    return changed(state, { presets: [...presets, text] }, ctx.now);
  }

  const text = event.remove.trim();
  return presets.includes(text)
    ? changed(
        state,
        { presets: presets.filter((entry) => entry !== text) },
        ctx.now,
      )
    : state;
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
    case 'preset':
      return reducePreset(state, event, ctx);
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
      // A fresh room lifetime: presets go with everything else.
      return createInitialState();
    case 'stale':
      // Clears only what the HUD shows; the room's saved presets stay.
      return isHudEmpty(state)
        ? state
        : changed(
            state,
            { lane: null, cars: [0, 0, 0], msg: null, calledAt: 0 },
            ctx.now,
          );
    default:
      return state;
  }
}
