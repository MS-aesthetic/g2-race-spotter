/**
 * The transport-independent v2 contract shared by every Race Spotter client
 * and the relay. Keep this package free of runtime dependencies.
 */

export {
  createInitialState,
  INITIAL_STATE,
  reduce,
  type ClientEvent,
  type ExpireEvent,
  type PeerEvent,
  type ReducerContext,
  type ReducerEvent,
  type StaleEvent,
} from './reduce.ts';

export {
  RoomClient,
  type ConnectionCloseDetail,
  type ConnectionState,
  type RoomClientIntent,
  type RoomClientOptions,
  type RoomClientTimers,
  type RoomWebSocket,
  type RoomWebSocketConstructor,
  type WebSocketCloseEvent,
  type WebSocketMessageEvent,
} from './client.ts';

/**
 * v2 (2026-09-25): `gap`/`side` replaced by `cars`, `stale` clear. Room
 * presets (`preset`, `State.presets`) were added to v2 later the same day as
 * an additive change.
 */
export const PROTOCOL_VERSION = 2;

export const PING_INTERVAL_MS = 2_000;
export const PEER_OFFLINE_MS = 6_000;
export const ALARM_TICK_MS = 3_000;
export const DRIVER_NO_LINK_MS = 5_000;
export const HUD_GAP_FLUSH_MS = 250;
/**
 * The relay clears lane, cars and message once a non-empty room state has
 * gone this long without an update (Maxx, 2026-09-25).
 */
export const HUD_STALE_CLEAR_MS = 6_000;
/** Highest `cars` level: 0 = no car, 3 = on the bumper. */
export const CAR_LEVEL_MAX = 3;
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 8_000;
export const RATE_LIMIT_PER_S = 30;
export const RATE_BURST = 60;
/**
 * An idle room (no socket, no change since `updatedAt`) is deleted after this
 * — the spotter's "session" (Maxx, 2026-09-25 design round 4: 24 h).
 */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1_000;
export const MSG_MAX_CHARS = 80;
/** Most custom messages a room keeps in `State.presets`. */
export const PRESETS_MAX = 12;
export const FRAME_MAX_BYTES = 1_024;

export const CLOSE_CODE_BAD_HELLO = 4_400;
export const CLOSE_CODE_AUTH = 4_401;
export const CLOSE_CODE_SILENT_PEER = 4_408;
export const CLOSE_CODE_DRIVER_EVICTED = 4_409;
export const CLOSE_CODE_VERSION = 4_426;

export type Lane = 'top' | 'mid' | 'bot';
/** How close a car behind is: 0 = none … 3 = on the bumper. */
export type CarLevel = 0 | 1 | 2 | 3;
/** Cars behind as `[left, mid, right]`. */
export type Cars = [CarLevel, CarLevel, CarLevel];
export type Role = 'spotter' | 'driver';
export type ErrorCode =
  'version' | 'auth' | 'role_taken' | 'bad_frame' | 'rate';

export interface Hello {
  t: 'hello';
  v: number;
  role: Role;
  name?: string;
}

export interface SetLane {
  t: 'lane';
  lane: Lane | null;
}

/**
 * Spotter-only: the full `[left, mid, right]` car-behind triple. Any finite
 * numbers are accepted; the relay rounds and clamps each to 0..3.
 */
export interface SetCars {
  t: 'cars';
  cars: [number, number, number];
}

export interface SetMsg {
  t: 'msg';
  text: string;
}

export interface Clear {
  t: 'clear';
}

export interface Ack {
  t: 'ack';
  msgId: string;
}

export interface Ping {
  t: 'ping';
  ts: number;
}

/**
 * Spotter-only: save a custom message to the room (`add`) or forget one
 * (`remove`). Exactly one of the two keys. Saving is not a call to the driver:
 * it never touches the HUD or `calledAt`.
 */
export type SetPreset =
  { t: 'preset'; add: string } | { t: 'preset'; remove: string };

export type ClientMessage =
  Hello | SetLane | SetCars | SetMsg | Clear | Ack | Ping | SetPreset;

export interface RoomMessage {
  id: string;
  text: string;
  ts: number;
  ackedAt: number | null;
}

export interface State {
  t: 'state';
  seq: number;
  lane: Lane | null;
  /** Cars behind, `[left, mid, right]`, each 0..3. */
  cars: Cars;
  msg: RoomMessage | null;
  spotterOnline: boolean;
  driverOnline: boolean;
  /** Server ms of the last change of any kind (peer flips and acks included). */
  updatedAt: number;
  /**
   * Server ms of the last spotter-originated change (lane / cars / msg /
   * clear); 0 for a fresh or stale-cleared room. The relay's stale clear runs
   * from this, so driver acks and presence flips never postpone it.
   */
  calledAt: number;
  /**
   * Custom messages saved to the room, oldest first: trimmed, unique, each
   * 1..`MSG_MAX_CHARS`, at most `PRESETS_MAX`. Additive in v2: a relay that
   * predates presets (or a room stored by one) omits it — read it as
   * `state.presets ?? []`.
   */
  presets?: string[];
}

export interface Pong {
  t: 'pong';
  ts: number;
  serverTs: number;
}

export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  detail?: string;
}

export type ServerMessage = State | Pong | ErrorMessage;
export type WireMessage = ClientMessage | ServerMessage;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function hasOnlyKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isLane(value: unknown): value is Lane {
  return value === 'top' || value === 'mid' || value === 'bot';
}

export function isCarLevel(value: unknown): value is CarLevel {
  return isInteger(value) && value >= 0 && value <= CAR_LEVEL_MAX;
}

