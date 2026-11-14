// Independent scenario tests for one hand of riichi mahjong (round.js) and the match level (game.js).
// Written from standard riichi rules and docs/games/MAHJONG_DESIGN.md section 1, not from the code:
// every scenario scripts a stacked wall, plays moves, and checks what the rules say must happen.

const test = require("node:test");
const assert = require("node:assert/strict");

const round = require("../src/services/games/mahjong/round");
const gameLib = require("../src/services/games/mahjong/game");
const { stackWall } = require("../src/services/games/mahjong/stackedWall");
const { RINSHAN_START } = require("../src/services/games/mahjong/wall");
const { isRedFive, kindOf, parseKinds } = require("../src/services/games/mahjong/tiles");

const { act, createHand, optionsFor, waitingSeats, remaining, furitenOf, waits } = round;
const SCORES = [25000, 25000, 25000, 25000];

// Four hands that share no pair and no run, so nothing is ever offered to them by accident.
// No fives in them, so scenarios can use the three plain fives and the red one freely.
const JUNK = ["147m147p147s1234z", "268m268p268s1567z", "369m369p369s2345z", "379m379p379s4567z"];

/** A hand from a stacked wall. `hands` entries left out get junk. */
function mk({ hands = [], draws = "", dealer = 0, roundWind = 27, honba = 0, sticks = 0, scores = SCORES, rinshan = "", dora = "1p1s6p6s6m", ura = "", fill = 0 } = {}) {
  const full = [0, 1, 2, 3].map((seat) => hands[seat] ?? JUNK[seat]);
  full.forEach((text, seat) => assert.equal(parseKinds(text).length, 13, `seat ${seat} needs 13 tiles: ${text}`));
  const wall = stackWall({ dealer, hands: full, draws, rinshan, dora, ura, fill });
  return createHand({ wall, dealer, roundWind, honba, sticks, scores });
}

/** A tile id in the seat's hand: "5m" is a plain five, "0m" the red one. */
function has(state, seat, name) {
  const kind = parseKinds(name)[0];
  const red = name[0] === "0";
  const found = state.hands[seat].find((tile) => kindOf(tile) === kind && isRedFive(tile) === red) ?? state.hands[seat].find((tile) => kindOf(tile) === kind);
  assert.notEqual(found, undefined, `seat ${seat} holds no ${name}`);
  return found;
}
const discard = (state, seat, name, riichi = false) => act(state, seat, { type: "discard", tile: has(state, seat, name), riichi });
const tsumogiri = (state, riichi = false) => act(state, state.turn, { type: "discard", tile: state.drawn, riichi });
/** Everyone still being asked passes. */
function passAll(state) {
  while (state.phase === "calls") for (const seat of waitingSeats(state)) act(state, seat, { type: "pass" });
}
const illegal = (fn) => assert.throws(fn, (error) => error.code === "illegal_action");
const kinds = (tiles) => tiles.map(kindOf).sort((a, b) => a - b);
const K = (text) => parseKinds(text).sort((a, b) => a - b);
const sum = (list) => list.reduce((total, value) => total + value, 0);

// A tenpai shape with tanyao: 234m 456p 345s 88s 67m, waiting on 5m and 8m.
const TANYAO_67M = "234m456p345s88s67m";

// ── 1. Turn basics ─────────────────────────────────────────────────────────
test("the dealer starts with 14 tiles and the turn; the others have 13", () => {
  const state = mk({ draws: "5m" });
  assert.equal(state.hands[0].length, 14);
  for (const seat of [1, 2, 3]) assert.equal(state.hands[seat].length, 13);
  assert.equal(state.turn, 0);
  assert.equal(state.phase, "turn");
  assert.deepEqual(waitingSeats(state), [0]);
  assert.equal(remaining(state), 122 - 53);
  assert.equal(optionsFor(state, 1), null);
});

test("a dealer other than seat 0 deals to themselves first and draws first", () => {
  const state = mk({ dealer: 2, draws: "5m" });
  assert.equal(state.turn, 2);
  assert.equal(state.hands[2].length, 14);
  assert.equal(round.seatWind(state, 2), 27);
  assert.equal(round.seatWind(state, 3), 28);
  assert.equal(round.seatWind(state, 1), 30);
});

test("illegal moves throw illegal_action: wrong seat, tile not in hand, hand over", () => {
  const state = mk({ draws: "5m" });
  illegal(() => act(state, 1, { type: "discard", tile: state.hands[1][0] }));
  illegal(() => act(state, 2, { type: "tsumo" }));
  illegal(() => act(state, 0, { type: "discard", tile: state.hands[1][0] })); // somebody else's tile
  illegal(() => act(state, 0, { type: "discard", tile: 135 })); // in the wall
  illegal(() => act(state, 0, { type: "discard" }));
  illegal(() => act(state, 0, { type: "tsumo" })); // nothing to win
  illegal(() => act(state, 0, { type: "ankan", kind: 0 }));
  illegal(() => act(state, 0, { type: "kakan", kind: 0 }));
  illegal(() => act(state, 0, { type: "kyuushu" }));
  illegal(() => act(state, 0, { type: "pass" })); // nothing to answer, it is a turn
  illegal(() => act(state, 0, { type: "dance" }));
  illegal(() => act(state, 0, null));
  illegal(() => act(state, 0, { type: "discard", tile: state.drawn, riichi: true })); // not tenpai
  // The hand is still exactly as it was.
  assert.equal(state.hands[0].length, 14);
  assert.equal(state.phase, "turn");

  const over = mk({ hands: ["19m19p19s1234567z"], draws: "7z" });
  act(over, 0, { type: "kyuushu" });
  assert.equal(over.phase, "over");
  illegal(() => act(over, 0, { type: "discard", tile: over.hands[0][0] }));
  illegal(() => act(over, 1, { type: "pass" }));
  assert.deepEqual(waitingSeats(over), []);
});

test("after a discard the turn passes to the next seat, who draws", () => {
  const state = mk({ draws: "5m6m" });
  tsumogiri(state);
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 1);
  assert.equal(state.hands[1].length, 14);
  assert.equal(kindOf(state.drawn), K("6m")[0]);
  illegal(() => act(state, 0, { type: "discard", tile: state.hands[0][0] }));
});

// ── 2. Calls ───────────────────────────────────────────────────────────────
const CHI_HAND = "344667m369p1234z";

test("chi is offered only to the seat on the discarder's left, with every shape", () => {
  const state = mk({ hands: [, CHI_HAND, "55m258p258s12567z"], draws: "5m" });
  tsumogiri(state);
  assert.equal(state.phase, "calls");
  const mine = optionsFor(state, 1);
  assert.equal(mine.chi.length, 3);
  const shapes = mine.chi.map((pair) => kinds(pair).join(",")).sort();
  assert.deepEqual(shapes, [K("34m").join(","), K("46m").join(","), K("67m").join(",")].sort());
  assert.equal(mine.pon, undefined);
  // Seat 2 holds a pair of fives but is not on the left: pon yes, chi no.
  const other = optionsFor(state, 2);
  assert.ok(other.pon);
  assert.equal(other.chi, undefined);
  assert.equal(optionsFor(state, 3), null);
});

test("each chi shape takes the right tiles and bans the right discards", () => {
  const bans = { "34m": ["5m", "2m"], "46m": ["5m"], "67m": ["5m", "8m"] };
  for (const [shape, banned] of Object.entries(bans)) {
    const state = mk({ hands: [, CHI_HAND], draws: "5m" });
    tsumogiri(state);
    const pair = optionsFor(state, 1).chi.find((entry) => kinds(entry).join(",") === K(shape).join(","));
    assert.ok(pair, shape);
    act(state, 1, { type: "chi", tiles: pair });
    assert.equal(state.phase, "turn");
    assert.equal(state.turn, 1);
    assert.equal(state.melds[1][0].type, "chi");
    assert.deepEqual(kinds(state.melds[1][0].tiles), K(`${shape}5m`));
    assert.equal(state.ponds[0][0].called, true);
    assert.equal(state.hands[1].length, 11);
    const allowed = optionsFor(state, 1).discards.map(kindOf);
    for (const name of banned) assert.ok(!allowed.includes(K(name)[0]), `${shape}: ${name} must be banned`);
    // Another tile is fine.
    assert.ok(allowed.includes(K("3p")[0]));
    for (const name of banned) {
      if (state.hands[1].some((tile) => kindOf(tile) === K(name)[0])) illegal(() => discard(state, 1, name));
    }
  }
});

test("chi from a seat that is not on the left is refused", () => {
  const state = mk({ hands: [, , CHI_HAND], draws: "5m" });
  tsumogiri(state);
  // Seat 2 would have shapes, but is not on the discarder's left.
  assert.equal(optionsFor(state, 2), null);
  illegal(() => act(state, 2, { type: "chi", tiles: [state.hands[2][0], state.hands[2][1]] }));
  assert.equal(state.phase, "turn"); // nobody could call: seat 1 just drew
  assert.equal(state.turn, 1);
});

test("pon works from each position and the turn moves to the caller", () => {
  for (const caller of [1, 2, 3]) {
    const hands = [];
    hands[caller] = "55m258p258s12567z".replace(/258p258s/, caller === 1 ? "258p258s" : "258p258s");
    const state = mk({ hands, draws: "5m" });
    tsumogiri(state);
    assert.equal(state.phase, "calls");
    const options = optionsFor(state, caller);
    assert.equal(options.pon.length, 1);
    act(state, caller, { type: "pon", tiles: options.pon[0] });
    assert.equal(state.phase, "turn", `caller ${caller}`);
    assert.equal(state.turn, caller);
    assert.equal(state.melds[caller][0].type, "pon");
    assert.equal(state.melds[caller][0].from, 0);
    assert.equal(state.ponds[0][0].called, true);
    assert.equal(state.hands[caller].length, 11);
    assert.equal(state.drawn, null);
    // Skipped seats don't draw; after the pon discard the next seat after the caller draws.
    const before = state.hands.map((hand) => hand.length);
    discard(state, caller, "8p");
    passAll(state);
    assert.equal(state.turn, (caller + 1) % 4);
    assert.equal(state.hands[(caller + 1) % 4].length, before[(caller + 1) % 4] + 1);
  }
});

