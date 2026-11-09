const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// Pools and margin (docs/design/predictions-pools.md): parimutuel payouts with no rake, the margin
// line and who gets one, life in the red, voids and corrections, and the prediction-pools flag.
//
// These are about a pool's own rules, so they run without the net worth floor and with bets able to
// reach Cash: that's how bets placed before Credit-only refund, and it stays one setting away.
// side-mode-floor.test.js covers both rules as they are in production.
process.env.ECONOMY_SIDE_MODE_FUNDS = "credit_then_cash";
process.env.ECONOMY_SIDE_MODE_MIN_NET_WORTH = "0";

const poolMath = require("../src/services/predictions/poolMath");
const margin = require("../src/services/margin");
const economy = require("../src/services/economy");
const features = require("../src/features");

// ── Payout math ──────────────────────────────────────────────────────────
const stakes = (list) => list.map(([key, outcomeId, stake]) => ({ key, outcomeId, stake }));

test("winners split the whole pool in proportion to stake", () => {
  // The design doc's example: $30k on A, $50k on B, $20k on C; A wins.
  const result = poolMath.settle(stakes([["me", "A", 6000], ["a2", "A", 24000], ["b", "B", 50000], ["c", "C", 20000]]), "A");
  assert.equal(result.mode, "paid");
  assert.equal(result.total, 100000);
  assert.equal(result.winnerTotal, 30000);
  assert.equal(result.payouts.get("me"), 20000);
  assert.equal(result.payouts.get("a2"), 80000);
  assert.equal(result.payouts.get("b"), 0);
  assert.equal(result.payouts.get("c"), 0);
  assert.equal(result.dust, 0);
});

test("payouts round down to the cent and never add up to more than the pool", () => {
  const result = poolMath.settle(stakes([["x", 1, 1000], ["y", 1, 1000], ["z", 1, 1000], ["n", 2, 1000.01]]), 1);
  for (const key of ["x", "y", "z"]) assert.equal(result.payouts.get(key), 1333.33);
  assert.equal(result.dust, 0.02);

  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let run = 0; run < 500; run += 1) {
    const list = [];
    const options = 2 + Math.floor(random() * 8);
    for (let i = 0; i < 1 + Math.floor(random() * 40); i += 1) list.push([`p${i}`, Math.floor(random() * options), Math.round((1000 + random() * 500000) * 100) / 100]);
    const winner = Math.floor(random() * options);
    const settled = poolMath.settle(stakes(list), winner);
    const paid = [...settled.payouts.values()].reduce((sum, value) => sum + Math.round(value * 100), 0);
    const total = list.reduce((sum, [, , stake]) => sum + Math.round(stake * 100), 0);
    assert.ok(paid <= total, `paid ${paid} of ${total}`);
    if (settled.mode === "paid") {
      const winners = list.filter(([, outcome]) => outcome === winner).length;
      assert.ok(total - paid < winners, "dust is under a cent per winner");
    } else {
      assert.equal(paid, total, "a pool nobody backed the winner of refunds everything");
    }
  }
});

test("nobody on the winner means everyone gets their stake back", () => {
  const result = poolMath.settle(stakes([["a", "A", 5000], ["b", "B", 7000]]), "C");
  assert.equal(result.mode, "no_winner");
  assert.equal(result.payouts.get("a"), 5000);
  assert.equal(result.payouts.get("b"), 7000);
});

test("a one-sided pool pays its bettors back their stakes, whichever way it goes", () => {
  const won = poolMath.settle(stakes([["a", "A", 5000], ["b", "A", 2500]]), "A");
  assert.equal(won.payouts.get("a"), 5000);
  assert.equal(won.payouts.get("b"), 2500);
  const lost = poolMath.settle(stakes([["a", "A", 5000], ["b", "A", 2500]]), "B");
  assert.equal(lost.mode, "no_winner");
  assert.equal(lost.payouts.get("a"), 5000);
});

test("odds and the bet slip preview", () => {
  const odds = poolMath.odds([30000, 50000, 20000, 0]);
  assert.deepEqual(odds.map((entry) => entry.share), [0.3, 0.5, 0.2, 0]);
  assert.ok(Math.abs(odds[0].multiplier - 10 / 3) < 1e-12);
  assert.equal(odds[3].multiplier, null);
  // $6,000 more on A: the pool is $106k, A $36k, so it pays 6000 × 106/36.
  const preview = poolMath.preview({ total: 100000, optionTotal: 30000, amount: 6000 });
  assert.equal(preview.payout, 17666.66);
  assert.equal(preview.profit, 11666.66);
  // Adding to a stake already there previews the whole stake.
  const raise = poolMath.preview({ total: 100000, optionTotal: 30000, mine: 6000, amount: 4000 });
  assert.equal(raise.stake, 10000);
  assert.equal(raise.payout, Math.floor((10000 * 104000 * 100) / 34000) / 100);
});

