const test = require("node:test");
const assert = require("node:assert/strict");
const moments = require("../src/services/games/moments");

// A pool that records the query and hands back canned rows.
function fakePool(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

const player = { username: "honk", profile_color: "#ff8800", oshi_symbol: "pek", oshi_name: "Usada Pekora", oshi_color: "#7fb5ff" };

test("blackjack moment: a settled hand, public facts only", async () => {
  const pool = fakePool([
    {
      round_id: "412",
      seat: 2,
      bet_cash: "100",
      doubled: true,
      outcome: "win",
      payout_cash: "400",
      table_key: "mid",
      settled_at: "2026-11-05T21:00:00Z",
      dealer_json: { hand: [{ rank: "10", suit: "S" }, { rank: "6", suit: "H" }, { rank: "K", suit: "D" }], value: 26 },
      seats_json: [
        { seat: 0, username: "someone", hand: [{ rank: "9", suit: "C" }], outcome: "loss" },
        { seat: 2, username: "honk", hand: [{ rank: "5", suit: "S" }, { rank: "6", suit: "D" }, { rank: "Q", suit: "H" }], outcome: "win" },
      ],
      ...player,
    },
  ]);
  const moment = await moments.getMoment(pool, "blackjack", "412-2");
  assert.deepEqual(pool.calls[0].params, ["412", 2]);
  assert.match(pool.calls[0].sql, /r\.status = 'settled'/);
  assert.match(pool.calls[0].sql, /outcome <> 'refund'/);
  assert.equal(moment.id, "412-2");
  assert.equal(moment.table.name, "Mid table");
  assert.equal(moment.wager, 200);
  assert.equal(moment.net, 200);
  assert.equal(moment.hand.length, 3);
  assert.equal(moment.dealer.value, 26);
  assert.equal(moment.others, 1);
  assert.deepEqual(moment.player, { username: "honk", profile_color: "#ff8800", oshi: { symbol: "PEK", display_name: "Usada Pekora", color: "#7fb5ff" } });
  // Nothing that identifies the account beyond its public name.
  assert.equal(JSON.stringify(moment).includes("user_id"), false);
});

test("blackjack moment: bad ids never reach the database", async () => {
  const pool = fakePool([]);
  for (const id of ["412", "412-5", "412-x", "-1-2", "1;drop-2", "99999999999999999-1"]) {
    await assert.rejects(moments.getMoment(pool, "blackjack", id), { code: "moment_not_found" });
  }
  assert.equal(pool.calls.length, 0);
  await assert.rejects(moments.getMoment(pool, "blackjack", "412-1"), { code: "moment_not_found" });
  assert.equal(pool.calls.length, 1);
});

test("cards moment: the best card leads, unknown kinds are not found", async () => {
  const id = "0f8c6c57-8d2b-4d0e-9a51-2b6f4f8f0c11";
  const row = (rarity, symbol, extra = {}) => ({ card_key: `${symbol}:${rarity}`, rarity, was_new: false, was_featured: false, stars_after: 1, banner_key: "standard", created_at: "2026-11-05T21:00:00Z", symbol, display_name: symbol, color: null, ...player, ...extra });
  const pool = fakePool([row("C", "AKI"), row("UR", "MAR", { was_new: true }), row("SSR", "SUI"), row("UR", "PEK")]);
  const moment = await moments.getMoment(pool, "cards", id.toUpperCase());
  assert.deepEqual(pool.calls[0].params, [id]);
  assert.equal(moment.count, 4);
  assert.equal(moment.best.symbol, "MAR");
  assert.equal(moment.best.rarity_name, "Legend");
  assert.equal(moment.best.was_new, true);
  await assert.rejects(moments.getMoment(pool, "cards", "not-a-uuid"), { code: "moment_not_found" });
  await assert.rejects(moments.getMoment(pool, "duel", "1"), { code: "moment_not_found" });
  await assert.rejects(moments.getMoment(fakePool([]), "cards", id), { code: "moment_not_found" });
});