test("an open kan takes three from the hand, draws a replacement and shortens the wall", () => {
  const state = mk({ hands: [, "555m258p258s1567z"], draws: "0m", rinshan: "9z" });
  const before = remaining(state);
  tsumogiri(state);
  const options = optionsFor(state, 1);
  assert.equal(options.kan, true);
  act(state, 1, { type: "kan" });
  assert.equal(state.melds[1][0].type, "minkan");
  assert.equal(state.melds[1][0].tiles.length, 4);
  assert.equal(state.turn, 1);
  assert.equal(state.phase, "turn");
  assert.equal(state.hands[1].length, 11); // 13 - 3 + replacement
  assert.equal(state.drawn, state.wall[RINSHAN_START]);
  assert.equal(remaining(state), before - 1);
  assert.equal(state.kans, 1);
});

test("priority: ron beats pon beats chi, in either order of answers, and a ron is waited for", () => {
  const hands = [, "46m258p258s12567z", "55m258p258s23456z", TANYAO_67M];
  const setup = () => mk({ hands, draws: "5m" });

  // The kinds on offer
  let state = setup();
  tsumogiri(state);
  assert.ok(optionsFor(state, 1).chi);
  assert.ok(optionsFor(state, 2).pon);
  assert.equal(optionsFor(state, 3).ron, true);

  // chi, pon, then ron: ron wins.
  state = setup();
  tsumogiri(state);
  act(state, 1, { type: "chi", tiles: optionsFor(state, 1).chi[0] });
  assert.equal(state.phase, "calls");
  act(state, 2, { type: "pon", tiles: optionsFor(state, 2).pon[0] });
  assert.equal(state.phase, "calls", "the hand must wait for the seat that could ron");
  assert.deepEqual(waitingSeats(state), [3]);
  act(state, 3, { type: "ron" });
  assert.equal(state.result.type, "win");
  assert.equal(state.result.wins[0].seat, 3);
  assert.equal(state.melds[1].length + state.melds[2].length, 0);

  // ron first: nothing else is needed.
  state = setup();
  tsumogiri(state);
  act(state, 3, { type: "ron" });
  assert.equal(state.phase, "over");
  assert.equal(state.result.wins[0].from, 0);

  // ron passed, pon answered, chi pending: pon beats chi without waiting for it.
  state = setup();
  tsumogiri(state);
  act(state, 3, { type: "pass" });
  act(state, 2, { type: "pon", tiles: optionsFor(state, 2).pon[0] });
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 2);
  assert.equal(state.melds[2][0].type, "pon");
  assert.equal(state.melds[1].length, 0);

  // pon answered first: not through until the ron seat answers.
  state = setup();
  tsumogiri(state);
  act(state, 2, { type: "pon", tiles: optionsFor(state, 2).pon[0] });
  assert.equal(state.phase, "calls");
  assert.equal(state.melds[2].length, 0);
  act(state, 3, { type: "pass" });
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 2);

  // chi answered first, then the rest pass: chi is made only once the others have said no.
  state = setup();
  tsumogiri(state);
  act(state, 1, { type: "chi", tiles: optionsFor(state, 1).chi[0] });
  assert.equal(state.melds[1].length, 0);
  act(state, 3, { type: "pass" });
  assert.equal(state.melds[1].length, 0, "seat 2 could still pon");
  act(state, 2, { type: "pass" });
  assert.equal(state.melds[1][0].type, "chi");

  // all pass: the next seat draws.
  state = setup();
  tsumogiri(state);
  passAll(state);
  assert.equal(state.turn, 1);
  assert.equal(state.phase, "turn");
});

test("passing on a pon or chi and a bad call tiles are handled", () => {
  const state = mk({ hands: [, "46m258p258s12567z", "55m258p258s23456z"], draws: "5m" });
  tsumogiri(state);
  illegal(() => act(state, 1, { type: "chi", tiles: [state.hands[1][2], state.hands[1][3]] })); // not a run with 5m
  illegal(() => act(state, 1, { type: "pon", tiles: [state.hands[1][2], state.hands[1][3]] }));
  illegal(() => act(state, 1, { type: "ron" }));
  illegal(() => act(state, 1, { type: "kan" }));
  illegal(() => act(state, 0, { type: "pass" })); // the discarder isn't asked
  illegal(() => act(state, 3, { type: "pass" })); // nor is a seat with no option
  act(state, 1, { type: "pass" });
  illegal(() => act(state, 1, { type: "pass" })); // already answered
});

test("swap-calling: after a pon you can't discard the same kind (red copy included)", () => {
  const state = mk({ hands: [, "550m258p258s1567z"], draws: "5m" }); // 5m 5m 0m
  tsumogiri(state);
  const options = optionsFor(state, 1);
  assert.equal(options.pon.length, 2, "plain+plain and red+plain");
  const plain = options.pon.find((pair) => pair.every((tile) => !isRedFive(tile)));
  act(state, 1, { type: "pon", tiles: plain });
  // The red five stays in the hand but may not go.
  const red = state.hands[1].find(isRedFive);
  assert.notEqual(red, undefined);
  illegal(() => act(state, 1, { type: "discard", tile: red }));
  assert.ok(!optionsFor(state, 1).discards.includes(red));
  assert.ok(optionsFor(state, 1).discards.includes(has(state, 1, "8p")));
});

test("swap-calling: after a chi you can't discard the tile at the other end of the run", () => {
  // Chi 4m with 2m3m makes 234m: the 1m is the other end and can't go either.
  const state = mk({ hands: [, "123m258p268s1567z"], draws: "4m" });
  tsumogiri(state);
  const pair = optionsFor(state, 1).chi.find((entry) => kinds(entry).join(",") === K("23m").join(","));
  act(state, 1, { type: "chi", tiles: pair });
  illegal(() => discard(state, 1, "1m"));
  assert.ok(!optionsFor(state, 1).discards.includes(has(state, 1, "1m")));
  discard(state, 1, "2p");
});

test("only ron on the last discard: no pon, chi or kan", () => {
  const state = mk({ hands: [, "46m258p258s12567z", "55m258p258s23456z", TANYAO_67M], draws: "5m" });
  state.livePos = state.liveEnd; // the dealer's draw was the last tile
  assert.equal(remaining(state), 0);
  tsumogiri(state);
  assert.equal(optionsFor(state, 1), null);
  assert.equal(optionsFor(state, 2), null);
  const ron = optionsFor(state, 3);
  assert.equal(ron.ron, true);
  assert.equal(ron.pon, undefined);
  assert.equal(ron.chi, undefined);
  act(state, 3, { type: "ron" });
  // Houtei counts.
  assert.ok(state.result.wins[0].yaku.some((entry) => entry.key === "houtei"));
});

test("a seat in riichi can't pon, chi or kan", () => {
  const state = mk({ hands: [, "46m258p258s12567z", "55m258p258s23456z"], draws: "5m" });
  state.riichi[1] = 1; // as if declared earlier; the hand is closed
  state.riichi[2] = 1;
  tsumogiri(state);
  // Nothing was offered: seat 1 simply drew (its options are the turn's, not a call).
  assert.equal(optionsFor(state, 1).phase, "turn");
  assert.equal(optionsFor(state, 2), null);
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 1);
  assert.equal(state.melds[2].length, 0);
});

/** Plays tsumogiri and passes until it is `seat`'s turn to act (or the hand ends). */
function until(state, seat) {
  let guard = 0;
  while (state.phase !== "over" && !(state.phase === "turn" && state.turn === seat)) {
    if (state.phase === "turn") tsumogiri(state);
    else passAll(state);
    guard += 1;
    assert.ok(guard < 500);
  }
}
// Fillers with no 1m to 4m in them, for scenarios that use those.
const NO_LOW_M = [, , "147p258s1234567z", "369p369s1234567z"];

// ── 3. Kans ────────────────────────────────────────────────────────────────
test("a closed kan draws a replacement, shortens the live wall by one and turns its indicator at once", () => {
  const state = mk({ hands: ["1111m28p268s1234z"], draws: "9p", rinshan: "3p", dora: "2m3m4m6m7m" });
  const before = remaining(state);
  assert.deepEqual(optionsFor(state, 0).ankan, [K("1m")[0]]);
  act(state, 0, { type: "ankan", kind: K("1m")[0] });
  assert.equal(state.melds[0][0].type, "ankan");
  assert.equal(state.melds[0][0].tiles.length, 4);
  assert.equal(state.hands[0].length, 11);
  assert.equal(state.drawn, state.wall[RINSHAN_START]);
  assert.equal(kindOf(state.drawn), K("3p")[0]);
  assert.equal(remaining(state), before - 1);
  assert.equal(round.doraIndicators(state).length, 2, "closed kan: the new indicator shows immediately");
  assert.equal(state.turn, 0);
  assert.equal(state.phase, "turn");
});

test("an added kan draws a replacement, shortens the wall, and turns its indicator only after the discard", () => {
  const hands = [, "55m258p268s12567z"];
  const state = mk({ hands, draws: "5m5s2z3z0m", rinshan: "9p", dora: "2m3m4m6m7m" });
  // The pon: seat 1 takes seat 0's 5m.
  tsumogiri(state);
  act(state, 1, { type: "pon", tiles: optionsFor(state, 1).pon[0] });
  discard(state, 1, "8p");
  passAll(state);
  until(state, 1);
  assert.equal(kindOf(state.drawn), K("5m")[0]);
  assert.ok(isRedFive(state.drawn));
  assert.deepEqual(optionsFor(state, 1).kakan, [K("5m")[0]]);
  const before = remaining(state);
  act(state, 1, { type: "kakan", kind: K("5m")[0] });
  assert.equal(state.melds[1][0].type, "kakan");
  assert.equal(state.melds[1][0].tiles.length, 4);
  assert.equal(remaining(state), before - 1);
  assert.equal(state.turn, 1);
  assert.equal(state.drawn, state.wall[RINSHAN_START]);
  assert.equal(round.doraIndicators(state).length, 1, "added kan: indicator waits for the discard");
  tsumogiri(state);
  assert.equal(round.doraIndicators(state).length, 2, "...and turns after the discard");
});

test("an open kan turns its indicator only after the discard that follows", () => {
  const state = mk({ hands: [, "555m258p268s1567z"], draws: "0m", rinshan: "9p", dora: "2m3m4m6m7m" });
  tsumogiri(state);
  act(state, 1, { type: "kan" });
  assert.equal(round.doraIndicators(state).length, 1);
  discard(state, 1, "2p");
  assert.equal(round.doraIndicators(state).length, 2);
});

test("a pending indicator turns before the next kan", () => {
  // Seat 1 takes an open kan, then at once makes a closed kan with the replacement-drawn hand.
  const state = mk({ hands: [, "555m2222p268s1567z".slice(0, 0) + "555m2222p68s1567z"], draws: "0m", rinshan: "9p3s", dora: "2m3m4m6m7m" });
  tsumogiri(state);
  act(state, 1, { type: "kan" });
  assert.equal(round.doraIndicators(state).length, 1);
  assert.deepEqual(optionsFor(state, 1).ankan, [K("2p")[0]]);
  act(state, 1, { type: "ankan", kind: K("2p")[0] });
  assert.equal(round.doraIndicators(state).length, 3, "pending one first, then the closed kan's own");
});

