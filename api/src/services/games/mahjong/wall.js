// The sealed wall (docs/games/MAHJONG_DESIGN.md §1, "The wall").
//
// One 32-byte seed per game. Its SHA-256 is published before the first tile is dealt and the seed
// after the last hand, so anyone can check that the walls weren't changed along the way: the wall
// of hand n is a Fisher-Yates shuffle of ids 0..135 whose random numbers come from
// SHA-256("<seed hex>|<n>|<counter>"), read four bytes at a time (big-endian), with values that
// would bias the pick thrown away. The replay page runs the same steps in the browser.

const crypto = require("node:crypto");
const { TILES } = require("./tiles");

// Where things sit in a shuffled wall. Tiles are dealt and drawn from the front; the last 14 are
// the dead wall.
const DEAD_WALL = 14;
const LIVE_END = TILES - DEAD_WALL; // 122: draws stop here (one earlier for every kan)
const RINSHAN_START = LIVE_END; // four replacement tiles
const DORA_START = LIVE_END + 4; // five dora indicators
const URA_START = LIVE_END + 9; // the five ura indicators under them

const newSeed = () => crypto.randomBytes(32).toString("hex");
const isSeed = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
/** What's published before the game: the SHA-256 of the seed's bytes. */
const seedHash = (seed) => crypto.createHash("sha256").update(Buffer.from(seed, "hex")).digest("hex");

/** Uniform integers from the seed for one hand: next(n) is in 0..n-1. */
function seededPicker(seed, handIndex) {
  let counter = 0;
  let block = Buffer.alloc(0);
  let offset = 0;
  const nextWord = () => {
    if (offset >= block.length) {
      block = crypto.createHash("sha256").update(`${seed}|${handIndex}|${counter}`).digest();
      counter += 1;
      offset = 0;
    }
    const word = block.readUInt32BE(offset);
    offset += 4;
    return word;
  };
  return (n) => {
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    for (;;) {
      const word = nextWord();
      if (word < limit) return word % n;
    }
  };
}

/** The wall of hand `handIndex` (0 for the first hand dealt, counting every hand) for this seed. */
function buildWall(seed, handIndex) {
  if (!isSeed(seed)) throw new Error("mahjong wall: the seed must be 64 hex characters");
  const pick = seededPicker(seed, handIndex);
  const wall = Array.from({ length: TILES }, (_, id) => id);
  for (let i = TILES - 1; i > 0; i -= 1) {
    const j = pick(i + 1);
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

module.exports = { DEAD_WALL, DORA_START, LIVE_END, RINSHAN_START, URA_START, buildWall, isSeed, newSeed, seedHash, seededPicker };
