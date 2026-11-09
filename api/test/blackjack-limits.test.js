const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const limits = require("../src/services/games/tables/blackjackLimits");
const blackjack = require("../src/services/games/tables/blackjack");
const { grantCash, parseArgs } = require("../scripts/grant-cash");

// Blackjack can't brick an account: it spends Credit only, a player's week stays inside a cap, there's
// a number of hands a day, and no bets under a net worth floor. The rules on their own first, then the
// real table on a freshly migrated database of its own.
const settings = { handsPerDay: 50, minNetWorth: 50000, weeklyRate: 0.05, weeklyMinimum: 10000 };
const plan = (facts = {}) => limits.planLimits({ credit: 100000, netWorth: 110000, weekNet: 0, openStakes: 0, handsToday: 0, ...facts }, settings);
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("rules: the weekly cap is what the player's Credit turns into Cash", () => {
  assert.equal(limits.weeklyLimitFor(0, settings), 10000);
  assert.equal(limits.weeklyLimitFor(100000, settings), 10000);
  assert.equal(limits.weeklyLimitFor(200000, settings), 10000);
  assert.equal(limits.weeklyLimitFor(400000, settings), 20000);
  assert.equal(limits.weeklyLimitFor(-500, settings), 10000);
});

test("rules: a fresh player can bet up to the cap", () => {
  const fresh = plan();
  assert.equal(fresh.blocked, null);
  assert.equal(fresh.max_bet, 10000);
  limits.assertCanBet(fresh, 10000);
  assert.throws(() => limits.assertCanBet(fresh, 10000.01), { code: "blackjack_bet_over_limit", max_bet: 10000 });
});

test("rules: a bet can't go past the cap on either side", () => {
  assert.equal(plan({ weekNet: -9000 }).max_bet, 1000);
  assert.equal(plan({ weekNet: 9500 }).max_bet, 500);
  assert.equal(plan({ weekNet: -10000 }).blocked, "weekly_limit");
  assert.equal(plan({ weekNet: 10000 }).blocked, "weekly_limit");
  assert.equal(plan({ weekNet: -25000 }).max_bet, 0);
  assert.throws(() => limits.assertCanBet(plan({ weekNet: 12500 }), 10), { code: "blackjack_weekly_limit", limit: 10000 });
});

test("rules: stakes out on other tables count against the loss side", () => {
  const open = plan({ weekNet: -5000, openStakes: 4000 });
  assert.equal(open.max_bet, 1000);
  assert.equal(plan({ openStakes: 10000 }).blocked, "weekly_limit");
  // They don't count on the way up: an open stake hasn't won anything.
  assert.equal(plan({ weekNet: 9000, openStakes: 500 }).max_bet, 1000);
});

test("rules: hands a day and the net worth floor", () => {
  assert.equal(plan({ handsToday: 49 }).blocked, null);
  assert.equal(plan({ handsToday: 50 }).blocked, "daily_limit");
  assert.throws(() => limits.assertCanBet(plan({ handsToday: 50 }), 10), { code: "blackjack_daily_limit", limit: 50 });
  assert.equal(plan({ netWorth: 50000 }).blocked, null);
  assert.equal(plan({ netWorth: 49999.99 }).blocked, "net_worth");
  assert.throws(() => limits.assertCanBet(plan({ netWorth: 1000 }), 10), { code: "blackjack_net_worth_floor", limit: 50000 });
  // The floor is the one to tell them about: it doesn't lift by waiting.
  assert.equal(plan({ netWorth: 1000, weekNet: -10000, handsToday: 50 }).blocked, "net_worth");
  assert.equal(plan({ netWorth: 1000 }).max_bet, 0);
});

test("rules: doubling needs room for the doubled stake on both sides", () => {
  assert.equal(limits.canDouble(plan({ openStakes: 5000 }), 5000), true);
  assert.equal(limits.canDouble(plan({ openStakes: 6000 }), 6000), false, "could lose 12,000");
  assert.equal(limits.canDouble(plan({ weekNet: 8000, openStakes: 1000 }), 1000), true);
  assert.equal(limits.canDouble(plan({ weekNet: 8000, openStakes: 2000 }), 2000), false, "could win past the cap");
  assert.equal(limits.canDouble(plan({ weekNet: -9000, openStakes: 1000 }), 1000), false, "the last of the room is on the table");
});

test("rules: env vars change the numbers, and bad ones fall back", () => {
  const set = limits.limitSettings({ BLACKJACK_HANDS_PER_DAY: "10", BLACKJACK_MIN_NET_WORTH: "75000" });
  assert.equal(set.handsPerDay, 10);
  assert.equal(set.minNetWorth, 75000);
  const fallback = limits.limitSettings({ BLACKJACK_HANDS_PER_DAY: "many", BLACKJACK_MIN_NET_WORTH: "-1" });
  assert.equal(fallback.handsPerDay, 50);
  assert.equal(fallback.minNetWorth, 50000);
});

