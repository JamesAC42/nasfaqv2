// The coach (coach.js): shanten and its form, discard rows, the suggestion, the way to a win, advice on
// every call, and the look back at a finished hand. Every position is built by hand and the expected
// numbers worked out from the rules, not read off the code.

const test = require("node:test");
const assert = require("node:assert/strict");

const round = require("../src/services/games/mahjong/round");
const view = require("../src/services/games/mahjong/view");
const coach = require("../src/services/games/mahjong/coach");
const { stackWall } = require("../src/services/games/mahjong/stackedWall");
const { countKinds, isRedFive, kindOf, parseKinds, parseTiles } = require("../src/services/games/mahjong/tiles");

const { act, createHand, waitingSeats } = round;
const SCORES = [25000, 25000, 25000, 25000];
const JUNK = ["147m147p147s1234z", "268m268p268s1567z", "369m369p369s2345z", "379m379p379s4567z"];

function mk({ hands = [], draws = "", dealer = 0, dora = "9p", rinshan = "", ura = "", fill = 0 } = {}) {
  const full = [0, 1, 2, 3].map((seat) => hands[seat] ?? JUNK[seat]);
  const wall = stackWall({ dealer, hands: full, draws, rinshan, dora, ura, fill });
  return createHand({ wall, dealer, roundWind: 27, scores: SCORES });
}

function has(state, seat, name) {
  const kind = parseKinds(name)[0];
  const red = name[0] === "0";
  const found = state.hands[seat].find((tile) => kindOf(tile) === kind && isRedFive(tile) === red) ?? state.hands[seat].find((tile) => kindOf(tile) === kind);
  assert.notEqual(found, undefined, `seat ${seat} holds no ${name}`);
  return found;
}
const discard = (state, seat, name, riichi = false) => act(state, seat, { type: "discard", tile: has(state, seat, name), riichi });
const tsumogiri = (state, riichi = false) => act(state, state.turn, { type: "discard", tile: state.drawn, riichi });
function passAll(state) {
  while (state.phase === "calls") for (const seat of waitingSeats(state)) act(state, seat, { type: "pass" });
}
const K = (text) => parseKinds(text).sort((a, b) => a - b);
const coachOf = (state, seat) => view.seatHand(state, seat, { coach: true }).help.coach;
/** A copy that the coach hasn't looked at, so edits to the position are seen. */
const edited = (state, change) => {
  const copy = structuredClone(state);
  change(copy);
  return copy;
};
const pondEntry = (name, n = 1) => ({ tile: parseTiles(name)[0], tsumogiri: false, riichi: false, called: false, n });

// ── 1. Shanten and its form ────────────────────────────────────────────────
test("shape: the closest of standard, seven pairs and thirteen orphans", () => {
  const shape = (text, melds = 0) => coach.shapeOf(countKinds(K(text)), melds);
  // Three sets, a pair and two stray tiles: one away, standard. (Seven pairs: one pair and twelve kinds is
  // 6 - 1 = 5 away; thirteen orphans: five different terminals and honors with one pair is 13 - 5 - 1 = 7.)
  assert.deepEqual(shape("123m456p789s11z35z"), { shanten: 1, form: "standard", by_form: { standard: 1, seven_pairs: 5, thirteen_orphans: 7 } });
  // Six pairs and a stray: ready on seven pairs, far away as a standard hand.
  const pairs = shape("1122m3344p5566s7z");
  assert.equal(pairs.shanten, 0);
  assert.equal(pairs.form, "seven_pairs");
  assert.ok(pairs.by_form.standard > 0);
  // Every terminal and honor once: ready, thirteen sides.
  const orphans = shape("19m19p19s1234567z");
  assert.equal(orphans.shanten, 0);
  assert.equal(orphans.form, "thirteen_orphans");
  // A complete hand is -1.
  assert.equal(shape("123m456p789s11155z").shanten, -1);
  // Once a tile is called only the standard form counts.
  const open = shape("456p789p12m46s9s99m", 1);
  assert.equal(open.by_form.seven_pairs, null);
  assert.equal(open.by_form.thirteen_orphans, null);
  assert.equal(open.form, "standard");
});

