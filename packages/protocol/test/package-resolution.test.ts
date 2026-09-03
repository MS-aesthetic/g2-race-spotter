import { describe, expect, it } from 'vitest';

import {
  createInitialState,
  isSetLane,
  reduce,
} from '@g2-race-spotter/protocol';

describe('protocol package root', () => {
  it('exposes guards and the reducer through a bare workspace import', () => {
    expect(isSetLane({ t: 'lane', lane: 'top' })).toBe(true);

    expect(
      reduce(
        createInitialState(),
        { t: 'lane', lane: 'top', role: 'spotter' },
        { now: 1, newId: () => 'unused' },
      ),
    ).toMatchObject({ lane: 'top', seq: 1, updatedAt: 1 });
  });
});
