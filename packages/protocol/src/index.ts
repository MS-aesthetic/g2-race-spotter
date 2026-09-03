/**
 * The transport-independent v1 contract shared by every Race Spotter client
 * and the relay. Keep this package free of runtime dependencies.
 */

export const PROTOCOL_VERSION = 1;

export const PING_INTERVAL_MS = 2_000;
export const PEER_OFFLINE_MS = 6_000;
export const ALARM_TICK_MS = 3_000;
export const DRIVER_NO_LINK_MS = 5_000;
export const GAP_SEND_MIN_MS = 100;
export const HUD_GAP_FLUSH_MS = 250;
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 8_000;
export const RATE_LIMIT_PER_S = 30;
export const RATE_BURST = 60;
export const ROOM_TTL_MS = 12 * 60 * 60 * 1_000;
export const MSG_MAX_CHARS = 80;
export const FRAME_MAX_BYTES = 1_024;

export const CLOSE_CODE_BAD_HELLO = 4_400;
export const CLOSE_CODE_AUTH = 4_401;
export const CLOSE_CODE_SILENT_PEER = 4_408;
export const CLOSE_CODE_DRIVER_EVICTED = 4_409;
export const CLOSE_CODE_VERSION = 4_426;

export type Lane = 'top' | 'mid' | 'bot';
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

export interface SetGap {
  t: 'gap';
  value: number;
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

export type ClientMessage =
  Hello | SetLane | SetGap | SetMsg | Clear | Ack | Ping;

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
  gap: number;
  msg: RoomMessage | null;
  spotterOnline: boolean;
  driverOnline: boolean;
  updatedAt: number;
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

export function isSetGap(value: unknown): value is SetGap {
  return (
    isRecord(value) &&
    value.t === 'gap' &&
    hasOnlyKeys(value, ['t', 'value']) &&
    isFiniteNumber(value.value)
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

export function isClientMessage(value: unknown): value is ClientMessage {
  return (
    isHello(value) ||
    isSetLane(value) ||
    isSetGap(value) ||
    isSetMsg(value) ||
    isClear(value) ||
    isAck(value) ||
    isPing(value)
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
    isFiniteNumber(value.gap) &&
    value.gap >= 0 &&
    value.gap <= 100 &&
    (value.msg === null || isRoomMessage(value.msg)) &&
    typeof value.spotterOnline === 'boolean' &&
    typeof value.driverOnline === 'boolean' &&
    isFiniteNumber(value.updatedAt)
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

export function isWireMessage(value: unknown): value is WireMessage {
  return isClientMessage(value) || isServerMessage(value);
}