// ── Margin rules ─────────────────────────────────────────────────────────
test("the margin line is 25% of share value, at most $100,000", () => {
  assert.equal(margin.computeLine(80000), 20000);
  assert.equal(margin.computeLine(10_000_000), 100000);
  assert.equal(margin.computeLine(0), 0);
  assert.equal(margin.computeLine(-50), 0);
  assert.equal(margin.computeLine(1234.57), 308.64);
});

test("only verified accounts 7+ days old and not suspended can borrow", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const old = { created_at: "2026-10-01T00:00:00Z", email_verified: true };
  assert.equal(margin.eligibility(old, { now }).eligible, true);
  assert.equal(margin.eligibility({ ...old, email_verified: false }, { now }).reason, "email_verification_required");
  const young = margin.eligibility({ created_at: "2026-11-02T12:00:00Z", email_verified: true }, { now });
  assert.equal(young.reason, "margin_account_too_new");
  assert.equal(young.available_at, "2026-11-09T12:00:00.000Z");
  assert.equal(margin.eligibility({ ...old, suspended_at: "2026-11-05T00:00:00Z", suspended_until: null }, { now }).reason, "account_suspended");
  assert.equal(margin.eligibility({ ...old, suspended_at: "2026-11-01T00:00:00Z", suspended_until: "2026-11-02T00:00:00Z" }, { now }).eligible, true, "a lifted suspension doesn't count");
});

test("the Saturday conversion leaves negative Credit alone", () => {
  const plan = economy.planCreditConversion([{ userId: 1, credit: "-13000" }, { userId: 2, credit: "200000" }], { rate: 0.05, minimum: 10000 });
  assert.deepEqual(plan.moves.map((move) => move.userId), [2]);
});

test("pools ship behind the prediction-pools flag at staff", () => {
  // Read from the file, not the running state (the end-to-end test below overrides it).
  assert.equal(features.readFlags().get("prediction-pools")?.state, "staff");
});