// ── 2. The discard rows ────────────────────────────────────────────────────
// 123m 456p 789s 11z 22z waits on east or south (a shanpon); the 9p it draws goes.
const SHANPON = "123m456p789s11z22z";

test("improvers: a ready discard lists its waits and how many are unseen from this seat", () => {
  const state = mk({ hands: [SHANPON], draws: "9p" });
  const help = coachOf(state, 0);
  const row = help.improvers[0];
  assert.equal(row.kind, 17); // 9p
  assert.equal(row.shanten, 0);
  assert.equal(row.riichi, true);
  // Seat 0 holds two of each; nothing else is on the table: two of each remain.
  assert.deepEqual(row.improve, [{ kind: 27, left: 2 }, { kind: 28, left: 2 }]);
  assert.equal(row.left, 4);
  // East gives the east pon (seat and round wind), south only a pair's worth: ron needs a yaku.
  assert.deepEqual(row.ready.waits, [
    { kind: 27, left: 2, ron_ok: true, tsumo_ok: true },
    { kind: 28, left: 2, ron_ok: false, tsumo_ok: true },
  ]);
  assert.equal(row.ready.furiten, null);
  // No other discard is ready.
  assert.ok(help.improvers.slice(1).every((other) => other.shanten === 1 && other.ready === null));
  // The older fields are still there.
  assert.equal(help.shanten, 0);
  assert.deepEqual(help.best, [17]);
  assert.equal(help.discards.length, help.improvers.length);
});

test("improvers: copies visible in ponds, melds and indicators come off the count", () => {
  const state = mk({ hands: [SHANPON], draws: "9p" });
  const seen = edited(state, (copy) => {
    copy.ponds[2].push(pondEntry("1z"), pondEntry("2z"));
    copy.ponds[3].push(pondEntry("1z", 2));
    copy.melds[1].push({ type: "pon", tiles: parseTiles("222z"), called: parseTiles("2z")[0], from: 0 });
  });
  const row = coachOf(seen, 0).improvers[0];
  // East: two in hand, three discarded (one more than can exist, which the count floors at zero); south: two in hand, one thrown, three in a meld.
  assert.deepEqual(row.improve, [{ kind: 27, left: 0 }, { kind: 28, left: 0 }]);
  const path = coachOf(seen, 0).win_path;
  assert.ok(path.blocked.some((entry) => entry.code === "no_tiles_left"));
  // One east thrown: one fewer.
  const one = edited(state, (copy) => copy.ponds[2].push(pondEntry("1z")));
  assert.deepEqual(coachOf(one, 0).improvers[0].improve, [{ kind: 27, left: 1 }, { kind: 28, left: 2 }]);
});

test("improvers: a hand not yet ready ranks by shanten, then by how many draws help", () => {
  // 234m 567m 345p 88s and 46s: waiting on the 5s once the loose 9s goes.
  const state = mk({ hands: ["234m567m345p88s46s"], draws: "9s" });
  const help = coachOf(state, 0);
  const top = help.improvers[0];
  assert.equal(top.kind, 26); // 9s
  assert.equal(top.shanten, 0);
  assert.deepEqual(top.improve, [{ kind: 22, left: 4 }]); // 5s: none in sight
  // Rows are sorted best first.
  for (let i = 1; i < help.improvers.length; i += 1) assert.ok(help.improvers[i - 1].shanten <= help.improvers[i].shanten);
  // A 6s thrown on the table by someone else is one fewer.
  const seen = edited(state, (copy) => copy.ponds[2].push(pondEntry("5s")));
  assert.deepEqual(coachOf(seen, 0).improvers[0].improve, [{ kind: 22, left: 3 }]);
});

// ── 3. The suggestion ──────────────────────────────────────────────────────
test("suggestion: the ready discard, with riichi, as a code and not prose", () => {
  const state = mk({ hands: [SHANPON], draws: "9p" });
  const { suggestion } = coachOf(state, 0);
  assert.equal(suggestion.action, "discard");
  assert.equal(suggestion.kind, 17);
  assert.equal(suggestion.riichi, true);
  assert.equal(suggestion.code, "makes_ready");
  assert.equal(suggestion.waits, 2);
  assert.equal(suggestion.left, 4);
  assert.deepEqual(suggestion.danger, []);
  assert.ok(state.hands[0].includes(suggestion.tile));
  assert.equal(coachOf(state, 0).improvers[0].recommended, true);
});