// Fillers with no m tiles and few honors, for the scenarios that spend many 1m to 4m.
const JB = [, "14p25p36p47s58s9s13z", "47p58p69p14s25s36s2z", "17p28p39p17s28s39s4z"];

test("a kan's replacement tile that wins is scored with the pending indicator already turned (open kan)", () => {
  // Seat 1: 555m, 234p, 678p, 44s, 88s. Takes the red five as an open kan; the replacement 4s wins.
  // Indicator 1 (1p) points at 2p; indicator 2 (3s) points at 4s: three dora only if it turned first.
  const state = mk({ hands: [, "555m234p678p44s88s"], draws: "0m", rinshan: "4s", dora: "1p3s1s1s1s" });
  tsumogiri(state);
  act(state, 1, { type: "kan" });
  assert.equal(round.doraIndicators(state).length, 1);
  assert.equal(optionsFor(state, 1).tsumo, true);
  act(state, 1, { type: "tsumo" });
  const win = state.result.wins[0];
  assert.ok(win.yaku.some((entry) => entry.key === "rinshan"));
  assert.equal(win.dora.dora, 4); // 444s three times, plus the 2p of 234p
  assert.equal(win.dora.red, 1);
  assert.equal(win.han, 7); // rinshan, tanyao, red five, four dora
  assert.deepEqual(state.result.deltas, [-6000, 12000, -3000, -3000]);
  assert.equal(state.result.dora.length, 2);
});

test("rinshan kaihou after a closed kan", () => {
  const state = mk({ hands: ["111m234p678p44s88s"], draws: "1m", rinshan: "4s" });
  act(state, 0, { type: "ankan", kind: K("1m")[0] });
  act(state, 0, { type: "tsumo" });
  const win = state.result.wins[0];
  const keys = win.yaku.map((entry) => entry.key);
  assert.ok(keys.includes("rinshan") && keys.includes("menzen-tsumo"), keys.join());
  assert.ok(!keys.includes("haitei"));
});

test("chankan: an added kan can be robbed by a seat waiting on that tile", () => {
  const hands = [, "55m258p268s12567z", "234m456p345s88s6m2z"];
  const state = mk({ hands, draws: "5m7m1z3p0m", rinshan: "9p" });
  tsumogiri(state); // 5m
  act(state, 1, { type: "pon", tiles: optionsFor(state, 1).pon[0] });
  discard(state, 1, "8p");
  passAll(state);
  discard(state, 2, "2z");
  passAll(state);
  until(state, 1);
  assert.ok(isRedFive(state.drawn));
  assert.deepEqual(waits(state, 2).sort((a, b) => a - b), K("58m"));
  act(state, 1, { type: "kakan", kind: K("5m")[0] });
  assert.equal(state.phase, "calls");
  assert.deepEqual(waitingSeats(state), [2]);
  assert.equal(optionsFor(state, 2).ron, true);
  assert.equal(optionsFor(state, 2).pon, undefined);
  const kansBefore = state.kans;
  act(state, 2, { type: "ron" });
  assert.equal(state.phase, "over");
  const win = state.result.wins[0];
  assert.equal(win.seat, 2);
  assert.equal(win.from, 1);
  assert.ok(win.yaku.some((entry) => entry.key === "chankan"));
  assert.equal(state.kans, kansBefore, "the robbed kan never happens");
  assert.equal(state.rinshanUsed, 0);
  assert.equal(win.han, 4); // chankan, tanyao, pinfu, red five
  assert.equal(win.fu, 30);
  assert.deepEqual(state.result.deltas, [0, -7700, 7700, 0]); // 4 han 30 fu
});

test("a closed kan can't be robbed, even by thirteen orphans waiting on the tile", () => {
  const state = mk({ hands: ["111m258p268s1234z", , "99m19p19s1234567z"], draws: "1m" });
  assert.deepEqual(waits(state, 2), K("1m"));
  act(state, 0, { type: "ankan", kind: K("1m")[0] });
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 0);
  assert.equal(optionsFor(state, 2), null);
  assert.equal(state.melds[0][0].type, "ankan");
});

test("no fifth kan: a closed, added or open kan is refused once four are down", () => {
  const state = mk({ hands: ["1111m28p268s1234z", "555m258p268s1567z"], draws: "9p" });
  state.kans = 4;
  state.kanSeats = [4, 0, 0, 0];
  assert.deepEqual(optionsFor(state, 0).ankan, []);
  illegal(() => act(state, 0, { type: "ankan", kind: K("1m")[0] }));
  state.drawn = null; // keep the position simple: discard the drawn tile
  const open = mk({ hands: [, "555m258p268s1567z"], draws: "0m" });
  open.kans = 4;
  open.kanSeats = [4, 0, 0, 0];
  tsumogiri(open);
  assert.equal(optionsFor(open, 1).kan, undefined);
  assert.ok(optionsFor(open, 1).pon, "a pon is still fine");
  illegal(() => act(open, 1, { type: "kan" }));
});

test("four kans by two players abort the hand once the next discard goes by", () => {
  const hands = ["1111m2222m47p123z", "3333m4444m58p456z", JB[2], JB[3]];
  const state = mk({ hands, draws: "9p9s", rinshan: "6p6p7s7s"});
  act(state, 0, { type: "ankan", kind: K("1m")[0] });
  act(state, 0, { type: "ankan", kind: K("2m")[0] });
  assert.equal(state.kans, 2);
  tsumogiri(state);
  passAll(state);
  assert.equal(state.turn, 1);
  act(state, 1, { type: "ankan", kind: K("3m")[0] });
  act(state, 1, { type: "ankan", kind: K("4m")[0] });
  assert.equal(state.kans, 4);
  assert.equal(state.phase, "turn", "not aborted until the discard goes by");
  assert.deepEqual(state.kanSeats, [2, 2, 0, 0]);
  tsumogiri(state);
  assert.equal(state.phase, "over");
  assert.equal(state.result.type, "draw");
  assert.equal(state.result.reason, "suukan");
  assert.deepEqual(state.result.deltas, [0, 0, 0, 0]);
  assert.equal(state.result.renchan, true);
  assert.equal(state.result.honba_next, 1);
});

function fourKansByOne() {
  return mk({ hands: ["1111m2222m3333m4m", JB[1], JB[2], JB[3]], draws: "4m", rinshan: "4m4m7z7z"});
}

test("four kans by one player do not abort the hand", () => {
  const state = fourKansByOne();
  for (const name of ["1m", "2m", "3m", "4m"]) act(state, 0, { type: "ankan", kind: K(name)[0] });
  assert.equal(state.kans, 4);
  assert.equal(state.phase, "turn");
  assert.deepEqual(optionsFor(state, 0).ankan, []);
  tsumogiri(state);
  assert.notEqual(state.phase, "over");
  passAll(state);
  assert.equal(state.turn, 1);
});

test("four kans by one player and a self-draw win is four kans (suukantsu)", () => {
  const state = fourKansByOne();
  for (const name of ["1m", "2m", "3m", "4m"]) act(state, 0, { type: "ankan", kind: K(name)[0] });
  assert.equal(optionsFor(state, 0).tsumo, true);
  act(state, 0, { type: "tsumo" });
  const win = state.result.wins[0];
  assert.ok(win.yaku.some((entry) => entry.key === "suukantsu"));
  assert.ok(win.yaku.some((entry) => entry.key === "suuankou"), "four closed kans are four concealed triplets too");
  assert.equal(win.yakuman, 2);
  assert.deepEqual(state.result.deltas, [96000, -32000, -32000, -32000]);
});

test("a closed kan in riichi: allowed when the waits and the reading stay the same", () => {
  const state = mk({ hands: ["111m234p567p789s5z"], draws: "6z9p9s2s1m" });
  discard(state, 0, "6z", true);
  passAll(state);
  until(state, 0);
  assert.equal(state.scores[0], 24000);
  assert.equal(kindOf(state.drawn), K("1m")[0]);
  assert.deepEqual(optionsFor(state, 0).ankan, [K("1m")[0]]);
  act(state, 0, { type: "ankan", kind: K("1m")[0] });
  assert.equal(state.melds[0][0].type, "ankan");
  assert.deepEqual(waits(state, 0, round.restingHand(state, 0)), K("5z"));
});

test("a closed kan in riichi: refused when it would change the waits", () => {
  const state = mk({ hands: ["3334m234p567p789s", , JB[2], JB[3]], draws: "9z".replace("9z", "7z") + "9p9s2s3m" });
  // 3334m waits on 2m and 5m; making a quad of 3m would leave a bare 4m.
  assert.deepEqual(waits(state, 0).sort((a, b) => a - b), []); // 13 tiles + draw: not yet resting
  discard(state, 0, "7z", true);
  passAll(state);
  until(state, 0);
  assert.equal(kindOf(state.drawn), K("3m")[0]);
  assert.deepEqual(optionsFor(state, 0).ankan, []);
  illegal(() => act(state, 0, { type: "ankan", kind: K("3m")[0] }));
  assert.deepEqual(optionsFor(state, 0).discards, [state.drawn]);
});

// ── 4. Riichi ──────────────────────────────────────────────────────────────
test("riichi needs a closed tenpai hand, 1,000 points and four tiles left to draw", () => {
  const fresh = (extra = {}) => mk({ hands: [TANYAO_67M], draws: "9p", ...extra });
  let state = fresh();
  assert.ok(optionsFor(state, 0).riichi.includes(state.drawn), "the drawn tile can be thrown with riichi");
  assert.equal(optionsFor(state, 0).riichi.length, 1);

  // 1,000 points exactly is enough, 900 is not.
  state = fresh({ scores: [1000, 25000, 25000, 25000] });
  assert.ok(optionsFor(state, 0).riichi.length > 0);
  state = fresh({ scores: [900, 25000, 25000, 25000] });
  assert.deepEqual(optionsFor(state, 0).riichi, []);
  illegal(() => act(state, 0, { type: "discard", tile: state.drawn, riichi: true }));

  // Four tiles left is enough, three is not.
  state = fresh();
  state.livePos = state.liveEnd - 4;
  assert.ok(optionsFor(state, 0).riichi.length > 0);
  state = fresh();
  state.livePos = state.liveEnd - 3;
  assert.deepEqual(optionsFor(state, 0).riichi, []);

  // Not tenpai.
  state = mk({ draws: "9p" });
  assert.deepEqual(optionsFor(state, 0).riichi, []);
  illegal(() => act(state, 0, { type: "discard", tile: state.drawn, riichi: true }));
});

