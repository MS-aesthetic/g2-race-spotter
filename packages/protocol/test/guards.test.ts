import { describe, expect, it } from 'vitest';

import ackInvalid from './fixtures/ack.invalid.json';
import ackValid from './fixtures/ack.valid.json';
import carsInvalid from './fixtures/cars.invalid.json';
import carsValid from './fixtures/cars.valid.json';
import clearInvalid from './fixtures/clear.invalid.json';
import clearValid from './fixtures/clear.valid.json';
import errorInvalid from './fixtures/error.invalid.json';
import errorValid from './fixtures/error.valid.json';
import helloInvalid from './fixtures/hello.invalid.json';
import helloValid from './fixtures/hello.valid.json';
import laneInvalid from './fixtures/lane.invalid.json';
import laneValid from './fixtures/lane.valid.json';
import msgInvalid from './fixtures/msg.invalid.json';
import msgValid from './fixtures/msg.valid.json';
import pingInvalid from './fixtures/ping.invalid.json';
import pingValid from './fixtures/ping.valid.json';
import pongInvalid from './fixtures/pong.invalid.json';
import pongValid from './fixtures/pong.valid.json';
import presetInvalid from './fixtures/preset.invalid.json';
import presetValid from './fixtures/preset.valid.json';
import stateInvalid from './fixtures/state.invalid.json';
import stateValid from './fixtures/state.valid.json';

import {
  isClientMessage,
  isErrorMessage,
  isHudEmpty,
  isPong,
  isSetCars,
  isSetMsg,
  isSetPreset,
  isState,
  isWireMessage,
  MSG_MAX_CHARS,
  PRESETS_MAX,
  PROTOCOL_VERSION,
  ROOM_TTL_MS,
} from '../src/index';

type FixtureExpectation = {
  readonly name: string;
  readonly guard: (value: unknown) => boolean;
  readonly valid: unknown;
  readonly invalid: unknown;
};

const fixtures: readonly FixtureExpectation[] = [
  {
    name: 'hello',
    guard: isClientMessage,
    valid: helloValid,
    invalid: helloInvalid,
  },
  {
    name: 'lane',
    guard: isClientMessage,
    valid: laneValid,
    invalid: laneInvalid,
  },
  {
    name: 'cars',
    guard: isSetCars,
    valid: carsValid,
    invalid: carsInvalid,
  },
  { name: 'msg', guard: isSetMsg, valid: msgValid, invalid: msgInvalid },
  {
    name: 'clear',
    guard: isClientMessage,
    valid: clearValid,
    invalid: clearInvalid,
  },
  { name: 'ack', guard: isClientMessage, valid: ackValid, invalid: ackInvalid },
  {
    name: 'ping',
    guard: isClientMessage,
    valid: pingValid,
    invalid: pingInvalid,
  },
  {
    name: 'preset',
    guard: isSetPreset,
    valid: presetValid,
    invalid: presetInvalid,
  },
  { name: 'state', guard: isState, valid: stateValid, invalid: stateInvalid },
  { name: 'pong', guard: isPong, valid: pongValid, invalid: pongInvalid },
  {
    name: 'error',
    guard: isErrorMessage,
    valid: errorValid,
    invalid: errorInvalid,
  },
];

