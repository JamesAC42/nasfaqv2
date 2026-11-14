// Mahjong tile helpers, mirroring api/src/services/games/mahjong/tiles.js.
//
// A tile is an id from 0 to 135. Its kind is `id >> 2`: 0-8 characters (man) 1-9, 9-17 circles
// (pin), 18-26 bamboo (sou), 27-30 East South West North, 31 white dragon, 32 green, 33 red. The
// first copy of each five (ids 16, 52, 88) is the red one.
//
// Written notation (for guides and tests): "123m406p789s1122z". Digits then a suit letter: m
// characters, p circles, s bamboo, z honors (1 East, 2 South, 3 West, 4 North, 5 white, 6 green,
// 7 red). A 0 is a red five.

export type TileId = number;
export type TileKind = number;
/** 0 characters, 1 circles, 2 bamboo, 3 honors. */
export type Suit = 0 | 1 | 2 | 3;

export const KINDS = 34;
export const TILES = 136;
export const RED_FIVE_IDS: readonly TileId[] = [16, 52, 88];

export const EAST = 27;
export const SOUTH = 28;
export const WEST = 29;
export const NORTH = 30;
export const WHITE = 31;
export const GREEN = 32;
export const RED = 33;

export const YAOCHUU_KINDS: readonly TileKind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export const kindOf = (id: TileId): TileKind => id >> 2;
export const isRedFive = (id: TileId) => id === 16 || id === 52 || id === 88;
export const isHonor = (kind: TileKind) => kind >= 27;
export const isSuited = (kind: TileKind) => kind < 27;
export const suitOf = (kind: TileKind): Suit => (kind < 27 ? ((Math.floor(kind / 9) as 0 | 1 | 2)) : 3);
/** 1 to 9 for a suited tile, 0 for an honor. */
export const numberOf = (kind: TileKind) => (kind < 27 ? (kind % 9) + 1 : 0);
export const isTerminal = (kind: TileKind) => kind < 27 && (kind % 9 === 0 || kind % 9 === 8);
/** Terminals and honors: what simples are not. */
export const isYaochuu = (kind: TileKind) => kind >= 27 || kind % 9 === 0 || kind % 9 === 8;
export const isDragon = (kind: TileKind) => kind >= 31;
export const isWind = (kind: TileKind) => kind >= 27 && kind <= 30;
/** Whether a tile is a five (red or not) of a suit. */
export const isFive = (kind: TileKind) => kind < 27 && kind % 9 === 4;

/** The tile id of the first copy of a kind. */
export const firstTileOf = (kind: TileKind): TileId => kind * 4;
/** A red five of the suit (0 characters, 1 circles, 2 bamboo). */
export const redFiveOf = (suit: 0 | 1 | 2): TileId => RED_FIVE_IDS[suit];

/** The kind a dora indicator points at: the next number (9 wraps to 1), wind or dragon. */
export function doraFromIndicator(kind: TileKind): TileKind {
  if (kind < 27) return kind - (kind % 9) + (((kind % 9) + 1) % 9);
  if (kind <= 30) return 27 + ((kind - 27 + 1) % 4);
  return 31 + ((kind - 31 + 1) % 3);
}

// ── Names ───────────────────────────────────────────────────────────────────
const SUIT_LETTERS = ["m", "p", "s", "z"] as const;
const SUIT_WORDS = ["characters", "circles", "bamboo"] as const;
const HONOR_NAMES = ["East wind", "South wind", "West wind", "North wind", "White dragon", "Green dragon", "Red dragon"] as const;
const HONOR_SHORT = ["E", "S", "W", "N", "Wh", "G", "R"] as const;

/** "5m", "1z" (a red five is written the same: see tileNotation). */
export const kindNotation = (kind: TileKind) => `${kind < 27 ? (kind % 9) + 1 : kind - 26}${SUIT_LETTERS[suitOf(kind)]}`;
/** A tile id as written: a red five is "0m". */
export const tileNotation = (id: TileId) => (isRedFive(id) ? `0${SUIT_LETTERS[suitOf(kindOf(id))]}` : kindNotation(kindOf(id)));

/** "5 of circles", "East wind", "Red dragon". */
export function kindName(kind: TileKind): string {
  if (kind >= 27) return HONOR_NAMES[kind - 27];
  return `${(kind % 9) + 1} of ${SUIT_WORDS[Math.floor(kind / 9)]}`;
}

/** Like kindName, with "Red " in front of a red five: "Red 5 of circles". */
export const tileName = (id: TileId) => (isRedFive(id) ? `Red ${kindName(kindOf(id))}` : kindName(kindOf(id)));

/** The suit alone: "circles", "bamboo", "characters"; honors are "honors". */
export const suitName = (suit: Suit) => (suit === 3 ? "honors" : SUIT_WORDS[suit]);

/**
 * The small corner label beginners get: 1 to 9 for suited tiles (the suit is in the picture), E S W N
 * for winds, Wh G R for dragons.
 */
export const shortLabel = (kind: TileKind): string => (kind < 27 ? String((kind % 9) + 1) : HONOR_SHORT[kind - 27]);

/** Plural for a kind, for sentences about waits: "5 of circles" stays as it is. Honors read the same. */
export const kindNames = (kinds: readonly TileKind[]) => kinds.map(kindName).join(", ");

// ── Sorting ─────────────────────────────────────────────────────────────────
/** Ids in table order: by kind, the red five first among fives (ids already order that way). */
export const sortTiles = (ids: readonly TileId[]): TileId[] => [...ids].sort((a, b) => a - b);
export const sortKinds = (kinds: readonly TileKind[]): TileKind[] => [...kinds].sort((a, b) => a - b);

