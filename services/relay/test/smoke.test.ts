import { describe, expect, it } from 'vitest';

import { workspaceName } from '../src/index';

describe('relay workspace', () => {
  it('loads the placeholder module', () => {
    expect(workspaceName).toBe('@g2-race-spotter/relay');
  });
});