test("an open hand can't declare riichi", () => {
  // Seat 1 pons the 5m, then is tenpai on 5z with an open hand.
  const state = mk({ hands: [, "55m234p567p789s56z"], draws: "5m9p9s2s9p" });
  tsumogiri(state);
  act(state, 1, { type: "pon", tiles: optionsFor(state, 1).pon[0] });
  discard(state, 1, "6z");
  passAll(state);
  until(state, 1);
  assert.ok(waits(state, 1, round.restingHand(state, 1)).length > 0);
  assert.deepEqual(optionsFor(state, 1).riichi, []);
  illegal(() => act(state, 1, { type: "discard", tile: state.drawn, riichi: true }));
});

test("a closed kan keeps the hand closed", () => {
  const state = mk({ hands: ["111m234p567p789s5z"], draws: "1m" });
  assert.ok(round.isClosed(state, 0));
  act(state, 0, { type: "ankan", kind: K("1m")[0] });
  assert.ok(round.isClosed(state, 0));
});

test("the riichi stick is paid only when the riichi discard isn't won on", () => {
  // Safe discard: 1,000 leaves the hand and sits on the table.
  let state = mk({ hands: [TANYAO_67M], draws: "9p6z" });
  tsumogiri(state, true);
  passAll(state);
  assert.equal(state.scores[0], 24000);
  assert.equal(state.sticks, 1);
  assert.equal(state.riichi[0], 2);

  // Won on: seat 1 waits on the riichi tile; no stick changes hands.
  state = mk({ hands: ["111m234p567p789s5z", TANYAO_67M], draws: "5m" });
  assert.ok(optionsFor(state, 0).riichi.includes(has(state, 0, "5m")));
  discard(state, 0, "5m", true);
  assert.deepEqual(waitingSeats(state), [1]);
  assert.equal(state.scores[0], 25000, "not paid while the answer is pending");
  act(state, 1, { type: "ron" });
  assert.equal(state.sticks, 0);
  assert.equal(state.result.scores[0], 25000 - 2000);
  assert.equal(state.result.scores[1], 25000 + 2000);
  assert.equal(sum(state.result.scores), 100000);
  assert.equal(state.result.wins[0].sticks, 0);
  assert.deepEqual(state.result.ura, [], "ura is only for a winner who is in riichi");
});

test("double riichi is worth two han", () => {
  const state = mk({ hands: [, TANYAO_67M], draws: "6z9p2s9s4z5m" });
  tsumogiri(state);
  tsumogiri(state, true);
  passAll(state);
  until(state, 1);
  act(state, 1, { type: "tsumo" });
  const win = state.result.wins[0];
  assert.deepEqual(win.yaku.map((entry) => entry.key).sort(), ["double-riichi", "ippatsu", "menzen-tsumo", "pinfu", "tanyao"]);
  assert.equal(win.han, 6);
});

test("a riichi discard that is passed on is paid when the calls resolve", () => {
  const state = mk({ hands: ["111m234p567p789s5z", TANYAO_67M], draws: "5m" });
  discard(state, 0, "5m", true);
  act(state, 1, { type: "pass" });
  assert.equal(state.scores[0], 24000);
  assert.equal(state.sticks, 1);
  assert.equal(furitenOf(state, 1), "passed");
});

test("double riichi on the first discard with no calls; a plain riichi after a call or later", () => {
  // First go-around, no calls: double.
  let state = mk({ hands: [, TANYAO_67M], draws: "6z9p" });
  tsumogiri(state);
  tsumogiri(state, true);
  assert.equal(state.riichi[1], 2);

  // A call before it: single.
  state = mk({ hands: [, , "55m258p258s23456z", TANYAO_67M], draws: "5m1z9p" });
  tsumogiri(state); // 5m
  act(state, 3, { type: "pass" }); // seat 3 waits on 5m but lets it go
  act(state, 2, { type: "pon", tiles: optionsFor(state, 2).pon[0] });
  discard(state, 2, "8p");
  passAll(state);
  assert.equal(state.turn, 3);
  tsumogiri(state, true);
  passAll(state);
  assert.equal(state.riichi[3], 1);

  // A later discard: single.
  state = mk({ hands: [, "234m456p345s88s6m2z"], draws: "6z3z2s9s4z7m" });
  for (let i = 0; i < 5; i += 1) tsumogiri(state); // seat 1's first discard (3z) is among these
  discard(state, 1, "2z", true);
  assert.equal(state.riichi[1], 1);
});

// Seat 1 riichi on its second discard. Draws: 6z (s0) 3z (s1) 2s 9s 4z 7m (s1, riichi), then `lap`.
function riichiHand(lap, extra = {}) {
  const state = mk({ hands: [, "234m456p345s88s6m2z"], draws: "6z3z2s9s4z7m" + lap, ...extra });
  for (let i = 0; i < 5; i += 1) tsumogiri(state);
  discard(state, 1, "2z", true);
  passAll(state);
  return state;
}

test("after riichi only the drawn tile can be discarded", () => {
  const state = riichiHand("1s2p9p2p");
  until(state, 1);
  assert.equal(state.scores[1], 24000);
  const options = optionsFor(state, 1);
  assert.deepEqual(options.discards, [state.drawn]);
  const other = state.hands[1].find((tile) => tile !== state.drawn);
  illegal(() => act(state, 1, { type: "discard", tile: other }));
  assert.deepEqual(options.riichi, []);
});

test("ippatsu: a tsumo on the first draw after riichi, with ura only for the riichi winner", () => {
  const state = riichiHand("1s2p9p5m", { ura: "3m" });
  until(state, 1);
  assert.equal(optionsFor(state, 1).tsumo, true);
  act(state, 1, { type: "tsumo" });
  const win = state.result.wins[0];
  const keys = win.yaku.map((entry) => entry.key).sort();
  assert.deepEqual(keys, ["ippatsu", "menzen-tsumo", "pinfu", "riichi", "tanyao"]);
  assert.equal(win.dora.ura, 1, "ura indicator 3m points at the 4m of 234m");
  assert.equal(state.result.ura.length, 1);
  assert.equal(win.han, 6);
  assert.equal(win.sticks, 1000, "the winner's own stick comes back");
  // Haneman by self-draw, non-dealer: dealer pays 6,000, the others 3,000, plus the stick.
  assert.deepEqual(state.result.deltas, [-6000, 13000, -3000, -3000]);
  assert.equal(state.result.scores[1], 25000 - 1000 + 13000);
});

test("ippatsu is gone after the seat's own next discard", () => {
  const state = riichiHand("1s2p9p4s1p2p9p5m");
  until(state, 1);
  assert.equal(state.ippatsu[1], true);
  tsumogiri(state);
  assert.equal(state.ippatsu[1], false);
  until(state, 1);
  act(state, 1, { type: "tsumo" });
  const keys = state.result.wins[0].yaku.map((entry) => entry.key);
  assert.ok(keys.includes("riichi") && !keys.includes("ippatsu"));
});

test("ippatsu is lost to a pon in between", () => {
  const state = riichiHand("9p5m", { hands: [, "234m456p345s88s6m2z", , "99p258p258s12567z"] });
  assert.equal(state.ippatsu[1], true);
  assert.equal(state.turn, 2);
  tsumogiri(state); // seat 2 throws the 9p, seat 3 can pon
  assert.equal(state.phase, "calls");
  act(state, 3, { type: "pon", tiles: optionsFor(state, 3).pon[0] });
  assert.equal(state.ippatsu[1], false);
});

test("ippatsu is lost to a closed kan by anyone", () => {
  const state = riichiHand("1s1m5m", { hands: ["258m147p147s1234z", "234m456p345s88s6m2z", , "111m258p258s1567z"], rinshan: "9p" });
  assert.equal(state.ippatsu[1], true);
  tsumogiri(state); // seat 2 draws 1s
  passAll(state);
  assert.equal(state.turn, 3);
  act(state, 3, { type: "ankan", kind: K("1m")[0] });
  assert.equal(state.ippatsu[1], false);
});

// ── 5. Furiten ─────────────────────────────────────────────────────────────
test("furiten by own discard, even a tile another player took: no ron, tsumo still works", () => {
  // Seat 1 throws a 5m (seat 2 pons it), and is then waiting on 5m and 8m with 67m.
  const state = mk({ hands: [, "234m456p345s88s5m6m", "55m258p258s23456z"], draws: "6z7m9s8m8m" });
  tsumogiri(state);
  discard(state, 1, "5m");
  act(state, 2, { type: "pon", tiles: optionsFor(state, 2).pon[0] });
  assert.equal(state.ponds[1][0].called, true);
  discard(state, 2, "8p");
  passAll(state);
  tsumogiri(state); // seat 3
  passAll(state);
  // Seat 0 throws the 8m: a complete hand for seat 1, but it is furiten.
  const eight = state.drawn;
  assert.equal(kindOf(eight), K("8m")[0]);
  assert.notEqual(round.readWin(state, 1, eight, { tsumo: false }), null, "the shape is complete");
  assert.equal(furitenOf(state, 1), "discard");
  tsumogiri(state);
  assert.equal(optionsFor(state, 1)?.ron, undefined, "no ron is offered (a chi is, which it declines)");
  passAll(state);
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 1);
  assert.ok(furitenOf(state, 1));
  // The 8m it draws itself wins.
  assert.equal(kindOf(state.drawn), K("8m")[0]);
  assert.equal(optionsFor(state, 1).tsumo, true);
  act(state, 1, { type: "tsumo" });
  assert.equal(state.result.wins[0].seat, 1);
});

test("furiten by passing: the rest of the go-around, and it ends with the seat's own discard", () => {
  // Seat 2 is waiting on 5m and 8m with a yaku, and lets seat 0's 5m go.
  let state = mk({ hands: [, , TANYAO_67M], draws: "5m8m8m" });
  tsumogiri(state);
  assert.equal(optionsFor(state, 2).ron, true);
  act(state, 2, { type: "pass" });
  assert.equal(furitenOf(state, 2), "passed");
  tsumogiri(state); // seat 1 throws the 8m
  assert.equal(optionsFor(state, 2)?.ron, undefined, "no ron for the 8m: still furiten");
  passAll(state);
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 2);
  assert.equal(furitenOf(state, 2), "passed");
  assert.equal(optionsFor(state, 2).tsumo, true, "but a self-draw wins");
  act(state, 2, { type: "tsumo" });
  assert.equal(state.result.wins[0].seat, 2);

  // After its own discard seat 2 may ron again.
  state = mk({ hands: [, , TANYAO_67M], draws: "5m8m9p8m" });
  tsumogiri(state);
  act(state, 2, { type: "pass" });
  tsumogiri(state);
  passAll(state);
  assert.equal(furitenOf(state, 2), "passed");
  tsumogiri(state); // seat 2's own discard of the 9p
  assert.equal(furitenOf(state, 2), null);
  assert.equal(state.turn, 3);
  tsumogiri(state); // seat 3 throws the 8m
  assert.equal(optionsFor(state, 2).ron, true);
});