test("suggestion: a lone honor goes first", () => {
  // Three sets and a pair, with a loose 4p and 9s: the 5z it drew is the tile that helps least.
  const lone = mk({ hands: ["234m567p345s88m4p9s"], draws: "5z" });
  const { suggestion } = coachOf(lone, 0);
  assert.equal(suggestion.kind, 31);
  assert.equal(suggestion.code, "isolated_honor");
  assert.equal(suggestion.riichi, false);
});

test("suggestion: a self-draw win is the move when there is one", () => {
  // Seat 0 completes 234m 567m 345p 88s 456s on its second turn (not the first: that would be tenhou).
  const state = edited(mk({ hands: ["234m567m345p88s46s"], draws: "5s" }), (copy) => {
    copy.discards[0] = 1;
  });
  const help = coachOf(state, 0);
  assert.equal(help.suggestion.action, "tsumo");
  assert.equal(help.suggestion.code, "win_now");
  assert.deepEqual(help.suggestion.yaku.sort(), ["menzen-tsumo", "tanyao"]);
  assert.equal(help.win_path.subject, "complete");
  // Riichi is on offer too, but with the win in hand it is not the move.
  assert.deepEqual(help.call_advice.map((entry) => [entry.option.type, entry.recommend]).filter(([type, advice]) => type !== "riichi" || advice !== "skip"), [["tsumo", "take"]]);
  assert.ok(help.call_advice.filter((entry) => entry.option.type === "riichi").every((entry) => entry.effects.some((effect) => effect.code === "tsumo_available")));
  assert.equal(help.win_path.can_win_now[0].tsumo_ok, true);
});

test("suggestion: against a riichi, a tile the riser threw is the safe one", () => {
  // Seat 3 is in riichi with a 5z in its pond. Seat 0 is far from ready, holds a 5z, and folds with it.
  const state = mk({ hands: ["159m159p159s1234z"], draws: "5z" });
  const folded = edited(state, (copy) => {
    copy.riichi[3] = 1;
    copy.ponds[3].push({ tile: parseTiles("5z")[0], tsumogiri: false, riichi: true, called: false, n: 1 });
    copy.discardNo = 1;
  });
  const help = coachOf(folded, 0);
  assert.deepEqual(help.riichi_seats, [3]);
  assert.equal(help.suggestion.kind, 31);
  assert.equal(help.suggestion.code, "safe_against_riichi");
  assert.equal(help.suggestion.seat, 3);
  assert.deepEqual(help.suggestion.danger, []);
  assert.deepEqual(help.improvers.find((entry) => entry.kind === 31).safe_against, [3]);
  // A tile nobody has thrown is a risk, and the suggestion says against whom.
  const risky = help.improvers.find((entry) => entry.kind === 4);
  assert.deepEqual(risky.safe_against, []);
});

test("suggestion: a ready throw that is furiten gives way to one that isn't", () => {
  // 234p 567p 789s 55m 3m 4m, drawing 6m: throwing the 6m waits on 2m and 5m, but seat 0 has thrown a 2m.
  // Most of the other waits are gone from sight, so the draws favor the furiten throw; the coach prefers
  // the 5m throw (waiting on 3m and 6m).
  const state = mk({ hands: ["234p567p789s55m34m"], draws: "6m" });
  const crowded = edited(state, (copy) => {
    copy.ponds[0].push({ tile: parseTiles("2m")[0], tsumogiri: false, riichi: false, called: false, n: 1 });
    copy.ponds[1].push(pondEntry("3m", 2), { ...pondEntry("3m", 3), tile: parseTiles("3m3m")[1] }, pondEntry("6m", 4), { ...pondEntry("6m", 5), tile: parseTiles("6m6m")[1] });
  });
  const help = coachOf(crowded, 0);
  const six = help.improvers.find((entry) => entry.kind === 5);
  assert.equal(six.ready.furiten, "discard");
  assert.equal(help.suggestion.code, "avoids_furiten");
  assert.notEqual(help.suggestion.kind, 5);
  assert.equal(help.improvers[0].ready.furiten, null);
});

