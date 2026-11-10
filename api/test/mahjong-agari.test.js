// Reference tests for the mahjong scoring, shanten, tile and wall modules. Every expected value here
// was worked out by hand from the rule sheet (docs/games/MAHJONG_DESIGN.md §1), not read off the code.
//
// Hands are written in notation: "123m 456p 789s 11z" (m characters, p circles, s bamboo, z honors:
// 1-4 East South West North, 5 white, 6 green, 7 red). Unless a test says otherwise the winner sits
// South in the East round, and wins on a discard.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { basePoints, decompose, evaluate, payments } = require("../src/services/games/mahjong/agari");
const { improvements, orphansShanten, sevenPairsShanten, shanten, standardShanten, waitsOf } = require("../src/services/games/mahjong/shanten");
const tiles = require("../src/services/games/mahjong/tiles");
const wallModule = require("../src/services/games/mahjong/wall");

const { countKinds, doraFromIndicator, parseKinds, parseTiles } = tiles;
const { buildWall, newSeed, seedHash } = wallModule;

const EAST = 27;
const SOUTH = 28;
const WEST = 29;

// ── Helpers ────────────────────────────────────────────────────────────────

const kind = (text) => {
  const kinds = parseKinds(text);
  assert.equal(kinds.length, 1, `one tile expected: ${text}`);
  return kinds[0];
};
const sorted = (text) => parseKinds(text).sort((a, b) => a - b);

/** A called set from its tiles: chi("234m"), pon("555z"), ankan("1111m"). */
const called = (type, size, run) => (text) => {
  const kinds = sorted(text);
  assert.equal(kinds.length, size, `${type} of ${size}: ${text}`);
  kinds.forEach((value, index) => assert.equal(value, kinds[0] + (run ? index : 0), `bad ${type}: ${text}`));
  return { type, kind: kinds[0] };
};
const chi = called("chi", 3, true);
const pon = called("pon", 3, false);
const minkan = called("minkan", 4, false);
const kakan = called("kakan", 4, false);
const ankan = called("ankan", 4, false);

/** evaluate() for a hand in notation. `hand` is the concealed tiles with the winning tile among them. */
function win(hand, winTile, options = {}) {
  const { melds = [], seat = SOUTH, round = EAST, ...flags } = options;
  const concealed = parseKinds(hand);
  const winKind = kind(winTile);
  assert.ok(concealed.includes(winKind), `the winning tile ${winTile} is not in ${hand}`);
  assert.equal(concealed.length + melds.length * 3, 14, `wrong number of tiles: ${hand}`);
  return evaluate({ concealed, melds, winKind, tsumo: false, seatWind: seat, roundWind: round, ...flags });
}

const yakuMap = (result) => Object.fromEntries(result.yaku.map((entry) => [entry.key, entry.han]));
/** Fu before rounding, from the listed parts. */
const rawFu = (result) => result.fuParts.filter((part) => part.key !== "round-up").reduce((sum, part) => sum + part.fu, 0);

/** An ordinary (non-yakuman) win: exactly these yaku, this many han, this fu. */
function expectWin(result, { yaku, han, fu, raw, limit, base }) {
  assert.ok(result, "the hand should be a winning shape");
  assert.equal(result.complete, true);
  assert.equal(result.noYaku, false, "the hand should have a yaku");
  assert.equal(result.yakuman, 0, "not a yakuman");
  if (yaku !== undefined) assert.deepEqual(yakuMap(result), yaku);
  if (han !== undefined) assert.equal(result.han, han, "han");
  if (raw !== undefined) assert.equal(rawFu(result), raw, "fu before rounding");
  if (fu !== undefined) assert.equal(result.fu, fu, "fu");
  if (limit !== undefined) assert.equal(result.limit, limit, "limit");
  if (base !== undefined) assert.equal(result.base, base, "base points");
}

/** A complete shape with no yaku: it can't be declared. */
function expectNoYaku(result) {
  assert.ok(result, "the hand should be a winning shape");
  assert.equal(result.complete, true);
  assert.equal(result.noYaku, true, `no yaku expected, got ${JSON.stringify(result.yaku)}`);
  assert.equal(result.han, 0);
  assert.equal(result.base, 0);
}

/** A yakuman hand: exactly these yakuman, one limit each. */
function expectYakuman(result, keys) {
  assert.ok(result, "the hand should be a winning shape");
  assert.equal(result.noYaku, false);
  assert.deepEqual(result.yaku.map((entry) => entry.key).sort(), [...keys].sort());
  assert.equal(result.yakuman, keys.length, "yakuman count");
  assert.equal(result.base, 8000 * keys.length, "base points");
  assert.equal(result.limit, "yakuman");
}

// A closed hand with no yaku of its own: runs 123m 567p 345s 789s and a pair of 9p. It has a terminal
// (no all simples), no honor, no two runs alike. What it wins on decides the wait:
//   6p middle, 3m and 7s edge, 9p single, 5p (and 7p, 1m, 9s, 3s, 5s) two-sided.
const PLAIN = "123m 567p 345s 789s 99p";
// The same hand after calling 123m.
const PLAIN_OPEN = "567p 345s 789s 99p";
// Three runs and a pair, all simples, to go with one more set: 5p is a two-sided wait, 6p a middle wait.
const SIMPLE_TAIL = "567p 345s 678s 88p";

// ── 0. Tiles ───────────────────────────────────────────────────────────────

