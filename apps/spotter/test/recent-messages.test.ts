import { MSG_MAX_CHARS } from '@g2-race-spotter/protocol';
import { describe, expect, it } from 'vitest';

import {
  RECENT_MESSAGES_KEY,
  RECENT_MESSAGES_MAX,
  addRecentMessage,
  loadRecentMessages,
  saveRecentMessages,
  type WebStorage,
} from '../src/recent-messages.ts';

function memoryStorage(initial: Record<string, string> = {}): WebStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('recent message chips', () => {
  it('keeps the newest first and dedupes a repeat', () => {
    let list = addRecentMessage([], 'box this lap');
    list = addRecentMessage(list, 'car left');
    list = addRecentMessage(list, 'box this lap');

    expect(list).toEqual(['box this lap', 'car left']);
  });

  it('caps the list at five', () => {
    let list: string[] = [];
    for (const text of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      list = addRecentMessage(list, text);
    }

    expect(list).toHaveLength(RECENT_MESSAGES_MAX);
    expect(list).toEqual(['g', 'f', 'e', 'd', 'c']);
  });

  it('trims and caps to MSG_MAX_CHARS before storing', () => {
    const long = `  ${'x'.repeat(MSG_MAX_CHARS + 20)}  `;
    const list = addRecentMessage([], long);

    expect(list[0]).toHaveLength(MSG_MAX_CHARS);
    expect(list[0]).toBe(list[0]!.trim());
  });

  it('ignores an empty or whitespace-only message', () => {
    expect(addRecentMessage(['car left'], '   ')).toEqual(['car left']);
  });

  it('round-trips through localStorage-shaped storage', () => {
    const storage = memoryStorage();
    const list = addRecentMessage(addRecentMessage([], 'one'), 'two');
    saveRecentMessages(storage, list);

    expect(storage.getItem(RECENT_MESSAGES_KEY)).toBe('["two","one"]');
    expect(loadRecentMessages(storage)).toEqual(['two', 'one']);
  });

  it('never writes more than five entries even if handed more', () => {
    const storage = memoryStorage();
    saveRecentMessages(storage, ['a', 'b', 'c', 'd', 'e', 'f']);

    expect(loadRecentMessages(storage)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns an empty list for missing, malformed or foreign values', () => {
    expect(loadRecentMessages(memoryStorage())).toEqual([]);
    expect(
      loadRecentMessages(memoryStorage({ [RECENT_MESSAGES_KEY]: 'not json' })),
    ).toEqual([]);
    expect(
      loadRecentMessages(memoryStorage({ [RECENT_MESSAGES_KEY]: '{"a":1}' })),
    ).toEqual([]);
    expect(
      loadRecentMessages(
        memoryStorage({ [RECENT_MESSAGES_KEY]: '[1,null,"  ","ok","ok"]' }),
      ),
    ).toEqual(['ok']);
  });

  it('survives a storage that throws (private mode)', () => {
    const hostile: WebStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    };

    expect(loadRecentMessages(hostile)).toEqual([]);
    expect(() => saveRecentMessages(hostile, ['a'])).not.toThrow();
  });
});