/** Seat 1 calls a chi on seat 0's 5m and is left ready with no yaku. */
function chiHand() {
  const state = mk({ hands: [undefined, "46m123p567p55s67s7z"], draws: "5m" });
  discard(state, 0, "5m");
  assert.equal(state.phase, "calls");
  return state;
}

// ── 4. The way to a win ────────────────────────────────────────────────────
test("win path: ready but open with no yaku is blocked, and says so on every wait", () => {
  const state = chiHand();
  act(state, 1, { type: "chi", tiles: round.optionsFor(state, 1).chi[0] });
  assert.equal(state.phase, "turn");
  assert.equal(state.turn, 1);
  const help = coachOf(state, 1);
  assert.equal(help.suggestion.kind, 33); // 7z
  const path = help.win_path;
  assert.equal(path.subject, "after_discard");
  assert.equal(path.ready, true);
  assert.deepEqual(path.can_win_now.map((wait) => [wait.kind, wait.ron_ok, wait.tsumo_ok]), [[22, false, false], [25, false, false]]);
  assert.deepEqual(path.blocked, [{ code: "no_yaku_open_hand" }]);
  assert.ok(!path.yaku_in_sight.some((entry) => entry.key === "riichi"));
});

test("win path: furiten because of its own discard names the kinds", () => {
  const state = mk({ hands: [SHANPON], draws: "9p" });
  const furiten = edited(state, (copy) => copy.ponds[0].push(pondEntry("2z")));
  const help = coachOf(furiten, 0);
  assert.equal(help.improvers[0].ready.furiten, "discard");
  assert.deepEqual(help.win_path.blocked, [{ code: "furiten_own_discard", kinds: [28] }]);
  // Throwing the east pair tile away from a ready hand would also be furiten: the discard itself counts.
  const flat = coachOf(state, 0);
  assert.deepEqual(flat.win_path.blocked, []);
});

test("win path: furiten after a riichi pass", () => {
  const state = mk({ hands: [SHANPON], draws: "9p" });
  const stuck = edited(state, (copy) => {
    copy.riichiFuriten[0] = true;
  });
  assert.deepEqual(coachOf(stuck, 0).win_path.blocked, [{ code: "furiten_riichi" }]);
  assert.equal(coachOf(stuck, 0).improvers[0].ready.furiten, "riichi");
});

test("win path: passing a winning tile blocks the ron until the next discard", () => {
  // Seat 3 waits on 6m (ittsu in pins and a pair of 4m; 57m is the wait) and passes seat 0's 6m. Later
  // seat 2's 3m can be chi'd: while it decides, it is still furiten for having passed.
  const hands = [undefined, undefined, undefined, "123p456p789p44m57m"];
  const state = mk({ hands, draws: "6m5z3m" });
  discard(state, 0, "6m");
  assert.deepEqual(waitingSeats(state), [3]);
  assert.equal(round.optionsFor(state, 3).ron, true);
  act(state, 3, { type: "pass" });
  tsumogiri(state); // seat 1 throws the 5z it drew
  passAll(state);
  tsumogiri(state); // seat 2 throws the 3m
  assert.equal(state.phase, "calls");
  assert.deepEqual(waitingSeats(state), [3]);
  const help = coachOf(state, 3);
  assert.equal(help.win_path.subject, "hand");
  assert.equal(help.win_path.ready, true);
  assert.deepEqual(help.win_path.blocked, [{ code: "furiten_passed" }]);
  assert.equal(help.suggestion, null);
  // The chi leaves it ready on the same wait with nothing gained: skip.
  const chi = help.call_advice.find((entry) => entry.option.type === "chi");
  assert.deepEqual(chi.effects.find((effect) => effect.code === "shanten_change"), { code: "shanten_change", from: 0, to: 0 });
  assert.equal(chi.recommend, "skip");
});

