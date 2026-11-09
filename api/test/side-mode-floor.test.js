const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const economy = require("../src/services/economy");
const features = require("../src/features");
const wallet = require("../src/services/games/wallet");
const core = require("../src/services/predictions/core");
const pools = require("../src/services/predictions/pools");
const { assertAboveFloor } = require("../src/services/sideModeFloor");

// Games, capsules, the card exchange and bets spend Credit only, so losing at them can't leave a
// player with no Cash to trade. And what can be lost to chance stops under a net worth floor. On a
// freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("the rules: Credit only, a $50,000 floor, and the client hears about both", () => {
  assert.equal(economy.SETTINGS.sideModeFunds, "credit");
  assert.equal(economy.SETTINGS.sideModeMinNetWorth, 50000);
  const settings = economy.publicSettings();
  assert.equal(settings.side_mode_funds, "credit");
  assert.equal(settings.side_mode_min_net_worth, 50000);
  assert.equal(economy.sideModeSpendable({ credit: 100, cash: 5000 }), 100, "Cash isn't spendable here");
});

test("Credit only and the net worth floor, end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_side_mode_floor_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_side_mode_floor_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_side_mode_floor_test";
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
  const floored = { code: "net_worth_floor", limit: 50000 };

  await t.test("spending takes Credit and leaves Cash alone, and too little Credit is a refusal", async () => {
    const player = await user("player", { cash: 10000, credit: 60000 });
    await debit(player.id, "gacha_pull_fee");
    assert.deepEqual(await balances(player.id), { cash: 10000, credit: 59900 });
    const { rows } = await pool.query(`SELECT cash_delta, credit_delta FROM market.ledger_entries WHERE user_id = $1`, [player.id]);
    assert.equal(Number(rows[0].cash_delta), 0);
    assert.equal(Number(rows[0].credit_delta), -100);

    const cashRich = await user("cashrich", { cash: 200000, credit: 50 });
    for (const entryType of ["gacha_pull_fee", "game_entry_fee", "pvp_stake_debit", "exchange_purchase", "exchange_bid_hold"]) {
      await assert.rejects(debit(cashRich.id, entryType), { code: "insufficient_credit" }, entryType);
    }
    assert.deepEqual(await balances(cashRich.id), { cash: 200000, credit: 50 });
    await assert.rejects(
      inTx((client) => core.moveCash(client, cashRich.id, -100, { entryType: "prediction_buy", marketId: 1 })),
      { code: "insufficient_credit" }
    );
    assert.deepEqual(await balances(cashRich.id), { cash: 200000, credit: 50 });
  });

  await t.test("under the floor, what can be lost to chance stops and the wallet is untouched", async () => {
    const low = await user("low", { cash: 5000, credit: 40000 });
    for (const entryType of ["gacha_pull_fee", "game_entry_fee", "pvp_stake_debit", "exchange_purchase", "exchange_bid_hold", "exchange_trade_escrow", "exchange_trade_settle"]) {
      await assert.rejects(debit(low.id, entryType), floored, entryType);
    }
    await assert.rejects(inTx((client) => core.moveCash(client, low.id, -100, { entryType: "prediction_buy", marketId: 1 })), floored);
    await assert.rejects(inTx((client) => core.moveCash(client, low.id, -100, { entryType: "prediction_limit_reserve", marketId: 1 })), floored);
    assert.deepEqual(await balances(low.id), { cash: 5000, credit: 40000 });
  });

  await t.test("under the floor, money still comes in, selling a card included", async () => {
    const low = await user("low2", { cash: 5000, credit: 40000 });
    await inTx((client) => core.moveCash(client, low.id, 250, { entryType: "prediction_sell", marketId: 1 }));
    await inTx((client) => core.moveCash(client, low.id, 250, { entryType: "prediction_payout", marketId: 1 }));
    await inTx((client) =>
      wallet.creditCashForGameWithClient(client, { userId: low.id, amount: 100, entryType: "game_prize_payout", referenceType: "game_session", referenceId: 1 })
    );
    await inTx((client) =>
      wallet.creditCashForGameWithClient(client, { userId: low.id, amount: 100, entryType: "exchange_sale", referenceType: "card_listing", referenceId: 1 })
    );
    assert.deepEqual(await balances(low.id), { cash: 5000, credit: 40700 });
  });

  await t.test("the floor counts everything net worth counts: shares, Cash and Credit, and exactly at it passes", async () => {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCfloor', 'F')`);
    const { rows: assets } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_mid_price)
       VALUES ('UCfloor', 'FLR', 'Floor', 'active', 10000, 0, 10000, 2000, 400, 10) RETURNING id`
    );
    const holder = await user("holder", { cash: 5000, credit: 5000 });
    await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 4000, 10)`, [holder.id, assets[0].id]);
    await assertAboveFloor(pool, holder.id);
    await debit(holder.id, "gacha_pull_fee");
    await assert.rejects(assertAboveFloor(pool, holder.id), floored, "one pull later they're under it");
    await assertAboveFloor(pool, holder.id, 0);
  });

  await t.test("pools: a bet stops under the floor, and one above it spends Credit", async () => {
    const bookie = await user("bookie", { flags: "is_bookie", credit: 100000 });
    const { slug } = await pools.createPool(pool, { ...bookie, is_bookie: true }, {
      title: "Who wins the relay?",
      options: ["Team A", "Team B"],
      closes_at: new Date(Date.now() + 120 * 60_000).toISOString(),
    });
    const older = `UPDATE market.users SET created_at = now() - interval '60 days' WHERE id = $1`;
    const { rows: outcomes } = await pool.query(
      `SELECT o.outcome_code FROM market.prediction_market_outcomes o JOIN market.prediction_markets m ON m.id = o.market_id WHERE m.slug = $1 ORDER BY o.sort_order LIMIT 1`,
      [slug]
    );
    const outcomeCode = outcomes[0].outcome_code;
    const low = await user("lowbettor", { cash: 5000, credit: 40000 });
    await pool.query(older, [low.id]);
    await assert.rejects(pools.placeBet(pool, low, { slug, outcomeCode, amount: 1000 }), floored);
    assert.deepEqual(await balances(low.id), { cash: 5000, credit: 40000 });

    const high = await user("highbettor", { cash: 10000, credit: 60000 });
    await pool.query(older, [high.id]);
    await pools.placeBet(pool, high, { slug, outcomeCode, amount: 1000 });
    assert.deepEqual(await balances(high.id), { cash: 10000, credit: 59000 });

    // Margin borrows past Credit and never reaches for Cash, then or when it's owed.
    const borrower = await user("borrower", { cash: 5000, credit: 1000 });
    await pool.query(older, [borrower.id]);
    await pool.query(
      `INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) SELECT $1, id, 8000, 10 FROM market.market_assets WHERE symbol = 'FLR'`,
      [borrower.id]
    );
    const placed = await pools.placeBet(pool, borrower, { slug, outcomeCode, amount: 5000, useMargin: true });
    assert.deepEqual([placed.bet.from_credit, placed.bet.from_cash, placed.bet.borrowed], [1000, 0, 4000]);
    assert.deepEqual(await balances(borrower.id), { cash: 5000, credit: -4000 });
    await assert.rejects(pools.placeBet(pool, borrower, { slug, outcomeCode, amount: 1000, useMargin: true }), { code: "in_the_red", owed: 4000 });
    assert.deepEqual(await balances(borrower.id), { cash: 5000, credit: -4000 });
  });
});
