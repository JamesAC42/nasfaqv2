const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// No share limit here: the buyback is what's being tested, not the allowance.
process.env.MARKET_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL = "100000000";

const { applySchema } = require("../src/migrations");
const trading = require("../src/services/trading");
const weekly = require("../src/services/weeklyEvaluation");
const pgNumeric = require("../src/services/pgNumeric");

// A buyback's offer only pays on shares held before the last tick ahead of it (docs/market/core-market.md).
// Shares bought after that tick sell at the frozen price, through the instant path, the queued
// estimate and the batch. On a freshly migrated database of its own.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const DB_NAME = "nasfaq_buyback_cutoff_test";
const FROZEN = 10;
const OFFER = 12; // day 0: 120%
const MAX = 1000;

test("a buyback pays its offer only on shares held before the cutoff", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${DB_NAME}`;
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await require("../src/services/achievements").tradeFillsIdle();
    await pool.end();
  });
  const quiet = [console.warn, console.log];
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log] = quiet;
  }
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);

  const close = (actual, expected, message) => assert.ok(Math.abs(Number(actual) - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
  const blend = (atOffer, quantity) => (atOffer * OFFER + (quantity - atOffer) * FROZEN) / quantity;
  const cutoff = new Date(Date.now() - 3 * 3_600_000);
  const hoursFromCutoff = (hours) => new Date(cutoff.getTime() + hours * 3_600_000);

  let userCount = 0;
  const user = async (name) => {
    userCount += 1;
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}') RETURNING id`,
      [`${name}_${userCount}`]
    );
    const id = Number(rows[0].id);
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 1000, 0)`, [id]);
    return id;
  };

  /**
   * A stock 600 shares over its max, with its holdings and the ledger that led to them (buys at
   * `hours` from the cutoff), then frozen into a buyback the way the evaluation starts one: the late
   * shares from weeklyEvaluation.startedLateShares.
   */
  const market = async (symbol, buys) => {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ($1, $2)`, [`UC${symbol}`, symbol]);
    const { rows } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
       VALUES ($1, $2, $2, 'active', $3, 0, $3, 2000, 400, $4, $4, $4) RETURNING id`,
      [`UC${symbol}`, symbol, MAX, FROZEN]
    );
    const assetId = Number(rows[0].id);
    const held = new Map();
    for (const { userId, quantity, hours } of buys) {
      await pool.query(
        `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id, created_at)
         VALUES ($1, $2, 'buy_asset_credit', $3, 0, 'trade_fill', 0, $4)`,
        [userId, assetId, quantity, hoursFromCutoff(hours)]
      );
      held.set(userId, (held.get(userId) || 0) + quantity);
    }
    for (const [userId, quantity] of held) {
      await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, $3, 9)`, [userId, assetId, quantity]);
    }
    const total = [...held.values()].reduce((sum, quantity) => sum + quantity, 0);
    assert.equal(total, MAX + 600);
    const { rows: buyback } = await pool.query(
      `INSERT INTO market.asset_buybacks (asset_id, frozen_price, target_max_supply, held_at_start, started_at, offer_cutoff_at)
       VALUES ($1, $2, $3, $4, now() - interval '1 hour', $5) RETURNING id`,
      [assetId, FROZEN, MAX, total, cutoff]
    );
    await pool.query(`UPDATE market.market_assets SET circulating_supply = $2, treasury_supply = 0, trading_state = 'buyback' WHERE id = $1`, [assetId, total]);
    const holdings = new Map([[String(assetId), new Map([...held].map(([userId, quantity]) => [userId, pgNumeric.parse(quantity)]))]]);
    const late = await weekly.startedLateShares(pool, [{ assetId }], holdings, cutoff);
    for (const row of late) {
      await pool.query(`INSERT INTO market.asset_buyback_late_shares (buyback_id, user_id, late_shares) VALUES ($1, $2, $3)`, [buyback[0].id, row.userId, row.late]);
    }
    return { assetId, late: new Map(late.map((row) => [row.userId, row.late])) };
  };

  const early = await user("early");
  const late = await user("late");
  const mixed = await user("mixed");
  const roundTrip = await user("roundtrip");
  const filler = await user("filler");
  const sell = (userId, symbol, quantity) => trading.executeOrder(pool, { userId, symbol, side: "sell", quantity, refreshDerivedState: false });

  await t.test("the start writes down what each holder added after the cutoff", async () => {
    const { late: written } = await market("BBA", [
      { userId: early, quantity: 300, hours: -2 },
      { userId: late, quantity: 300, hours: 1 },
      { userId: mixed, quantity: 200, hours: -2 },
      { userId: mixed, quantity: 100, hours: 1 },
      { userId: filler, quantity: 700, hours: -30 },
    ]);
    assert.equal(written.get(early), undefined, "held before the cutoff: nothing late");
    assert.equal(written.get(late), 300);
    assert.equal(written.get(mixed), 100);
    assert.equal(written.get(filler), undefined);
  });

  await t.test("a share held before the cutoff gets the offer", async () => {
    const result = await sell(early, "BBA", 20);
    close(result.executed_price, OFFER, "early seller");
  });

  await t.test("a share bought after the cutoff gets the frozen price", async () => {
    const result = await sell(late, "BBA", 20);
    close(result.executed_price, FROZEN, "late buyer");
  });

  await t.test("some of each: the shares held before get the offer, the rest the frozen price", async () => {
    const portfolio = await trading.getPortfolioSummary(pool, mixed);
    assert.equal(portfolio.holdings.find((row) => row.symbol === "BBA").buyback_offer_shares, 200, "the portfolio says 200 of the 300 get the offer");
    const result = await sell(mixed, "BBA", 250);
    close(result.executed_price, blend(200, 250), "mixed seller");
    const after = await sell(mixed, "BBA", 50);
    close(after.executed_price, FROZEN, "what's left was bought after the cutoff");
    const { holdings } = await trading.getPortfolioSummary(pool, early);
    assert.equal(holdings.find((row) => row.symbol === "BBA").buyback_offer_shares, 280);
  });

  await t.test("first come, first served: the offer still stops at the shares over the max", async () => {
    // 600 over, 340 sold back, 280 of them at the offer: 260 left at it.
    const { rows } = await pool.query(`SELECT circulating_supply - max_supply AS over FROM market.market_assets WHERE symbol = 'BBA'`);
    assert.equal(Number(rows[0].over), 260);
    const result = await sell(early, "BBA", 280);
    close(result.executed_price, blend(260, 280), "only the excess gets the offer");
    const { rows: buyback } = await pool.query(`SELECT shares_bought, cash_paid FROM market.asset_buybacks b JOIN market.market_assets a ON a.id = b.asset_id WHERE a.symbol = 'BBA'`);
    assert.equal(Number(buyback[0].shares_bought), 620);
  });

  await t.test("a holder who sold and bought back after the cutoff gets the offer only on what they kept", async () => {
    const { late: written } = await market("BBR", [
      { userId: roundTrip, quantity: 300, hours: -2 },
      { userId: roundTrip, quantity: -200, hours: 0.5 },
      { userId: roundTrip, quantity: 200, hours: 1 },
      { userId: filler, quantity: 1300, hours: -30 },
    ]);
    assert.equal(written.get(roundTrip), 200, "the 200 bought back are late");
    const result = await sell(roundTrip, "BBR", 300);
    close(result.executed_price, blend(100, 300), "the 100 held throughout get the offer");
  });

  await t.test("queued sells: the estimate and the batch give the same price", async () => {
    await market("BBQ", [
      { userId: early, quantity: 300, hours: -2 },
      { userId: late, quantity: 300, hours: 1 },
      { userId: mixed, quantity: 200, hours: -2 },
      { userId: mixed, quantity: 100, hours: 1 },
      { userId: filler, quantity: 700, hours: -30 },
    ]);
    const orders = {
      late: await trading.submitLiveOrder(pool, { userId: late, symbol: "BBQ", side: "sell", quantity: 20 }),
      mixed: await trading.submitLiveOrder(pool, { userId: mixed, symbol: "BBQ", side: "sell", quantity: 250 }),
      early: await trading.submitLiveOrder(pool, { userId: early, symbol: "BBQ", side: "sell", quantity: 20 }),
      // Behind their own queued 250, which takes the 200 held before the cutoff.
      mixedRest: await trading.submitLiveOrder(pool, { userId: mixed, symbol: "BBQ", side: "sell", quantity: 50 }),
    };
    const expected = { late: FROZEN, mixed: blend(200, 250), early: OFFER, mixedRest: FROZEN };
    for (const [name, order] of Object.entries(orders)) {
      const { rows } = await pool.query(`SELECT metadata_json FROM market.trade_orders WHERE id = $1`, [order.order_id]);
      close(rows[0].metadata_json.queued_indicative_price, expected[name], `${name}'s estimate`);
    }
    const batch = await trading.processDueLiveOrders(pool, { now: new Date(Date.now() + 15 * 60_000) });
    assert.equal(batch.filled, 4);
    assert.ok(!batch.row_by_row, "the batched path filled them");
    for (const [name, order] of Object.entries(orders)) {
      const { rows } = await pool.query(`SELECT price FROM market.trade_fills WHERE order_id = $1`, [order.order_id]);
      close(rows[0].price, expected[name], `${name}'s fill`);
    }
  });

  await t.test("a buyback with no late shares written (one started before this rule) pays the offer on every share", async () => {
    const { assetId } = await market("BBL", [
      { userId: late, quantity: 300, hours: 1 },
      { userId: filler, quantity: 1300, hours: -30 },
    ]);
    await pool.query(`DELETE FROM market.asset_buyback_late_shares WHERE buyback_id = (SELECT id FROM market.asset_buybacks WHERE asset_id = $1)`, [assetId]);
    const result = await sell(late, "BBL", 20);
    close(result.executed_price, OFFER, "no row: all of them");
  });
});