test("win path: yaku in sight for a closed all-simples hand and for value honors", () => {
  const keys = (help) => Object.fromEntries(help.win_path.yaku_in_sight.map((entry) => [entry.key, entry.status]));
  // 234m 567p 345s 88s 56m and a drawn 5z: the 5z goes, thirteen simples are left.
  const simples = keys(coachOf(mk({ hands: ["234m567p345s88s56m"], draws: "5z" }), 0));
  assert.equal(simples["menzen-tsumo"], "available");
  assert.equal(simples.riichi, "available");
  assert.equal(simples.tanyao, "met");
  // Seat 0 is the East dealer in the east round: a pair of east is a value pair, one short of a pon, twice over.
  const east = keys(coachOf(mk({ hands: ["234m567p345s11z99m"], draws: "3z" }), 0));
  assert.equal(east["yakuhai-seat"], "near");
  assert.equal(east["yakuhai-round"], "near");
  assert.equal(east.tanyao, undefined);
  // Seat 1 is South: a pair of south counts for it, and a pair of east for the round.
  const south = mk({ hands: [undefined, "234m567p345s22z99m"], draws: "3z" });
  discard(south, 0, "3z");
  const mine = keys(coachOf(south, 1));
  assert.equal(mine["yakuhai-seat"], "near");
  assert.equal(mine["yakuhai-round"], undefined);
  // Nothing in a closed hand's chiitoitsu lean unless it is close.
  const pairs = keys(coachOf(mk({ hands: ["1133m4466p5577s1z"], draws: "9s" }), 0));
  assert.ok(["met", "near"].includes(pairs.chiitoitsu));
});

// ── 5. Calls ───────────────────────────────────────────────────────────────
test("call advice: a pon of the seat wind is a yaku and a step toward ready", () => {
  // Seat 1 is South. Pairs of south and nine man, one from ready; seat 0 throws a south.
  const state = mk({ hands: [undefined, "22z99m456p789p46s1z"], draws: "9s" });
  discard(state, 0, "2z");
  assert.equal(state.phase, "calls");
  const advice = coachOf(state, 1).call_advice;
  assert.equal(advice.length, 1);
  const pon = advice[0];
  assert.equal(pon.option.type, "pon");
  assert.equal(pon.recommend, "take");
  const code = (name) => pon.effects.find((effect) => effect.code === name);
  assert.ok(code("opens_hand_no_riichi"));
  assert.deepEqual(code("shanten_change"), { code: "shanten_change", from: 1, to: 0 });
  assert.deepEqual(code("gives_yaku"), { code: "gives_yaku", yaku: ["yakuhai-seat"] });
  assert.equal(code("no_yaku_in_sight"), undefined);
});

test("call advice: a chi that spends a terminal on a closed all-simples hand loses its yaku", () => {
  // Seat 1 is ready on 4m or 7m with all simples; seat 0 throws a 1p and the chi would use 23p.
  const state = mk({ hands: [undefined, "234p567p345s88s56m"], draws: "9s" });
  discard(state, 0, "1p");
  assert.equal(state.phase, "calls");
  const advice = coachOf(state, 1).call_advice;
  const chi = advice.find((entry) => entry.option.type === "chi");
  assert.ok(chi);
  const code = (name) => chi.effects.find((effect) => effect.code === name);
  assert.deepEqual(code("shanten_change"), { code: "shanten_change", from: 0, to: 0 });
  assert.ok(code("opens_hand_no_riichi"));
  assert.deepEqual(code("loses_yaku"), { code: "loses_yaku", yaku: ["tanyao"] });
  assert.ok(code("no_yaku_in_sight"));
  assert.equal(chi.recommend, "skip");
});

test("call advice: a ron is always taken, with what it is worth", () => {
  const state = mk({ hands: [undefined, "234p567p345s88s56m"], draws: "4m" });
  discard(state, 0, "4m");
  assert.equal(state.phase, "calls");
  const advice = coachOf(state, 1).call_advice;
  const ron = advice.find((entry) => entry.option.type === "ron");
  assert.equal(ron.recommend, "take");
  const win = ron.effects[0];
  assert.equal(win.code, "wins_hand");
  assert.deepEqual(win.yaku.sort(), ["pinfu", "tanyao"]);
  // 2 han 30 fu, a non-dealer ron: 480 base, 1,920 paid up to 2,000.
  assert.deepEqual([win.han, win.fu, win.points], [2, 30, 2000]);
  assert.equal(win.limit, null);
});