test("tiles: kinds are numbered as the rule sheet says", () => {
  assert.deepEqual(parseKinds("19m19p19s1234567z"), [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
  assert.deepEqual(parseKinds("123456789m"), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(parseKinds("0m0p0s"), [4, 13, 22], "a 0 reads as a five");
  assert.deepEqual(parseKinds("123m 456p"), [0, 1, 2, 12, 13, 14], "spaces are ignored");
  assert.equal(tiles.EAST, 27);
  assert.equal(tiles.SOUTH, 28);
  assert.equal(tiles.WEST, 29);
  assert.equal(tiles.NORTH, 30);
  assert.equal(tiles.WHITE, 31);
  assert.equal(tiles.GREEN, 32);
  assert.equal(tiles.RED, 33);
  assert.throws(() => parseKinds("8z"));
  assert.throws(() => parseKinds("123"));
});

test("tiles: ids 16, 52 and 88 are the red fives, and an id is used once", () => {
  assert.deepEqual(parseTiles("0m5m0p5p0s5s"), [16, 17, 52, 53, 88, 89]);
  const everyKind = "123456789m123456789p123456789s1234567z";
  const ids = parseTiles(everyKind);
  assert.deepEqual(ids.map((id) => id >> 2), parseKinds(everyKind), "an id's kind is id >> 2");
  for (const red of [16, 52, 88]) assert.ok(!ids.includes(red), "a 5 is never the red five");
  assert.deepEqual(parseTiles("1m9s7z").map((id) => id >> 2), [0, 26, 33]);
  const used = new Set();
  assert.deepEqual(parseTiles("1111m", used), [0, 1, 2, 3]);
  assert.throws(() => parseTiles("1m", used), "a fifth copy doesn't exist");
  assert.deepEqual(parseTiles("555m"), [17, 18, 19], "plain fives never take the red one");
  assert.throws(() => parseTiles("5555m"), "there are only three plain fives");
});

test("tiles: countKinds counts by kind", () => {
  const counts = countKinds(parseKinds("1123m 99p 777z"));
  assert.equal(counts.length, 34);
  assert.equal(counts[0], 2);
  assert.equal(counts[1], 1);
  assert.equal(counts[2], 1);
  assert.equal(counts[17], 2);
  assert.equal(counts[33], 3);
  assert.equal(counts.reduce((sum, value) => sum + value, 0), 9);
});

// ── 1. Yaku ────────────────────────────────────────────────────────────────

test("no yaku: a complete closed hand won on a discard with nothing to its name can't be declared", () => {
  expectNoYaku(win(PLAIN, "6p"));
});

test("not a win: tiles that don't make four sets and a pair read as null", () => {
  assert.equal(win("123m 567p 345s 789s 9p 1z", "1z"), null);
  assert.equal(win("123m 567p 345s 78s 9p 11z", "1z"), null);
  assert.equal(evaluate({ concealed: parseKinds("123m 567p 345s 789s 9p"), melds: [], winKind: kind("9p"), tsumo: false, seatWind: SOUTH, roundWind: EAST }), null, "13 tiles");
});

test("riichi: 1 han on 123m 567p 345s 789s 99p, middle wait on 6p", () => {
  // Fu: 20 + 10 closed ron + 2 middle wait = 32 -> 40.
  expectWin(win(PLAIN, "6p", { riichi: 1 }), { yaku: { riichi: 1 }, han: 1, raw: 32, fu: 40 });
});

test("ippatsu: 1 han on top of riichi", () => {
  expectWin(win(PLAIN, "6p", { riichi: 1, ippatsu: true }), { yaku: { riichi: 1, ippatsu: 1 }, han: 2, fu: 40 });
});

test("ippatsu: worth nothing without riichi", () => {
  expectNoYaku(win(PLAIN, "6p", { ippatsu: true }));
});

test("double riichi: 2 han, in place of riichi and not on top of it", () => {
  expectWin(win(PLAIN, "6p", { riichi: 2 }), { yaku: { "double-riichi": 2 }, han: 2, fu: 40 });
  expectWin(win(PLAIN, "6p", { riichi: 2, ippatsu: true }), { yaku: { "double-riichi": 2, ippatsu: 1 }, han: 3 });
});

test("riichi: never awarded to an open hand (chi 123m, 567p 345s 789s 99p)", () => {
  // Riichi is closed-only on the rule sheet. With a chi on the table the riichi flag must not score.
  expectNoYaku(win(PLAIN_OPEN, "6p", { melds: [chi("123m")], riichi: 1 }));
  expectNoYaku(win(PLAIN_OPEN, "6p", { melds: [chi("123m")], riichi: 2, ippatsu: true }));
});

test("fully concealed hand: 1 han for a closed self-draw", () => {
  // Fu: 20 + 2 middle wait + 2 self-draw = 24 -> 30.
  expectWin(win(PLAIN, "6p", { tsumo: true }), { yaku: { "menzen-tsumo": 1 }, han: 1, raw: 24, fu: 30 });
});

test("fully concealed hand: not awarded to an open hand's self-draw", () => {
  expectNoYaku(win(PLAIN_OPEN, "6p", { melds: [chi("123m")], tsumo: true }));
});

test("fully concealed hand: a closed kan leaves the hand closed", () => {
  // Closed kan 2222m + 567p 345s 789s 99p. Fu: 20 + 16 closed simple kan + 2 middle + 2 self-draw = 40.
  expectWin(win(PLAIN_OPEN, "6p", { melds: [ankan("2222m")], tsumo: true }), { yaku: { "menzen-tsumo": 1 }, han: 1, raw: 40, fu: 40 });
});

test("pinfu: 1 han, 30 fu on a discard (123m 567p 345s 789s 99p on 5p)", () => {
  const result = win(PLAIN, "5p");
  expectWin(result, { yaku: { pinfu: 1 }, han: 1, raw: 30, fu: 30 });
  assert.equal(result.wait, "ryanmen");
});

test("pinfu: with a self-draw it is 2 han and exactly 20 fu", () => {
  expectWin(win(PLAIN, "5p", { tsumo: true }), { yaku: { pinfu: 1, "menzen-tsumo": 1 }, han: 2, raw: 20, fu: 20 });
});

test("pinfu: every two-sided wait of the plain hand counts (1m, 7p, 3s, 5s, 9s)", () => {
  for (const tile of ["1m", "7p", "3s", "5s", "9s"]) expectWin(win(PLAIN, tile), { yaku: { pinfu: 1 }, han: 1, fu: 30 });
});

test("pinfu: a pair of a wind that is neither seat nor round is fine (33z, 44z)", () => {
  expectWin(win("123m 567p 345s 789s 33z", "5p"), { yaku: { pinfu: 1 }, han: 1, fu: 30 });
  expectWin(win("123m 567p 345s 789s 44z", "5p"), { yaku: { pinfu: 1 }, han: 1, fu: 30 });
  // East is a guest wind for a West seat in the South round.
  expectWin(win("123m 567p 345s 789s 11z", "5p", { seat: WEST, round: SOUTH }), { yaku: { pinfu: 1 }, han: 1, fu: 30 });
});

test("pinfu: not with a dragon pair (123m 567p 345s 789s 55z)", () => {
  expectNoYaku(win("123m 567p 345s 789s 55z", "5p"));
  // Fu: 20 + 10 + 2 dragon pair = 32 -> 40.
  expectWin(win("123m 567p 345s 789s 55z", "5p", { riichi: 1 }), { yaku: { riichi: 1 }, han: 1, raw: 32, fu: 40 });
});

test("pinfu: not with a seat wind pair (22z for South)", () => {
  expectNoYaku(win("123m 567p 345s 789s 22z", "5p"));
  expectWin(win("123m 567p 345s 789s 22z", "5p", { riichi: 1 }), { yaku: { riichi: 1 }, han: 1, raw: 32, fu: 40 });
});

test("pinfu: not with a round wind pair (11z in East)", () => {
  expectNoYaku(win("123m 567p 345s 789s 11z", "5p"));
  expectWin(win("123m 567p 345s 789s 11z", "5p", { riichi: 1 }), { yaku: { riichi: 1 }, han: 1, raw: 32, fu: 40 });
});

test("pinfu: not on a middle wait (5-7p taking 6p)", () => {
  const result = win(PLAIN, "6p", { riichi: 1 });
  expectWin(result, { yaku: { riichi: 1 }, han: 1, fu: 40 });
  assert.equal(result.wait, "kanchan");
  expectNoYaku(win(PLAIN, "2m"));
  expectNoYaku(win(PLAIN, "4s"));
  expectNoYaku(win(PLAIN, "8s"));
});

test("pinfu: not on an edge wait (12m taking 3m, 89s taking 7s)", () => {
  expectNoYaku(win(PLAIN, "3m"));
  expectNoYaku(win(PLAIN, "7s"));
  const result = win(PLAIN, "3m", { riichi: 1 });
  expectWin(result, { yaku: { riichi: 1 }, han: 1, raw: 32, fu: 40 });
  assert.equal(result.wait, "penchan");
  assert.equal(win(PLAIN, "7s", { riichi: 1 }).wait, "penchan");
});

test("pinfu: not on a single wait (the pair, 9p)", () => {
  expectNoYaku(win(PLAIN, "9p"));
  const result = win(PLAIN, "9p", { riichi: 1 });
  expectWin(result, { yaku: { riichi: 1 }, han: 1, raw: 32, fu: 40 });
  assert.equal(result.wait, "tanki");
});

test("pinfu: not on 3456p taking 3p, which is a single wait either way", () => {
  // 123m 789s 345s + 3456p: 3p makes 33p + 456p, 6p makes 345p + 66p. Both wait on the pair.
  expectNoYaku(win("123m 345s 789s 33456p", "3p"));
  expectWin(win("123m 345s 789s 33456p", "3p", { riichi: 1 }), { yaku: { riichi: 1 }, han: 1, raw: 32, fu: 40 });
});

test("pinfu: not with a triplet in the hand (222m 567p 345s 789s 99p)", () => {
  expectNoYaku(win("222m 567p 345s 789s 99p", "5p"));
  // Fu: 20 + 10 + 4 closed simple triplet = 34 -> 40.
  expectWin(win("222m 567p 345s 789s 99p", "5p", { riichi: 1 }), { yaku: { riichi: 1 }, han: 1, raw: 34, fu: 40 });
});

test("pinfu: not awarded open (chi 234m, 567p 345s 678s 88p on 5p is all simples only)", () => {
  expectWin(win(SIMPLE_TAIL, "5p", { melds: [chi("234m")] }), { yaku: { tanyao: 1 }, han: 1, raw: 30, fu: 30 });
  expectNoYaku(win(PLAIN_OPEN, "5p", { melds: [chi("123m")] }));
});

test("pinfu: 23334p taking 2p is two-sided with the pair of 3p", () => {
  expectWin(win("123m 456s 789s 23334p", "2p"), { yaku: { pinfu: 1 }, han: 1, fu: 30 });
  // 33345p: 5p completes 345p next to the pair of 3p, also two-sided.
  expectWin(win("123m 456s 789s 33345p", "5p"), { yaku: { pinfu: 1 }, han: 1, fu: 30 });
  // 33344p: 4p only makes the pair next to 333p.
  expectNoYaku(win("123m 456s 789s 33344p", "4p"));
});

test("pure double sequence: 1 han closed (223344m 567p 789s 99p)", () => {
  // Won on the middle 8s so pinfu stays out. Fu: 20 + 10 + 2 = 32 -> 40.
  expectWin(win("223344m 567p 789s 99p", "8s"), { yaku: { iipeikou: 1 }, han: 1, raw: 32, fu: 40 });
});

test("pure double sequence: not awarded open", () => {
  expectNoYaku(win("223344m 789s 99p", "8s", { melds: [chi("567p")] }));
  // With something else to win on it still isn't counted.
  expectWin(win("223344m 678s 88p", "7s", { melds: [chi("567p")] }), { yaku: { tanyao: 1 }, han: 1 });
});

test("pure double sequence: the same run in two suits is not one", () => {
  expectNoYaku(win("234m 234567p 789s 99p", "8s"));
});

test("twice pure double sequence: 3 han closed (223344m 667788p 99s on 9s)", () => {
  // Also seven pairs, which scores less. Fu: 20 + 10 + 2 single wait = 32 -> 40.
  const result = win("223344m 667788p 99s", "9s");
  expectWin(result, { yaku: { ryanpeikou: 3 }, han: 3, raw: 32, fu: 40 });
  assert.equal(result.form, "standard");
});

test("twice pure double sequence: with pinfu on a two-sided wait it is 4 han 30 fu, not mangan", () => {
  expectWin(win("223344m 667788p 99s", "2m"), { yaku: { ryanpeikou: 3, pinfu: 1 }, han: 4, fu: 30, limit: null, base: 1920 });
});

test("twice pure double sequence: gone once a run is called (chi 234m, 234m 667788p 99s)", () => {
  expectNoYaku(win("234m 667788p 99s", "9s", { melds: [chi("234m")] }));
});

test("all simples: 1 han closed (234m 567p 345s 678s 88p)", () => {
  expectWin(win(`234m ${SIMPLE_TAIL}`, "6p"), { yaku: { tanyao: 1 }, han: 1, raw: 32, fu: 40 });
});

test("all simples: 1 han open too (pon 333m, 567p 345s 678s 88p)", () => {
  // Fu: 20 + 2 open simple triplet + 2 middle wait = 24 -> 30.
  expectWin(win(SIMPLE_TAIL, "6p", { melds: [pon("333m")] }), { yaku: { tanyao: 1 }, han: 1, raw: 24, fu: 30 });
  expectWin(win(SIMPLE_TAIL, "6p", { melds: [chi("234m")] }), { yaku: { tanyao: 1 }, han: 1, raw: 22, fu: 30 });
});

test("all simples: not with a terminal in a run (789s)", () => {
  expectNoYaku(win("234m 567p 345s 789s 88p", "6p"));
});

test("all simples: not with a terminal pair (99p) or an honor pair (44z)", () => {
  expectNoYaku(win("234m 567p 345s 678s 99p", "6p"));
  expectNoYaku(win("234m 567p 345s 678s 44z", "6p"));
});

test("all simples: not with a terminal in a called run (chi 123m) or a called triplet (pon 999m)", () => {
  expectNoYaku(win(SIMPLE_TAIL, "6p", { melds: [chi("123m")] }));
  expectNoYaku(win(SIMPLE_TAIL, "6p", { melds: [pon("999m")] }));
});

test("value tiles: white dragon, open (pon 555z, 234m 567p 345s 88p)", () => {
  // Fu: 20 + 4 open honor triplet + 2 middle wait = 26 -> 30.
  expectWin(win("234m 567p 345s 88p", "6p", { melds: [pon("555z")] }), { yaku: { "yakuhai-white": 1 }, han: 1, raw: 26, fu: 30 });
});

test("value tiles: green dragon, closed (666z 234m 567p 345s 88p)", () => {
  // Fu: 20 + 10 + 8 closed honor triplet + 2 middle wait = 40.
  expectWin(win("234m 567p 345s 88p 666z", "6p"), { yaku: { "yakuhai-green": 1 }, han: 1, raw: 40, fu: 40 });
});

test("value tiles: red dragon, as a kan (open kan 7777z)", () => {
  // Fu: 20 + 16 open honor kan + 2 middle wait = 38 -> 40.
  expectWin(win("234m 567p 345s 88p", "6p", { melds: [minkan("7777z")] }), { yaku: { "yakuhai-red": 1 }, han: 1, raw: 38, fu: 40 });
});

test("value tiles: seat wind (South holds 222z)", () => {
  expectWin(win("234m 567p 345s 88p", "6p", { melds: [pon("222z")] }), { yaku: { "yakuhai-seat": 1 }, han: 1, fu: 30 });
});

test("value tiles: round wind (111z in the East round)", () => {
  expectWin(win("234m 567p 345s 88p", "6p", { melds: [pon("111z")] }), { yaku: { "yakuhai-round": 1 }, han: 1, fu: 30 });
});

test("value tiles: a wind that is both seat and round is 2 han (East seat, East round, 111z)", () => {
  expectWin(win("234m 567p 345s 88p", "6p", { melds: [pon("111z")], seat: EAST, round: EAST }), {
    yaku: { "yakuhai-seat": 1, "yakuhai-round": 1 },
    han: 2,
    fu: 30,
  });
});

test("value tiles: seat and round follow the seat (West seat, South round)", () => {
  const at = { seat: WEST, round: SOUTH };
  expectWin(win("234m 567p 345s 88p", "6p", { ...at, melds: [pon("333z")] }), { yaku: { "yakuhai-seat": 1 }, han: 1 });
  expectWin(win("234m 567p 345s 88p", "6p", { ...at, melds: [pon("222z")] }), { yaku: { "yakuhai-round": 1 }, han: 1 });
  expectNoYaku(win("234m 567p 345s 88p", "6p", { ...at, melds: [pon("111z")] }));
  expectNoYaku(win("234m 567p 345s 88p", "6p", { ...at, melds: [pon("444z")] }));
});

test("value tiles: a guest wind triplet is no yaku (333z and 444z for South in East)", () => {
  expectNoYaku(win("234m 567p 345s 88p", "6p", { melds: [pon("333z")] }));
  expectNoYaku(win("234m 567p 345s 88p", "6p", { melds: [pon("444z")] }));
  expectNoYaku(win("234m 567p 345s 88p 333z", "6p"));
});

test("value tiles: two dragon triplets are 1 han each, and a dragon pair is none", () => {
  // pon 555z, pon 666z, 234m 567p 88p: no little three dragons without the third dragon as the pair.
  expectWin(win("234m 567p 88p", "6p", { melds: [pon("555z"), pon("666z")] }), { yaku: { "yakuhai-white": 1, "yakuhai-green": 1 }, han: 2 });
});

test("after a kan: 1 han, open hand (open kan 2222m, 567p 345s 789s 99p)", () => {
  // Fu: 20 + 8 open simple kan + 2 middle wait + 2 self-draw = 32 -> 40.
  expectWin(win(PLAIN_OPEN, "6p", { melds: [minkan("2222m")], tsumo: true, rinshan: true }), { yaku: { rinshan: 1 }, han: 1, raw: 32, fu: 40 });
});

test("after a kan: with a closed kan the self-draw yaku is added", () => {
  expectWin(win(PLAIN_OPEN, "6p", { melds: [ankan("2222m")], tsumo: true, rinshan: true }), {
    yaku: { rinshan: 1, "menzen-tsumo": 1 },
    han: 2,
    raw: 40,
    fu: 40,
  });
});

test("robbing a kan: 1 han", () => {
  expectWin(win(PLAIN, "6p", { chankan: true }), { yaku: { chankan: 1 }, han: 1, fu: 40 });
  expectWin(win(PLAIN_OPEN, "6p", { melds: [chi("123m")], chankan: true }), { yaku: { chankan: 1 }, han: 1, raw: 22, fu: 30 });
});

test("under the sea: 1 han on the last draw, open or closed", () => {
  // Open: 20 + 2 middle wait + 2 self-draw = 24 -> 30.
  expectWin(win(PLAIN_OPEN, "6p", { melds: [chi("123m")], tsumo: true, haitei: true }), { yaku: { haitei: 1 }, han: 1, raw: 24, fu: 30 });
  expectWin(win(PLAIN, "6p", { tsumo: true, haitei: true }), { yaku: { haitei: 1, "menzen-tsumo": 1 }, han: 2, fu: 30 });
});

test("under the river: 1 han on the last discard, open or closed", () => {
  expectWin(win(PLAIN, "6p", { houtei: true }), { yaku: { houtei: 1 }, han: 1, fu: 40 });
  expectWin(win(PLAIN_OPEN, "6p", { melds: [chi("123m")], houtei: true }), { yaku: { houtei: 1 }, han: 1, fu: 30 });
});

test("seven pairs: 2 han, 25 fu (1133m 2255p 4466s 77z)", () => {
  const result = win("1133m 2255p 4466s 77z", "7z");
  expectWin(result, { yaku: { chiitoitsu: 2 }, han: 2, fu: 25, base: 400 });
  assert.equal(result.form, "pairs");
});

test("seven pairs: a self-draw adds 1 han and no fu", () => {
  expectWin(win("1133m 2255p 4466s 77z", "3m", { tsumo: true }), { yaku: { chiitoitsu: 2, "menzen-tsumo": 1 }, han: 3, fu: 25, base: 800 });
});

test("seven pairs: four of one tile are not two pairs (1111m 2255p 4466s 77z)", () => {
  assert.equal(win("1111m 2255p 4466s 77z", "7z"), null);
});

test("seven pairs: with all simples (2244m 3355p 446688s)", () => {
  expectWin(win("2244m 3355p 446688s", "8s"), { yaku: { chiitoitsu: 2, tanyao: 1 }, han: 3, fu: 25 });
});

test("seven pairs: with all terminals and honors (1199m 1199p 11s 1122z)", () => {
  expectWin(win("1199m 1199p 11s 1122z", "1s"), { yaku: { chiitoitsu: 2, honroutou: 2 }, han: 4, fu: 25 });
});

test("seven pairs: with a half flush (1133557799m 1122z) and a full flush (11223355668899m)", () => {
  expectWin(win("1133557799m 1122z", "9m"), { yaku: { chiitoitsu: 2, honitsu: 3 }, han: 5, fu: 25, limit: "mangan" });
  expectWin(win("11223355668899m", "9m"), { yaku: { chiitoitsu: 2, chinitsu: 6 }, han: 8, fu: 25, limit: "baiman" });
});

test("mixed triple sequence: 2 han closed (234m 234p 234s 789s 99p)", () => {
  expectWin(win("234m 234p 234s 789s 99p", "3s"), { yaku: { sanshoku: 2 }, han: 2, raw: 32, fu: 40 });
});

test("mixed triple sequence: 1 han open (chi 234m)", () => {
  // Fu: 20 + 2 middle wait = 22 -> 30.
  expectWin(win("234p 234s 789s 99p", "3s", { melds: [chi("234m")] }), { yaku: { sanshoku: 1 }, han: 1, raw: 22, fu: 30 });
});

test("mixed triple sequence: runs one step apart are not it (234m 234p 345s)", () => {
  expectNoYaku(win("234m 234p 345s 789s 99p", "4s"));
});

test("pure straight: 2 han closed (123456789m 345s 99p)", () => {
  expectWin(win("123456789m 345s 99p", "4s"), { yaku: { ittsu: 2 }, han: 2, raw: 32, fu: 40 });
});

test("pure straight: 1 han open (chi 123m)", () => {
  expectWin(win("456789m 345s 99p", "4s", { melds: [chi("123m")] }), { yaku: { ittsu: 1 }, han: 1, raw: 22, fu: 30 });
});

test("pure straight: 123 456 789 across two suits is not it", () => {
  expectNoYaku(win("123456m 789p 345s 99s", "4s"));
});

test("half outside hand: 2 han closed (123m 789p 123s 333z 99s)", () => {
  // West is a guest wind here. Fu: 20 + 10 + 8 closed honor triplet + 2 middle wait = 40.
  expectWin(win("123m 789p 123s 99s 333z", "2m"), { yaku: { chanta: 2 }, han: 2, raw: 40, fu: 40 });
});

test("half outside hand: 1 han open (chi 789p)", () => {
  // Fu: 20 + 8 + 2 = 30.
  expectWin(win("123m 123s 99s 333z", "2m", { melds: [chi("789p")] }), { yaku: { chanta: 1 }, han: 1, raw: 30, fu: 30 });
});

test("fully outside hand: 3 han closed (123m 999m 789p 123s 99s)", () => {
  // Fu: 20 + 10 + 8 closed terminal triplet + 2 middle wait = 40.
  expectWin(win("123999m 789p 123s 99s", "2m"), { yaku: { junchan: 3 }, han: 3, raw: 40, fu: 40 });
});

test("fully outside hand: 2 han open (chi 789p)", () => {
  expectWin(win("123999m 123s 99s", "2m", { melds: [chi("789p")] }), { yaku: { junchan: 2 }, han: 2, raw: 30, fu: 30 });
});

test("outside hands: an honor pair makes it half outside, not fully (123m 999m 789p 123s 11z)", () => {
  // Fu: 20 + 10 + 8 + 2 middle wait + 2 round wind pair = 42 -> 50.
  expectWin(win("123999m 789p 123s 11z", "2m"), { yaku: { chanta: 2 }, han: 2, raw: 42, fu: 50 });
});

test("outside hands: one inside run breaks both (123m 999m 789p 456s 11s)", () => {
  expectNoYaku(win("123999m 789p 11456s", "5s"));
  expectNoYaku(win("123999m 789p 456s 11z", "5s"));
});

test("all terminals and honors: 2 han with all triplets, and neither outside hand", () => {
  // pon 111m, pon 999p, 999s 333z 11s on the pair. Fu: 20 + 4 + 4 open terminal triplets + 8 + 8 closed
  // terminal and honor triplets + 2 single wait = 46 -> 50.
  expectWin(win("11999s 333z", "1s", { melds: [pon("111m"), pon("999p")] }), { yaku: { honroutou: 2, toitoi: 2 }, han: 4, raw: 46, fu: 50, limit: "mangan" });
});

test("all triplets: 2 han (pon 111m, pon 888p, 444s 666s 55m)", () => {
  // Two closed triplets only, so no three concealed triplets. Fu: 20 + 4 + 2 + 4 + 4 + 2 single = 36 -> 40.
  expectWin(win("55m 444666s", "5m", { melds: [pon("111m"), pon("888p")] }), { yaku: { toitoi: 2 }, han: 2, raw: 36, fu: 40 });
});

test("all triplets: with all simples open (pon 222m, pon 888p, 444s 666s 55m)", () => {
  expectWin(win("55m 444666s", "5m", { melds: [pon("222m"), pon("888p")] }), { yaku: { toitoi: 2, tanyao: 1 }, han: 3, raw: 34, fu: 40 });
});

test("three concealed triplets: 2 han when the discard finishes the run (222m 345m 444p 666s 99p on 5m)", () => {
  // Fu: 20 + 10 + 4 + 4 + 4 = 42 -> 50.
  expectWin(win("222345m 444p 666s 99p", "5m"), { yaku: { sanankou: 2 }, han: 2, raw: 42, fu: 50 });
});

test("three concealed triplets: 222234m on a discarded 2m, the 2m goes to the run and 222m stays concealed", () => {
  expectWin(win("222234m 444p 666s 99p", "2m"), { yaku: { sanankou: 2 }, han: 2, raw: 42, fu: 50 });
});

test("three concealed triplets: not when a discard completes the third triplet (222m 444p 66s 123s 99p on 6s)", () => {
  expectNoYaku(win("222m 444p 123666s 99p", "6s"));
  // Fu: 20 + 10 + 4 + 4 + 2 (the triplet finished by ron counts as open) = 40.
  const result = win("222m 444p 123666s 99p", "6s", { riichi: 1 });
  expectWin(result, { yaku: { riichi: 1 }, han: 1, raw: 40, fu: 40 });
  assert.equal(result.wait, "shanpon");
});

test("three concealed triplets: the same hand by self-draw has all three", () => {
  // Fu: 20 + 4 + 4 + 4 + 2 self-draw = 34 -> 40.
  expectWin(win("222m 444p 123666s 99p", "6s", { tsumo: true }), { yaku: { "menzen-tsumo": 1, sanankou: 2 }, han: 3, raw: 34, fu: 40 });
});

test("three concealed triplets: counted in an open hand (pon 888p, 222m 444p 666s 55m)", () => {
  // Fu: 20 + 2 open + 4 + 4 + 4 + 2 single wait = 36 -> 40. 5 han is a mangan.
  expectWin(win("22255m 444p 666s", "5m", { melds: [pon("888p")] }), { yaku: { toitoi: 2, sanankou: 2, tanyao: 1 }, han: 5, raw: 36, fu: 40, limit: "mangan" });
});

test("four concealed triplets: a discard on the two-pair wait is three concealed triplets and all triplets", () => {
  // 222m 444p 666s 88s 55m taking 8s. Fu: 20 + 10 + 4 + 4 + 4 + 2 = 44 -> 50.
  expectWin(win("22255m 444p 666888s", "8s"), { yaku: { toitoi: 2, sanankou: 2, tanyao: 1 }, han: 5, raw: 44, fu: 50, limit: "mangan", base: 2000 });
});

test("triple triplets: 2 han open (pon 222m, pon 222p, 222s 456s 99m)", () => {
  // Fu: 20 + 2 + 2 + 4 closed simple triplet + 2 middle wait = 30.
  expectWin(win("99m 222456s", "5s", { melds: [pon("222m"), pon("222p")] }), { yaku: { "sanshoku-doukou": 2 }, han: 2, raw: 30, fu: 30 });
});

test("triple triplets: closed, with three concealed triplets (333m 333p 333s 678s 11z)", () => {
  // Fu: 20 + 10 + 4 + 4 + 4 + 2 middle wait + 2 round wind pair = 46 -> 50. 4 han 50 fu is a mangan.
  expectWin(win("333m 333p 333678s 11z", "7s"), { yaku: { "sanshoku-doukou": 2, sanankou: 2 }, han: 4, raw: 46, fu: 50, limit: "mangan" });
});

test("three kans: 2 han (open 2222m, closed 4444p, added 6666s, 345s 99m)", () => {
  // Fu: 20 + 8 + 16 + 8 + 2 middle wait = 54 -> 60.
  expectWin(win("99m 345s", "4s", { melds: [minkan("2222m"), ankan("4444p"), kakan("6666s")] }), { yaku: { sankantsu: 2 }, han: 2, raw: 54, fu: 60 });
});

test("three kans: three closed kans are three concealed triplets too", () => {
  // Fu: 20 + 10 + 16 x 3 + 2 middle wait = 80. 4 han 80 fu is a mangan.
  expectWin(win("99m 345s", "4s", { melds: [ankan("2222m"), ankan("4444p"), ankan("6666s")] }), {
    yaku: { sankantsu: 2, sanankou: 2 },
    han: 4,
    raw: 80,
    fu: 80,
    limit: "mangan",
  });
});

test("little three dragons: 2 han plus the two dragon triplets (pon 555z, pon 666z, 77z 234m 567p)", () => {
  // Fu: 20 + 4 + 4 + 2 dragon pair + 2 middle wait = 32 -> 40. 4 han 40 fu is a mangan.
  expectWin(win("234m 567p 77z", "6p", { melds: [pon("555z"), pon("666z")] }), {
    yaku: { shousangen: 2, "yakuhai-white": 1, "yakuhai-green": 1 },
    han: 4,
    raw: 32,
    fu: 40,
    limit: "mangan",
    base: 2000,
  });
});

test("half flush: 3 han closed (123m 345m 678m 99m 333z)", () => {
  // Fu: 20 + 10 + 8 closed honor triplet + 2 middle wait = 40.
  expectWin(win("12334567899m 333z", "4m"), { yaku: { honitsu: 3 }, han: 3, raw: 40, fu: 40 });
});

test("half flush: 2 han open (chi 123m)", () => {
  expectWin(win("34567899m 333z", "4m", { melds: [chi("123m")] }), { yaku: { honitsu: 2 }, han: 2, raw: 30, fu: 30 });
});

test("half flush: two suits and honors is nothing", () => {
  expectNoYaku(win("123345678m 99p 333z", "4m"));
});

test("full flush: 6 han closed (111m 234m 456m 678m 99m)", () => {
  // Fu: 20 + 10 + 8 closed terminal triplet + 2 middle wait = 40.
  expectWin(win("11123445667899m", "5m"), { yaku: { chinitsu: 6 }, han: 6, raw: 40, fu: 40, limit: "haneman" });
});

test("full flush: 5 han open (chi 678m)", () => {
  expectWin(win("11123445699m", "5m", { melds: [chi("678m")] }), { yaku: { chinitsu: 5 }, han: 5, raw: 30, fu: 30, limit: "mangan" });
});

test("yaku add up: riichi, pinfu, all simples, mixed triple sequence, pure double sequence", () => {
  // 234m 234p 55p 234s 234s taking 2m.
  const hand = "234m 23455p 223344s";
  expectWin(win(hand, "2m", { riichi: 1 }), { yaku: { riichi: 1, pinfu: 1, tanyao: 1, iipeikou: 1, sanshoku: 2 }, han: 6, fu: 30, limit: "haneman", base: 3000 });
  expectWin(win(hand, "2m", { riichi: 1, ippatsu: true, tsumo: true }), {
    yaku: { riichi: 1, ippatsu: 1, "menzen-tsumo": 1, pinfu: 1, tanyao: 1, iipeikou: 1, sanshoku: 2 },
    han: 8,
    fu: 20,
    limit: "baiman",
    base: 4000,
  });
});

// ── 2. Yakuman ─────────────────────────────────────────────────────────────

test("yakuman: thirteen orphans (19m 19p 19s 1234567z and a second 7z)", () => {
  const result = win("19m 19p 19s 12345677z", "7z");
  expectYakuman(result, ["kokushi"]);
  assert.equal(result.form, "orphans");
  expectYakuman(win("19m 19p 19s 12345677z", "1m", { tsumo: true }), ["kokushi"]);
});

test("yakuman: thirteen orphans on the thirteen-sided wait is still one limit", () => {
  expectYakuman(win("119m 19p 19s 1234567z", "1m"), ["kokushi"]);
});

test("yakuman: twelve orphans and two pairs is nothing (no 7z)", () => {
  assert.equal(win("119m 19p 19s 1234566z", "6z"), null);
});

test("yakuman: four concealed triplets on the single wait, by discard (222m 444p 666s 888s 55m)", () => {
  expectYakuman(win("22255m 444p 666888s", "5m"), ["suuankou"]);
});

test("yakuman: four concealed triplets by self-draw on the two-pair wait", () => {
  expectYakuman(win("22255m 444p 666888s", "8s", { tsumo: true }), ["suuankou"]);
});

test("yakuman: four concealed triplets with closed kans", () => {
  expectYakuman(win("55m 444p 666s", "5m", { melds: [ankan("2222m"), ankan("8888s")] }), ["suuankou"]);
});

test("yakuman: big three dragons, open (pon 555z, pon 666z, 777z 234m 99p)", () => {
  expectYakuman(win("234m 99p 777z", "3m", { melds: [pon("555z"), pon("666z")] }), ["daisangen"]);
});

test("yakuman: big three dragons when the discard completes the third dragon", () => {
  expectYakuman(win("234m 99p 555666777z", "7z"), ["daisangen"]);
});

test("yakuman: little four winds (pon 111z, pon 222z, 333z 44z 234m)", () => {
  expectYakuman(win("234m 33344z", "3m", { melds: [pon("111z"), pon("222z")] }), ["shousuushii"]);
});

test("yakuman: big four winds is one limit, not two (pon 111z 222z 333z, 444z 99m)", () => {
  expectYakuman(win("99m 444z", "9m", { melds: [pon("111z"), pon("222z"), pon("333z")] }), ["daisuushii"]);
});

test("yakuman: all honors (pon 111z, pon 222z, 333z 555z 66z)", () => {
  expectYakuman(win("33355566z", "6z", { melds: [pon("111z"), pon("222z")] }), ["tsuuiisou"]);
});

test("yakuman: all honors as seven pairs (11223344556677z)", () => {
  expectYakuman(win("11223344556677z", "7z"), ["tsuuiisou"]);
});

test("yakuman: all terminals (pon 111m, pon 999m, 111p 999s 11s)", () => {
  expectYakuman(win("111p 11999s", "1s", { melds: [pon("111m"), pon("999m")] }), ["chinroutou"]);
});

test("yakuman: all green with the green dragon (223344s 666s 888s 66z)", () => {
  expectYakuman(win("223344666888s 66z", "6z"), ["ryuuiisou"]);
});

test("yakuman: all green without the green dragon (234s 234s 666s 888s 44s)", () => {
  expectYakuman(win("22334444666888s", "4s"), ["ryuuiisou"]);
});

test("yakuman: all green, open (chi 234s, pon 666z, 666s 888s 33s)", () => {
  expectYakuman(win("33666888s", "3s", { melds: [chi("234s"), pon("666z")] }), ["ryuuiisou"]);
});

test("yakuman: one 5s spoils all green (223344s 55s 666s 888s is a full flush)", () => {
  // Full flush 6 + all simples 1 + pure double sequence 1 = 8 han whichever way it's read.
  expectWin(win("22334455666888s", "5s"), { yaku: { chinitsu: 6, tanyao: 1, iipeikou: 1 }, han: 8, fu: 40, limit: "baiman" });
});

test("yakuman: nine gates (1112345678999m and a second 9m)", () => {
  expectYakuman(win("11123456789999m", "9m"), ["chuuren"]);
});

test("yakuman: nine gates with any extra tile, by self-draw (a second 2m, a second 5m)", () => {
  expectYakuman(win("11122345678999m", "2m", { tsumo: true }), ["chuuren"]);
  expectYakuman(win("11123455678999p", "5p"), ["chuuren"]);
  expectYakuman(win("11112345678999s", "1s"), ["chuuren"]);
});

test("yakuman: nine gates needs a closed hand (pon 111m, 234 55 678 999m is a full flush)", () => {
  // Fu: 20 + 4 open terminal triplet + 8 closed terminal triplet + 2 single wait = 34 -> 40.
  expectWin(win("23455678999m", "5m", { melds: [pon("111m")] }), { yaku: { chinitsu: 5 }, han: 5, raw: 34, fu: 40, limit: "mangan" });
});

test("yakuman: four kans (open 2222m, closed 4444p, added 6666s, open 8888s, 99m)", () => {
  expectYakuman(win("99m", "9m", { melds: [minkan("2222m"), ankan("4444p"), kakan("6666s"), minkan("8888s")] }), ["suukantsu"]);
});

test("yakuman: blessing of heaven and blessing of earth on any winning shape", () => {
  expectYakuman(win(PLAIN, "6p", { tsumo: true, tenhou: true, seat: EAST }), ["tenhou"]);
  expectYakuman(win(PLAIN, "6p", { tsumo: true, chiihou: true }), ["chiihou"]);
  expectYakuman(win("1133m 2255p 4466s 77z", "7z", { tsumo: true, tenhou: true, seat: EAST }), ["tenhou"]);
  expectYakuman(win("1133m 2255p 4466s 77z", "7z", { tsumo: true, chiihou: true }), ["chiihou"]);
});

test("stacked yakuman: big three dragons and all honors is 2", () => {
  const result = win("11122777z", "2z", { melds: [pon("555z"), pon("666z")] });
  expectYakuman(result, ["daisangen", "tsuuiisou"]);
  assert.equal(result.base, 16000);
});

test("stacked yakuman: four concealed triplets, big three dragons and all honors is 3", () => {
  const result = win("11122555666777z", "2z", { tsumo: true });
  expectYakuman(result, ["suuankou", "daisangen", "tsuuiisou"]);
  assert.equal(result.base, 24000);
  expectYakuman(win("11122555666777z", "2z"), ["suuankou", "daisangen", "tsuuiisou"]);
});

test("stacked yakuman: big four winds and all honors is 2", () => {
  expectYakuman(win("44455z", "5z", { melds: [pon("111z"), pon("222z"), pon("333z")] }), ["daisuushii", "tsuuiisou"]);
});

test("stacked yakuman: little four winds and all honors is 2", () => {
  expectYakuman(win("33344555z", "4z", { melds: [pon("111z"), pon("222z")] }), ["shousuushii", "tsuuiisou"]);
});

test("stacked yakuman: all terminals and four concealed triplets is 2", () => {
  expectYakuman(win("111999m 111999p 11s", "1s", { tsumo: true }), ["chinroutou", "suuankou"]);
});

test("stacked yakuman: all green and four concealed triplets is 2", () => {
  expectYakuman(win("222444666888s 66z", "6z"), ["ryuuiisou", "suuankou"]);
});

test("stacked yakuman: four closed kans are four kans and four concealed triplets", () => {
  expectYakuman(win("99m", "9m", { melds: [ankan("2222m"), ankan("4444p"), ankan("6666s"), ankan("8888s")] }), ["suukantsu", "suuankou"]);
});

test("stacked yakuman: blessing of heaven on thirteen orphans, and on four concealed triplets", () => {
  expectYakuman(win("19m 19p 19s 12345677z", "7z", { tsumo: true, tenhou: true, seat: EAST }), ["kokushi", "tenhou"]);
  expectYakuman(win("22255m 444p 666888s", "8s", { tsumo: true, tenhou: true, seat: EAST }), ["suuankou", "tenhou"]);
});

test("yakuman: ordinary yaku and dora add nothing to a yakuman", () => {
  const result = win("22255m 444p 666888s", "5m", { riichi: 1, ippatsu: true, dora: parseKinds("2m4p"), ura: parseKinds("6s"), redFives: 1 });
  expectYakuman(result, ["suuankou"]);
  assert.equal(result.base, 8000);
});

// The closed full flush 111m 234m 456m 678m 99m taking 5m: 6 han, read one way only.
const FLUSH = "11123445667899m";

test("counted yakuman: 13 han from yaku and dora is a yakuman's points", () => {
  // Full flush 6 + riichi 1 + self-draw 1 = 8, dora 1m x 3, ura 9m x 2: 13.
  const result = win(FLUSH, "5m", { riichi: 1, tsumo: true, dora: parseKinds("1m"), ura: parseKinds("9m") });
  expectWin(result, { yaku: { riichi: 1, "menzen-tsumo": 1, chinitsu: 6 }, han: 13, limit: "kazoe", base: 8000 });
  assert.deepEqual(result.dora, { dora: 3, ura: 2, red: 0 });
});

test("counted yakuman: 12 han is still a sanbaiman, and 20 han is one yakuman, not more", () => {
  // 8 from yaku, dora 1m x 3, ura 2m x 1: 12.
  expectWin(win(FLUSH, "5m", { riichi: 1, tsumo: true, dora: parseKinds("1m"), ura: parseKinds("2m") }), { han: 12, limit: "sanbaiman", base: 6000 });
  // 8 from yaku, dora 1m twice (6), ura 1m (3), ura 9m (2), one red five: 20.
  expectWin(win(FLUSH, "5m", { riichi: 1, tsumo: true, dora: parseKinds("1m1m"), ura: parseKinds("1m9m"), redFives: 1 }), { han: 20, limit: "kazoe", base: 8000 });
});

test("dora are not yaku: a hand with dora, ura-less, and red fives but no yaku can't be declared", () => {
  const result = win(PLAIN, "6p", { dora: parseKinds("9p9p1m"), ura: parseKinds("9p"), redFives: 2 });
  expectNoYaku(result);
  assert.equal(result.limit, null);
  expectNoYaku(win(PLAIN_OPEN, "6p", { melds: [pon("333z")], dora: parseKinds("3z3z") }));
});

// ── 3. Fu ──────────────────────────────────────────────────────────────────
// Each row: what it shows, the concealed tiles, the winning tile, the options, fu before rounding, fu.
// Hands with no yaku of their own win on the last discard (houtei) or the last draw (haitei), which
// add han but never fu.

const LAST_DISCARD = { houtei: true };
const LAST_DRAW = { tsumo: true, haitei: true };
const EAST_EAST = { seat: EAST, round: EAST };

const FU_HANDS = [
  ["closed ron, middle wait: 20 + 10 + 2 = 32", PLAIN, "6p", LAST_DISCARD, 32, 40],
  ["pinfu ron: 20 + 10 = 30", PLAIN, "5p", {}, 30, 30],
  ["pinfu self-draw: 20, with no 2 for the draw", PLAIN, "5p", { tsumo: true }, 20, 20],
  ["closed self-draw, middle wait: 20 + 2 + 2 = 24", PLAIN, "6p", { tsumo: true }, 24, 30],
  ["open ron worth only 20 counts as 30 (chi 234m)", SIMPLE_TAIL, "5p", { melds: [chi("234m")] }, 30, 30],
  ["open self-draw with nothing else: 20 + 2 = 22 (chi 234m)", SIMPLE_TAIL, "5p", { melds: [chi("234m")], tsumo: true, haitei: true }, 22, 30],
  ["seven pairs ron: 25", "1133m 2255p 4466s 77z", "7z", {}, 25, 25],
  ["seven pairs self-draw: 25", "1133m 2255p 4466s 77z", "7z", { tsumo: true }, 25, 25],
  ["open simple triplet 2 (pon 333m): 20 + 2 = 22", SIMPLE_TAIL, "5p", { melds: [pon("333m")], ...LAST_DISCARD }, 22, 30],
  ["closed simple triplet 4 (333m): 20 + 10 + 4 = 34", `333m ${SIMPLE_TAIL}`, "5p", LAST_DISCARD, 34, 40],
  ["open terminal triplet 4 (pon 999m): 20 + 4 = 24", SIMPLE_TAIL, "5p", { melds: [pon("999m")], ...LAST_DISCARD }, 24, 30],
  ["closed terminal triplet 8 (999m): 20 + 10 + 8 = 38", `999m ${SIMPLE_TAIL}`, "5p", LAST_DISCARD, 38, 40],
  ["open honor triplet 4 (pon 444z): 20 + 4 = 24", SIMPLE_TAIL, "5p", { melds: [pon("444z")], ...LAST_DISCARD }, 24, 30],
  ["closed honor triplet 8 (333z): 20 + 10 + 8 = 38", `${SIMPLE_TAIL} 333z`, "5p", LAST_DISCARD, 38, 40],
  ["open simple kan 8 (open kan 3333m): 20 + 8 = 28", SIMPLE_TAIL, "5p", { melds: [minkan("3333m")], ...LAST_DISCARD }, 28, 30],
  ["added simple kan 8 (added kan 3333m): 20 + 8 = 28", SIMPLE_TAIL, "5p", { melds: [kakan("3333m")], ...LAST_DISCARD }, 28, 30],
  ["closed simple kan 16 (closed kan 3333m): 20 + 10 + 16 = 46", SIMPLE_TAIL, "5p", { melds: [ankan("3333m")], ...LAST_DISCARD }, 46, 50],
  ["open terminal kan 16 (open kan 9999m): 20 + 16 = 36", SIMPLE_TAIL, "5p", { melds: [minkan("9999m")], ...LAST_DISCARD }, 36, 40],
  ["added terminal kan 16 (added kan 1111s): 20 + 16 = 36", SIMPLE_TAIL, "5p", { melds: [kakan("1111s")], ...LAST_DISCARD }, 36, 40],
  ["open honor kan 16 (open kan 4444z): 20 + 16 = 36", SIMPLE_TAIL, "5p", { melds: [minkan("4444z")], ...LAST_DISCARD }, 36, 40],
  ["closed terminal kan 32 (closed kan 1111m): 20 + 10 + 32 = 62", SIMPLE_TAIL, "5p", { melds: [ankan("1111m")], ...LAST_DISCARD }, 62, 70],
  ["closed honor kan 32 (closed kan 3333z): 20 + 10 + 32 = 62", SIMPLE_TAIL, "5p", { melds: [ankan("3333z")], ...LAST_DISCARD }, 62, 70],
  ["closed honor kan 32, self-draw: 20 + 32 + 2 = 54", SIMPLE_TAIL, "5p", { melds: [ankan("3333z")], ...LAST_DRAW }, 54, 60],
  ["dragon pair 2 (77z): 20 + 10 + 2 = 32", "123m 567p 345s 789s 77z", "5p", LAST_DISCARD, 32, 40],
  ["seat wind pair 2 (22z for South): 20 + 10 + 2 = 32", "123m 567p 345s 789s 22z", "5p", LAST_DISCARD, 32, 40],
  ["round wind pair 2 (11z in East): 20 + 10 + 2 = 32", "123m 567p 345s 789s 11z", "5p", LAST_DISCARD, 32, 40],
  ["double wind pair 4 (11z, East seat in East): 20 + 10 + 8 + 4 = 42", `999m 567p 345s 678s 11z`, "5p", { ...EAST_EAST, ...LAST_DISCARD }, 42, 50],
  ["double wind pair 4 on its own: 20 + 10 + 4 = 34", "123m 567p 345s 789s 11z", "5p", { ...EAST_EAST, ...LAST_DISCARD }, 34, 40],
  ["guest wind pair 0 (33z): pinfu, 20 + 10 = 30", "123m 567p 345s 789s 33z", "5p", {}, 30, 30],
  ["edge wait 2 (12m taking 3m): 20 + 10 + 2 = 32", PLAIN, "3m", LAST_DISCARD, 32, 40],
  ["edge wait 2 (89s taking 7s): 20 + 10 + 2 = 32", PLAIN, "7s", LAST_DISCARD, 32, 40],
  ["single wait 2 (9p): 20 + 10 + 2 = 32", PLAIN, "9p", LAST_DISCARD, 32, 40],
  ["single wait on a dragon pair, self-draw: 20 + 2 + 2 + 2 = 26", "123m 567p 345s 789s 77z", "7z", LAST_DRAW, 26, 30],
  ["two-pair wait 0, ron triplet counts as open: 20 + 10 + 4 + 4 + 2 = 40 exactly", "444m 567p 345s 333z 55z", "3z", LAST_DISCARD, 40, 40],
  ["the same by self-draw, the triplet is closed: 20 + 4 + 8 + 2 + 2 = 36", "444m 567p 345s 333z 55z", "3z", LAST_DRAW, 36, 40],
  ["simple triplet finished by ron 2: 20 + 10 + 2 = 32", `333m ${SIMPLE_TAIL}`, "3m", LAST_DISCARD, 32, 40],
  ["simple triplet finished by self-draw 4: 20 + 4 + 2 = 26", `333m ${SIMPLE_TAIL}`, "3m", LAST_DRAW, 26, 30],
  ["terminal triplet finished by ron 4: 20 + 10 + 4 = 34", `999m ${SIMPLE_TAIL}`, "9m", LAST_DISCARD, 34, 40],
  ["closed self-draw landing exactly on 30: 20 + 8 + 2", `999m ${SIMPLE_TAIL}`, "5p", LAST_DRAW, 30, 30],
  ["open hand, middle wait and a triplet: 20 + 2 + 2 = 24", SIMPLE_TAIL, "6p", { melds: [pon("333m")], ...LAST_DISCARD }, 24, 30],
  ["self-draw after a kan still gets 2: 20 + 8 + 2 + 2 = 32", PLAIN_OPEN, "6p", { melds: [minkan("2222m")], tsumo: true, rinshan: true }, 32, 40],
  [
    "two closed terminal kans, a ron triplet and a double wind pair: 20 + 10 + 32 + 32 + 4 + 4 = 102",
    "456999s 11z",
    "9s",
    { melds: [ankan("1111m"), ankan("9999p")], ...EAST_EAST, riichi: 1 },
    102,
    110,
  ],
  [
    "three kinds of kan and a closed triplet, open: 20 + 16 + 32 + 8 + 8 + 2 = 86",
    "99m 111s",
    "9m",
    { melds: [minkan("1111z"), ankan("9999p"), kakan("5555s")], ...LAST_DISCARD },
    86,
    90,
  ],
];

for (const [name, hand, tile, options, raw, fu] of FU_HANDS) {
  test(`fu: ${name} -> ${fu} (${hand} on ${tile})`, () => {
    const result = win(hand, tile, options);
    assert.ok(result, "the hand should be a winning shape");
    assert.equal(result.noYaku, false);
    assert.equal(result.yakuman, 0);
    assert.equal(result.fu, fu, "fu");
    assert.equal(rawFu(result), raw, "fu before rounding");
  });
}

test("fu: the 110 fu hand is 1 han, 5,300 to a dealer", () => {
  const result = win("456999s 11z", "9s", { melds: [ankan("1111m"), ankan("9999p")], ...EAST_EAST, riichi: 1 });
  expectWin(result, { yaku: { riichi: 1 }, han: 1, fu: 110, base: 880 });
  assert.equal(payments({ base: result.base, winner: 0, dealer: 0, tsumo: false, loser: 2 }).total, 5300);
});

// ── 4. Points ──────────────────────────────────────────────────────────────
// The standard table, written out. Columns: fu, han, non-dealer ron, dealer ron, non-dealer self-draw
// (what each non-dealer pays, what the dealer pays), dealer self-draw (what everyone pays). null where
// the cell doesn't exist (20 fu is only ever a pinfu self-draw, 25 fu is seven pairs).

const SCORE_TABLE = [
  [20, 2, null, null, 400, 700, 700],
  [20, 3, null, null, 700, 1300, 1300],
  [20, 4, null, null, 1300, 2600, 2600],
  [25, 2, 1600, 2400, null, null, null],
  [25, 3, 3200, 4800, 800, 1600, 1600],
  [25, 4, 6400, 9600, 1600, 3200, 3200],
  [30, 1, 1000, 1500, 300, 500, 500],
  [30, 2, 2000, 2900, 500, 1000, 1000],
  [30, 3, 3900, 5800, 1000, 2000, 2000],
  [30, 4, 7700, 11600, 2000, 3900, 3900],
  [40, 1, 1300, 2000, 400, 700, 700],
  [40, 2, 2600, 3900, 700, 1300, 1300],
  [40, 3, 5200, 7700, 1300, 2600, 2600],
  [40, 4, 8000, 12000, 2000, 4000, 4000],
  [50, 1, 1600, 2400, 400, 800, 800],
  [50, 2, 3200, 4800, 800, 1600, 1600],
  [50, 3, 6400, 9600, 1600, 3200, 3200],
  [50, 4, 8000, 12000, 2000, 4000, 4000],
  [60, 1, 2000, 2900, 500, 1000, 1000],
  [60, 2, 3900, 5800, 1000, 2000, 2000],
  [60, 3, 7700, 11600, 2000, 3900, 3900],
  [60, 4, 8000, 12000, 2000, 4000, 4000],
  [70, 1, 2300, 3400, 600, 1200, 1200],
  [70, 2, 4500, 6800, 1200, 2300, 2300],
  [70, 3, 8000, 12000, 2000, 4000, 4000],
  [70, 4, 8000, 12000, 2000, 4000, 4000],
  [80, 1, 2600, 3900, 700, 1300, 1300],
  [80, 2, 5200, 7700, 1300, 2600, 2600],
  [80, 3, 8000, 12000, 2000, 4000, 4000],
  [80, 4, 8000, 12000, 2000, 4000, 4000],
  [90, 1, 2900, 4400, 800, 1500, 1500],
  [90, 2, 5800, 8700, 1500, 2900, 2900],
  [90, 3, 8000, 12000, 2000, 4000, 4000],
  [90, 4, 8000, 12000, 2000, 4000, 4000],
  [100, 1, 3200, 4800, 800, 1600, 1600],
  [100, 2, 6400, 9600, 1600, 3200, 3200],
  [100, 3, 8000, 12000, 2000, 4000, 4000],
  [100, 4, 8000, 12000, 2000, 4000, 4000],
  [110, 1, 3600, 5300, null, null, null],
  [110, 2, 7100, 10600, 1800, 3600, 3600],
  [110, 3, 8000, 12000, 2000, 4000, 4000],
  [110, 4, 8000, 12000, 2000, 4000, 4000],
];

/** The four ways a win of `base` is paid, checked against one row's numbers. Seat 0 deals. */
function expectPayments(base, [ron, dealerRon, fromOthers, fromDealer, dealerAll]) {
  if (ron !== null) {
    const paid = payments({ base, winner: 1, dealer: 0, tsumo: false, loser: 3 });
    assert.deepEqual(paid.from, { 3: ron }, "non-dealer ron");
    assert.equal(paid.total, ron);
    const toDealer = payments({ base, winner: 0, dealer: 0, tsumo: false, loser: 2 });
    assert.deepEqual(toDealer.from, { 2: dealerRon }, "dealer ron");
    assert.equal(toDealer.total, dealerRon);
  }
  if (fromOthers !== null) {
    const paid = payments({ base, winner: 2, dealer: 0, tsumo: true });
    assert.deepEqual(paid.from, { 0: fromDealer, 1: fromOthers, 3: fromOthers }, "non-dealer self-draw");
    assert.equal(paid.total, fromDealer + 2 * fromOthers);
    const toDealer = payments({ base, winner: 0, dealer: 0, tsumo: true });
    assert.deepEqual(toDealer.from, { 1: dealerAll, 2: dealerAll, 3: dealerAll }, "dealer self-draw");
    assert.equal(toDealer.total, 3 * dealerAll);
  }
}

for (const [fu, han, ...row] of SCORE_TABLE) {
  test(`points: ${fu} fu ${han} han pays ${row.map((value) => value ?? "-").join(" / ")}`, () => {
    const { base, limit } = basePoints(han, fu);
    expectPayments(base, row);
    // In this table only the mangan cells pay 8,000 on a ron.
    assert.equal(limit, row[0] === 8000 ? "mangan" : null);
  });
}

test("points: 4 han 30 fu and 3 han 60 fu are not rounded up to mangan", () => {
  assert.deepEqual(basePoints(4, 30), { base: 1920, limit: null });
  assert.deepEqual(basePoints(3, 60), { base: 1920, limit: null });
  assert.deepEqual(basePoints(4, 25), { base: 1600, limit: null });
});

test("points: mangan starts at 4 han 40 fu and 3 han 70 fu", () => {
  assert.deepEqual(basePoints(4, 40), { base: 2000, limit: "mangan" });
  assert.deepEqual(basePoints(3, 70), { base: 2000, limit: "mangan" });
  assert.deepEqual(basePoints(2, 110), { base: 1760, limit: null });
});

// Limit hands: han, limit, then the same five payments. Fu no longer matters.
const LIMIT_TABLE = [
  [5, "mangan", 8000, 12000, 2000, 4000, 4000],
  [6, "haneman", 12000, 18000, 3000, 6000, 6000],
  [7, "haneman", 12000, 18000, 3000, 6000, 6000],
  [8, "baiman", 16000, 24000, 4000, 8000, 8000],
  [9, "baiman", 16000, 24000, 4000, 8000, 8000],
  [10, "baiman", 16000, 24000, 4000, 8000, 8000],
  [11, "sanbaiman", 24000, 36000, 6000, 12000, 12000],
  [12, "sanbaiman", 24000, 36000, 6000, 12000, 12000],
  [13, "kazoe", 32000, 48000, 8000, 16000, 16000],
  [14, "kazoe", 32000, 48000, 8000, 16000, 16000],
  [26, "kazoe", 32000, 48000, 8000, 16000, 16000],
];

for (const [han, limit, ...row] of LIMIT_TABLE) {
  test(`points: ${han} han is a ${limit}, ${row.join(" / ")}`, () => {
    for (const fu of [20, 25, 30, 40, 70, 110]) {
      const points = basePoints(han, fu);
      assert.equal(points.limit, limit);
      expectPayments(points.base, row);
    }
  });
}

test("points: a yakuman is 32,000 (48,000 to a dealer), and stacked yakuman multiply it", () => {
  assert.deepEqual(basePoints(0, 0, 1), { base: 8000, limit: "yakuman" });
  expectPayments(basePoints(0, 0, 1).base, [32000, 48000, 8000, 16000, 16000]);
  expectPayments(basePoints(0, 0, 2).base, [64000, 96000, 16000, 32000, 32000]);
  expectPayments(basePoints(0, 0, 3).base, [96000, 144000, 24000, 48000, 48000]);
});

test("points: each payment rounds up to the next 100 on its own", () => {
  // 30 fu 1 han: base 240. 240 -> 300 and 480 -> 500, so a self-draw collects 1,100, more than the 1,000 ron.
  assert.equal(payments({ base: 240, winner: 1, dealer: 0, tsumo: true }).total, 1100);
  assert.equal(payments({ base: 240, winner: 0, dealer: 0, tsumo: true }).total, 1500);
  // The dealer is found by seat, wherever it sits.
  assert.deepEqual(payments({ base: 240, winner: 0, dealer: 3, tsumo: true }).from, { 1: 300, 2: 300, 3: 500 });
  assert.deepEqual(payments({ base: 240, winner: 3, dealer: 3, tsumo: false, loser: 1 }).from, { 1: 1500 });
});

test("points: whole hands through evaluate and payments", () => {
  const pay = (result, dealerWins) => payments({ base: result.base, winner: dealerWins ? 0 : 1, dealer: 0, tsumo: false, loser: 2 }).total;
  // Riichi only, 40 fu: 1,300 / 2,000.
  assert.equal(pay(win(PLAIN, "6p", { riichi: 1 }), false), 1300);
  assert.equal(pay(win(PLAIN, "6p", { riichi: 1, ...EAST_EAST }), true), 2000);
  // Pinfu only: 1,000. Seven pairs only: 1,600.
  assert.equal(pay(win(PLAIN, "5p"), false), 1000);
  assert.equal(pay(win("1133m 2255p 4466s 77z", "7z"), false), 1600);
  // Twice pure double sequence with pinfu, 4 han 30 fu: 7,700.
  assert.equal(pay(win("223344m 667788p 99s", "2m"), false), 7700);
  // Pinfu self-draw, 2 han 20 fu: 400 and 700.
  const drawn = win(PLAIN, "5p", { tsumo: true });
  assert.deepEqual(payments({ base: drawn.base, winner: 1, dealer: 0, tsumo: true }).from, { 0: 700, 2: 400, 3: 400 });
  // Thirteen orphans: 32,000.
  assert.equal(pay(win("19m 19p 19s 12345677z", "7z"), false), 32000);
});

// ── 5. The reading that scores most ────────────────────────────────────────

test("highest reading: 111222333m 456p 77s on 4p reads as three concealed triplets (2 han 50 fu), not three alike runs", () => {
  // Triplets: 20 + 10 + 8 + 4 + 4 = 46 -> 50, 2 han: base 800. Runs: pinfu and one double run, 2 han 30 fu: base 480.
  expectWin(win("111222333m 456p 77s", "4p"), { yaku: { sanankou: 2 }, han: 2, raw: 46, fu: 50, base: 800 });
});

test("highest reading: 111222333m 789p 99s on a discarded 1m reads as runs (fully outside, pinfu, double run)", () => {
  // As triplets the ron 1m opens 111m: two concealed triplets, no yaku at all.
  expectWin(win("111222333m 789p 99s", "1m"), { yaku: { junchan: 3, pinfu: 1, iipeikou: 1 }, han: 5, fu: 30, limit: "mangan" });
});

test("highest reading: the same hand self-drawn is still better as runs (6 han against 3)", () => {
  expectWin(win("111222333m 789p 99s", "1m", { tsumo: true }), {
    yaku: { "menzen-tsumo": 1, junchan: 3, pinfu: 1, iipeikou: 1 },
    han: 6,
    fu: 20,
    limit: "haneman",
  });
});

test("highest reading: 111222333m 555p 99s self-drawn is four concealed triplets", () => {
  expectYakuman(win("111222333m 555p 99s", "9s", { tsumo: true }), ["suuankou"]);
  expectYakuman(win("111222333m 555p 99s", "2m", { tsumo: true }), ["suuankou"]);
  expectYakuman(win("111222333m 555p 99s", "9s"), ["suuankou"]);
});

test("highest reading: 111222333m 555p 99s on a discarded 5p is all triplets and three concealed triplets", () => {
  // Triplets: 4 han, 20 + 10 + 8 + 4 + 4 + 2 = 48 -> 50, a mangan. Runs: one double run, 1 han.
  expectWin(win("111222333m 555p 99s", "5p"), { yaku: { toitoi: 2, sanankou: 2 }, han: 4, raw: 48, fu: 50, limit: "mangan" });
});

test("highest reading: 22334455m 678p 678s on 2m takes the two-sided reading for pinfu", () => {
  // Pair 55m with 234m 234m: pinfu, double run, all simples, 3 han 30 fu (base 960).
  // Pair 22m with 345m 345m is a single wait: 2 han 40 fu (base 640).
  expectWin(win("22334455m 678p 678s", "2m"), { yaku: { pinfu: 1, tanyao: 1, iipeikou: 1 }, han: 3, fu: 30, base: 960 });
});

test("highest reading: 23444s on 4s is pinfu on the two-sided wait, not a single wait", () => {
  expectWin(win("123456m 789p 23444s", "4s"), { yaku: { pinfu: 1 }, han: 1, fu: 30 });
  expectWin(win("123456m 789p 23444s", "4s", { riichi: 1 }), { yaku: { riichi: 1, pinfu: 1 }, han: 2, fu: 30 });
  expectWin(win("123456m 789p 23444s", "4s", { tsumo: true }), { yaku: { "menzen-tsumo": 1, pinfu: 1 }, han: 2, fu: 20 });
});

test("highest reading: 344556s on 4s counts the middle wait when pinfu is out of reach", () => {
  // 999m 567p 55z and 345s 456s. The 4s in 345s is a middle wait: 20 + 10 + 8 + 2 + 2 = 42 -> 50.
  // In 456s it is two-sided: 40. Same han, so the 50 fu reading pays more.
  expectWin(win("999m 567p 344556s 55z", "4s", { riichi: 1 }), { yaku: { riichi: 1 }, han: 1, raw: 42, fu: 50, base: 400 });
});

test("highest reading: 333345s on a discarded 3s keeps 333s concealed for three concealed triplets", () => {
  // 111m 222p 333s 345s 99p. Fu: 20 + 10 + 8 + 4 + 4 = 46 -> 50.
  expectWin(win("111m 222p 99p 333345s", "3s"), { yaku: { sanankou: 2 }, han: 2, raw: 46, fu: 50 });
});

test("highest reading: twice pure double sequence beats seven pairs (112233m 112233p 99s)", () => {
  expectWin(win("112233m 112233p 99s", "9s"), { yaku: { ryanpeikou: 3, junchan: 3 }, han: 6, raw: 32, fu: 40, limit: "haneman" });
});

test("highest reading: 22223333444455m on 5m is best as 22m 234m 234m 345m 345m", () => {
  // Pair 22m: twice double run 3 + pinfu 1 (5m finishes 34m) + all simples 1 + full flush 6 = 11.
  // Pair 55m with four 234m: 10 han. Pair 55m with 222m 333m 444m 234m: 9 han.
  expectWin(win("22223333444455m", "5m"), { yaku: { ryanpeikou: 3, pinfu: 1, tanyao: 1, chinitsu: 6 }, han: 11, fu: 30, limit: "sanbaiman", base: 6000 });
});

test("highest reading: a yakuman is named even when another reading counts to 13 han", () => {
  // 111222333m 555m 99m self-drawn in riichi with dora 1m and 2m. As triplets: four concealed triplets.
  // As runs: full flush 6, riichi 1, self-draw 1, double run 1, dora 6 = 15 han, a counted yakuman.
  // Both pay 8,000 base; the hand is four concealed triplets.
  const result = win("11122233355599m", "9m", { tsumo: true, riichi: 1, dora: parseKinds("1m2m") });
  assert.equal(result.base, 8000);
  expectYakuman(result, ["suuankou"]);
});

test("decompose: lists both readings of 111222333m 55z and of 22334455m", () => {
  const readings = (hand) =>
    new Set(decompose(countKinds(parseKinds(hand))).map(({ pair, sets }) => `${pair}:${sets.map((set) => `${set.seq ? "run" : "set"}${set.kind}`).sort().join(",")}`));
  assert.deepEqual(readings("111222333m 55z"), new Set(["31:set0,set1,set2", "31:run0,run0,run0"]));
  assert.deepEqual(readings("22334455m"), new Set(["1:run2,run2", "4:run1,run1"]));
  assert.deepEqual(readings("123m 55z"), new Set(["31:run0"]));
  assert.equal(decompose(countKinds(parseKinds("124m 55z"))).length, 0);
});

// ── 6. Shanten and waits ───────────────────────────────────────────────────
// Each row: the concealed tiles, how many sets are called, the shanten, and for 13-tile hands the
// waits ("" for none).

const SHANTEN_HANDS = [
  // Complete.
  ["123m 456p 789s 234s 55z", 0, -1, null],
  ["1133m 2255p 4466s 77z", 0, -1, null],
  ["19m 19p 19s 12345677z", 0, -1, null],
  ["345678m 55z", 2, -1, null],
  ["55z", 4, -1, null],
  // Tenpai, one wait shape each.
  ["123m 456p 789s 23s 55z", 0, 0, "14s"],
  ["123m 456p 789s 13s 55z", 0, 0, "2s"],
  ["123m 456p 789s 12s 55z", 0, 0, "3s"],
  ["123m 456p 234789s 5z", 0, 0, "5z"],
  ["123m 456p 22789s 55z", 0, 0, "2s5z"],
  ["23456m 123p 789s 55z", 0, 0, "147m"],
  ["2345m 123p 789s 111z", 0, 0, "25m"],
  ["3334m 123p 789s 111z", 0, 0, "245m"],
  ["2345678m 123p 789s", 0, 0, "258m"],
  ["1113m 456p 789s 222z", 0, 0, "23m"],
  ["2223456m 123p 789s", 0, 0, "13467m"],
  ["1112345678999m", 0, 0, "123456789m"],
  ["1112345678999s", 0, 0, "123456789s"],
  ["19m 19p 19s 1234567z", 0, 0, "19m19p19s1234567z"],
  ["19m 19p 19s 1234566z", 0, 0, "7z"],
  ["119m 19p 19s 123456z", 0, 0, "7z"],
  ["1133m 2255p 4466s 7z", 0, 0, "7z"],
  ["112233m 445566p 7s", 0, 0, "7s"],
  // Tenpai with called sets.
  ["456p 23789s 55z", 1, 0, "14s"],
  ["34567m 55z", 2, 0, "258m"],
  ["111m 5p", 3, 0, "5p"],
  ["1123m", 3, 0, "14m"],
  ["5z", 4, 0, "5z"],
  // Not tenpai.
  ["123m 456p 237899s 5z", 0, 1, ""],
  ["1133m 2255p 44679s", 0, 1, ""],
  ["111m 2255p 4466s 77z", 0, 1, ""],
  ["159m 19p 19s 123456z", 0, 1, ""],
  ["123m 45p 78s 22z 5z", 1, 1, ""],
  ["123m 456p 789s 1234z", 0, 2, ""],
  ["123m 456p 1479s 123z", 0, 3, ""],
  ["123m 147p 158s 1122z", 0, 4, ""],
  ["19m 12589p 19s 1122z", 0, 4, ""],
  ["123m 147p 158s 1123z", 0, 5, ""],
  ["147m 258p 369s 1234z", 0, 6, ""],
  ["147m 258p 369s 12345z", 0, 6, null],
];

for (const [hand, melds, expected, waits] of SHANTEN_HANDS) {
  const label = melds ? `${hand} with ${melds} called` : hand;
  test(`shanten: ${label} is ${expected}${waits ? `, waiting on ${waits}` : ""}`, () => {
    const kinds = parseKinds(hand);
    const size = kinds.length + melds * 3;
    assert.ok(size === 13 || size === 14, `13 or 14 tiles: ${hand}`);
    const counts = countKinds(kinds);
    assert.equal(shanten(counts, melds), expected, "shanten");
    if (waits !== null) assert.deepEqual(waitsOf(counts, melds), sorted(waits), "waits");
    assert.deepEqual(counts, countKinds(kinds), "the counts are handed back unchanged");
  });
}

test("shanten: each form on its own (147m 258p 369s 1234z: 8 standard, 6 seven pairs, 7 orphans)", () => {
  const scattered = countKinds(parseKinds("147m 258p 369s 1234z"));
  assert.equal(standardShanten(scattered), 8);
  assert.equal(sevenPairsShanten(scattered), 6);
  assert.equal(orphansShanten(scattered), 7);
});

test("shanten: seven pairs needs seven different pairs (111m 2255p 4466s 77z: 1 for pairs, 2 standard)", () => {
  const counts = countKinds(parseKinds("111m 2255p 4466s 77z"));
  assert.equal(sevenPairsShanten(counts), 1);
  assert.equal(standardShanten(counts), 2);
  // Fourteen tiles with a four-of-a-kind: six kinds paired, still one away.
  assert.equal(sevenPairsShanten(countKinds(parseKinds("1111m 2255p 4466s 77z"))), 1);
  assert.equal(sevenPairsShanten(countKinds(parseKinds("1133m 2255p 4466s 77z"))), -1);
  assert.equal(sevenPairsShanten(countKinds(parseKinds("1133m 2255p 4466s 7z"))), 0);
});

test("shanten: thirteen orphans counts kinds and one pair", () => {
  assert.equal(orphansShanten(countKinds(parseKinds("19m 19p 19s 1234567z"))), 0);
  assert.equal(orphansShanten(countKinds(parseKinds("19m 19p 19s 12345677z"))), -1);
  assert.equal(orphansShanten(countKinds(parseKinds("19m 19p 19s 1234566z"))), 0);
  assert.equal(orphansShanten(countKinds(parseKinds("159m 19p 19s 123456z"))), 1);
  assert.equal(orphansShanten(countKinds(parseKinds("2345678m 234p 567s"))), 13);
});

test("shanten: a called hand is never read as seven pairs or thirteen orphans", () => {
  // 1133m 2255p 44s with one set called: five pairs, but only the standard form counts.
  // One pair and three partial sets: 8 - 2 (the called set) - 3 - 1 = 2.
  assert.equal(shanten(countKinds(parseKinds("1133m 2255p 44s")), 1), 2);
});

test("waits: a hand waiting only on a tile it holds all four of has no wait (1111m 234p 567p 789s)", () => {
  assert.deepEqual(waitsOf(countKinds(parseKinds("1111m 234p 567p 789s"))), []);
  assert.deepEqual(waitsOf(countKinds(parseKinds("1111m")), 3), []);
});

test("waits: a tile held four times is dropped from a wider wait (3333456m: only 6m is left)", () => {
  // 333m + 3456m would wait on 3m and 6m for the pair, but the hand already holds every 3m.
  assert.deepEqual(waitsOf(countKinds(parseKinds("3333456m 123p 789s"))), sorted("6m"));
  // 333m 34m holds four 3m too, but neither wait (2m, 5m) is one of them.
  assert.deepEqual(waitsOf(countKinds(parseKinds("33334m 456p 789s 11z"))), sorted("25m"));
});

test("improvements: 123m 456p 789s 1234z is two away, and only pairing an honor helps (12 tiles)", () => {
  const counts = countKinds(parseKinds("123m 456p 789s 1234z"));
  assert.deepEqual(improvements(counts), { shanten: 2, kinds: sorted("1234z"), left: 12 });
});

test("improvements: a tenpai hand lists its waits, less the copies already seen", () => {
  const counts = countKinds(parseKinds("123m 456p 789s 23s 55z"));
  assert.deepEqual(improvements(counts), { shanten: 0, kinds: sorted("14s"), left: 8 });
  const seen = new Array(34).fill(0);
  seen[kind("1s")] = 3;
  seen[kind("4s")] = 4;
  assert.deepEqual(improvements(counts, 0, seen), { shanten: 0, kinds: sorted("14s"), left: 1 });
  // The pair wait 22s 55z: two copies of each are in the hand.
  assert.deepEqual(improvements(countKinds(parseKinds("123m 456p 22789s 55z"))), { shanten: 0, kinds: sorted("2s5z"), left: 4 });
});

// ── 7. Dora ────────────────────────────────────────────────────────────────

test("dora: the indicator points at the next number, and 9 wraps to 1 in each suit", () => {
  assert.deepEqual(parseKinds("123456789m").map(doraFromIndicator), parseKinds("234567891m"));
  assert.deepEqual(parseKinds("123456789p").map(doraFromIndicator), parseKinds("234567891p"));
  assert.deepEqual(parseKinds("123456789s").map(doraFromIndicator), parseKinds("234567891s"));
});

test("dora: winds go East South West North East, dragons white green red white", () => {
  assert.deepEqual(parseKinds("1234z").map(doraFromIndicator), parseKinds("2341z"));
  assert.deepEqual(parseKinds("567z").map(doraFromIndicator), parseKinds("675z"));
  assert.equal(doraFromIndicator(kind("4z")), kind("1z"), "North never points at a dragon");
  assert.equal(doraFromIndicator(kind("7z")), kind("5z"), "red never points at a wind");
});

test("dora: dora, ura and red fives each add han to a hand with a yaku", () => {
  // Riichi 1, dora 9p x 2, ura 1m x 1, one red five: 5 han.
  const result = win(PLAIN, "6p", { riichi: 1, dora: parseKinds("9p"), ura: parseKinds("1m"), redFives: 1 });
  expectWin(result, { yaku: { riichi: 1 }, han: 5, fu: 40, limit: "mangan" });
  assert.deepEqual(result.dora, { dora: 2, ura: 1, red: 1 });
  assert.equal(result.yakuHan, 1);
});

test("dora: ura count only in riichi", () => {
  const drawn = win(PLAIN, "6p", { tsumo: true, dora: parseKinds("3z"), ura: parseKinds("9p") });
  expectWin(drawn, { yaku: { "menzen-tsumo": 1 }, han: 1 });
  assert.deepEqual(drawn.dora, { dora: 0, ura: 0, red: 0 });
  const inRiichi = win(PLAIN, "6p", { tsumo: true, riichi: 1, dora: parseKinds("3z"), ura: parseKinds("9p") });
  expectWin(inRiichi, { yaku: { riichi: 1, "menzen-tsumo": 1 }, han: 4 });
  assert.deepEqual(inRiichi.dora, { dora: 0, ura: 2, red: 0 });
  const double = win(PLAIN, "6p", { riichi: 2, ura: parseKinds("9p") });
  assert.deepEqual(double.dora, { dora: 0, ura: 2, red: 0 });
  assert.equal(double.han, 4);
});

test("dora: two indicators pointing at the same tile count it twice", () => {
  const result = win(PLAIN, "6p", { riichi: 1, dora: parseKinds("9p9p") });
  assert.deepEqual(result.dora, { dora: 4, ura: 0, red: 0 });
  assert.equal(result.han, 5);
});

test("dora: tiles in called sets count, four for a kan", () => {
  const kan = win(PLAIN_OPEN, "6p", { melds: [minkan("2222m")], tsumo: true, rinshan: true, dora: parseKinds("2m") });
  assert.deepEqual(kan.dora, { dora: 4, ura: 0, red: 0 });
  assert.equal(kan.han, 5);
  const closedKan = win(PLAIN_OPEN, "6p", { melds: [ankan("2222m")], riichi: 1, dora: parseKinds("3z"), ura: parseKinds("2m") });
  assert.deepEqual(closedKan.dora, { dora: 0, ura: 4, red: 0 });
  const run = win(PLAIN_OPEN, "6p", { melds: [chi("123m")], houtei: true, dora: parseKinds("2m9p") });
  assert.deepEqual(run.dora, { dora: 3, ura: 0, red: 0 });
  assert.equal(run.han, 4);
  const triplet = win("234m 567p 345s 88p", "6p", { melds: [pon("555z")], dora: parseKinds("5z") });
  assert.deepEqual(triplet.dora, { dora: 3, ura: 0, red: 0 });
  assert.equal(triplet.han, 4);
});

test("dora: red fives are counted as given, on seven pairs too", () => {
  expectWin(win("2244m 3355p 446688s", "8s", { redFives: 2, dora: parseKinds("5p") }), { yaku: { chiitoitsu: 2, tanyao: 1 }, han: 7, fu: 25, limit: "haneman" });
});

// ── 8. The wall ────────────────────────────────────────────────────────────

const SEED = "00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef";

test("wall: 136 different tile ids, 0 to 135", () => {
  for (const hand of [0, 1, 7]) {
    const wall = buildWall(SEED, hand);
    assert.equal(wall.length, 136);
    assert.equal(new Set(wall).size, 136);
    assert.deepEqual([...wall].sort((a, b) => a - b), Array.from({ length: 136 }, (_, id) => id));
  }
});

test("wall: the same seed and hand number always give the same wall", () => {
  assert.deepEqual(buildWall(SEED, 0), buildWall(SEED, 0));
  assert.deepEqual(buildWall(SEED, 5), buildWall(SEED, 5));
});

test("wall: every hand of a game has a different wall, and so does every seed", () => {
  const walls = new Set();
  for (let hand = 0; hand < 16; hand += 1) walls.add(buildWall(SEED, hand).join(","));
  assert.equal(walls.size, 16);
  const other = SEED.replace(/^00/, "01");
  assert.notDeepEqual(buildWall(other, 0), buildWall(SEED, 0));
  assert.notDeepEqual(buildWall(SEED, 0), Array.from({ length: 136 }, (_, id) => id), "it is shuffled");
});

test("wall: the published hash is the SHA-256 of the seed's 32 bytes", () => {
  const expected = crypto.createHash("sha256").update(Buffer.from(SEED, "hex")).digest("hex");
  assert.equal(seedHash(SEED), expected);
  assert.equal(Buffer.from(SEED, "hex").length, 32);
  // Thirty-two zero bytes have a well-known digest.
  assert.equal(seedHash("00".repeat(32)), "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925");
  assert.notEqual(seedHash(SEED), crypto.createHash("sha256").update(SEED).digest("hex"), "not the hash of the hex text");
});

test("wall: a new seed is 32 random bytes in hex, and only such a seed builds a wall", () => {
  const seed = newSeed();
  assert.match(seed, /^[0-9a-f]{64}$/);
  assert.notEqual(seed, newSeed());
  assert.equal(buildWall(seed, 0).length, 136);
  assert.throws(() => buildWall("abc", 0));
  assert.throws(() => buildWall(SEED.toUpperCase().replace(/[0-9]/g, "G"), 0));
});

test("wall: anyone can rebuild it from the published recipe", () => {
  // A Fisher-Yates shuffle of 0..135 from the last position down, each pick taken from four bytes
  // (big-endian) of SHA-256("<seed hex>|<hand>|<counter>"), throwing away values that would bias it.
  const rebuild = (seed, hand) => {
    const words = [];
    let counter = 0;
    const next = () => {
      if (!words.length) {
        const block = crypto.createHash("sha256").update(`${seed}|${hand}|${counter}`).digest();
        counter += 1;
        for (let at = 0; at < 32; at += 4) words.push(block.readUInt32BE(at));
      }
      return words.shift();
    };
    const wall = Array.from({ length: 136 }, (_, id) => id);
    for (let last = 135; last > 0; last -= 1) {
      const span = last + 1;
      const fair = 2 ** 32 - (2 ** 32 % span);
      let word = next();
      while (word >= fair) word = next();
      const pick = word % span;
      [wall[last], wall[pick]] = [wall[pick], wall[last]];
    }
    return wall;
  };
  for (const hand of [0, 1, 2, 11]) assert.deepEqual(buildWall(SEED, hand), rebuild(SEED, hand));
});

test("wall: the dead wall is the last 14 tiles: four replacements, five dora indicators, five ura", () => {
  assert.equal(wallModule.DEAD_WALL, 14);
  assert.equal(wallModule.LIVE_END, 122);
  assert.equal(wallModule.RINSHAN_START, 122);
  assert.equal(wallModule.DORA_START, 126);
  assert.equal(wallModule.URA_START, 131);
});
