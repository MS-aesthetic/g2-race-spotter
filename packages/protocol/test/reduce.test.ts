import { describe, expect, it } from 'vitest';

import {
  createInitialState,
  INITIAL_STATE,
  MSG_MAX_CHARS,
  PRESETS_MAX,
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
      calledAt: 0,
      presets: [],
    });
    expect(createInitialState()).not.toBe(createInitialState());
    expect(createInitialState().cars).not.toBe(createInitialState().cars);
    expect(createInitialState().presets).not.toBe(createInitialState().presets);
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
      calledAt: 0,
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

  it('stamps calledAt on spotter calls only, never on acks or presence', () => {
    let state = reduce(
      createInitialState(),
      event({ t: 'lane', role: 'spotter', lane: 'top' }),
      context(1_000),
    );
    expect(state).toMatchObject({ calledAt: 1_000, updatedAt: 1_000 });
    state = reduce(
      state,
      event({ t: 'cars', role: 'spotter', cars: [1, 0, 0] }),
      context(2_000),
    );
    expect(state.calledAt).toBe(2_000);
    state = reduce(
      state,
      event({ t: 'msg', role: 'spotter', text: 'box' }),
      context(3_000),
    );
    expect(state.calledAt).toBe(3_000);

    // The driver's ack (auto-ack at 5 s included) and presence flips move
    // updatedAt but must not restart the stale window.
    const acked = reduce(
      state,
      event({ t: 'ack', role: 'driver', msgId: 'message-1' }),
      context(8_000),
    );
    expect(acked).toMatchObject({ updatedAt: 8_000, calledAt: 3_000 });
    const flipped = reduce(
      acked,
      event({ t: 'peer', role: 'driver', online: true }),
      context(8_500),
    );
    expect(flipped).toMatchObject({ updatedAt: 8_500, calledAt: 3_000 });

    const cleared = reduce(
      flipped,
      event({ t: 'clear', role: 'spotter' }),
      context(9_000),
    );
    expect(cleared.calledAt).toBe(9_000);
    // A no-op call (same lane) is not a call.
    expect(
      reduce(
        cleared,
        event({ t: 'lane', role: 'spotter', lane: 'top' }),
        context(9_500),
      ),
    ).toBe(cleared);
    expect(reduce(cleared, event({ t: 'expire' }), context(10_000))).toEqual(
      INITIAL_STATE,
    );
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

  it('saves and forgets presets for the spotter only, deduped and capped, without a call', () => {
    const initial = reduce(
      createInitialState(),
      event({ t: 'lane', role: 'spotter', lane: 'top' }),
      context(1_000),
    );
    const saved = reduce(
      initial,
      event({ t: 'preset', role: 'spotter', add: 'Fuel save' }),
      context(2_000),
    );
    expect(saved).toMatchObject({
      presets: ['Fuel save'],
      seq: initial.seq + 1,
      updatedAt: 2_000,
      // Saving a message is not a call: the stale-clear clock does not move.
      calledAt: 1_000,
      lane: 'top',
    });

    // Same text again (after trimming) is a no-op: no seq bump, same object.
    expect(
      reduce(
        saved,
        event({ t: 'preset', role: 'spotter', add: '  Fuel save ' }),
        context(3_000),
      ),
    ).toBe(saved);
    // Only the spotter edits presets.
    expect(
      reduce(
        saved,
        event({ t: 'preset', role: 'driver', add: 'Driver note' }),
        context(3_000),
      ),
    ).toBe(saved);
    expect(
      reduce(
        saved,
        event({ t: 'preset', role: 'driver', remove: 'Fuel save' }),
        context(3_000),
      ),
    ).toBe(saved);
    // Empty and over-long texts never land in the room.
    expect(
      reduce(
        saved,
        event({ t: 'preset', role: 'spotter', add: '   ' }),
        context(3_000),
      ),
    ).toBe(saved);
    expect(
      reduce(
        saved,
        event({
          t: 'preset',
          role: 'spotter',
          add: 'x'.repeat(MSG_MAX_CHARS + 1),
        }),
        context(3_000),
      ),
    ).toBe(saved);

    const second = reduce(
      saved,
      event({ t: 'preset', role: 'spotter', add: 'Box box' }),
      context(3_000),
    );
    expect(second.presets).toEqual(['Fuel save', 'Box box']);
    expect(saved.presets).toEqual(['Fuel save']);

    const removed = reduce(
      second,
      event({ t: 'preset', role: 'spotter', remove: 'Fuel save' }),
      context(4_000),
    );
    expect(removed).toMatchObject({
      presets: ['Box box'],
      seq: second.seq + 1,
      calledAt: 1_000,
    });
    // Removing what is not there is a no-op.
    expect(
      reduce(
        removed,
        event({ t: 'preset', role: 'spotter', remove: 'Fuel save' }),
        context(5_000),
      ),
    ).toBe(removed);
  });

  it('stops at PRESETS_MAX presets', () => {
    let state = createInitialState();
    for (let index = 0; index < PRESETS_MAX; index += 1) {
      state = reduce(
        state,
        event({ t: 'preset', role: 'spotter', add: `preset ${index}` }),
        context(1_000 + index),
      );
    }
    expect(state.presets).toHaveLength(PRESETS_MAX);

    const full = reduce(
      state,
      event({ t: 'preset', role: 'spotter', add: 'one too many' }),
      context(9_000),
    );
    expect(full).toBe(state);

    // Removing one makes room again.
    const freed = reduce(
      reduce(
        state,
        event({ t: 'preset', role: 'spotter', remove: 'preset 0' }),
        context(9_000),
      ),
      event({ t: 'preset', role: 'spotter', add: 'one too many' }),
      context(9_001),
    );
    expect(freed.presets).toHaveLength(PRESETS_MAX);
    expect(freed.presets?.at(-1)).toBe('one too many');
  });

  it('keeps presets through a stale clear and drops them on expiry', () => {
    let state = reduce(
      createInitialState(),
      event({ t: 'preset', role: 'spotter', add: 'Fuel save' }),
      context(500),
    );
    state = reduce(
      state,
      event({ t: 'cars', role: 'spotter', cars: [0, 2, 0] }),
      context(1_000),
    );

    const cleared = reduce(state, event({ t: 'stale' }), context(7_000));
    expect(cleared).toMatchObject({
      cars: [0, 0, 0],
      presets: ['Fuel save'],
      calledAt: 0,
    });
    // A room holding only presets shows nothing, so it is not stale-cleared
    // again (and the relay never arms for it).
    expect(reduce(cleared, event({ t: 'stale' }), context(14_000))).toBe(
      cleared,
    );

    expect(reduce(cleared, event({ t: 'expire' }), context(9_000))).toEqual(
      INITIAL_STATE,
    );
  });

  it('treats a stored state without presets as having none', () => {
    const legacy = createInitialState();
    delete legacy.presets;

    const saved = reduce(
      legacy,
      event({ t: 'preset', role: 'spotter', add: 'Fuel save' }),
      context(1_000),
    );
    expect(saved.presets).toEqual(['Fuel save']);
    expect(
      reduce(
        legacy,
        event({ t: 'preset', role: 'spotter', remove: 'Fuel save' }),
        context(1_000),
      ),
    ).toBe(legacy);
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
