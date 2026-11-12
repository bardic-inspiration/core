// Seeded randomness, adapted from dnd-hirelings' `logic/rng.js`: FNV-1a with
// MurmurHash3's finalizer hashes a key to a seed, and mulberry32 steps it.
// The whole stream position is one 32-bit integer, so it lives in game state
// and travels in the log. Changing either algorithm changes every replay;
// tests/rng.test.ts pins golden values.

/** Hashes a string to an unsigned 32-bit seed. */
export function hashSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** One step of mulberry32: the next stream position, and a value in [0, 1). */
export function nextRandom(position: number): { position: number; value: number } {
  const next = (position + 0x6d2b79f5) >>> 0;
  let mixed = next;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return { position: next, value: ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32 };
}

/** Rolls `n` dice of `d` sides from a stream position. */
export function rollDice(position: number, n: number, d: number): { position: number; values: number[] } {
  const values: number[] = [];
  let at = position;
  for (let i = 0; i < n; i++) {
    const step = nextRandom(at);
    at = step.position;
    values.push(1 + Math.floor(step.value * d));
  }
  return { position: at, values };
}