async function waitFor(check, { timeoutMs = 20_000, everyMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

test("the real table: Credit only, the cap, the daily limit and the floor", { skip: !databaseUrl, timeout: 240_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_blackjack_limits_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_blackjack_limits_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_blackjack_limits_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const saved = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await require("../src/migrations").applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = saved;
  }

  const user = async (name, { cash = 0, credit = 0 }) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}') RETURNING id`,
      [name]
    );
    const id = Number(rows[0].id);
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, $2, $3)`, [id, cash, credit]);
    return id;
  };
  const wallet = async (id) => {
    const { rows } = await pool.query(`SELECT cash_balance, credit_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [id]);
    return { cash: Number(rows[0].cash_balance), credit: Number(rows[0].credit_balance) };
  };
  // A settled hand in the player's history, `ago` before now.
  const pastHand = async (id, { bet = 100, payout = 0, ago = "1 minute", status = "settled", outcome = "loss" } = {}) => {
    const { rows } = await pool.query(`INSERT INTO games.blackjack_rounds (table_key, status) VALUES ('low', $1) RETURNING id`, [status]);
    await pool.query(
      `INSERT INTO games.blackjack_bets (round_id, user_id, seat, bet_cash, outcome, payout_cash, created_at) VALUES ($1, $2, 0, $3, $4, $5, now() - $6::interval)`,
      [rows[0].id, id, bet, outcome, payout, ago]
    );
  };

  await blackjack.init(pool);

  // Cash doesn't count: a player with only Cash can't bet, and their Cash stays put.
  const cashOnly = await user("cashonly", { cash: 200000 });
  await blackjack.sit({ userId: cashOnly, tableKey: "low", seat: 0 });
  await assert.rejects(blackjack.bet({ userId: cashOnly, tableKey: "low", amount: 50 }), { code: "blackjack_no_credit" });
  assert.deepEqual(await wallet(cashOnly), { cash: 200000, credit: 0 });
  assert.equal(blackjack.getTable("low").round_id, null, "the failed bet leaves no round behind");
  await blackjack.leave({ userId: cashOnly, tableKey: "low" });

  // Credit pays, and when there's too little of it Cash doesn't top it up.
  const mixed = await user("mixed", { cash: 100000, credit: 30 });
  await blackjack.sit({ userId: mixed, tableKey: "low", seat: 0 });
  await assert.rejects(blackjack.bet({ userId: mixed, tableKey: "low", amount: 50 }), { code: "blackjack_no_credit" });
  assert.deepEqual(await wallet(mixed), { cash: 100000, credit: 30 });
  await blackjack.leave({ userId: mixed, tableKey: "low" });

  // Under the floor, whatever's in the wallet.
  const low = await user("low", { credit: 40000 });
  await blackjack.sit({ userId: low, tableKey: "low", seat: 0 });
  await assert.rejects(blackjack.bet({ userId: low, tableKey: "low", amount: 50 }), { code: "blackjack_net_worth_floor", limit: 50000 });
  await blackjack.leave({ userId: low, tableKey: "low" });

  // The week: this week's losses count, last week's and refunded rounds don't.
  const loser = await user("loser", { credit: 100000 });
  await pastHand(loser, { bet: 9900 });
  await pastHand(loser, { bet: 50000, ago: "8 days" });
  await pastHand(loser, { bet: 5000, status: "refunded", outcome: "refund", payout: 5000 });
  const before = await blackjack.limitsForPlayer({ userId: loser });
  assert.equal(before.week_net, -9900);
  assert.equal(before.max_bet, 100);
  assert.equal(before.hands_today >= 1, true);
  assert.ok(new Date(before.week_resets_at).getTime() > Date.now());
  assert.equal(new Date(before.week_resets_at).toLocaleString("en-US", { weekday: "long", hour: "numeric", hour12: false, timeZone: "America/New_York" }).startsWith("Saturday"), true);
  await blackjack.sit({ userId: loser, tableKey: "low", seat: 0 });
  await assert.rejects(blackjack.bet({ userId: loser, tableKey: "low", amount: 200 }), { code: "blackjack_bet_over_limit", max_bet: 100 });
  const placed = await blackjack.bet({ userId: loser, tableKey: "low", amount: 100 });
  assert.equal(placed.phase, "betting");
  const { rows: ledger } = await pool.query(
    `SELECT cash_delta, credit_delta FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'table_bet_debit'`,
    [loser]
  );
  assert.equal(ledger.length, 1);
  assert.equal(Number(ledger[0].cash_delta), 0, "the bet came out of Credit alone");
  assert.equal(Number(ledger[0].credit_delta), -100);
  const during = await blackjack.limitsForPlayer({ userId: loser });
  assert.equal(during.open_stakes, 100);
  assert.equal(during.blocked, "weekly_limit", "with the last of the room on the table, nothing more can be bet");

  // The hand plays out and the table goes back to idle.
  await waitFor(async () => {
    const table = blackjack.getTable("low");
    if (table.phase === "playing" && table.turn === 0) await blackjack.act({ userId: loser, tableKey: "low", action: "stand" }).catch(() => {});
    return table.phase === "idle";
  });
  await blackjack.leave({ userId: loser, tableKey: "low" });

  // The day: hands today count, yesterday's don't, and a day's limit says so.
  const busy = await user("busy", { credit: 100000 });
  for (let hand = 0; hand < 3; hand += 1) await pastHand(busy, { bet: 10, payout: 10, outcome: "push" });
  const quota = { ...limits.limitSettings(), handsPerDay: 3 };
  const client = await pool.connect();
  try {
    const stopped = await limits.readPlan(client, busy, quota);
    assert.equal(stopped.hands_today, 3);
    assert.equal(stopped.blocked, "daily_limit");
    assert.equal((await limits.readPlan(client, busy, { ...quota, handsPerDay: 4 })).blocked, null);
  } finally {
    client.release();
  }

  // Doubling: a stake that could go past the cap is refused, and the hand carries on.
  const doubler = await user("doubler", { credit: 100000 });
  await pastHand(doubler, { bet: 9000 });
  await blackjack.sit({ userId: doubler, tableKey: "low", seat: 0 });
  let tried = false;
  for (let attempt = 0; attempt < 12 && !tried; attempt += 1) {
    const net = (await blackjack.limitsForPlayer({ userId: doubler })).week_net;
    // Hold the player's room at $1,000 less their stake, whatever the last hand did.
    if (net !== -9000) {
      await pool.query(`DELETE FROM games.blackjack_bets WHERE user_id = $1`, [doubler]);
      await pastHand(doubler, { bet: 9000 });
    }
    await blackjack.bet({ userId: doubler, tableKey: "low", amount: 200 });
    await waitFor(async () => {
      const table = blackjack.getTable("low");
      if (table.phase === "playing" && table.turn === 0 && table.seats[0].hand.length === 2) {
        // $200 on the table and $800 of room: doubling fits, so take the room away first.
        await pool.query(`UPDATE games.blackjack_bets SET bet_cash = 9900 WHERE user_id = $1 AND outcome = 'loss'`, [doubler]);
        const creditBefore = (await wallet(doubler)).credit;
        await assert.rejects(blackjack.act({ userId: doubler, tableKey: "low", action: "double" }), { code: "blackjack_double_over_limit" });
        assert.equal((await wallet(doubler)).credit, creditBefore, "a refused double charges nothing");
        tried = true;
        await blackjack.act({ userId: doubler, tableKey: "low", action: "stand" });
      }
      return blackjack.getTable("low").phase === "idle";
    });
  }
  assert.ok(tried, "dealt a hand that could double within twelve tries");

  // The make-good: a dry run writes nothing, a grant pays Cash once, and an unknown name stops the run.
  const stuck = await user("stuck", { cash: 100, credit: 0 });
  const dry = await grantCash(pool, { names: ["stuck"], amount: 5000, grant: 20261109, apply: false });
  assert.equal(dry[0].status, "would pay");
  assert.equal((await wallet(stuck)).cash, 100);
  await assert.rejects(grantCash(pool, { names: ["stuck", "nobody"], amount: 5000, grant: 20261109, apply: true }), /no such player: nobody/);
  assert.equal((await wallet(stuck)).cash, 100);
  assert.equal((await grantCash(pool, { names: ["stuck"], amount: 5000, grant: 20261109, apply: true }))[0].status, "paid");
  assert.deepEqual(await wallet(stuck), { cash: 5100, credit: 0 });
  assert.equal((await grantCash(pool, { names: ["stuck"], amount: 5000, grant: 20261109, apply: true }))[0].status, "already paid");
  assert.equal((await wallet(stuck)).cash, 5100);
  const { rows: notes } = await pool.query(`SELECT title FROM market.notifications WHERE user_id = $1`, [stuck]);
  assert.deepEqual(notes.map((note) => note.title), ["A one-time $5,000 in Cash"]);
});

test("the grant script refuses bad arguments", () => {
  assert.throws(() => parseArgs(["--grant", "1", "someone"]), /--amount/);
  assert.throws(() => parseArgs(["--grant", "1", "--amount", "25001", "someone"]), /--amount/);
  assert.throws(() => parseArgs(["--amount", "5000", "someone"]), /--grant/);
  assert.throws(() => parseArgs(["--grant", "1", "--amount", "5000"]), /name at least one/);
  assert.deepEqual(parseArgs(["--grant", "7", "--amount", "5000", "Two Words", "--apply"]), { names: ["Two Words"], apply: true, amount: 5000, grant: 7 });
});