describe('protocol v2 guards', () => {
  it.each(fixtures)(
    '$name valid fixture passes its guard and the wire guard',
    ({ guard, valid }) => {
      expect(guard(valid)).toBe(true);
      expect(isWireMessage(valid)).toBe(true);
    },
  );

  it.each(fixtures)(
    '$name invalid fixture fails its guard and the wire guard',
    ({ guard, invalid }) => {
      expect(guard(invalid)).toBe(false);
      expect(isWireMessage(invalid)).toBe(false);
    },
  );

  it('is protocol version 2 and the hello fixture speaks it', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(helloValid.v).toBe(PROTOCOL_VERSION);
  });

  it('accepts any finite cars triple on the wire and rejects malformed ones', () => {
    expect(isSetCars({ t: 'cars', cars: [0, 0, 0] })).toBe(true);
    // The relay clamps and rounds; the guard only checks the shape.
    expect(isClientMessage({ t: 'cars', cars: [-1, 9, 1.5] })).toBe(true);
    expect(isSetCars({ t: 'cars', cars: [1, 2, 3, 0] })).toBe(false);
    expect(isSetCars({ t: 'cars', cars: [1, '2', 3] })).toBe(false);
    expect(isSetCars({ t: 'cars', cars: [1, Number.NaN, 3] })).toBe(false);
    expect(isSetCars({ t: 'cars', cars: [1, 2, 3], extra: 1 })).toBe(false);
    expect(isSetCars({ t: 'cars' })).toBe(false);
  });

  it('removes the v1 gap and side messages', () => {
    expect(isClientMessage({ t: 'gap', value: 50 })).toBe(false);
    expect(isClientMessage({ t: 'side', side: 'inside' })).toBe(false);
  });

  it('requires integer 0..3 cars on state frames', () => {
    const base = stateValid as Record<string, unknown>;
    const withoutCars: Record<string, unknown> = { ...base };
    delete withoutCars.cars;

    expect(isState(withoutCars)).toBe(false);
    expect(isState({ ...base, cars: [3, 3, 3] })).toBe(true);
    expect(isState({ ...base, cars: [0, 1.5, 0] })).toBe(false);
    expect(isState({ ...base, cars: [0, -1, 0] })).toBe(false);
    expect(isState({ ...base, cars: [0, 0] })).toBe(false);
  });

  it('requires a non-negative calledAt on state frames', () => {
    const base = stateValid as Record<string, unknown>;
    const withoutCalledAt: Record<string, unknown> = { ...base };
    delete withoutCalledAt.calledAt;

    expect(isState(withoutCalledAt)).toBe(false);
    expect(isState({ ...base, calledAt: 0 })).toBe(true);
    expect(isState({ ...base, calledAt: -1 })).toBe(false);
    expect(isState({ ...base, calledAt: '1' })).toBe(false);
  });

  it('accepts preset add/remove with one trimmed 1..80-char text', () => {
    expect(isSetPreset({ t: 'preset', add: 'Fuel save' })).toBe(true);
    expect(isClientMessage({ t: 'preset', remove: 'Fuel save' })).toBe(true);
    expect(isSetPreset({ t: 'preset', add: 'a'.repeat(MSG_MAX_CHARS) })).toBe(
      true,
    );
    expect(
      isSetPreset({ t: 'preset', add: 'a'.repeat(MSG_MAX_CHARS + 1) }),
    ).toBe(false);
    expect(isSetPreset({ t: 'preset', add: ' padded ' })).toBe(false);
    expect(isSetPreset({ t: 'preset', add: '' })).toBe(false);
    expect(isSetPreset({ t: 'preset' })).toBe(false);
    expect(isSetPreset({ t: 'preset', add: 7 })).toBe(false);
    expect(isSetPreset({ t: 'preset', remove: 'x', extra: 1 })).toBe(false);
  });

  it('accepts a state with or without presets (additive), validating them when present', () => {
    const base = stateValid as Record<string, unknown>;
    const withoutPresets: Record<string, unknown> = { ...base };
    delete withoutPresets.presets;

    // A relay that predates presets omits the field; that frame is still v2.
    expect(isState(withoutPresets)).toBe(true);
    expect(isState({ ...base, presets: [] })).toBe(true);
    expect(
      isState({
        ...base,
        presets: Array.from({ length: PRESETS_MAX }, (_, i) => `p${i}`),
      }),
    ).toBe(true);
    expect(
      isState({
        ...base,
        presets: Array.from({ length: PRESETS_MAX + 1 }, (_, i) => `p${i}`),
      }),
    ).toBe(false);
    expect(isState({ ...base, presets: ['dup', 'dup'] })).toBe(false);
    expect(isState({ ...base, presets: [' untrimmed'] })).toBe(false);
    expect(isState({ ...base, presets: 'Fuel save' })).toBe(false);
    expect(isState({ ...base, presets: [1] })).toBe(false);
  });

  it('keeps an idle room for 24 hours (Maxx, design round 4)', () => {
    expect(ROOM_TTL_MS).toBe(24 * 60 * 60 * 1_000);
    expect(PRESETS_MAX).toBe(12);
  });

  it('calls a room with no lane, no car and no message empty', () => {
    expect(isHudEmpty({ lane: null, cars: [0, 0, 0], msg: null })).toBe(true);
    expect(isHudEmpty({ lane: 'top', cars: [0, 0, 0], msg: null })).toBe(false);
    expect(isHudEmpty({ lane: null, cars: [0, 0, 1], msg: null })).toBe(false);
    expect(
      isHudEmpty({
        lane: null,
        cars: [0, 0, 0],
        msg: { id: 'm', text: 'x', ts: 1, ackedAt: 2 },
      }),
    ).toBe(false);
  });
});