export function isCars(value: unknown): value is Cars {
  return Array.isArray(value) && value.length === 3 && value.every(isCarLevel);
}

export function isRole(value: unknown): value is Role {
  return value === 'spotter' || value === 'driver';
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    value === 'version' ||
    value === 'auth' ||
    value === 'role_taken' ||
    value === 'bad_frame' ||
    value === 'rate'
  );
}

export function isHello(value: unknown): value is Hello {
  return (
    isRecord(value) &&
    value.t === 'hello' &&
    hasOnlyKeys(value, ['t', 'v', 'role', 'name']) &&
    isInteger(value.v) &&
    value.v >= 0 &&
    isRole(value.role) &&
    (value.name === undefined || typeof value.name === 'string')
  );
}

export function isSetLane(value: unknown): value is SetLane {
  return (
    isRecord(value) &&
    value.t === 'lane' &&
    hasOnlyKeys(value, ['t', 'lane']) &&
    (value.lane === null || isLane(value.lane))
  );
}

export function isSetCars(value: unknown): value is SetCars {
  return (
    isRecord(value) &&
    value.t === 'cars' &&
    hasOnlyKeys(value, ['t', 'cars']) &&
    Array.isArray(value.cars) &&
    value.cars.length === 3 &&
    value.cars.every(isFiniteNumber)
  );
}

export function isSetMsg(value: unknown): value is SetMsg {
  return (
    isRecord(value) &&
    value.t === 'msg' &&
    hasOnlyKeys(value, ['t', 'text']) &&
    typeof value.text === 'string' &&
    value.text === value.text.trim() &&
    value.text.length > 0 &&
    value.text.length <= MSG_MAX_CHARS
  );
}

export function isClear(value: unknown): value is Clear {
  return isRecord(value) && value.t === 'clear' && hasOnlyKeys(value, ['t']);
}

export function isAck(value: unknown): value is Ack {
  return (
    isRecord(value) &&
    value.t === 'ack' &&
    hasOnlyKeys(value, ['t', 'msgId']) &&
    typeof value.msgId === 'string' &&
    value.msgId.length > 0
  );
}

export function isPing(value: unknown): value is Ping {
  return (
    isRecord(value) &&
    value.t === 'ping' &&
    hasOnlyKeys(value, ['t', 'ts']) &&
    isFiniteNumber(value.ts)
  );
}

/** A message text as the wire carries it: trimmed, 1..`MSG_MAX_CHARS`. */
function isMessageText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= MSG_MAX_CHARS
  );
}

export function isSetPreset(value: unknown): value is SetPreset {
  if (!isRecord(value) || value.t !== 'preset') {
    return false;
  }

  return (
    (hasOnlyKeys(value, ['t', 'add']) && isMessageText(value.add)) ||
    (hasOnlyKeys(value, ['t', 'remove']) && isMessageText(value.remove))
  );
}

export function isClientMessage(value: unknown): value is ClientMessage {
  return (
    isHello(value) ||
    isSetLane(value) ||
    isSetCars(value) ||
    isSetMsg(value) ||
    isClear(value) ||
    isAck(value) ||
    isPing(value) ||
    isSetPreset(value)
  );
}

/** `State.presets` as the reducer keeps it: unique message texts, capped. */
export function isPresets(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= PRESETS_MAX &&
    value.every(isMessageText) &&
    new Set(value).size === value.length
  );
}

export function isRoomMessage(value: unknown): value is RoomMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.text === 'string' &&
    value.text === value.text.trim() &&
    value.text.length > 0 &&
    value.text.length <= MSG_MAX_CHARS &&
    isFiniteNumber(value.ts) &&
    (value.ackedAt === null || isFiniteNumber(value.ackedAt))
  );
}

export function isState(value: unknown): value is State {
  return (
    isRecord(value) &&
    value.t === 'state' &&
    isInteger(value.seq) &&
    value.seq >= 0 &&
    (value.lane === null || isLane(value.lane)) &&
    isCars(value.cars) &&
    (value.msg === null || isRoomMessage(value.msg)) &&
    typeof value.spotterOnline === 'boolean' &&
    typeof value.driverOnline === 'boolean' &&
    isFiniteNumber(value.updatedAt) &&
    isFiniteNumber(value.calledAt) &&
    value.calledAt >= 0 &&
    (value.presets === undefined || isPresets(value.presets))
  );
}

export function isPong(value: unknown): value is Pong {
  return (
    isRecord(value) &&
    value.t === 'pong' &&
    isFiniteNumber(value.ts) &&
    isFiniteNumber(value.serverTs)
  );
}

export function isErrorMessage(value: unknown): value is ErrorMessage {
  return (
    isRecord(value) &&
    value.t === 'error' &&
    isErrorCode(value.code) &&
    (value.detail === undefined || typeof value.detail === 'string')
  );
}

export function isServerMessage(value: unknown): value is ServerMessage {
  return isState(value) || isPong(value) || isErrorMessage(value);
}

/**
 * True when the room carries nothing the driver's HUD would show: no lane,
 * no car behind, no message. The relay's stale clear only applies to a room
 * that is not already empty.
 */
export function isHudEmpty(
  state: Pick<State, 'lane' | 'cars' | 'msg'>,
): boolean {
  return (
    state.lane === null &&
    state.cars.every((level) => level === 0) &&
    state.msg === null
  );
}

export function isWireMessage(value: unknown): value is WireMessage {
  return isClientMessage(value) || isServerMessage(value);
}