test("furiten by passing also applies when the hand had no yaku to win with", () => {
  // 123m 456p 789s 11p and a kanchan 4s6s: no yaku on a ron (no riichi, not pinfu), but a tsumo has menzen.
  const state = mk({ hands: [, "123m456p789s11p46s"], draws: "5s5s" });
  tsumogiri(state); // 5s: complete shape, no yaku, so no ron is offered (a chi is)
  assert.equal(optionsFor(state, 1)?.ron, undefined);
  passAll(state);
  assert.equal(state.phase, "turn");
  assert.equal(furitenOf(state, 1), "passed");
  assert.equal(optionsFor(state, 1).tsumo, true);
  act(state, 1, { type: "tsumo" });
  // (Seat 1's first draw with nothing called before it: a blessing of earth.)
  assert.deepEqual(state.result.wins[0].yaku.map((entry) => entry.key), ["chiihou"]);
});

test("a seat that can't win for lack of a yaku isn't offered the ron", () => {
  const state = mk({ hands: [, "123m456p789s11p46s"], draws: "5s" });
  assert.notEqual(round.readWin(state, 1, state.drawn, { tsumo: false }), null);
  assert.equal(round.readWin(state, 1, state.drawn, { tsumo: false }).noYaku, true);
  tsumogiri(state);
  assert.equal(optionsFor(state, 1)?.ron, undefined);
  passAll(state);
  assert.equal(state.phase, "turn");
  assert.equal(state.result, null);
});

test("riichi furiten: a winning tile let go by a riichi seat lasts for the rest of the hand", () => {
  const state = mk({ hands: [, TANYAO_67M], draws: "6z9p5m8m4z5m" });
  tsumogiri(state);
  tsumogiri(state, true); // seat 1 riichi
  passAll(state);
  tsumogiri(state); // seat 2 throws the 5m
  assert.equal(optionsFor(state, 1).ron, true);
  act(state, 1, { type: "pass" });
  assert.equal(furitenOf(state, 1), "riichi");
  tsumogiri(state); // seat 3 throws the 8m: nothing offered
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 0);
  tsumogiri(state); // seat 0
  assert.equal(state.turn, 1);
  assert.equal(furitenOf(state, 1), "riichi");
  assert.equal(optionsFor(state, 1).tsumo, true, "the self-draw still wins");
  // Even after seat 1's own discard it stays.
  const spare = mk({ hands: [, TANYAO_67M], draws: "6z9p5m8m4z7z" });
  tsumogiri(spare);
  tsumogiri(spare, true);
  passAll(spare);
  tsumogiri(spare);
  act(spare, 1, { type: "pass" });
  tsumogiri(spare);
  tsumogiri(spare);
  tsumogiri(spare); // seat 1 throws its draw
  assert.equal(furitenOf(spare, 1), "riichi");
});

// ── 6. Winning ─────────────────────────────────────────────────────────────
/** Plays on until the seat has made its first discard and drawn again (so it isn't a first draw). */
function second(state, seat) {
  until(state, seat);
  tsumogiri(state);
  until(state, seat);
}
/** Swaps the tile that will be drawn at wall slot `slot` for a live tile of this kind. */
function plant(state, slot, name) {
  const kind = parseKinds(name)[0];
  const at = state.wall.findIndex((tile, index) => index >= state.livePos && index < 122 && kindOf(tile) === kind && index !== slot);
  assert.ok(at >= 0, `no ${name} left in the live wall`);
  [state.wall[slot], state.wall[at]] = [state.wall[at], state.wall[slot]];
}

test("non-dealer tsumo pays 1300 and 700 for 3 han 20 fu; honba adds 100 each and sticks go to the winner", () => {
  let state = mk({ hands: [, TANYAO_67M], draws: "6z9p2s9s4z5m" });
  second(state, 1);
  act(state, 1, { type: "tsumo" });
  let win = state.result.wins[0];
  assert.deepEqual(win.yaku.map((entry) => entry.key).sort(), ["menzen-tsumo", "pinfu", "tanyao"]);
  assert.equal(win.han, 3);
  assert.equal(win.fu, 20);
  assert.deepEqual(state.result.deltas, [-1300, 2700, -700, -700]);
  assert.equal(state.result.renchan, false);
  assert.equal(state.result.honba_next, 0);

  state = mk({ hands: [, TANYAO_67M], draws: "6z9p2s9s4z5m", honba: 2, sticks: 2 });
  second(state, 1);
  act(state, 1, { type: "tsumo" });
  assert.deepEqual(state.result.deltas, [-1500, 2700 + 600 + 2000, -900, -900]);
  assert.equal(state.sticks, 0);
  assert.equal(state.result.honba_next, 0);
  assert.equal(sum(state.result.scores), 100000 + 2000);
});

test("dealer tsumo: everyone pays 1300 for 3 han 20 fu, honba adds 100 each, the deal stays", () => {
  const state = mk({ hands: [TANYAO_67M], draws: "9p2s9s4z5m", honba: 1 });
  second(state, 0);
  act(state, 0, { type: "tsumo" });
  assert.deepEqual(state.result.deltas, [4200, -1400, -1400, -1400]);
  assert.equal(state.result.renchan, true);
  assert.equal(state.result.honba_next, 2);
});

test("non-dealer ron: base times four, 300 per honba, sticks to the winner", () => {
  const state = mk({ hands: [, TANYAO_67M], draws: "5m", honba: 1, sticks: 1 });
  tsumogiri(state);
  act(state, 1, { type: "ron" });
  const win = state.result.wins[0];
  assert.equal(win.han, 2);
  assert.equal(win.fu, 30);
  assert.deepEqual(state.result.deltas, [-2300, 3300, 0, 0]);
  assert.equal(state.result.renchan, false);
  assert.equal(state.result.honba_next, 0);
});

test("dealer ron: base times six", () => {
  const state = mk({ hands: [TANYAO_67M], draws: "9p5m" });
  tsumogiri(state);
  tsumogiri(state);
  act(state, 0, { type: "ron" });
  assert.deepEqual(state.result.deltas, [2900, -2900, 0, 0]);
  assert.equal(state.result.renchan, true);
  assert.equal(state.result.honba_next, 1);
});

test("a ron can't be declared on a tile that isn't a win, and the answer can't be changed", () => {
  const state = mk({ hands: [, TANYAO_67M, "55m258p258s23456z"], draws: "5m" });
  tsumogiri(state);
  illegal(() => act(state, 2, { type: "ron" }));
  act(state, 1, { type: "pass" });
  illegal(() => act(state, 1, { type: "ron" }));
});

test("double ron: both are paid, each gets honba, the sticks go to the winner nearest after the discarder", () => {
  const state = mk({ hands: [, TANYAO_67M, "234m456p345s66s67m"], draws: "5m", honba: 1, sticks: 1 });
  tsumogiri(state);
  assert.equal(optionsFor(state, 1).ron, true);
  assert.equal(optionsFor(state, 2).ron, true);
  act(state, 2, { type: "ron" });
  assert.equal(state.phase, "calls", "seat 1 may still answer");
  act(state, 1, { type: "ron" });
  assert.equal(state.result.wins.length, 2);
  assert.deepEqual(state.result.wins.map((win) => win.seat), [1, 2]);
  // 2,000 each + 300 honba each; the stick to seat 1; seat 0 pays both.
  assert.deepEqual(state.result.deltas, [-4600, 2300 + 1000, 2300, 0]);
  assert.equal(state.result.renchan, false);
  assert.equal(state.result.honba_next, 0);
});

test("double ron with the dealer: sticks to whoever is next after the discarder; the deal stays", () => {
  const state = mk({ hands: [TANYAO_67M, "147m147p147s1567z", , TANYAO_67M], draws: "9p5m", honba: 1, sticks: 2 });
  tsumogiri(state); // seat 0's 9p
  passAll(state);
  tsumogiri(state); // seat 1 throws the 5m
  act(state, 0, { type: "ron" });
  act(state, 3, { type: "ron" });
  assert.equal(state.result.wins.length, 2);
  // Seat 3 is next after seat 1 (seat 2 isn't winning), so seat 3 takes both sticks.
  assert.deepEqual(state.result.deltas, [2900 + 300, -(3200 + 2300), 0, 2000 + 300 + 2000]);
  assert.equal(state.result.renchan, true);
  assert.equal(state.result.honba_next, 2);
  assert.equal(state.sticks, 0);
});

test("triple ron: all three are paid and it is not a draw", () => {
  const hands = [, TANYAO_67M, "234m456p345s66s67m", "234m456p345s22s67m"];
  const state = mk({ hands, draws: "5m", honba: 1, sticks: 1 });
  tsumogiri(state);
  for (const seat of [1, 2, 3]) assert.equal(optionsFor(state, seat).ron, true);
  act(state, 3, { type: "ron" });
  act(state, 1, { type: "ron" });
  act(state, 2, { type: "ron" });
  assert.equal(state.result.type, "win");
  assert.equal(state.result.wins.length, 3);
  assert.deepEqual(state.result.deltas, [-(3 * 2300), 2300 + 1000, 2300, 2300]);
});

test("blessing of heaven: the dealer's self-draw on the first draw is a yakuman", () => {
  const state = mk({ hands: [TANYAO_67M], draws: "5m" });
  act(state, 0, { type: "tsumo" });
  const win = state.result.wins[0];
  assert.deepEqual(win.yaku.map((entry) => entry.key), ["tenhou"]);
  assert.equal(win.yakuman, 1);
  assert.deepEqual(state.result.deltas, [48000, -16000, -16000, -16000]);
});

