import {
  createInitialState,
  isSetLane,
  reduce,
} from '@g2-race-spotter/protocol';

if (!isSetLane({ t: 'lane', lane: 'top' })) {
  throw new Error('bare package guard import failed');
}

const next = reduce(
  createInitialState(),
  { t: 'lane', lane: 'top', role: 'spotter' },
  { now: 1, newId: () => 'unused' },
);

if (next.lane !== 'top' || next.seq !== 1 || next.updatedAt !== 1) {
  throw new Error('bare package reducer import failed');
}