// ── End to end, on a throwaway database ──────────────────────────────────
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("prediction pools and margin end to end", { skip: !databaseUrl, timeout: 240_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_predictions_pools_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_predictions_pools_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_predictions_pools_test";
  const pool = new Pool({ connectionString: target.href });
  // The flag file says "staff"; most of these run as players would once it's on.
  const restoreFlags = features.override({ "prediction-pools": "on" });
  t.after(async () => {
    restoreFlags();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });

  const { applySchema } = require("../src/migrations");
  const quiet = [console.warn, console.log];
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log] = quiet;
  }
  const core = require("../src/services/predictions/core");
  const pools = require("../src/services/predictions/pools");
  const markets = require("../src/services/predictions/markets");
  const auto = require("../src/services/predictions/auto");
  const resolution = require("../src/services/predictions/resolution");
  const trading = require("../src/services/predictions/trading");
  const shareTrading = require("../src/services/trading");

  // ── Fixtures ──
  const DAY = 86_400_000;
  const makeUser = async (name, { ageDays = 30, verified = true, flags = {} } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, created_at,
                                 is_admin, is_bookie, can_void_prediction_markets, can_resolve_prediction_markets)
       VALUES ($1, $1, $1 || '@example.test', $2, 'x', 'x', '{}', $3, $4, $5, $6, $7) RETURNING *`,
      [name, verified, new Date(Date.now() - ageDays * DAY), Boolean(flags.is_admin), Boolean(flags.is_bookie), Boolean(flags.can_void_prediction_markets), Boolean(flags.can_resolve_prediction_markets)]
    );
    const user = rows[0];
    await core.inTransaction(pool, (client) => core.cashBalance(client, user.id));
    return { ...user, id: Number(user.id) };
  };
  const setWallet = (user, { credit, cash }) =>
    pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = $2, cash_balance = $3 WHERE user_id = $1`, [user.id, credit, cash]);
  const wallet = async (user) => {
    const { rows } = await pool.query(`SELECT credit_balance, cash_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [user.id]);
    return { credit: Number(rows[0].credit_balance), cash: Number(rows[0].cash_balance) };
  };
  const total = (w) => Math.round((w.credit + w.cash) * 100) / 100;
  let assetCount = 0;
  const giveShares = async (user, value) => {
    assetCount += 1;
    const symbol = `T${assetCount}`;
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1, $2, $2, $2, true)`, [`UC${symbol}`, symbol]);
    const { rows } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_mid_price, current_fair_value, current_fair_value_raw)
       VALUES ($1, $2, $2, 'active', 100000, 100, 99900, 2000, 400, 100, 100, 100) RETURNING id`,
      [`UC${symbol}`, symbol]
    );
    await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, $3, 100)`, [user.id, rows[0].id, value / 100]);
    return { id: Number(rows[0].id), symbol };
  };
  const minutesFromNow = (n) => new Date(Date.now() + n * 60_000);
  const openPool = (bookie, input = {}) =>
    pools.createPool(pool, bookie, { title: "Who wins the relay?", options: ["Team A", "Team B", "Team C"], closes_at: minutesFromNow(120), ...input });
  const bet = (user, slug, outcome, amount, extra = {}) => pools.placeBet(pool, user, { slug, outcomeCode: outcome, amount, ...extra });
  const poolId = async (slug) => Number((await pool.query(`SELECT id FROM market.prediction_markets WHERE slug = $1`, [slug])).rows[0].id);
  const notices = async (user) => (await pool.query(`SELECT kind, title, body FROM market.notifications WHERE user_id = $1 ORDER BY id`, [user.id])).rows;

  const bookie = await makeUser("bookie", { flags: { is_bookie: true } });
  const staff = await makeUser("staffer", { flags: { can_void_prediction_markets: true, can_resolve_prediction_markets: true } });
  const owner = await makeUser("owner", { flags: { is_admin: true } });
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  const carol = await makeUser("carol");
  const dave = await makeUser("dave");
  const newbie = await makeUser("newbie", { ageDays: 2 });

  await t.test("only bookies open pools, with 2 to 100 options and a close 2 minutes to 28 days out", async () => {
    await assert.rejects(openPool(alice), { code: "forbidden" });
    await assert.rejects(openPool(bookie, { options: ["Only one"] }), { code: "invalid_pool", field: "options" });
    await assert.rejects(openPool(bookie, { options: Array.from({ length: 101 }, (_, i) => `Option ${i}`) }), { code: "invalid_pool", field: "options" });
    await assert.rejects(openPool(bookie, { options: ["Same", "same"] }), { code: "invalid_pool", field: "options" });
    await assert.rejects(openPool(bookie, { closes_at: minutesFromNow(1) }), { code: "invalid_pool", field: "closes_at" });
    await assert.rejects(openPool(bookie, { closes_at: minutesFromNow(29 * 24 * 60) }), { code: "invalid_pool", field: "closes_at" });
    const big = await openPool(bookie, { title: "Which of a hundred?", options: Array.from({ length: 100 }, (_, i) => `Option ${i + 1}`) });
    const detail = await pools.getPoolDetail(pool, big.slug, alice);
    assert.equal(detail.options.length, 100);
    assert.equal(detail.options[99].outcome_code, "o100");
    assert.equal(detail.status, "open");
    assert.equal(detail.pricing, "pool");
    // A deploy after a 100-option pool exists still migrates (the outcome code checks allow o100).
    await applySchema(pool);
  });

  await t.test("bets, raises and payouts follow the pool math, and money only moves between players", async () => {
    for (const user of [alice, bob, carol]) await setWallet(user, { credit: 100000, cash: 0 });
    const { slug } = await openPool(bookie);
    const before = await Promise.all([alice, bob, carol].map(wallet));
    await bet(alice, slug, "o1", 6000);
    await bet(bob, slug, "o1", 20000);
    await bet(bob, slug, "o1", 4000); // a raise
    await bet(carol, slug, "o2", 50000);
    await bet(alice, slug, "o3", 20000); // backing a second option
    await assert.rejects(bet(carol, slug, "o2", 999), { code: "invalid_amount", min_bet: 1000 });
    await assert.rejects(bet(bookie, slug, "o1", 5000), { code: "bookie_own_pool" });
    await assert.rejects(bet(alice, slug, "o9", 5000), { code: "invalid_outcome" });

    const detail = await pools.getPoolDetail(pool, slug, alice);
    assert.equal(detail.pool_total, 100000);
    assert.deepEqual(detail.options.map((option) => option.pool_stake), [30000, 50000, 20000]);
    assert.ok(Math.abs(detail.options[0].multiplier - 10 / 3) < 1e-12);
    assert.equal(detail.options[0].bettors.find((entry) => entry.username === "bob").stake, 24000, "a raise adds to the same stake");
    assert.equal(detail.bets[0].username, "alice");
    assert.equal(detail.can.bet, true);
    assert.equal((await pools.getPoolDetail(pool, slug, bookie)).can.bet, false, "the bookie can't bet in their own pool");
    // A stake is skin in it: bettors can post in the pool's thread, others can't.
    const predictionMarketDb = require("../src/predictionMarketDb");
    await predictionMarketDb.createPredictionMarketComment(pool, slug, alice.id, { body: "Red has the anchor leg." });
    await assert.rejects(predictionMarketDb.createPredictionMarketComment(pool, slug, dave.id, { body: "Just watching." }), { code: "prediction_market_comment_requires_position" });

    await assert.rejects(pools.resolvePool(pool, bookie, await poolId(slug), { outcome: "o1" }), { code: "resolution_note_required" });
    await assert.rejects(pools.resolvePool(pool, alice, await poolId(slug), { outcome: "o1", note: "mine" }), { code: "forbidden" });
    const result = await pools.resolvePool(pool, bookie, await poolId(slug), { outcome: "o1", sourceUrl: "https://example.test/relay" });
    assert.equal(result.mode, "paid");
    assert.equal(result.paid_out, 100000);
    const after = await Promise.all([alice, bob, carol].map(wallet));
    // Alice: 6k of 30k on A → 20k back; her 20k on C is gone. Bob: 24k of 30k → 80k.
    assert.equal(after[0].credit, before[0].credit - 26000 + 20000);
    assert.equal(after[1].credit, before[1].credit - 24000 + 80000);
    assert.equal(after[2].credit, before[2].credit - 50000);
    assert.equal(after.reduce((sum, w) => sum + total(w), 0), before.reduce((sum, w) => sum + total(w), 0), "no rake: nothing leaves the players");

    const record = (await pools.getPoolDetail(pool, slug, carol)).record;
    assert.equal(record.length, 1);
    assert.equal(record[0].action, "resolved");
    assert.equal(record[0].outcome_label, "Team A");
    assert.equal(record[0].actor.username, "bookie");
    assert.equal(record[0].source_url, "https://example.test/relay");
    const bobNotices = await notices(bob);
    assert.equal(bobNotices.at(-1).kind, "prediction_won");
    assert.match(bobNotices.at(-1).body, /\$80,000\.00 paid to your Credit/);
    assert.equal((await notices(carol)).at(-1).kind, "prediction_lost");
    await assert.rejects(bet(carol, slug, "o2", 5000), { code: "prediction_market_closed" });

    const history = await pools.listHistory(pool, alice, { mine: true });
    const entry = history.items.find((item) => item.slug === slug);
    assert.equal(entry.winner_label, "Team A");
    assert.deepEqual(entry.mine, { staked: 26000, paid: 20000, net: -6000 });
  });

  await t.test("nobody on the winner refunds everyone, Cash back as Cash", async () => {
    await setWallet(alice, { credit: 1000, cash: 9000 });
    await setWallet(bob, { credit: 50000, cash: 0 });
    const { slug } = await openPool(bookie);
    await bet(alice, slug, "o1", 5000); // 1,000 Credit then 4,000 Cash
    await bet(bob, slug, "o2", 7000);
    const result = await pools.resolvePool(pool, bookie, await poolId(slug), { outcome: "o3", note: "Team C took it" });
    assert.equal(result.mode, "no_winner");
    assert.deepEqual(await wallet(alice), { credit: 1000, cash: 9000 });
    assert.deepEqual(await wallet(bob), { credit: 50000, cash: 0 });
    assert.match((await notices(alice)).at(-1).body, /nobody had backed it/);
  });

  await t.test("margin: borrow up to the line, opt in, then you're in the red", async () => {
    await setWallet(alice, { credit: 0, cash: 2000 });
    await giveShares(alice, 80000); // line: 20,000
    await setWallet(bob, { credit: 100000, cash: 0 });
    const { slug } = await openPool(bookie);
    await bet(bob, slug, "o2", 30000);

    await assert.rejects(bet(alice, slug, "o1", 15000), { code: "insufficient_credit", margin_available: 20000 });
    await assert.rejects(bet(alice, slug, "o1", 22001, { useMargin: true }), { code: "margin_line_exceeded", line: 20000 });
    const placed = await bet(alice, slug, "o1", 15000, { useMargin: true });
    assert.deepEqual([placed.bet.from_credit, placed.bet.from_cash, placed.bet.borrowed], [0, 2000, 13000]);
    assert.deepEqual(await wallet(alice), { credit: -13000, cash: 0 });
    assert.equal(placed.wallet.owed, 13000);

    // One borrowed bet at a time: in the red, nothing else.
    await assert.rejects(bet(alice, slug, "o1", 1000, { useMargin: true }), { code: "in_the_red", owed: 13000 });
    const detail = await pools.getPoolDetail(pool, slug, alice);
    assert.equal(detail.mine.margin.in_red, true);
    assert.equal(detail.mine.margin.available, 0);
    assert.equal(detail.mine.stakes[0].borrowed, 13000);

    // Winning repays the debt first: the payout lands on the negative balance.
    await pools.resolvePool(pool, bookie, await poolId(slug), { outcome: "o1", note: "A won" });
    assert.deepEqual(await wallet(alice), { credit: 32000, cash: 0 }, "45,000 paid, 13,000 of it to the debt");
    assert.match((await notices(alice)).at(-1).body, /\$13,000\.00 of it paid back what you owed on margin/);
  });

  await t.test("margin needs shares, an account 7 days old and a verified email", async () => {
    const { slug } = await openPool(bookie);
    await setWallet(carol, { credit: 1000, cash: 0 });
    await assert.rejects(bet(carol, slug, "o1", 2000, { useMargin: true }), { code: "margin_line_exceeded", line: 0 }, "no shares, no line");
    const young = await makeUser("young", { ageDays: 8 });
    await pool.query(`UPDATE market.users SET created_at = now() - interval '6 days' WHERE id = $1`, [young.id]);
    await giveShares(young, 40000);
    await setWallet(young, { credit: 0, cash: 0 });
    await assert.rejects(bet(young, slug, "o1", 1000, { useMargin: true }), { code: "margin_account_too_new" });
    const unverified = await makeUser("unverified", { verified: false });
    await giveShares(unverified, 40000);
    await setWallet(unverified, { credit: 0, cash: 0 });
    await assert.rejects(bet(unverified, slug, "o1", 1000, { useMargin: true }), { code: "email_verification_required" });
    await pool.query(`UPDATE market.users SET suspended_at = now() WHERE id = $1`, [carol.id]);
    await giveShares(carol, 40000);
    await assert.rejects(bet(carol, slug, "o1", 2000, { useMargin: true }), { code: "account_suspended" });
    await pool.query(`UPDATE market.users SET suspended_at = NULL WHERE id = $1`, [carol.id]);
    await bet(carol, slug, "o1", 2000, { useMargin: true });
    assert.deepEqual(await wallet(carol), { credit: -1000, cash: 0 });
  });

  await t.test("in the red: no spending anywhere, fees still land, and Cash from a sale repays first", async () => {
    // Carol owes 1,000 from the test above.
    const credit = () => wallet(carol).then((w) => w.credit);
    const spend = (amount) => core.inTransaction(pool, (client) => economy.charge(client, carol.id, amount, { from: "credit_then_cash", entryType: "game_entry_fee", referenceType: "game_session", referenceId: 1 }));
    await pool.query(`UPDATE market.portfolio_cash_balances SET cash_balance = 0 WHERE user_id = $1`, [carol.id]);
    await assert.rejects(spend(10), { code: "in_the_red", owed: 1000 });
    // A share fee (a charge with a shortfall) still goes through, deeper into the red.
    await core.inTransaction(pool, (client) => economy.charge(client, carol.id, 50, { from: "credit_then_cash", shortfall: "cash", entryType: "share_fee", referenceType: "weekly_evaluation", referenceId: 1 }));
    assert.equal(await credit(), -1000);
    assert.equal((await wallet(carol)).cash, -50);

    // A share buy is refused at the order, even with Cash on hand; a sell isn't.
    const asset = (await pool.query(`SELECT a.symbol FROM market.portfolio_holdings h JOIN market.market_assets a ON a.id = h.asset_id WHERE h.user_id = $1`, [carol.id])).rows[0];
    await pool.query(`UPDATE market.portfolio_cash_balances SET cash_balance = 100000 WHERE user_id = $1`, [carol.id]);
    await require("../src/services/marketState").getMarketStatus(pool);
    await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'open'`);
    await assert.rejects(shareTrading.submitLiveOrder(pool, { userId: carol.id, symbol: asset.symbol, side: "buy", quantity: 1 }), { code: "in_the_red", owed: 1000 });
    const sell = await shareTrading.submitLiveOrder(pool, { userId: carol.id, symbol: asset.symbol, side: "sell", quantity: 1 });
    assert.ok(sell, "selling to pay it back is fine");

    // The sweep moves Cash into the debt.
    const swept = await margin.sweep(pool);
    assert.deepEqual(swept, [{ user_id: carol.id, amount: 1000 }]);
    assert.deepEqual(await wallet(carol), { credit: 0, cash: 99000 });
    await spend(10);
    const ledger = await pool.query(`SELECT cash_delta, credit_delta FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'margin_repay'`, [carol.id]);
    assert.deepEqual(ledger.rows.map((row) => [Number(row.cash_delta), Number(row.credit_delta)]), [[-1000, 1000]]);

    // "Repay now" covers part of a debt when that's all the Cash there is.
    await setWallet(carol, { credit: -500, cash: 200 });
    assert.deepEqual(await margin.repay(pool, carol.id), { repaid: 200, owed: 300, cash: 0, credit: -300 });
    await setWallet(carol, { credit: 100000, cash: 0 });
  });

  await t.test("accounts under 7 days can have $10,000 staked across open pools", async () => {
    await setWallet(newbie, { credit: 100000, cash: 10000 });
    const first = await openPool(bookie);
    const second = await openPool(bookie);
    await bet(newbie, first.slug, "o1", 6000);
    await assert.rejects(bet(newbie, second.slug, "o1", 5000), { code: "new_account_pool_cap", cap: 10000, staked: 6000 });
    await bet(newbie, second.slug, "o1", 4000);
    const me = await pools.getMyPools(pool, newbie);
    assert.equal(me.new_account.staked, 10000);
    assert.equal(me.open.length, 2);
    // Once a pool finishes, its stake no longer counts.
    await pools.voidPool(pool, bookie, await poolId(first.slug), { reason: "Called off" });
    await bet(newbie, second.slug, "o2", 6000);
  });

  await t.test("a void puts everyone back, and cancels a margin bet's debt", async () => {
    await setWallet(alice, { credit: 0, cash: 3000 });
    await setWallet(bob, { credit: 40000, cash: 5000 });
    const { slug } = await openPool(bookie);
    await bet(alice, slug, "o1", 10000, { useMargin: true }); // 3,000 Cash, 7,000 borrowed
    await bet(bob, slug, "o2", 42000); // 40,000 Credit, 2,000 Cash
    assert.deepEqual(await wallet(alice), { credit: -7000, cash: 0 });
    await assert.rejects(pools.voidPool(pool, alice, await poolId(slug), {}), { code: "forbidden" });
    await pools.voidPool(pool, bookie, await poolId(slug), { reason: "Event canceled" });
    assert.deepEqual(await wallet(alice), { credit: 0, cash: 3000 });
    assert.deepEqual(await wallet(bob), { credit: 40000, cash: 5000 });
    const detail = await pools.getPoolDetail(pool, slug, alice);
    assert.equal(detail.status, "voided");
    assert.equal(detail.record.at(-1).action, "voided");
    assert.equal(detail.record.at(-1).refunded, 52000);
    assert.match((await notices(bob)).at(-1).body, /Event canceled\. \$42,000\.00 back where it came from/);
  });

  await t.test("staff can correct or void a result for 7 days; payouts are reversed first, even below zero", async () => {
    await setWallet(alice, { credit: 20000, cash: 0 });
    await setWallet(bob, { credit: 20000, cash: 0 });
    const { slug } = await openPool(bookie);
    const id = await poolId(slug);
    await bet(alice, slug, "o1", 10000);
    await bet(bob, slug, "o2", 10000);
    await pools.resolvePool(pool, bookie, id, { outcome: "o1", note: "Looked like A" });
    assert.equal((await wallet(alice)).credit, 30000);

    await assert.rejects(pools.correctPool(pool, bookie, id, { outcome: "o2", note: "It was B" }), { code: "forbidden" }, "a bookie can't correct");
    await assert.rejects(pools.correctPool(pool, staff, id, { outcome: "o1", note: "Same" }), { code: "same_outcome" });
    await pools.correctPool(pool, staff, id, { outcome: "o2", sourceUrl: "https://example.test/replay", note: "Photo finish: B" });
    assert.deepEqual(await wallet(alice), { credit: 10000, cash: 0 });
    assert.deepEqual(await wallet(bob), { credit: 30000, cash: 0 });
    const detail = await pools.getPoolDetail(pool, slug, bob);
    assert.deepEqual(detail.record.map((entry) => entry.action), ["resolved", "corrected"]);
    assert.equal(detail.record[1].previous_label, "Team A");
    assert.equal(detail.record[1].clawed_back, 20000);
    assert.match((await notices(alice)).at(-1).body, /was taken back first/);

    // Bob spends his winnings, then the result is voided: taking them back leaves him below zero.
    await setWallet(bob, { credit: 5000, cash: 0 });
    await pools.voidPool(pool, staff, id, { reason: "Race rerun" });
    assert.deepEqual(await wallet(bob), { credit: 5000 - 20000 + 10000, cash: 0 });
    assert.deepEqual(await wallet(alice), { credit: 20000, cash: 0 });

    // After 7 days, it stands.
    const { slug: later } = await openPool(bookie);
    await bet(alice, later, "o1", 1000);
    await pools.resolvePool(pool, bookie, await poolId(later), { outcome: "o1", note: "A" });
    await pool.query(`UPDATE market.prediction_markets SET resolved_at = now() - interval '8 days' WHERE slug = $1`, [later]);
    await assert.rejects(pools.correctPool(pool, staff, await poolId(later), { outcome: "o2", note: "B" }), { code: "correction_window_closed" });
    await assert.rejects(pools.voidPool(pool, staff, await poolId(later), { reason: "late" }), { code: "correction_window_closed" });
    await setWallet(bob, { credit: 100000, cash: 0 });
  });

  await t.test("nobody resolves a pool they have money in, and bookies close and extend their own", async () => {
    await setWallet(owner, { credit: 100000, cash: 0 });
    const { slug } = await openPool(bookie, { closes_at: minutesFromNow(60) });
    const id = await poolId(slug);
    await bet(owner, slug, "o1", 5000);
    const otherBookie = await makeUser("otherbookie", { flags: { is_bookie: true } });
    await assert.rejects(pools.resolvePool(pool, otherBookie, id, { outcome: "o1", note: "x" }), { code: "forbidden" });
    await assert.rejects(pools.resolvePool(pool, owner, id, { outcome: "o1", note: "x" }), { code: "bookie_has_stake" });
    await assert.rejects(pools.extendPool(pool, bookie, id, { closesAt: minutesFromNow(30) }), { code: "invalid_pool" }, "only later");
    await pools.extendPool(pool, bookie, id, { closesAt: minutesFromNow(240) });
    await pools.closePool(pool, bookie, id);
    await assert.rejects(bet(owner, slug, "o2", 5000), { code: "prediction_market_closed" });
    const mine = await pools.listBookiePools(pool, bookie);
    assert.ok(mine.pools.some((entry) => entry.slug === slug && entry.bettors === 1));
    await pools.resolvePool(pool, bookie, id, { outcome: "o2", note: "B" });
  });

  await t.test("the market maker's flows don't touch pools", async () => {
    const { slug } = await openPool(bookie);
    const id = await poolId(slug);
    await assert.rejects(trading.trade(pool, { userId: alice.id, slug, outcomeCode: "o1", side: "buy", amount: 100 }), { code: "prediction_market_closed" });
    await assert.rejects(trading.quote(pool, { slug, outcomeCode: "o1", side: "buy", amount: 100 }), { code: "prediction_market_closed" });
    await assert.rejects(resolution.propose(pool, owner, id, { outcome: "o1", sourceUrl: "https://example.test" }), { code: "prediction_market_transition_invalid" });
    // The generic void routes to the pool's.
    await setWallet(dave, { credit: 10000, cash: 0 });
    await bet(dave, slug, "o1", 4000);
    await resolution.voidMarket(pool, staff, id, { reason: "Staff void" });
    assert.deepEqual(await wallet(dave), { credit: 10000, cash: 0 });
    // Once pools are on for everyone, no new market-maker markets.
    await assert.rejects(markets.createMarket(pool, owner, { title: "An LMSR market", rules_text: "Rules for it here.", resolution_source_text: "Somewhere", closes_at: minutesFromNow(60) }), { code: "lmsr_retired" });
    await assert.rejects(auto.updateTemplate(pool, owner, "stream-peak", { enabled: true }), { code: "lmsr_retired" });
  });

  await t.test("auto pools: off to start, guarded on every bet, resolved from the data", async () => {
    const { rows: templates } = await pool.query(`SELECT key, enabled FROM market.prediction_auto_templates WHERE key IN ('stream-peak-pool', 'top-gainer-pool') ORDER BY key`);
    assert.deepEqual(templates.map((row) => [row.key, row.enabled]), [["stream-peak-pool", false], ["top-gainer-pool", false]]);
    await applySchema(pool);
    await auto.updateTemplate(pool, owner, "stream-peak-pool", { enabled: true, params: { talents: 50 } });
    await applySchema(pool);
    assert.equal((await pool.query(`SELECT enabled FROM market.prediction_auto_templates WHERE key = 'stream-peak-pool'`)).rows[0].enabled, true, "turning one on sticks across deploys");

    const channel = "UCKOR";
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1, 'Korone', 'Inugami Korone', 'KOR', true)`, [channel]);
    await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
       VALUES ($1, 'KOR', 'Inugami Korone', 'active', 10000, 0, 10000, 2000, 400)`,
      [channel]
    );
    let n = 0;
    const addStream = async (fields) => {
      n += 1;
      await pool.query(
        `INSERT INTO yt.livestream_sessions (youtube_channel_id, video_id, status, video_title, scheduled_start_at, actual_start_at, first_seen_at, last_seen_at, max_concurrent_viewers, updated_at)
         VALUES ($1, $2, $3, 'A stream', $4, $5, now(), now(), $6, now())`,
        [channel, `v${n}`, fields.status || "upcoming", fields.scheduled ?? null, fields.actual ?? null, fields.peak ?? null]
      );
      return `v${n}`;
    };
    for (const peak of [10000, 20000, 30000, 40000, 50000]) await addStream({ status: "ended", actual: new Date(Date.now() - DAY), peak });
    const video = await addStream({ scheduled: minutesFromNow(120) });
    await auto.runAutoTemplates(pool);
    const market = (await pool.query(`SELECT * FROM market.prediction_markets WHERE auto_key = $1`, [`stream-peak-pool:${video}`])).rows[0];
    assert.ok(market, "an auto pool opens on the scheduled stream");
    assert.equal(market.pricing, "pool");
    assert.equal(market.auto_data.line, 30000);
    const outcomes = (await pool.query(`SELECT outcome_code FROM market.prediction_market_outcomes WHERE market_id = $1 ORDER BY sort_order`, [market.id])).rows;
    assert.deepEqual(outcomes.map((row) => row.outcome_code), ["yes", "no"]);

    await setWallet(alice, { credit: 50000, cash: 0 });
    await setWallet(bob, { credit: 50000, cash: 0 });
    await bet(alice, market.slug, "yes", 10000);
    await bet(bob, market.slug, "no", 30000);
    await pool.query(`UPDATE yt.livestream_sessions SET status = 'live', actual_start_at = now() WHERE video_id = $1`, [video]);
    await assert.rejects(bet(bob, market.slug, "no", 1000), { code: "prediction_market_closed" }, "betting shuts the moment the stream starts");
    await auto.closeLockedMarkets(pool);
    await pool.query(`UPDATE yt.livestream_sessions SET status = 'ended', max_concurrent_viewers = 45000 WHERE video_id = $1`, [video]);
    await auto.resolveAutoMarkets(pool);
    const detail = await pools.getPoolDetail(pool, market.slug, alice);
    assert.equal(detail.status, "resolved");
    assert.equal(detail.resolution_outcome, "yes");
    assert.equal(detail.record[0].automatic, true);
    assert.equal((await wallet(alice)).credit, 40000 + 40000);

    // A bet that slipped in after the real start voids it.
    const late = await addStream({ scheduled: minutesFromNow(200) });
    await pool.query(`DELETE FROM market.prediction_markets WHERE auto_template = 'stream-peak-pool' AND status = 'resolved'`);
    await auto.runAutoTemplates(pool);
    const lateMarket = (await pool.query(`SELECT * FROM market.prediction_markets WHERE auto_key = $1`, [`stream-peak-pool:${late}`])).rows[0];
    await bet(bob, lateMarket.slug, "no", 5000);
    await pool.query(`UPDATE yt.livestream_sessions SET status = 'ended', actual_start_at = now() - interval '1 hour', max_concurrent_viewers = 1000 WHERE video_id = $1`, [late]);
    await auto.resolveAutoMarkets(pool);
    assert.equal((await pool.query(`SELECT status FROM market.prediction_markets WHERE id = $1`, [lateMarket.id])).rows[0].status, "voided");
  });

  await t.test("behind the flag: at `staff`, only admins see pools and the red rules leave everyone else alone", async () => {
    const { slug, id } = await openPool(bookie);
    let restore = features.override({ "prediction-pools": "staff" });
    try {
      await assert.rejects(pools.getPoolDetail(pool, slug, alice), { code: "prediction_market_not_found" });
      await assert.rejects(bet(alice, slug, "o1", 5000), { code: "prediction_market_not_found" });
      await assert.rejects(pools.listHistory(pool, alice), { code: "prediction_market_not_found" });
      const floor = await markets.listMarkets(pool, { tab: "live", viewer: alice });
      assert.equal(floor.items.filter((item) => item.pricing === "pool").length, 0);
      const adminFloor = await markets.listMarkets(pool, { tab: "live", viewer: owner });
      assert.ok(adminFloor.items.some((item) => item.slug === slug));
      await assert.rejects(markets.getMarketDetail(pool, slug, alice), { code: "prediction_market_not_found" });
      // The flag's "staff" is admins: bookies and prediction staff wait for "on" like everyone else,
      // and the generic close and void don't reach a pool they can't see.
      await assert.rejects(pools.getPoolDetail(pool, slug, bookie), { code: "prediction_market_not_found" });
      await assert.rejects(resolution.closeMarket(pool, staff, id), { code: "prediction_market_not_found" });
      await assert.rejects(resolution.voidMarket(pool, staff, id, { reason: "no" }), { code: "prediction_market_not_found" });
      // A player with Credit below zero (from a void, as today) still spends Cash as before.
      await setWallet(dave, { credit: -200, cash: 1000 });
      await core.inTransaction(pool, (client) => economy.charge(client, dave.id, 100, { from: "credit_then_cash", entryType: "game_entry_fee", referenceType: "game_session", referenceId: 2 }));
      assert.deepEqual(await wallet(dave), { credit: -200, cash: 900 });
      assert.deepEqual(await margin.sweep(pool), [], "and the sweep doesn't touch them");
      // An admin in the preview can bet, and an admin in the red is held to the red rules.
      await setWallet(owner, { credit: 10000, cash: 0 });
      await bet(owner, slug, "o1", 2000);
      await setWallet(owner, { credit: -200, cash: 1000 });
      await assert.rejects(
        core.inTransaction(pool, (client) => economy.charge(client, owner.id, 100, { from: "credit_then_cash", entryType: "game_entry_fee", referenceType: "game_session", referenceId: 3 })),
        { code: "in_the_red" }
      );
      assert.deepEqual(await margin.sweep(pool), [{ user_id: owner.id, amount: 200 }], "and the sweep repays them");
      restore();
      restore = features.override({ "prediction-pools": "off" });
      await assert.rejects(pools.getPoolDetail(pool, slug, owner), { code: "prediction_market_not_found" });
    } finally {
      restore();
    }
  });
});
