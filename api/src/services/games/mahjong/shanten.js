// Shanten: how many tiles a hand is away from tenpai (0 is tenpai, -1 is complete). The bots choose
// discards by it, and the table uses it for tenpai checks, waits and the beginner hints.
//
// The standard form (four sets and a pair) is worked out one suit at a time: for a suit's nine counts,
// the most partial sets it can hold for each number of complete sets taken, with and without the pair
// coming from it. Those answers are kept per suit pattern, so a hand costs four lookups and a small
// merge. Seven pairs and thirteen orphans have their own formulas.

const { KINDS, YAOCHUU_KINDS } = require("./tiles");

const NONE = -1;
// best[sets * 2 + pair] = the most partial sets alongside, or NONE.
const suitMemo = new Map();
const honorMemo = new Map();

function solveGroup(source, length, sequences) {
  const tiles = source.slice();
  const best = new Int8Array(10).fill(NONE);
  const walk = (start, sets, partial, pair) => {
    let i = start;
    while (i < length && tiles[i] === 0) i += 1;
    if (i >= length) {
      const slot = sets * 2 + pair;
      if (partial > best[slot]) best[slot] = partial;
      return;
    }
    const count = tiles[i];
    if (sets < 4) {
      if (count >= 3) {
        tiles[i] -= 3;
        walk(i, sets + 1, partial, pair);
        tiles[i] += 3;
      }
      if (sequences && i + 2 < length && tiles[i + 1] > 0 && tiles[i + 2] > 0) {
        tiles[i] -= 1;
        tiles[i + 1] -= 1;
        tiles[i + 2] -= 1;
        walk(i, sets + 1, partial, pair);
        tiles[i] += 1;
        tiles[i + 1] += 1;
        tiles[i + 2] += 1;
      }
    }
    if (count >= 2) {
      tiles[i] -= 2;
      if (!pair) walk(i, sets, partial, 1);
      walk(i, sets, partial + 1, pair);
      tiles[i] += 2;
    }
    if (sequences) {
      if (i + 1 < length && tiles[i + 1] > 0) {
        tiles[i] -= 1;
        tiles[i + 1] -= 1;
        walk(i, sets, partial + 1, pair);
        tiles[i] += 1;
        tiles[i + 1] += 1;
      }
      if (i + 2 < length && tiles[i + 2] > 0) {
        tiles[i] -= 1;
        tiles[i + 2] -= 1;
        walk(i, sets, partial + 1, pair);
        tiles[i] += 1;
        tiles[i + 2] += 1;
      }
    }
    // Leave one copy of this tile on its own.
    tiles[i] -= 1;
    walk(i, sets, partial, pair);
    tiles[i] += 1;
  };
  walk(0, 0, 0, 0);
  return best;
}

function groupBest(counts, offset, length, sequences) {
  let key = 0;
  for (let i = 0; i < length; i += 1) key = key * 5 + counts[offset + i];
  const memo = sequences ? suitMemo : honorMemo;
  let best = memo.get(key);
  if (!best) {
    best = solveGroup(counts.slice(offset, offset + length), length, sequences);
    memo.set(key, best);
  }
  return best;
}

/**
 * Shanten for the standard form. `counts` is the concealed tiles by kind; `melds` how many sets are
 * already called (or closed kans).
 */
function standardShanten(counts, melds = 0) {
  let current = new Int8Array(10).fill(NONE);
  current[0] = 0;
  for (let group = 0; group < 4; group += 1) {
    const best = group < 3 ? groupBest(counts, group * 9, 9, true) : groupBest(counts, 27, 7, false);
    const next = new Int8Array(10).fill(NONE);
    for (let slot = 0; slot < 10; slot += 1) {
      if (current[slot] === NONE) continue;
      const sets = slot >> 1;
      const pair = slot & 1;
      for (let add = 0; add < 10; add += 1) {
        if (best[add] === NONE) continue;
        const addSets = add >> 1;
        const addPair = add & 1;
        if (sets + addSets > 4 || pair + addPair > 1) continue;
        const target = (sets + addSets) * 2 + pair + addPair;
        const partial = current[slot] + best[add];
        if (partial > next[target]) next[target] = partial;
      }
    }
    current = next;
  }
  let shanten = 8;
  for (let slot = 0; slot < 10; slot += 1) {
    if (current[slot] === NONE) continue;
    const sets = (slot >> 1) + melds;
    if (sets > 4) continue;
    const pair = slot & 1;
    const value = 8 - 2 * sets - Math.min(current[slot], 4 - sets) - pair;
    if (value < shanten) shanten = value;
  }
  return shanten;
}

/** Seven pairs (closed hands only). */
function sevenPairsShanten(counts) {
  let pairs = 0;
  let kinds = 0;
  for (let kind = 0; kind < KINDS; kind += 1) {
    if (counts[kind] > 0) kinds += 1;
    if (counts[kind] >= 2) pairs += 1;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** Thirteen orphans (closed hands only). */
function orphansShanten(counts) {
  let kinds = 0;
  let pair = 0;
  for (const kind of YAOCHUU_KINDS) {
    if (counts[kind] > 0) kinds += 1;
    if (counts[kind] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

/** The lowest of the three forms. A hand with melds can only be the standard form. */
function shanten(counts, melds = 0) {
  const standard = standardShanten(counts, melds);
  if (melds > 0) return standard;
  return Math.min(standard, sevenPairsShanten(counts), orphansShanten(counts));
}

/**
 * For a hand one short of a full hand (13 tiles, less 3 per meld): the kinds that would complete it.
 * A tile the hand already holds all four of isn't a wait (docs §1, "Draws").
 */
function waitsOf(counts, melds = 0) {
  const waits = [];
  if (shanten(counts, melds) !== 0) return waits;
  for (let kind = 0; kind < KINDS; kind += 1) {
    if (counts[kind] >= 4) continue;
    counts[kind] += 1;
    if (shanten(counts, melds) === -1) waits.push(kind);
    counts[kind] -= 1;
  }
  return waits;
}

/**
 * For a hand one short of a full hand: its shanten and the kinds that would lower it. `seen[kind]` is
 * how many copies the player can see (their own included); `left` is how many useful tiles remain.
 */
function improvements(counts, melds = 0, seen = null) {
  const now = shanten(counts, melds);
  const kinds = [];
  let left = 0;
  for (let kind = 0; kind < KINDS; kind += 1) {
    if (counts[kind] >= 4) continue;
    counts[kind] += 1;
    const better = shanten(counts, melds) < now;
    counts[kind] -= 1;
    if (!better) continue;
    kinds.push(kind);
    left += seen ? Math.max(0, 4 - seen[kind]) : 4 - counts[kind];
  }
  return { shanten: now, kinds, left };
}

module.exports = { improvements, orphansShanten, sevenPairsShanten, shanten, standardShanten, waitsOf };
