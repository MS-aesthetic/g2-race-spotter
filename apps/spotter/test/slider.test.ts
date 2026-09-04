import { GAP_SEND_MIN_MS } from '@g2-race-spotter/protocol';
import { describe, expect, it } from 'vitest';

import { createGapThrottle, nextSide } from '../src/intents.ts';

function harness() {
  const sent: number[] = [];
  let now = 0;
  const throttle = createGapThrottle({
    send: (value) => sent.push(value),
    now: () => now,
  });

  return {
    sent,
    at(ms: number): void {
      now = ms;
    },
    throttle,
  };
}

describe('AC-2 gap throttle', () => {
  it('sends at most four gap frames for 30 drag values in 300 ms', () => {
    const { sent, at, throttle } = harness();

    // 30 `input` events, one every 10 ms, values 1..30.
    for (let step = 0; step < 30; step += 1) {
      at(step * 10);
      throttle.input(step + 1);
    }

    // Finger lifted: the `change` event.
    at(300);
    throttle.release(30);

    expect(sent.length).toBeLessThanOrEqual(4);
    expect(sent.at(-1)).toBe(30);
  });

  it('never sends two drag frames closer together than GAP_SEND_MIN_MS', () => {
    const times: number[] = [];
    let now = 0;
    const throttle = createGapThrottle({
      send: () => times.push(now),
      now: () => now,
    });

    for (let step = 0; step < 30; step += 1) {
      now = step * 10;
      throttle.input(step + 1);
    }

    expect(times.length).toBeGreaterThan(1);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(
        GAP_SEND_MIN_MS,
      );
    }
  });

  it('sends immediately on the first drag value', () => {
    const { sent, at, throttle } = harness();

    at(0);
    throttle.input(42);

    expect(sent).toEqual([42]);
  });

  it('ignores sub-1-point jitter around the last sent value', () => {
    const { sent, at, throttle } = harness();

    at(0);
    throttle.input(50);
    at(1_000);
    throttle.input(50.4);
    at(2_000);
    throttle.release(49.6);

    expect(sent).toEqual([50]);
  });

  it('does not re-send on release when the value never moved', () => {
    const { sent, at, throttle } = harness();

    at(0);
    throttle.input(25);
    at(50);
    throttle.release(25);

    expect(sent).toEqual([25]);
  });

  it('always sends the released value even inside the throttle window', () => {
    const { sent, at, throttle } = harness();

    at(0);
    throttle.input(10);
    at(20);
    throttle.input(60);
    at(40);
    throttle.release(60);

    // The 60 at t=20 was throttled away; the release still delivers it.
    expect(sent).toEqual([10, 60]);
  });

  it('clamps to the protocol range and rounds to whole points', () => {
    const { sent, at, throttle } = harness();

    at(0);
    throttle.input(-20);
    at(200);
    throttle.input(140);
    at(400);
    throttle.release(66.6);

    expect(sent).toEqual([0, 100, 67]);
  });

  it('re-sends after reset even for an unchanged value', () => {
    const { sent, at, throttle } = harness();

    at(0);
    throttle.release(30);
    throttle.reset();
    at(1);
    throttle.release(30);

    expect(sent).toEqual([30, 30]);
  });
});

describe('side toggle (T052)', () => {
  it('sets the tapped side and clears it on a second tap', () => {
    expect(nextSide(null, 'inside')).toBe('inside');
    expect(nextSide(null, 'outside')).toBe('outside');
    // Tapping the lit button is how the spotter says the car has gone.
    expect(nextSide('inside', 'inside')).toBeNull();
    expect(nextSide('outside', 'outside')).toBeNull();
    // Tapping the other one switches sides without a clear in between.
    expect(nextSide('inside', 'outside')).toBe('outside');
    expect(nextSide('outside', 'inside')).toBe('inside');
  });
});