test("blessing of earth: a non-dealer's first draw, nothing called; a call spoils it", () => {
  let state = mk({ hands: [, TANYAO_67M], draws: "6z5m" });
  tsumogiri(state);
  act(state, 1, { type: "tsumo" });
  assert.deepEqual(state.result.wins[0].yaku.map((entry) => entry.key), ["chiihou"]);
  assert.deepEqual(state.result.deltas, [-16000, 32000, -8000, -8000]);

  // A pon by seat 2 first: seat 1's draw is no longer a first draw.
  state = mk({ hands: [, TANYAO_67M, "66z258p258s23457z"], draws: "6z9s4z5m" });
  tsumogiri(state);
  act(state, 2, { type: "pon", tiles: optionsFor(state, 2).pon[0] });
  discard(state, 2, "8p");
  passAll(state);
  tsumogiri(state);
  passAll(state);
  tsumogiri(state);
  passAll(state);
  assert.equal(state.turn, 1);
  act(state, 1, { type: "tsumo" });
  const keys = state.result.wins[0].yaku.map((entry) => entry.key);
  assert.ok(!keys.includes("chiihou"), keys.join());
  assert.ok(keys.includes("menzen-tsumo"));
});

test("a draw by the dealer in later turns is not blessing of heaven", () => {
  const state = mk({ hands: [TANYAO_67M], draws: "9p2s9s4z5m" });
  second(state, 0);
  act(state, 0, { type: "tsumo" });
  assert.ok(!state.result.wins[0].yaku.some((entry) => entry.key === "tenhou"));
});

test("under the sea: haitei on the last drawn tile, and under the river: houtei on the last discard", () => {
  // Haitei: seat 0 (dealer) holds its first draw as the last tile of the wall.
  let state = mk({ hands: [TANYAO_67M], draws: "5m" });
  state.called = true; // not a first draw
  state.livePos = state.liveEnd;
  assert.equal(remaining(state), 0);
  act(state, 0, { type: "tsumo" });
  let keys = state.result.wins[0].yaku.map((entry) => entry.key);
  assert.ok(keys.includes("haitei"), keys.join());
  assert.ok(!keys.includes("houtei"));

  // Houtei: the last discard is a ron.
  state = mk({ hands: [, TANYAO_67M], draws: "5m" });
  state.livePos = state.liveEnd;
  tsumogiri(state);
  act(state, 1, { type: "ron" });
  keys = state.result.wins[0].yaku.map((entry) => entry.key);
  assert.ok(keys.includes("houtei") && !keys.includes("haitei"), keys.join());
});

test("a replacement tile drawn after a kan is not haitei, even when it is the last tile", () => {
  const state = mk({ hands: ["111m234p678p44s88s"], draws: "1m", rinshan: "4s" });
  state.livePos = state.liveEnd - 1; // one tile left: a kan is still allowed
  act(state, 0, { type: "ankan", kind: K("1m")[0] });
  assert.equal(remaining(state), 0);
  act(state, 0, { type: "tsumo" });
  const keys = state.result.wins[0].yaku.map((entry) => entry.key);
  assert.ok(keys.includes("rinshan") && !keys.includes("haitei") && !keys.includes("tenhou"), keys.join());
});

test("a complete hand with no yaku can't be declared, by tsumo or ron", () => {
  // Seat 1 chis the 5m (open), keeps 234p 567p 789s and 9p, throws the 1z, and later draws the 9p.
  const state = mk({ hands: [, "46m234p567p789s9p1z"], draws: "5m2s9s4z9p" });
  tsumogiri(state);
  act(state, 1, { type: "chi", tiles: optionsFor(state, 1).chi[0] });
  discard(state, 1, "1z");
  passAll(state);
  until(state, 1);
  assert.equal(kindOf(state.drawn), K("9p")[0]);
  assert.notEqual(round.readWin(state, 1, state.drawn, { tsumo: true }), null);
  assert.equal(round.readWin(state, 1, state.drawn, { tsumo: true }).noYaku, true);
  assert.equal(optionsFor(state, 1).tsumo, false);
  illegal(() => act(state, 1, { type: "tsumo" }));
});

// ── Responsibility (pao) ───────────────────────────────────────────────────
// Seat 1 pons white from seat 0, green from seat 3, red from seat 2 (the last one, so seat 2 is liable)
// and is then waiting on 1m and 4m with 23m and 99s. `tail` is what seats 2, 3, 0, 1 draw next.
function daisangen(tail, extra = {}) {
  const hands = [, "23m99s147p556677z", "369m369p369s1234z", "379m379p379s1234z"];
  const state = mk({ hands, draws: "5z2s6z7z" + tail, ...extra });
  tsumogiri(state); // 5z
  act(state, 1, { type: "pon", tiles: optionsFor(state, 1).pon[0] });
  discard(state, 1, "1p");
  passAll(state);
  tsumogiri(state); // seat 2: 2s
  passAll(state);
  tsumogiri(state); // seat 3: 6z
  act(state, 1, { type: "pon", tiles: optionsFor(state, 1).pon[0] });
  discard(state, 1, "4p");
  passAll(state);
  tsumogiri(state); // seat 2: 7z, the last dragon
  act(state, 1, { type: "pon", tiles: optionsFor(state, 1).pon[0] });
  discard(state, 1, "7p");
  passAll(state);
  return state;
}

test("pao: a self-drawn big three dragons is paid entirely by the seat that fed the last pon", () => {
  const state = daisangen("3p9p3s1m", { honba: 1 });
  assert.equal(state.pao[1], 2);
  until(state, 1);
  act(state, 1, { type: "tsumo" });
  const win = state.result.wins[0];
  assert.ok(win.yaku.some((entry) => entry.key === "daisangen"));
  assert.equal(win.pao, 2);
  assert.deepEqual(state.result.deltas, [0, 32300, -32300, 0]);
});

test("pao: a ron off the feeder is paid by the feeder alone", () => {
  const state = daisangen("1m", { honba: 0 });
  tsumogiri(state); // seat 2 draws the 1m and throws it
  assert.equal(state.phase, "calls");
  act(state, 1, { type: "ron" });
  assert.deepEqual(state.result.deltas, [0, 32000, -32000, 0]);
});

test("pao: a ron off a third player is split between that player and the feeder", () => {
  const state = daisangen("3p1m", { honba: 1 });
  tsumogiri(state); // seat 2: 3p
  passAll(state);
  tsumogiri(state); // seat 3: 1m
  assert.equal(state.phase, "calls");
  assert.equal(state.pending.from, 3);
  act(state, 1, { type: "ron" });
  // Yakuman by ron, non-dealer: 32,000. Half each; the discarder also pays the honba.
  assert.deepEqual(state.result.deltas, [0, 32300, -16000, -16300]);
});


// ── 7. Draws ───────────────────────────────────────────────────────────────
const TEN = ["234m456p345s88s67m", "234m456p345s66s67m", "234m456p345s22s67m", "234m678p234s99s67m"]; // all wait on 5m and 8m

/**
 * Leaves exactly `names.length` tiles in the live wall and plants those tiles in it, so the hand runs
 * out after that many more draws. Call right after mk(), while the dealer holds the first draw.
 */
function lastTiles(state, names) {
  const start = state.livePos;
  state.livePos = state.liveEnd - names.length;
  names.forEach((name, index) => {
    const kind = parseKinds(name)[0];
    const slot = state.livePos + index;
    const at = state.wall.findIndex((tile, i) => i >= start && i < 126 && !(i >= state.livePos && i < state.liveEnd) && kindOf(tile) === kind);
    assert.ok(at >= 0, `no ${name} to plant`);
    [state.wall[slot], state.wall[at]] = [state.wall[at], state.wall[slot]];
  });
  assert.equal(remaining(state), names.length);
}
/** Everyone throws what they draw and passes every call until the hand is over. */
function runOut(state) {
  let guard = 0;
  while (state.phase !== "over") {
    if (state.phase === "turn") tsumogiri(state);
    else passAll(state);
    guard += 1;
    assert.ok(guard < 100);
  }
}
function exhaustive(tenpai, extra = {}) {
  const hands = [0, 1, 2, 3].map((seat) => (tenpai.includes(seat) ? TEN[seat] : undefined));
  const state = mk({ hands, draws: "2p", dora: "1p1s1z1z", ...extra });
  lastTiles(state, ["2p", "2p", "7s"]);
  runOut(state);
  return state;
}

test("exhaustive draw: tenpai seats are paid 3,000 between them by the noten seats (every count from 0 to 4)", () => {
  const cases = [
    [[], [0, 0, 0, 0]],
    [[0], [3000, -1000, -1000, -1000]],
    [[2], [-1000, -1000, 3000, -1000]],
    [[0, 1], [1500, 1500, -1500, -1500]],
    [[1, 3], [-1500, 1500, -1500, 1500]],
    [[0, 1, 2], [1000, 1000, 1000, -3000]],
    [[1, 2, 3], [-3000, 1000, 1000, 1000]],
    [[0, 1, 2, 3], [0, 0, 0, 0]],
  ];
  for (const [tenpai, deltas] of cases) {
    const state = exhaustive(tenpai);
    const result = state.result;
    assert.equal(result.type, "draw", tenpai.join());
    assert.equal(result.reason, "exhaustive");
    assert.deepEqual(result.deltas, deltas, `tenpai ${tenpai.join() || "none"}`);
    assert.deepEqual(result.tenpai, [0, 1, 2, 3].map((seat) => tenpai.includes(seat)));
    assert.deepEqual(Object.keys(result.hands).map(Number), tenpai);
    assert.equal(sum(result.scores), 100000);
  }
});

test("exhaustive draw: the dealer stays only when tenpai, and the counter always goes up", () => {
  let state = exhaustive([0], { honba: 2 });
  assert.equal(state.result.renchan, true);
  assert.equal(state.result.honba_next, 3);
  state = exhaustive([1, 2], { honba: 2 });
  assert.equal(state.result.renchan, false);
  assert.equal(state.result.honba_next, 3);
  state = exhaustive([], {});
  assert.equal(state.result.renchan, false);
  assert.equal(state.result.honba_next, 1);
});

test("exhaustive draw: waiting only on a tile you hold all four of isn't tenpai", () => {
  // 1111m 234p 567p 789s: the only wait is a fifth 1m. Seat 1 holds that; control hand waits on 5z.
  const run = (seat1) => {
    const state = mk({ hands: ["258m147p147s1234z", seat1], draws: "2p" });
    lastTiles(state, ["2p", "2p", "7s"]);
    runOut(state);
    return state.result;
  };
  const dead = run("1111m234p567p789s");
  assert.equal(dead.tenpai[1], false);
  assert.deepEqual(dead.deltas, [0, 0, 0, 0]);
  const live = run("111m234p567p789s5z");
  assert.equal(live.tenpai[1], true);
  assert.deepEqual(live.deltas, [-1000, 3000, -1000, -1000]);
});

