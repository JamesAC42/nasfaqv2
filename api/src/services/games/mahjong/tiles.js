// Mahjong tiles (docs/games/MAHJONG_DESIGN.md §1, "The wall").
//
// A tile is an id from 0 to 135. Its kind is `id >> 2`: 0-8 man (characters) 1-9, 9-17 pin
// (circles), 18-26 sou (bamboo), 27-30 East South West North, 31 white, 32 green, 33 red. The first
// copy of each five (ids 16, 52, 88) is the red one.
//
// Written notation, for tests and logs: "123m406p789s1122z" (0 is a red five, z is honors 1-7).

const KINDS = 34;
const TILES = 136;
const RED_IDS = Object.freeze([16, 52, 88]);

const EAST = 27;
const SOUTH = 28;
const WEST = 29;
const NORTH = 30;
const WHITE = 31;
const GREEN = 32;
const RED = 33;

const kindOf = (id) => id >> 2;
const isRedFive = (id) => id === 16 || id === 52 || id === 88;
const isHonor = (kind) => kind >= 27;
const isSuited = (kind) => kind < 27;
const suitOf = (kind) => (kind < 27 ? Math.floor(kind / 9) : 3);
/** 1 to 9 for a suited tile, 0 for an honor. */
const numberOf = (kind) => (kind < 27 ? (kind % 9) + 1 : 0);
const isTerminal = (kind) => kind < 27 && (kind % 9 === 0 || kind % 9 === 8);
/** Terminals and honors: the tiles simples aren't. */
const isYaochuu = (kind) => kind >= 27 || kind % 9 === 0 || kind % 9 === 8;
const isDragon = (kind) => kind >= 31;
const isWind = (kind) => kind >= 27 && kind <= 30;

const YAOCHUU_KINDS = Object.freeze([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
// 2, 3, 4, 6, 8 of bamboo and the green dragon.
const ALL_GREEN = new Set([19, 20, 21, 23, 25, 32]);

/** The kind a dora indicator points at: the next number (9 wraps to 1), wind or dragon. */
function doraFromIndicator(kind) {
  if (kind < 27) return kind - (kind % 9) + ((kind % 9) + 1) % 9;
  if (kind <= 30) return 27 + ((kind - 27 + 1) % 4);
  return 31 + ((kind - 31 + 1) % 3);
}

const SUIT_LETTERS = ["m", "p", "s", "z"];

/** "5m", "1z". */
const kindName = (kind) => `${kind < 27 ? (kind % 9) + 1 : kind - 26}${SUIT_LETTERS[suitOf(kind)]}`;
/** A tile id as written: a red five is "0m". */
const tileName = (id) => (isRedFive(id) ? `0${SUIT_LETTERS[suitOf(kindOf(id))]}` : kindName(kindOf(id)));

/** Kinds from notation: "123m55z" -> [0, 1, 2, 31, 31]. A 0 reads as a five. */
function parseKinds(text) {
  const kinds = [];
  let digits = [];
  for (const ch of String(text).replace(/\s+/g, "")) {
    if (ch >= "0" && ch <= "9") digits.push(Number(ch));
    else {
      const suit = SUIT_LETTERS.indexOf(ch);
      if (suit < 0) throw new Error(`bad tile notation: ${text}`);
      for (const digit of digits) {
        const number = digit === 0 ? 5 : digit;
        if (suit === 3 && (number < 1 || number > 7)) throw new Error(`bad honor in: ${text}`);
        kinds.push(suit * 9 + number - 1);
      }
      digits = [];
    }
  }
  if (digits.length) throw new Error(`tile notation without a suit: ${text}`);
  return kinds;
}

/**
 * Tile ids from notation, never using one id twice across calls that share `used` (a Set). A 0
 * takes the red five; a 5 takes a plain one.
 */
function parseTiles(text, used = new Set()) {
  const ids = [];
  let digits = [];
  const take = (kind, red) => {
    const base = kind * 4;
    const order = red ? [0] : isSuited(kind) && kind % 9 === 4 ? [1, 2, 3] : [0, 1, 2, 3];
    for (const copy of order) {
      if (!used.has(base + copy)) {
        used.add(base + copy);
        return base + copy;
      }
    }
    throw new Error(`no copy left of ${kindName(kind)} in: ${text}`);
  };
  for (const ch of String(text).replace(/\s+/g, "")) {
    if (ch >= "0" && ch <= "9") digits.push(Number(ch));
    else {
      const suit = SUIT_LETTERS.indexOf(ch);
      if (suit < 0) throw new Error(`bad tile notation: ${text}`);
      for (const digit of digits) ids.push(take(suit * 9 + (digit === 0 ? 5 : digit) - 1, digit === 0));
      digits = [];
    }
  }
  if (digits.length) throw new Error(`tile notation without a suit: ${text}`);
  return ids;
}

/** How many of each kind: a 34-long array. */
function countKinds(kinds) {
  const counts = new Array(KINDS).fill(0);
  for (const kind of kinds) counts[kind] += 1;
  return counts;
}

const countTiles = (ids) => countKinds(ids.map(kindOf));

/** Ids in table order: by kind, the red five first among fives. */
const sortTiles = (ids) => [...ids].sort((a, b) => a - b);

/** Kinds written back as notation ("123m55z"), for messages and tests. */
function formatKinds(kinds) {
  const sorted = [...kinds].sort((a, b) => a - b);
  let out = "";
  for (let suit = 0; suit < 4; suit += 1) {
    const inSuit = sorted.filter((kind) => suitOf(kind) === suit);
    if (inSuit.length) out += inSuit.map((kind) => (suit === 3 ? kind - 26 : (kind % 9) + 1)).join("") + SUIT_LETTERS[suit];
  }
  return out;
}

module.exports = {
  ALL_GREEN,
  EAST,
  GREEN,
  KINDS,
  NORTH,
  RED,
  RED_IDS,
  SOUTH,
  TILES,
  WEST,
  WHITE,
  YAOCHUU_KINDS,
  countKinds,
  countTiles,
  doraFromIndicator,
  formatKinds,
  isDragon,
  isHonor,
  isRedFive,
  isSuited,
  isTerminal,
  isWind,
  isYaochuu,
  kindName,
  kindOf,
  numberOf,
  parseKinds,
  parseTiles,
  sortTiles,
  suitOf,
  tileName,
};