test("call advice: riichi and kans are offered with their effects", () => {
  const state = mk({ hands: [SHANPON], draws: "9p" });
  const riichi = coachOf(state, 0).call_advice.find((entry) => entry.option.type === "riichi" && entry.option.kind === 17);
  assert.ok(riichi);
  assert.deepEqual(riichi.effects.map((effect) => effect.code), ["adds_yaku", "locks_hand", "costs_stick", "waits_left", "already_has_yaku"]);
  assert.equal(riichi.recommend, "either"); // the east pon already scores; the south wait needs the riichi
  const quad = mk({ hands: ["1111m456p789s22z5s"], draws: "9p" });
  const kan = coachOf(quad, 0).call_advice.find((entry) => entry.option.type === "ankan");
  assert.ok(kan);
  assert.ok(kan.effects.some((effect) => effect.code === "adds_dora_indicator"));
  assert.ok(kan.effects.some((effect) => effect.code === "keeps_closed"));
});

// ── 6. The review ──────────────────────────────────────────────────────────
test("review: a discard that broke a ready hand, then dealing in; where the winning tile's copies went", () => {
  // Seat 0 is ready on east or south, draws a 9p, and throws a 1m from its 123m. Seat 3 was waiting on 1m.
  const state = mk({ hands: [SHANPON, undefined, undefined, "23m456p789p234s55s"], draws: "9p" });
  discard(state, 0, "1m");
  assert.equal(state.phase, "calls");
  act(state, 3, { type: "ron" });
  assert.equal(state.phase, "over");

  assert.equal(coach.review({ log: state.log.slice(0, -1) }, 0), null);
  const mine = coach.review(state, 0);
  assert.equal(mine.outcome, "dealt_in");
  assert.equal(mine.ready_turn, 0); // ready from the deal
  assert.equal(mine.final.won, false);
  assert.equal(mine.final.shanten, 1);
  assert.deepEqual(mine.moments, [
    { code: "discarded_winning_shape", turn: 1, discard: 0, from: 0, to: 1, better: [17] },
    { code: "dealt_in", to: 3, tile: 0 },
  ]);
  assert.equal(mine.delta, state.result.deltas[0]);
  // The 1m it threw is still in its own pond.
  const oneMan = mine.final.improve.find((entry) => entry.kind === 0);
  assert.equal(oneMan.copies.own_discards, 1);

  const winner = coach.review(state, 3);
  assert.equal(winner.outcome, "won_ron");
  assert.equal(winner.ready_turn, 0);
  assert.equal(winner.final.shanten, -1);
  assert.deepEqual(winner.final.waits.map((wait) => [wait.kind, wait.won_on]), [[0, true], [3, false]]);
  assert.deepEqual(winner.moments, []);
  // 1m: one thrown by seat 0, the other three nowhere in sight: all still in the wall.
  const one = winner.final.waits[0].copies;
  assert.deepEqual({ ...one, wall: null, dead_wall: null }, { own_hand: 0, own_melds: 0, own_discards: 0, other_discards: 1, other_melds: 0, other_hands: 0, dora_indicators: 0, wall: null, dead_wall: null, unseen: 3 });
  assert.equal(one.wall + one.dead_wall, 3);
  // And the split agrees with a count straight from the wall.
  const wallCount = (kind, from, to) => state.wall.slice(from, to).filter((tile) => kindOf(tile) === kind).length;
  assert.equal(one.wall, wallCount(0, state.livePos, 122));
  assert.equal(winner.final.waits[1].copies.wall + winner.final.waits[1].copies.dead_wall, 4);
  // A record that kept only its log can still say how many were unseen, and splits them once given the wall.
  const bare = coach.review({ log: state.log }, 3);
  assert.equal(bare.final.waits[0].copies.wall, null);
  assert.equal(bare.final.waits[0].copies.unseen, 3);
  assert.deepEqual(coach.review({ log: state.log }, 3, { wall: state.wall }).final.waits[0].copies, one);
});

