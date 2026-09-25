import { ROOM_TTL_MS } from '@g2-race-spotter/protocol';

/**
 * The new-visit path (Maxx, 2026-09-25 design round 4): "When a user goes to
 * the page, they are assigned a random room ID. User is asked to set a 4
 * digit pin." Kept pure so `join.test.ts` can pin the shape and the retry
 * rule without a socket.
 */

export const ROOM_CODE_LENGTH = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Largest multiple of 36 that fits a byte: bytes at or above it are
 * redrawn, so every character is equally likely. */
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);

/** Fills a byte array with random values, as `crypto.getRandomValues` does. */
export type RandomBytes = (
  bytes: Uint8Array<ArrayBuffer>,
) => Uint8Array<ArrayBuffer>;

const cryptoBytes: RandomBytes = (bytes) =>
  globalThis.crypto.getRandomValues(bytes);

/** A random `[A-Z0-9]{6}` room code. */
export function generateRoomCode(random: RandomBytes = cryptoBytes): string {
  let code = '';
  while (code.length < ROOM_CODE_LENGTH) {
    for (const byte of random(new Uint8Array(ROOM_CODE_LENGTH * 2))) {
      if (byte < UNBIASED_LIMIT && code.length < ROOM_CODE_LENGTH) {
        code += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  return code;
}

/** A new room must have a PIN: it is what makes the random code private. */
export function isStartPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

/**
 * Whether a stored room is still the spotter's session: the relay deletes a
 * room idle for `ROOM_TTL_MS` (24 h), so after that the phone starts a new
 * one instead of silently re-creating the old code. `seenAt` 0 (never
 * recorded, e.g. stored by an older build) counts as current.
 */
export function isSessionCurrent(seenAt: number, now: number): boolean {
  return seenAt === 0 || now - seenAt < ROOM_TTL_MS;
}