test("nagashi mangan: all discards terminals and honors, none called, paid as a self-drawn mangan", () => {
  const state = mk({ draws: "2p" });
  lastTiles(state, ["9m", "4p", "3s", "5p", "1z", "6s"]);
  runOut(state);
  const result = state.result;
  assert.equal(result.type, "draw");
  assert.equal(result.reason, "nagashi");
  assert.deepEqual(result.nagashi, [1]);
  assert.deepEqual(result.deltas, [-4000, 8000, -2000, -2000]);
  assert.equal(result.renchan, false);
  assert.equal(result.honba_next, 1);
});

test("nagashi mangan is paid instead of tenpai payments, and a dealer's one pays 4,000 each", () => {
  const state = mk({ hands: [, , TEN[2]], draws: "9m" }); // the dealer's only discard is a 9m
  lastTiles(state, ["4p", "2p", "7s"]);
  runOut(state);
  const result = state.result;
  assert.equal(result.reason, "nagashi");
  assert.deepEqual(result.nagashi, [0]);
  assert.deepEqual(result.deltas, [12000, -4000, -4000, -4000], "seat 2's tenpai pays nothing");
  assert.equal(result.renchan, false, "the dealer isn't tenpai");
});

test("nagashi mangan is lost when a discard was called, or when one was a simple", () => {
  // Seat 1 throws a 9m that seat 2 pons: no nagashi for seat 1.
  let state = mk({ hands: [, , "99m258p258s23456z"], draws: "2p" });
  lastTiles(state, ["9m", "4p", "3s"]);
  tsumogiri(state); // seat 0's 2p
  passAll(state);
  tsumogiri(state); // seat 1's 9m
  act(state, 2, { type: "pon", tiles: optionsFor(state, 2).pon[0] });
  discard(state, 2, "8p");
  passAll(state);
  runOut(state);
  assert.equal(state.result.reason, "exhaustive");
  assert.deepEqual(state.result.nagashi, []);

  // A simple among the discards (seat 1 throws a 9m and then a 5m).
  state = mk({ draws: "2p" });
  lastTiles(state, ["9m", "4p", "3s", "5p", "5m", "6s"]);
  runOut(state);
  assert.deepEqual(state.result.nagashi, []);
  assert.equal(state.result.reason, "exhaustive");
});

// ── Abortive draws ─────────────────────────────────────────────────────────
const NINE = "19m19p19s1234567z"; // thirteen orphans waiting hand: 13 different terminals and honors

test("nine terminals: the dealer's first draw, and a non-dealer's first draw, may abort", () => {
  let state = mk({ hands: [NINE], draws: "5m", honba: 1 });
  assert.equal(optionsFor(state, 0).kyuushu, true);
  act(state, 0, { type: "kyuushu" });
  assert.equal(state.result.type, "draw");
  assert.equal(state.result.reason, "kyuushu");
  assert.deepEqual(state.result.deltas, [0, 0, 0, 0]);
  assert.equal(state.result.renchan, true);
  assert.equal(state.result.honba_next, 2);

  state = mk({ hands: [, NINE], draws: "5m6p" });
  assert.equal(optionsFor(state, 0).kyuushu, false, "the dealer's hand has no nine");
  tsumogiri(state);
  assert.equal(optionsFor(state, 1).kyuushu, true);
  act(state, 1, { type: "kyuushu" });
  assert.equal(state.result.reason, "kyuushu");
});

test("nine terminals: eight kinds is not enough", () => {
  const eight = mk({ hands: ["19m19p19s12z25m56p4s"], draws: "5m" }); // 1m 9m 1p 9p 1s 9s 1z 2z = 8 kinds
  assert.equal(optionsFor(eight, 0).kyuushu, false);
  illegal(() => act(eight, 0, { type: "kyuushu" }));
  const nine = mk({ hands: ["19m19p19s123z25m5p4s"], draws: "5m" }); // the same with a 3z: nine kinds
  assert.equal(optionsFor(nine, 0).kyuushu, true);
});

test("nine terminals: not after the seat's own first discard, nor when a call came before the draw", () => {
  // Not on the second draw.
  let state = mk({ hands: [NINE], draws: "5m6p2s9s4z6s" });
  discard(state, 0, "5m");
  passAll(state);
  until(state, 0);
  assert.equal(optionsFor(state, 0).kyuushu, false);
  illegal(() => act(state, 0, { type: "kyuushu" }));

  // A call before seat 3's first draw.
  state = mk({ hands: [, , "55m258p258s23456z", NINE], draws: "5m6p" });
  tsumogiri(state);
  act(state, 2, { type: "pon", tiles: optionsFor(state, 2).pon[0] });
  discard(state, 2, "8p");
  passAll(state);
  assert.equal(state.turn, 3);
  assert.equal(optionsFor(state, 3).kyuushu, false);
});

const WINDLESS = ["147m147p147s4567z", "268m268p268s4567z", "369m369p369s4567z", "379m379p379s4567z"];

test("four winds: the same wind from all four on the first go-around ends the hand", () => {
  const state = mk({ hands: WINDLESS, draws: "3z3z3z3z", honba: 1 });
  for (let i = 0; i < 3; i += 1) {
    tsumogiri(state);
    assert.equal(state.phase, "turn");
  }
  tsumogiri(state);
  assert.equal(state.phase, "over");
  assert.equal(state.result.reason, "suufon");
  assert.deepEqual(state.result.deltas, [0, 0, 0, 0]);
  assert.equal(state.result.renchan, true);
  assert.equal(state.result.honba_next, 2);
});

test("four winds: not when the fourth is a different tile, not a dragon, and not after a call", () => {
  let state = mk({ hands: WINDLESS, draws: "3z3z3z4p" });
  for (let i = 0; i < 4; i += 1) tsumogiri(state);
  assert.equal(state.phase, "turn");

  state = mk({ hands: ["147m147p147s2346z", "268m268p268s2346z", "369m369p369s2346z", "379m379p379s2346z"], draws: "5z5z5z5z" });
  for (let i = 0; i < 4; i += 1) tsumogiri(state);
  assert.equal(state.phase, "turn", "dragons are not winds");

  // A pon in the go-around: seat 2 pons the first 3z, so the go-around is broken.
  state = mk({ hands: [WINDLESS[0], WINDLESS[1], "33z258p258s14567z", WINDLESS[3]], draws: "3z" });
  tsumogiri(state);
  const options = optionsFor(state, 2);
  assert.ok(options?.pon);
  act(state, 2, { type: "pon", tiles: options.pon[0] });
  discard(state, 2, "8p");
  passAll(state);
  assert.notEqual(state.phase, "over");
});

test("four riichi: the fourth declaration ends the hand with nothing paid, the sticks stay", () => {
  const state = mk({ hands: TEN, draws: "1z2z3z4z", honba: 1, dora: "1p1s2z2z2z" });
  for (let seat = 0; seat < 4; seat += 1) {
    assert.equal(state.turn, seat);
    assert.equal(state.phase, "turn");
    tsumogiri(state, true);
    passAll(state);
  }
  assert.equal(state.phase, "over");
  assert.equal(state.result.reason, "suucha");
  assert.deepEqual(state.result.deltas, [0, 0, 0, 0]);
  assert.deepEqual(state.result.scores, [24000, 24000, 24000, 24000]);
  assert.equal(state.sticks, 4);
  assert.equal(state.result.renchan, true);
  assert.equal(state.result.honba_next, 2);
});

test("three riichi are not an abort", () => {
  const state = mk({ hands: [TEN[0], TEN[1], TEN[2]], draws: "1z2z3z4z" });
  for (let seat = 0; seat < 3; seat += 1) {
    tsumogiri(state, true);
    passAll(state);
  }
  tsumogiri(state);
  passAll(state);
  assert.notEqual(state.phase, "over");
});

// ── 8. The match ───────────────────────────────────────────────────────────
const { createGame, next, standings } = gameLib;
const SEED = "ab".repeat(32);
const newGame = (length = "east") => createGame({ seed: SEED, length });

/** Ends the game's current hand the way a result would, without playing it. */
function endHand(game, { renchan = false, honba_next = 0, scores, sticks, type = "win", reason } = {}) {
  const hand = game.hand;
  if (scores) hand.scores = [...scores];
  if (sticks !== undefined) hand.sticks = sticks;
  hand.phase = "over";
  hand.result = { type, reason, renchan, honba_next, scores: [...hand.scores], wins: [], deltas: [0, 0, 0, 0] };
}
/** Ends the hand with the dealer passing and everyone on `scores`; returns the game. */
const passDeal = (game, scores = SCORES) => {
  endHand(game, { scores });
  next(game);
  return game;
};
const position = (game) => (game.over ? "over" : `${game.wind}:${game.number}:${game.hand.dealer}:${game.honba}`);

test("a new game: everyone on 25,000, seat 0 deals East 1", () => {
  const game = newGame();
  assert.deepEqual(game.scores, SCORES);
  assert.equal(game.hand.dealer, 0);
  assert.equal(game.hand.roundWind, 27);
  assert.equal(gameLib.roundLabel(game), "East 1");
  assert.equal(game.hand.hands[0].length, 14);
  assert.equal(game.seed_hash.length, 64);
  illegalMatch(() => createGame({ seed: SEED, length: "west" }));
  illegalMatch(() => next(game), "hand_not_over");
});
function illegalMatch(fn, code = "bad_length") {
  assert.throws(fn, (error) => error.code === code);
}

test("the deal passes seat by seat and the seat winds follow the dealer", () => {
  const game = newGame();
  const labels = [];
  const winds = [];
  for (let i = 0; i < 4; i += 1) {
    labels.push(gameLib.roundLabel(game));
    winds.push([0, 1, 2, 3].map((seat) => round.seatWind(game.hand, seat) - 27));
    assert.equal(game.hand.dealer, i);
    assert.equal(game.hand.roundWind, 27);
    if (i < 3) passDeal(game);
  }
  assert.deepEqual(labels, ["East 1", "East 2", "East 3", "East 4"]);
  assert.deepEqual(winds, [[0, 1, 2, 3], [3, 0, 1, 2], [2, 3, 0, 1], [1, 2, 3, 0]]);
});

test("East-only: with nobody on 30,000 after East 4, the game goes on into South; reaching 30,000 there ends it", () => {
  const game = newGame("east");
  for (let i = 0; i < 4; i += 1) passDeal(game);
  assert.equal(game.over, false);
  assert.equal(game.wind, 1);
  assert.equal(game.hand.dealer, 0);
  assert.equal(game.hand.roundWind, 28);
  assert.equal(gameLib.roundLabel(game), "South 1");
  // South 1 leaves seat 2 on 30,000: over at once.
  endHand(game, { scores: [24000, 23000, 30000, 23000] });
  next(game);
  assert.equal(game.over, true);
  assert.equal(game.hand, null);
  assert.equal(game.hands.length, 5);
});

