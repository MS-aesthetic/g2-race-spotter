import { describe, expect, it } from 'vitest';

import {
  createInitialState,
  INITIAL_STATE,
  reduce,
  type ReducerContext,
  type ReducerEvent,
  type State,
} from '../src/index.js';

const context = (now = 1_000): ReducerContext => ({
  now,
  newId: () => 'message-1',
});

function event(input: ReducerEvent): ReducerEvent {
  return input;
}

function withMessage(): State {
  return reduce(
    createInitialState(),
    event({ t: 'msg', role: 'spotter', text: '  pit this lap  ' }),
    context(),
  );
}

describe('reduce', () => {
  it('creates independent normative initial states', () => {
    expect(INITIAL_STATE).toEqual({
      t: 'state',
      seq: 0,
      lane: null,
      cars: [0, 0, 0],
      msg: null,
      spotterOnline: false,
      driverOnline: false,
      updatedAt: 0,
    });
    expect(createInitialState()).not.toBe(createInitialState());
    expect(createInitialState().cars).not.toBe(createInitialState().cars);
  });

  it('sets lane only for the spotter and leaves same lanes alone', () => {
    const initial = createInitialState();
    const lane = reduce(
      initial,
      event({ t: 'lane', role: 'spotter', lane: 'top' }),
      context(),
    );

    expect(lane).toMatchObject({ lane: 'top', seq: 1, updatedAt: 1_000 });
    expect(
      reduce(
        lane,
        event({ t: 'lane', role: 'spotter', lane: 'top' }),
        context(2_000),
      ),
    ).toBe(lane);
    expect(
      reduce(
        lane,
        event({ t: 'lane', role: 'driver', lane: 'bot' }),
        context(2_000),
      ),
    ).toBe(lane);
  });

  it('sets the cars triple only for the spotter, rounding and clamping each level', () => {
    const initial = createInitialState();
    const called = reduce(
      initial,
      event({ t: 'cars', role: 'spotter', cars: [1, 2.4, 3] }),
      context(),
    );
    expect(called).toMatchObject({ cars: [1, 2, 3], seq: 1, updatedAt: 1_000 });

    // A repeat (after rounding) is not news: no `seq` bump, no broadcast.
    expect(
      reduce(
        called,
        event({ t: 'cars', role: 'spotter', cars: [1.2, 1.6, 3] }),
        context(2_000),
      ),
    ).toBe(called);
    // The driver may not call cars on itself.
    expect(
      reduce(
        called,
        event({ t: 'cars', role: 'driver', cars: [0, 0, 0] }),
        context(2_000),
      ),
    ).toBe(called);

    const clamped = reduce(
      called,
      event({ t: 'cars', role: 'spotter', cars: [-4, 9, 0] }),
      context(3_000),
    );
    expect(clamped).toMatchObject({ cars: [0, 3, 0], seq: 2 });
    // The reducer never shares the caller's array.
    expect(clamped.cars).not.toBe(called.cars);
    // Cars and lane are independent calls.
    expect(clamped.lane).toBeNull();
  });

  it('stale-clears lane, cars and message but keeps presence', () => {
    let state = reduce(
      createInitialState(),
      event({ t: 'peer', role: 'driver', online: true }),
      context(500),
    );
    state = reduce(
      state,
      event({ t: 'lane', role: 'spotter', lane: 'top' }),
      context(1_000),
    );
    state = reduce(
      state,
      event({ t: 'cars', role: 'spotter', cars: [0, 3, 1] }),
      context(1_000),
    );
    state = reduce(
      state,
      event({ t: 'msg', role: 'spotter', text: 'box' }),
      context(1_000),
    );

    const cleared = reduce(state, event({ t: 'stale' }), context(7_000));
    expect(cleared).toEqual({
      ...state,
      lane: null,
      cars: [0, 0, 0],
      msg: null,
      seq: state.seq + 1,
      updatedAt: 7_000,
    });
    expect(cleared.driverOnline).toBe(true);
    // An empty room is left alone, so the relay's alarm cannot loop on it.
    expect(reduce(cleared, event({ t: 'stale' }), context(13_000))).toBe(
      cleared,
    );
    const onlyAcked = reduce(
      reduce(
        createInitialState(),
        event({ t: 'msg', role: 'spotter', text: 'box' }),
        context(1_000),
      ),
      event({ t: 'ack', role: 'driver', msgId: 'message-1' }),
      context(2_000),
    );
    expect(
      reduce(onlyAcked, event({ t: 'stale' }), context(8_000)),
    ).toMatchObject({ msg: null, seq: onlyAcked.seq + 1 });
  });

  it('trims a new spotter message and uses only injected clock and id dependencies', () => {
    const state = withMessage();

    expect(state).toMatchObject({
      seq: 1,
      updatedAt: 1_000,
      msg: { id: 'message-1', text: 'pit this lap', ts: 1_000, ackedAt: null },
    });
  });

  it('only acknowledges the current unacknowledged message for the driver', () => {
    const message = withMessage();
    const unmatched = reduce(
      message,
      event({ t: 'ack', role: 'driver', msgId: 'other' }),
      context(2_000),
    );
    const wrongRole = reduce(
      message,
      event({ t: 'ack', role: 'spotter', msgId: 'message-1' }),
      context(2_000),
    );
    const acknowledged = reduce(
      message,
      event({ t: 'ack', role: 'driver', msgId: 'message-1' }),
      context(2_000),
    );

    expect(unmatched).toBe(message);
    expect(wrongRole).toBe(message);
    expect(acknowledged).toMatchObject({
      seq: 2,
      updatedAt: 2_000,
      msg: { id: 'message-1', ackedAt: 2_000 },
    });
    expect(
      reduce(
        acknowledged,
        event({ t: 'ack', role: 'driver', msgId: 'message-1' }),
        context(3_000),
      ),
    ).toBe(acknowledged);
  });

  it('clears only an existing spotter message', () => {
    const empty = createInitialState();
    const message = withMessage();
    const cleared = reduce(
      message,
      event({ t: 'clear', role: 'spotter' }),
      context(2_000),
    );

    expect(
      reduce(empty, event({ t: 'clear', role: 'spotter' }), context()),
    ).toBe(empty);
    expect(
      reduce(message, event({ t: 'clear', role: 'driver' }), context()),
    ).toBe(message);
    expect(cleared).toMatchObject({ msg: null, seq: 2, updatedAt: 2_000 });
  });

  it('tracks peer presence without bumping no-op peer events', () => {
    const initial = createInitialState();
    const spotter = reduce(
      initial,
      event({ t: 'peer', role: 'spotter', online: true }),
      context(),
    );
    const driver = reduce(
      spotter,
      event({ t: 'peer', role: 'driver', online: true }),
      context(2_000),
    );

    expect(spotter).toMatchObject({ spotterOnline: true, seq: 1 });
    expect(driver).toMatchObject({ driverOnline: true, seq: 2 });
    expect(
      reduce(
        driver,
        event({ t: 'peer', role: 'driver', online: true }),
        context(3_000),
      ),
    ).toBe(driver);
  });

  it('returns a fresh initial state for expiry and preserves monotonic metadata for ordinary changes', () => {
    const message = withMessage();
    const later = reduce(
      message,
      event({ t: 'lane', role: 'spotter', lane: 'mid' }),
      context(500),
    );
    const expired = reduce(later, event({ t: 'expire' }), context(2_000));

    expect(later).toMatchObject({ lane: 'mid', seq: 2, updatedAt: 1_000 });
    expect(expired).toEqual(INITIAL_STATE);
    expect(expired).not.toBe(INITIAL_STATE);
  });

  it('ignores client messages that cannot change room state', () => {
    const initial = createInitialState();

    expect(
      reduce(initial, event({ t: 'hello', role: 'spotter', v: 2 }), context()),
    ).toBe(initial);
    expect(
      reduce(initial, event({ t: 'ping', role: 'driver', ts: 1 }), context()),
    ).toBe(initial);
  });
});
