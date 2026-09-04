import { describe, expect, it } from 'vitest';

import ackInvalid from './fixtures/ack.invalid.json';
import ackValid from './fixtures/ack.valid.json';
import clearInvalid from './fixtures/clear.invalid.json';
import clearValid from './fixtures/clear.valid.json';
import errorInvalid from './fixtures/error.invalid.json';
import errorValid from './fixtures/error.valid.json';
import gapInvalid from './fixtures/gap.invalid.json';
import gapValid from './fixtures/gap.valid.json';
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
import sideInvalid from './fixtures/side.invalid.json';
import sideValid from './fixtures/side.valid.json';
import stateInvalid from './fixtures/state.invalid.json';
import stateValid from './fixtures/state.valid.json';

import {
  isClientMessage,
  isErrorMessage,
  isPong,
  isSetGap,
  isSetMsg,
  isSetSide,
  isState,
  isWireMessage,
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
    name: 'side',
    guard: isSetSide,
    valid: sideValid,
    invalid: sideInvalid,
  },
  { name: 'gap', guard: isSetGap, valid: gapValid, invalid: gapInvalid },
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
  { name: 'state', guard: isState, valid: stateValid, invalid: stateInvalid },
  { name: 'pong', guard: isPong, valid: pongValid, invalid: pongInvalid },
  {
    name: 'error',
    guard: isErrorMessage,
    valid: errorValid,
    invalid: errorInvalid,
  },
];

describe('protocol v1 guards', () => {
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

  it('accepts a cleared side call and rejects a malformed one', () => {
    expect(isSetSide({ t: 'side', side: null })).toBe(true);
    expect(isClientMessage({ t: 'side', side: 'outside' })).toBe(true);
    expect(isSetSide({ t: 'side' })).toBe(false);
    expect(isSetSide({ t: 'side', side: 'inside', extra: 1 })).toBe(false);
  });

  it('treats `side` as additive on state frames', () => {
    const withoutSide: Record<string, unknown> = {
      ...(stateValid as Record<string, unknown>),
    };
    delete withoutSide.side;

    // A relay that predates the field still speaks PROTOCOL_VERSION 1.
    expect(isState(withoutSide)).toBe(true);
    expect(isState({ ...stateValid, side: null })).toBe(true);
    expect(isState({ ...stateValid, side: 'left' })).toBe(false);
  });
});
