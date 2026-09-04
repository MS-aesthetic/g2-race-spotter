import { describe, expect, it } from 'vitest';

import {
  createInputHandler,
  FOREGROUND_DEBOUNCE_MS,
  toOsEvent,
} from '../src/input.ts';
import { FakeClock } from './helpers.ts';

describe('toOsEvent', () => {
  it('accepts the ordinals of the pinned SDK enum', () => {
    expect(toOsEvent(0)).toBe('CLICK_EVENT');
    expect(toOsEvent(3)).toBe('DOUBLE_CLICK_EVENT');
    expect(toOsEvent(7)).toBe('SYSTEM_EXIT_EVENT');
    expect(toOsEvent(99)).toBeUndefined();
  });

  it('accepts full names, shorthands and enum-qualified strings', () => {
    expect(toOsEvent('CLICK_EVENT')).toBe('CLICK_EVENT');
    expect(toOsEvent('CLICK')).toBe('CLICK_EVENT');
    expect(toOsEvent('foreground_enter')).toBe('FOREGROUND_ENTER_EVENT');
    expect(toOsEvent('OsEventTypeList.DOUBLE_CLICK_EVENT')).toBe(
      'DOUBLE_CLICK_EVENT',
    );
    expect(toOsEvent('SWIPE')).toBeUndefined();
  });

  it('digs the type out of every wrapper shape the host has used', () => {
    expect(toOsEvent({ textEvent: { containerID: 1, eventType: 0 } })).toBe(
      'CLICK_EVENT',
    );
    expect(
      toOsEvent({ sysEvent: { eventType: 'FOREGROUND_EXIT_EVENT' } }),
    ).toBe('FOREGROUND_EXIT_EVENT');
    expect(toOsEvent({ listEvent: { eventType: 1 } })).toBe('SCROLL_TOP_EVENT');
    expect(toOsEvent({ jsonData: { Event_Type: 'CLICK_EVENT' } })).toBe(
      'CLICK_EVENT',
    );
    expect(toOsEvent({ eventType: 3 })).toBe('DOUBLE_CLICK_EVENT');
    expect(toOsEvent({ type: 'SYSTEM_EXIT_EVENT' })).toBe('SYSTEM_EXIT_EVENT');
  });

  it('returns undefined for junk instead of throwing', () => {
    expect(toOsEvent(undefined)).toBeUndefined();
    expect(toOsEvent(null)).toBeUndefined();
    expect(toOsEvent([])).toBeUndefined();
    expect(toOsEvent({ textEvent: {} })).toBeUndefined();
  });
});

describe('input handler', () => {
  function handler(clock: FakeClock): {
    handle: (raw: unknown) => void;
    resetAckGuard: () => void;
    reconnects: number[];
    disconnects: number;
  } {
    const reconnects: number[] = [];
    let disconnects = 0;

    const { handle, resetAckGuard } = createInputHandler({
      now: clock.now,
      shutDownPageContainer: async () => true,
      ack: () => undefined,
      unackedMessageId: () => undefined,
      reconnect: () => reconnects.push(clock.ms),
      disconnect: () => {
        disconnects += 1;
      },
      log: () => undefined,
    });

    return {
      handle,
      resetAckGuard,
      reconnects,
      get disconnects() {
        return disconnects;
      },
    };
  }

  it('debounces foreground re-entry to one reconnect per second', () => {
    const clock = new FakeClock();
    const { handle, reconnects } = handler(clock);

    handle({ sysEvent: { eventType: 'FOREGROUND_ENTER_EVENT' } });
    clock.ms += FOREGROUND_DEBOUNCE_MS - 1;
    handle({ sysEvent: { eventType: 'FOREGROUND_ENTER_EVENT' } });
    clock.ms += 1;
    handle({ sysEvent: { eventType: 'FOREGROUND_ENTER_EVENT' } });

    expect(reconnects).toEqual([0, FOREGROUND_DEBOUNCE_MS]);
  });

  it('keeps the socket on a foreground exit and closes it on a system exit', () => {
    const clock = new FakeClock();
    const handled = handler(clock);

    handled.handle({ sysEvent: { eventType: 'FOREGROUND_EXIT_EVENT' } });
    expect(handled.disconnects).toBe(0);

    handled.handle({ sysEvent: { eventType: 'SYSTEM_EXIT_EVENT' } });
    handled.handle({ sysEvent: { eventType: 'ABNORMAL_EXIT_EVENT' } });
    expect(handled.disconnects).toBe(2);
  });
});