test("East-only: the extra South round also ends after South 4, at 29,900 or less", () => {
  const game = newGame("east");
  for (let i = 0; i < 4; i += 1) passDeal(game);
  for (let i = 0; i < 3; i += 1) {
    passDeal(game, [29900, 25000, 25000, 20100]);
    assert.equal(game.over, false, `South ${i + 1}`);
  }
  assert.equal(game.hand.dealer, 3);
  endHand(game, { scores: [29900, 25000, 25000, 20100] });
  next(game);
  assert.equal(game.over, true);
});

test("East-only: someone on 30,000 after East 4 ends the game", () => {
  const game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  endHand(game, { scores: [30000, 25000, 25000, 20000] });
  next(game);
  assert.equal(game.over, true);
  assert.equal(game.final.standings[0].seat, 0);
});

test("East-South: eight hands, East then South, whatever the scores", () => {
  const game = newGame("south");
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    seen.push(`${game.hand.roundWind - 27}:${game.hand.dealer}`);
    // Even with someone far ahead the game plays all eight.
    if (i < 7) passDeal(game, [60000, 20000, 10000, 10000]);
  }
  assert.deepEqual(seen, ["0:0", "0:1", "0:2", "0:3", "1:0", "1:1", "1:2", "1:3"]);
  assert.equal(game.over, false);
  endHand(game, { scores: [60000, 20000, 10000, 10000] });
  next(game);
  assert.equal(game.over, true, "after South 4, someone has 30,000 or more");
});

test("East-South: nobody on 30,000 after South 4 goes on into West; the first hand to reach 30,000 ends it", () => {
  const game = newGame("south");
  for (let i = 0; i < 8; i += 1) passDeal(game);
  assert.equal(game.over, false);
  assert.equal(game.hand.roundWind, 29);
  assert.equal(gameLib.roundLabel(game), "West 1");
  endHand(game, { scores: [26000, 26000, 26000, 22000] });
  next(game);
  assert.equal(game.over, false);
  endHand(game, { scores: [31000, 25000, 25000, 19000] });
  next(game);
  assert.equal(game.over, true);
});

test("the deal stays on a renchan, the counter climbs, and sticks carry over", () => {
  const game = newGame();
  endHand(game, { renchan: true, honba_next: 1, sticks: 2, scores: [23000, 25000, 25000, 25000] });
  next(game);
  assert.equal(position(game), "0:0:0:1");
  assert.equal(game.hand.honba, 1);
  assert.equal(game.hand.sticks, 2);
  assert.deepEqual(game.hand.scores, [23000, 25000, 25000, 25000]);
  assert.equal(game.hand.roundWind, 27);
  // A draw where the dealer is noten: the deal passes, the counter still goes up and sticks stay.
  endHand(game, { type: "draw", reason: "exhaustive", renchan: false, honba_next: 2, sticks: 3 });
  next(game);
  assert.equal(position(game), "0:1:1:2");
  assert.equal(game.hand.sticks, 3);
  // A non-dealer's win clears the counter.
  endHand(game, { renchan: false, honba_next: 0, sticks: 0 });
  next(game);
  assert.equal(position(game), "0:2:2:0");
  assert.equal(game.hand.sticks, 0);
});

test("a hand is dealt from the game's own wall each time, counted from 0", () => {
  const dealt = [];
  const game = createGame({
    seed: SEED,
    length: "east",
    wallFor: (index) => {
      dealt.push(index);
      return stackWall({ dealer: dealt.length > 1 ? 1 : 0, hands: [], draws: "" });
    },
  });
  endHand(game);
  next(game);
  assert.deepEqual(dealt, [0, 1]);
  assert.equal(game.hand_index, 1);
  assert.equal(game.hands.length, 1);
  assert.equal(game.hands[0].dealer, 0);
});

test("bust: anyone below zero ends the game at once; exactly zero plays on", () => {
  let game = newGame("south");
  endHand(game, { scores: [60000, 40100, -100, 0 + 0] });
  next(game);
  assert.equal(game.over, true);

  game = newGame("south");
  endHand(game, { scores: [50000, 50000, 0, 0] });
  next(game);
  assert.equal(game.over, false, "zero is not below zero");
  assert.equal(game.hand.dealer, 1);
});

test("bust in a real hand: a dealer's blessing of heaven, twice", () => {
  const game = createGame({ seed: SEED, length: "south", wallFor: () => stackWall({ dealer: 0, hands: [TANYAO_67M, ...JUNK.slice(1)], draws: "5m", dora: "1p1s6p6s6m" }) });
  act(game.hand, 0, { type: "tsumo" });
  assert.deepEqual(game.hand.result.deltas, [48000, -16000, -16000, -16000]);
  next(game);
  assert.equal(game.over, false);
  assert.deepEqual(game.scores, [73000, 9000, 9000, 9000]);
  assert.equal(game.honba, 1);
  assert.equal(game.hand.dealer, 0);
  act(game.hand, 0, { type: "tsumo" });
  // Each pays 16,000 + 100 honba and goes below zero.
  assert.deepEqual(game.hand.result.deltas, [48000 + 300, -16100, -16100, -16100]);
  next(game);
  assert.equal(game.over, true);
  assert.equal(game.final.standings[0].seat, 0);
  assert.equal(sum(game.final.scores), 100000);
});

test("last hand: the dealer wins and leads with 30,000 or more, so the game ends there", () => {
  const game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  assert.equal(game.hand.dealer, 3);
  endHand(game, { renchan: true, honba_next: 1, scores: [20000, 20000, 20000, 40000] });
  next(game);
  assert.equal(game.over, true);
});

test("last hand: the dealer wins on 30,000 or more but isn't first, or leads with under 30,000: play on", () => {
  let game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  endHand(game, { renchan: true, honba_next: 1, scores: [35000, 15000, 15000, 35000 - 0] }); // seat 3 ties seat 0, who is nearer the first dealer
  next(game);
  assert.equal(game.over, false, "tied for first with a seat nearer the first dealer: not in first place");
  assert.equal(game.hand.dealer, 3);
  assert.equal(game.honba, 1);

  game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  endHand(game, { renchan: true, honba_next: 1, scores: [24000, 24000, 24000, 28000] });
  next(game);
  assert.equal(game.over, false, "leading but under 30,000");
  assert.equal(game.hand.dealer, 3);
});

test("last hand: someone else wins or the deal passes, and anyone on 30,000 ends the game", () => {
  const game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  endHand(game, { renchan: false, scores: [31000, 25000, 25000, 19000] });
  next(game);
  assert.equal(game.over, true);
});

test("last hand: a tenpai dealer in first with 30,000 ends the game at an exhaustive draw; a noten dealer's deal passes and 30,000 ends it too", () => {
  let game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  endHand(game, { type: "draw", reason: "exhaustive", renchan: true, honba_next: 1, scores: [20000, 20000, 20000, 40000] });
  next(game);
  assert.equal(game.over, true);

  game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  endHand(game, { type: "draw", reason: "exhaustive", renchan: false, honba_next: 1, scores: [20000, 20000, 20000, 40000] });
  next(game);
  assert.equal(game.over, true, "dealer passes the deal and seat 3 is over 30,000: that ends it too");
});

test("last hand: an abortive draw is not a dealer win or a tenpai draw, so it does not end the game", () => {
  // Rule sheet: the game ends on the last hand if the dealer wins it (or is tenpai when it draws) and leads
  // with 30,000 or more. A nine-terminals abort is neither.
  const game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  endHand(game, { type: "draw", reason: "kyuushu", renchan: true, honba_next: 1, scores: [20000, 20000, 20000, 40000] });
  next(game);
  assert.equal(game.over, false);
  assert.equal(game.hand.dealer, 3);
});

test("final standings: points, tie-break by seat, sticks to first, scores sum to zero", () => {
  let table = standings([32000, 25000, 25000, 18000]);
  assert.deepEqual(table.map((entry) => entry.seat), [0, 1, 2, 3]);
  assert.deepEqual(table.map((entry) => entry.place), [1, 2, 3, 4]);
  // (32,000 - 30,000) / 1,000 + 15 + 20 = 37; 25,000: -5 + 5 = 0; 25,000: -5 - 5 = -10; 18,000: -12 - 15 = -27
  assert.deepEqual(table.map((entry) => entry.score), [37, 0, -10, -27]);
  assert.equal(sum(table.map((entry) => entry.score)), 0);

  table = standings([40000, 30000, 20000, 10000]);
  assert.deepEqual(table.map((entry) => entry.score), [45, 5, -15, -35]);

  // A tie goes to the seat nearer the first dealer, whichever way the seats lie.
  table = standings([25000, 25000, 25000, 25000]);
  assert.deepEqual(table.map((entry) => entry.seat), [0, 1, 2, 3]);
  assert.deepEqual(table.map((entry) => entry.score), [30, 0, -10, -20]);
  table = standings([20000, 30000, 30000, 20000]);
  assert.deepEqual(table.map((entry) => entry.seat), [1, 2, 0, 3]);

  // Sticks on the table go to first.
  table = standings([24000, 25000, 25000, 24000], 2);
  assert.equal(table[0].seat, 1);
  assert.equal(table[0].points, 27000);
  assert.equal(sum(table.map((entry) => entry.points)), 100000);
  assert.ok(Math.abs(sum(table.map((entry) => entry.score))) < 1e-9);
  // First: (27,000 - 30,000) / 1,000 + 15 + 20 = 32; then 0; then 24,000: -6 - 5 = -11; then -6 - 15 = -21.
  assert.deepEqual(table.map((entry) => entry.score), [32, 0, -11, -21]);
});

test("the game's final carries the standings, the scores and the sticks left on the table", () => {
  const game = newGame("east");
  for (let i = 0; i < 3; i += 1) passDeal(game);
  endHand(game, { scores: [22000, 22000, 22000, 33000], sticks: 1 });
  next(game);
  assert.equal(game.over, true);
  const final = game.final;
  assert.equal(final.sticks, 1);
  assert.deepEqual(final.scores, [22000, 22000, 22000, 33000]);
  assert.equal(final.standings[0].seat, 3);
  assert.equal(final.standings[0].points, 34000, "first place takes the stick");
  assert.equal(sum(final.standings.map((entry) => entry.points)), 100000);
  assert.ok(Math.abs(sum(final.standings.map((entry) => entry.score))) < 1e-9);
  assert.deepEqual(final.standings.map((entry) => entry.place), [1, 2, 3, 4]);
  assert.equal(game.hands.length, 4);
});
