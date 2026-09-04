import { normaliseMessage } from './intents.ts';

/** Spotter persistence is `localStorage`, namespaced `g2rs:v1:` (constitution §5). */
export const RECENT_MESSAGES_KEY = 'g2rs:v1:recentMsgs';
export const RECENT_MESSAGES_MAX = 5;

/** The slice of `localStorage` this module needs, so tests can pass a stub. */
export interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Most recent first. Re-sending an existing message moves it to the front
 * rather than adding a duplicate chip — the spotter has five slots and a race
 * has a handful of phrases that repeat all afternoon.
 */
export function addRecentMessage(
  list: readonly string[],
  text: string,
): string[] {
  const message = normaliseMessage(text);
  if (message === '') {
    return [...list];
  }

  return [message, ...list.filter((entry) => entry !== message)].slice(
    0,
    RECENT_MESSAGES_MAX,
  );
}

export function loadRecentMessages(storage: WebStorage): string[] {
  let raw: string | null;
  try {
    raw = storage.getItem(RECENT_MESSAGES_KEY);
  } catch {
    // Safari in private mode throws on access, not just on write.
    return [];
  }

  if (raw === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const messages: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') {
      continue;
    }

    const message = normaliseMessage(entry);
    if (message !== '' && !messages.includes(message)) {
      messages.push(message);
    }
  }

  return messages.slice(0, RECENT_MESSAGES_MAX);
}

export function saveRecentMessages(
  storage: WebStorage,
  list: readonly string[],
): void {
  try {
    storage.setItem(
      RECENT_MESSAGES_KEY,
      JSON.stringify(list.slice(0, RECENT_MESSAGES_MAX)),
    );
  } catch {
    // A full or unavailable quota must never break sending a message.
  }
}
