/** xorshift32. The only randomness allowed in the sim and base generation. */
export type Rng = { next(): number; int(maxExclusive: number): number; chance(percent: number): boolean; pick<T>(items: readonly T[]): T; state(): number };

export function createRng(seed: number): Rng {
  let s = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
  return {
    next,
    int: max => max <= 0 ? 0 : next() % max,
    chance: percent => next() % 100 < percent,
    pick: items => items[next() % items.length],
    state: () => s,
  };
}

/** Mix several integers into one 32-bit seed (FNV-1a over 32-bit words). */
export function mixSeed(...parts: readonly (number | bigint | string)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= 0xff; h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
