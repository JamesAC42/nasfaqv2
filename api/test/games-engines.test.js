const test = require("node:test");
const assert = require("node:assert/strict");
const duel = require("../src/services/games/tables/duelEngine");
const highLow = require("../src/services/games/tables/highLowEngine");
const { buildTimeline, replay, splitPool } = require("../src/services/games/sessions");

const card = (symbol, base, extra = {}) => ({ symbol, base, momentum: 0, move_pct: 0, unit: "gen0", rarity: "SR", price: 10, ...extra });

test("duel: first to three wins, picks stay hidden until both are in", () => {
  const decks = [
    [card("A", 30), card("B", 30), card("C", 30), card("D", 30), card("E", 30)],
    [card("V", 10), card("W", 10), card("X", 10), card("Y", 10), card("Z", 10)],
  ];
  let state = duel.setup({ decks, now: 0 });
  state = duel.tick(state, 3000);
  assert.equal(state.phase, "picking");
  for (let round = 0; round < 3; round += 1) {
    state = duel.act(state, 0, { type: "pick", card: round }, 1);
    assert.deepEqual(duel.publicState(state).picked, [true, false]);
    assert.throws(() => duel.act(state, 0, { type: "pick", card: 4 }, 1));
    state = duel.act(state, 1, { type: "pick", card: round }, 1);
    assert.equal(state.phase, "reveal");
    state = duel.tick(state, state.deadline);
  }
  assert.equal(state.phase, "done");
  assert.equal(state.winner, 0);
  assert.deepEqual(state.wins, [3, 0]);
});

test("duel: a used card can't be played twice and timeouts auto-pick", () => {
  const decks = [0, 1].map(() => [1, 2, 3, 4, 5].map((n) => card(`S${n}`, 20)));
  let state = duel.tick(duel.setup({ decks, now: 0 }), 3000);
  state = duel.act(state, 0, { type: "pick", card: 2 }, 1);
  state = duel.tick(state, state.deadline);
  assert.equal(state.phase, "reveal");
  assert.equal(state.history[0].auto[1], true);
  state = duel.tick(state, state.deadline);
  assert.throws(() => duel.act(state, 0, { type: "pick", card: 2 }, 1));
});

test("duel: conditions change power", () => {
  const a = card("A", 20, { momentum: 4, move_pct: 3 });
  const b = card("B", 25);
  assert.equal(duel.powerOf(a, b, { key: "volatility" }).total, 28);
  assert.equal(duel.powerOf(a, b, { key: "quiet" }).total, 20);
  assert.equal(duel.powerOf(a, b, { key: "underdog" }).total, 31);
  assert.equal(duel.powerOf(a, b, { key: "bull" }).total, 29);
});

test("high-low: doubles and ties score as designed", () => {
  const from = { rank: 7 };
  assert.equal(highLow.scoreCall({ dir: "higher" }, from, { rank: 9 }), 1);
  assert.equal(highLow.scoreCall({ dir: "lower" }, from, { rank: 9 }), 0);
  assert.equal(highLow.scoreCall({ dir: "higher", double: true }, from, { rank: 9 }), 2);
  assert.equal(highLow.scoreCall({ dir: "lower", double: true }, from, { rank: 9 }), -1);
  assert.equal(highLow.scoreCall({ dir: "higher", double: true }, from, { rank: 7 }), 0);
  assert.equal(highLow.scoreCall({ dir: "pass" }, from, { rank: 2 }), 0);
});

test("high-low: nine rounds then done, one double each", () => {
  let state = highLow.tick(highLow.setup({ now: 0 }), 3000);
  state = highLow.act(state, 0, { type: "call", dir: "higher", double: true }, 1);
  state = highLow.act(state, 1, { type: "call", dir: "lower" }, 1);
  state = highLow.tick(state, state.deadline);
  assert.throws(() => highLow.act(state, 0, { type: "call", dir: "higher", double: true }, 1));
  while (state.phase !== "done") state = highLow.tick(state, state.deadline);
  assert.equal(state.history.length, highLow.ROUNDS);
});

test("ticker tap: timelines are deterministic and replay scores server-side", () => {
  const a = buildTimeline("seed-1", ["AAA", "BBB"]);
  assert.deepEqual(a, buildTimeline("seed-1", ["AAA", "BBB"]));
  assert.notDeepEqual(a, buildTimeline("seed-2", ["AAA", "BBB"]));
  const perfect = a.filter((t) => t.kind !== "down").map((t) => ({ t: t.start_ms + 50, lane: t.lane }));
  const good = replay(a, perfect);
  const idle = replay(a, []);
  const reckless = replay(a, a.map((t) => ({ t: t.start_ms + 50, lane: t.lane })));
  assert.ok(good.score > 0);
  assert.equal(idle.score, 0);
  assert.ok(reckless.score < good.score);
});

test("ticker tap: pool split rescales for fewer winners and never overpays", () => {
  assert.deepEqual(splitPool(180, 2), [108, 72]);
  for (const winners of [1, 3, 7, 10]) {
    const total = splitPool(1234.56, winners).reduce((s, v) => s + v, 0);
    assert.ok(total <= 1234.56 + 1e-9);
  }
});
