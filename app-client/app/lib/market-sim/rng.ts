// Seeded randomness, so the same seed always gives the same run. Separate streams (the market's
// and each player's) keep a scenario and its baseline drawing the same numbers for as long as
// their choices agree.

export type Rng = () => number;

/** mulberry32: a small, fast 32-bit generator, uniform on [0, 1). */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes numbers into one 32-bit seed (a stream per seed and player, say). */
export function seedFor(...parts: number[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    hash = Math.imul(hash ^ (part >>> 0), 0x01000193);
    hash = Math.imul(hash ^ (hash >>> 13), 0x5bd1e995);
    hash ^= hash >>> 15;
  }
  return hash >>> 0;
}

/** A standard normal draw (Box-Muller). */
export function gaussian(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