/**
 * Seat 3 (23m 456p 789p 234s 55s, waiting on 1m and 4m) declares riichi on a 7z and then the others play
 * on. `draws` are the wall tiles in order; `finish` runs once the draws have been dealt out.
 */
function riichiHand(draws, finish) {
  const state = mk({ hands: [undefined, undefined, undefined, "23m456p789p234s55s"], draws });
  tsumogiri(state); // seat 0
  passAll(state);
  tsumogiri(state); // seat 1
  passAll(state);
  tsumogiri(state); // seat 2
  passAll(state);
  tsumogiri(state, true); // seat 3 throws its 7z and declares
  passAll(state);
  assert.ok(state.riichi[3] > 0); // a double riichi, on its first throw
  finish(state);
  assert.equal(state.phase, "over");
  return state;
}

test("review: dealing in to a riichi", () => {
  const state = riichiHand("9p5z6z7z1m", (hand) => {
    tsumogiri(hand); // seat 0 throws the 1m
    assert.deepEqual(waitingSeats(hand), [3]);
    act(hand, 3, { type: "ron" });
  });
  const mine = coach.review(state, 0);
  assert.equal(mine.outcome, "dealt_in");
  assert.deepEqual(mine.moments, [{ code: "dealt_in_after_riichi", to: 3, tile: 0, riichi_seat: 3 }]);
  const winner = coach.review(state, 3);
  assert.equal(winner.outcome, "won_ron");
  assert.ok(state.result.wins[0].yaku.some((entry) => entry.key === "double-riichi"));
});

test("review: folding with safe tiles, and winning by self-draw with 58 tiles left", () => {
  // 7z comes to seat 0 twice after the riichi: it is the tile seat 3 threw, so it is safe both times.
  const draws = "9p5z6z7z" + "7z6z5z1z" + "7z4z3z4m";
  const state = riichiHand(draws, (hand) => {
    for (let i = 0; i < 3; i += 1) {
      tsumogiri(hand);
      passAll(hand);
    }
    // seat 3 draws the 1z, and goes on; seat 0 throws its second 7z.
    tsumogiri(hand);
    passAll(hand);
    for (let i = 0; i < 3; i += 1) {
      tsumogiri(hand);
      passAll(hand);
    }
    // seat 3 draws the 4m
    assert.equal(hand.turn, 3);
    act(hand, 3, { type: "tsumo" });
  });
  assert.equal(round.remaining(state), 122 - 52 - 12);
  const folded = coach.review(state, 0);
  assert.equal(folded.outcome, "lost_to_tsumo");
  assert.deepEqual(folded.moments, [{ code: "folded_safely", against: 3, discards: 2 }]);
  const winner = coach.review(state, 3);
  assert.equal(winner.outcome, "won_tsumo");
  assert.deepEqual(winner.moments, [{ code: "won_by_draw_with_n_left", left: 58 }]);
  assert.deepEqual(winner.final.waits.map((wait) => [wait.kind, wait.won_on]), [[0, false], [3, true]]);
});

test("review is reachable from the seat's end-of-hand view and keeps the older fields", () => {
  const state = mk({ hands: [SHANPON, undefined, undefined, "23m456p789p234s55s"], draws: "9p" });
  discard(state, 0, "1m");
  act(state, 3, { type: "ron" });
  const help = view.seatHand(state, 0, { coach: true }).help.coach;
  assert.deepEqual(help.discards, []);
  assert.deepEqual(help.best, []);
  assert.equal(help.review.outcome, "dealt_in");
  assert.equal(help.shanten, 1);
});

// ── 7. Cost ────────────────────────────────────────────────────────────────
test("a coached turn is worked out in well under 15 ms and only once per position", () => {
  const state = mk({ hands: ["234m567m345p88s46s"], draws: "7z" });
  const started = process.hrtime.bigint();
  const first = coachOf(state, 0);
  const cold = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(cold < 100, `cold ${cold} ms`);
  const again = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(coachOf(state, 0), first);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 - again < 15);
  const times = [];
  for (let i = 0; i < 30; i += 1) {
    const copy = structuredClone(state);
    const t = process.hrtime.bigint();
    coachOf(copy, 0);
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[Math.floor(times.length / 2)] < 15, `median ${times[15]} ms`);
});