/** How many of each kind: a 34-long array. */
export function countKinds(kinds: readonly TileKind[]): number[] {
  const counts = new Array<number>(KINDS).fill(0);
  for (const kind of kinds) counts[kind] += 1;
  return counts;
}
export const countTiles = (ids: readonly TileId[]) => countKinds(ids.map(kindOf));

// ── Notation ────────────────────────────────────────────────────────────────
/** Kinds from notation: "123m55z" gives [0, 1, 2, 31, 31]. A 0 reads as a five. Throws on bad notation. */
export function kindsFrom(text: string): TileKind[] {
  const kinds: TileKind[] = [];
  let digits: number[] = [];
  for (const ch of String(text).replace(/\s+/g, "")) {
    if (ch >= "0" && ch <= "9") {
      digits.push(Number(ch));
      continue;
    }
    const suit = SUIT_LETTERS.indexOf(ch as (typeof SUIT_LETTERS)[number]);
    if (suit < 0) throw new Error(`bad tile notation: ${text}`);
    for (const digit of digits) {
      const number = digit === 0 ? 5 : digit;
      if (suit === 3 ? number < 1 || number > 7 : number < 1 || number > 9) throw new Error(`bad tile in notation: ${text}`);
      kinds.push(suit * 9 + number - 1);
    }
    digits = [];
  }
  if (digits.length) throw new Error(`tile notation without a suit: ${text}`);
  return kinds;
}

/**
 * Tile ids from notation, for guides and examples: tilesFrom("123m406p11z"). Never uses one id twice
 * across calls that share `used`. A 0 takes the red five; a 5 takes a plain one. Throws on bad
 * notation or when all four copies of something are used up.
 */
export function tilesFrom(text: string, used: Set<TileId> = new Set()): TileId[] {
  const ids: TileId[] = [];
  let digits: number[] = [];
  const take = (kind: TileKind, red: boolean): TileId => {
    const base = kind * 4;
    const order = red ? [0] : isFive(kind) ? [1, 2, 3] : [0, 1, 2, 3];
    for (const copy of order) {
      if (!used.has(base + copy)) {
        used.add(base + copy);
        return base + copy;
      }
    }
    throw new Error(`no copy left of ${kindNotation(kind)} in: ${text}`);
  };
  for (const ch of String(text).replace(/\s+/g, "")) {
    if (ch >= "0" && ch <= "9") {
      digits.push(Number(ch));
      continue;
    }
    const suit = SUIT_LETTERS.indexOf(ch as (typeof SUIT_LETTERS)[number]);
    if (suit < 0) throw new Error(`bad tile notation: ${text}`);
    for (const digit of digits) {
      const number = digit === 0 ? 5 : digit;
      if (suit === 3 ? number < 1 || number > 7 : number < 1 || number > 9) throw new Error(`bad tile in notation: ${text}`);
      ids.push(take(suit * 9 + number - 1, digit === 0));
    }
    digits = [];
  }
  if (digits.length) throw new Error(`tile notation without a suit: ${text}`);
  return ids;
}

/** Kinds written back as notation ("123m55z"). */
export function formatKinds(kinds: readonly TileKind[]): string {
  const sorted = sortKinds(kinds);
  let out = "";
  for (let suit = 0; suit < 4; suit += 1) {
    const inSuit = sorted.filter((kind) => suitOf(kind) === suit);
    if (inSuit.length) out += inSuit.map((kind) => (suit === 3 ? kind - 26 : (kind % 9) + 1)).join("") + SUIT_LETTERS[suit];
  }
  return out;
}

/** Tile ids written back as notation, in the order given, run by run: "12m0p" style with red fives as 0. */
export function formatTiles(ids: readonly TileId[]): string {
  let out = "";
  let run = "";
  let runSuit: Suit | null = null;
  for (const id of ids) {
    const kind = kindOf(id);
    const suit = suitOf(kind);
    if (runSuit !== null && suit !== runSuit) {
      out += run + SUIT_LETTERS[runSuit];
      run = "";
    }
    runSuit = suit;
    run += isRedFive(id) ? "0" : String(suit === 3 ? kind - 26 : (kind % 9) + 1);
  }
  if (runSuit !== null) out += run + SUIT_LETTERS[runSuit];
  return out;
}

// ── Winds and seats ─────────────────────────────────────────────────────────
/** Where another seat sits from yours: 0 you, 1 right (the player after you), 2 across, 3 left. */
export type Relative = 0 | 1 | 2 | 3;
export const relativeSeat = (seat: number, me: number): Relative => ((((seat - me) % 4) + 4) % 4) as Relative;
/** "bottom", "right", "top", "left": where a table draws a seat, you at the bottom. */
export const RELATIVE_SIDES = ["bottom", "right", "top", "left"] as const;
export const sideOf = (seat: number, me: number) => RELATIVE_SIDES[relativeSeat(seat, me)];
/** The seat that sits at `side` when `me` is at the bottom. */
export const seatAt = (side: Relative, me: number) => (me + side) % 4;

/** The wind a seat holds when `dealer` deals: kind 27 for the dealer, then 28, 29, 30 in turn order. */
export const seatWindOf = (seat: number, dealer: number): TileKind => 27 + ((((seat - dealer) % 4) + 4) % 4);
/** "East", "South", "West", "North" for a wind kind (27-30). */
export const windName = (kind: TileKind) => ["East", "South", "West", "North"][kind - 27] ?? "";
/** Single-letter wind: E S W N. */
export const windLetter = (kind: TileKind) => ["E", "S", "W", "N"][kind - 27] ?? "";
/** Who is the chi source for you: the player before you in turn order ("on your left"). */
export const leftOf = (seat: number) => (seat + 3) % 4;
/** The player after you in turn order ("on your right"). */
export const rightOf = (seat: number) => (seat + 1) % 4;
