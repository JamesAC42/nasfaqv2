const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const economy = require("../src/services/economy");
const features = require("../src/features");
const wallet = require("../src/services/games/wallet");
const core = require("../src/services/predictions/core");
const pools = require("../src/services/predictions/pools");

// Games, capsules, the card exchange and bets spend Credit only, so losing at them can't leave a
// player with no Cash to trade. Enough Credit is all they ask for: net worth doesn't matter. On a
// freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

// Every games-wallet entry that spends: pulls, fees, stakes, and buying on the card exchange.
const SPENDING = ["gacha_pull_fee", "game_entry_fee", "pvp_stake_debit", "exchange_purchase", "exchange_bid_hold", "exchange_trade_escrow", "exchange_trade_settle"];

test("the rules: Credit only, nothing about net worth, and the client hears about it", () => {
  assert.equal(economy.SETTINGS.sideModeFunds, "credit");
  assert.equal("sideModeMinNetWorth" in economy.SETTINGS, false);
  const settings = economy.publicSettings();
  assert.equal(settings.side_mode_funds, "credit");
  assert.equal("side_mode_min_net_worth" in settings, false);
  assert.equal(economy.sideModeSpendable({ credit: 100, cash: 5000 }), 100, "Cash isn't spendable here");
});

test("Credit only, whatever the net worth, end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_side_mode_credit_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_side_mode_credit_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_side_mode_credit_test";
  const pool = new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
  const saved = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = saved;
  }
  const restoreFlags = features.override({ "prediction-pools": "on" });
  t.after(async () => {
    restoreFlags();
    await pool.end();
  });

  const user = async (name, { cash = 0, credit = 0, flags = "" } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json${flags ? `, ${flags}` : ""})
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}'${flags ? ", true" : ""}) RETURNING id, username, is_admin, is_bookie`,
      [name]
    );
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, $2, $3)`, [rows[0].id, cash, credit]);
    return { ...rows[0], id: Number(rows[0].id) };
  };
  const balances = async (id) => {
    const { rows } = await pool.query(`SELECT cash_balance, credit_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [id]);
    return { cash: Number(rows[0].cash_balance), credit: Number(rows[0].credit_balance) };
  };
  const inTx = async (work) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const debit = (id, entryType, amount = 100) =>
    inTx((client) => wallet.debitCashForGameWithClient(client, { userId: id, amount, entryType, referenceType: "game_session", referenceId: 1 }));
  const predict = (id, amount, entryType = "prediction_buy") => inTx((client) => core.moveCash(client, id, -amount, { entryType, marketId: 1 }));
  const older = `UPDATE market.users SET created_at = now() - interval '60 days' WHERE id = $1`;

  await t.test("spending takes Credit and leaves Cash alone, and too little Credit is a refusal", async () => {
    const player = await user("player", { cash: 10000, credit: 60000 });
    await debit(player.id, "gacha_pull_fee");
    assert.deepEqual(await balances(player.id), { cash: 10000, credit: 59900 });
    const { rows } = await pool.query(`SELECT cash_delta, credit_delta FROM market.ledger_entries WHERE user_id = $1`, [player.id]);
    assert.equal(Number(rows[0].cash_delta), 0);
    assert.equal(Number(rows[0].credit_delta), -100);

    const cashRich = await user("cashrich", { cash: 200000, credit: 50 });
    for (const entryType of SPENDING) {
      await assert.rejects(debit(cashRich.id, entryType), { code: "insufficient_credit" }, entryType);
    }
    assert.deepEqual(await balances(cashRich.id), { cash: 200000, credit: 50 });
    await assert.rejects(predict(cashRich.id, 100), { code: "insufficient_credit" });
    assert.deepEqual(await balances(cashRich.id), { cash: 200000, credit: 50 });
  });

  await t.test("a low net worth with enough Credit spends in every side mode", async () => {
    // $1,000 in all: no shares, no Cash.
    const low = await user("low", { credit: 1000 });
    for (const entryType of SPENDING) await debit(low.id, entryType);
    await predict(low.id, 100);
    await predict(low.id, 100, "prediction_limit_reserve");
    assert.deepEqual(await balances(low.id), { cash: 0, credit: 100 });

    // What's left covers $100 and nothing more.
    for (const entryType of SPENDING) {
      await assert.rejects(debit(low.id, entryType, 100.01), { code: "insufficient_credit" }, entryType);
    }
    await assert.rejects(predict(low.id, 100.01), { code: "insufficient_credit" });
    assert.deepEqual(await balances(low.id), { cash: 0, credit: 100 });
    await debit(low.id, "gacha_pull_fee", 100);
    assert.deepEqual(await balances(low.id), { cash: 0, credit: 0 });
    await assert.rejects(debit(low.id, "gacha_pull_fee", 1), { code: "insufficient_credit" });
  });

  await t.test("Credit below zero can't be spent, and Cash is never reached for", async () => {
    const red = await user("red", { cash: 50000, credit: -100 });
    for (const entryType of SPENDING) {
      await assert.rejects(debit(red.id, entryType), { code: "in_the_red", owed: 100 }, entryType);
    }
    await assert.rejects(predict(red.id, 100), { code: "in_the_red" });
    assert.deepEqual(await balances(red.id), { cash: 50000, credit: -100 });
  });

  await t.test("pools: a low net worth bets with its Credit, and too little Credit is a refusal", async () => {
    const bookie = await user("bookie", { flags: "is_bookie", credit: 100000 });
    const { slug } = await pools.createPool(pool, { ...bookie, is_bookie: true }, {
      title: "Who wins the relay?",
      options: ["Team A", "Team B"],
      closes_at: new Date(Date.now() + 120 * 60_000).toISOString(),
    });
    const { rows: outcomes } = await pool.query(
      `SELECT o.outcome_code FROM market.prediction_market_outcomes o JOIN market.prediction_markets m ON m.id = o.market_id WHERE m.slug = $1 ORDER BY o.sort_order LIMIT 1`,
      [slug]
    );
    const outcomeCode = outcomes[0].outcome_code;

    const low = await user("lowbettor", { credit: 2000 });
    await pool.query(older, [low.id]);
    await pools.placeBet(pool, low, { slug, outcomeCode, amount: 1000 });
    assert.deepEqual(await balances(low.id), { cash: 0, credit: 1000 });

    const short = await user("shortbettor", { cash: 50000, credit: 500 });
    await pool.query(older, [short.id]);
    await assert.rejects(pools.placeBet(pool, short, { slug, outcomeCode, amount: 1000 }), { code: "insufficient_credit" });
    assert.deepEqual(await balances(short.id), { cash: 50000, credit: 500 });

    // Margin borrows past Credit and never reaches for Cash, then or when it's owed.
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCmargin', 'M')`);
    const { rows: assets } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_mid_price)
       VALUES ('UCmargin', 'MRG', 'Margin', 'active', 10000, 0, 10000, 2000, 400, 10) RETURNING id`
    );
    const borrower = await user("borrower", { cash: 5000, credit: 1000 });
    await pool.query(older, [borrower.id]);
    await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 8000, 10)`, [borrower.id, assets[0].id]);
    const placed = await pools.placeBet(pool, borrower, { slug, outcomeCode, amount: 5000, useMargin: true });
    assert.deepEqual([placed.bet.from_credit, placed.bet.from_cash, placed.bet.borrowed], [1000, 0, 4000]);
    assert.deepEqual(await balances(borrower.id), { cash: 5000, credit: -4000 });
    await assert.rejects(pools.placeBet(pool, borrower, { slug, outcomeCode, amount: 1000, useMargin: true }), { code: "in_the_red", owed: 4000 });
    assert.deepEqual(await balances(borrower.id), { cash: 5000, credit: -4000 });
  });
});
