const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const trading = require("../src/services/trading");

// An order fills from the quote the page shows (market_assets.current_mid_price and its bid and ask),
// however long ago the last trade or tick moved it: nothing fades in between. On a freshly migrated
// database (its own), through the instant path, the order estimate and the batch.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

const FAIR = 13.37;
const MID = 13.91; // above the mark: the case that filled low
const SPREAD_BPS = 400;
const DEPTH = 2000;
const HOURS_AGO = 6;

test("orders fill at the shown quote, hours after the last update", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_quote_fill_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_quote_fill_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_quote_fill_test";
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
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCquote', 'Quote')`);
  const { rows: assetRows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
     VALUES ('UCquote', 'QTE', 'Quote', 'active', 100000, 1000, 99000, $1, $2, $3, $3, $3) RETURNING id`,
    [DEPTH, SPREAD_BPS, FAIR]
  );
  const assetId = Number(assetRows[0].id);
  const { rows: userRows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('quote_tester', 'quote_tester', 'quote@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  const userId = Number(userRows[0].id);
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 100000, 0)`, [userId]);
  await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 500, 12)`, [userId, assetId]);

  const close = (actual, expected, message, tolerance = 1e-9) =>
    assert.ok(Math.abs(Number(actual) - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
  const half = SPREAD_BPS / 20000;
  const impact = trading.IMPACT_SETTINGS.persistentWeight + trading.IMPACT_SETTINGS.transientWeight;
  const slip = trading.IMPACT_SETTINGS.slippageWeight;

  /**
   * The stock as the last tick left it, `hours` ago: a stored mid above fair value, the offsets agreeing
   * with it the way the ticks write them (against that tick's base rate, `base`), and its quotes.
   */
  const setQuote = async ({ mid = MID, base = FAIR, persistent = 0.01, hours = HOURS_AGO } = {}) => {
    const transient = Math.log(mid / base) - persistent;
    await pool.query(
      `UPDATE market.market_assets
       SET current_mid_price = $2, current_bid_price = $3, current_ask_price = $4, current_persistent_offset = $5, current_transient_offset = $6,
           offsets_updated_at = now() - make_interval(hours => $7)
       WHERE id = $1`,
      [assetId, mid, mid * (1 - half), mid * (1 + half), persistent, transient, hours]
    );
  };
  const stored = async () => {
    const { rows } = await pool.query(
      `SELECT current_mid_price, current_bid_price, current_ask_price, current_fair_value, current_persistent_offset, current_transient_offset, offsets_updated_at
       FROM market.market_assets WHERE id = $1`,
      [assetId]
    );
    const row = rows[0];
    return {
      mid: Number(row.current_mid_price),
      bid: Number(row.current_bid_price),
      ask: Number(row.current_ask_price),
      fair: Number(row.current_fair_value),
      persistent: Number(row.current_persistent_offset),
      transient: Number(row.current_transient_offset),
      updatedAt: row.offsets_updated_at,
    };
  };
  const afterTrade = (mid, side, quantity) => mid * Math.exp((side === "buy" ? 1 : -1) * impact * (quantity / DEPTH));

  await t.test("a sale hours after the last tick fills at the shown bid less slippage, and moves the mid from there", async () => {
    await setQuote();
    const shown = await stored();
    const result = await trading.executeOrder(pool, { userId, symbol: "QTE", side: "sell", quantity: 8, refreshDerivedState: false });
    close(result.executed_price, shown.bid * (1 - slip * (8 / DEPTH)), "fill price");
    assert.ok(result.executed_price > shown.bid * 0.99, "nowhere near the faded price it used to fill at");
    const next = await stored();
    close(next.mid, afterTrade(MID, "sell", 8), "mid after");
    close(next.bid, next.mid * (1 - half), "bid after");
    close(next.ask, next.mid * (1 + half), "ask after");
    close(next.fair * Math.exp(next.persistent + next.transient), next.mid, "the offsets agree with the stored mid");
    assert.ok(Date.now() - new Date(next.updatedAt).getTime() < 60_000, "the trade stamps the offsets");
  });

  await t.test("a buy hours later fills at the shown ask plus slippage", async () => {
    await setQuote();
    const shown = await stored();
    const result = await trading.executeOrder(pool, { userId, symbol: "QTE", side: "buy", quantity: 40, refreshDerivedState: false });
    close(result.executed_price, shown.ask * (1 + slip * (40 / DEPTH)), "fill price");
    close((await stored()).mid, afterTrade(MID, "buy", 40), "mid after");
  });

  await t.test("below the mark too: a buy fills at the ask, not a higher faded price", async () => {
    await setQuote({ mid: 12.4, persistent: -0.02 });
    const shown = await stored();
    const result = await trading.executeOrder(pool, { userId, symbol: "QTE", side: "buy", quantity: 10, refreshDerivedState: false });
    close(result.executed_price, shown.ask * (1 + slip * (10 / DEPTH)), "fill price");
    close((await stored()).mid, afterTrade(12.4, "buy", 10), "mid after");
  });

  await t.test("the stored mid wins when the offsets were written against another base rate", async () => {
    // A tick restates the transient offset against its interval's base rate, which can differ from
    // current_fair_value; the page still shows the stored mid, and that's what fills.
    await setQuote({ base: 12.9 });
    const shown = await stored();
    assert.ok(Math.abs(shown.fair * Math.exp(shown.persistent + shown.transient) - shown.mid) > 0.1, "the offsets alone would price it elsewhere");
    const result = await trading.executeOrder(pool, { userId, symbol: "QTE", side: "sell", quantity: 20, refreshDerivedState: false });
    close(result.executed_price, shown.bid * (1 - slip * (20 / DEPTH)), "fill price");
    const next = await stored();
    close(next.mid, afterTrade(MID, "sell", 20), "mid after");
    close(next.fair * Math.exp(next.persistent + next.transient), next.mid, "and the offsets agree with it afterwards");
  });

  await t.test("queued orders: the estimate and the batch both start from the shown quote", async () => {
    await setQuote();
    const shown = await stored();
    const sell = await trading.submitLiveOrder(pool, { userId, symbol: "QTE", side: "sell", quantity: 30 });
    const { rows: orderRows } = await pool.query(`SELECT quote_bid_at_submit, quote_ask_at_submit, metadata_json FROM market.trade_orders WHERE id = $1`, [sell.order_id]);
    close(orderRows[0].quote_bid_at_submit, shown.bid, "the order's quote is the page's bid");
    close(orderRows[0].quote_ask_at_submit, shown.ask, "and its ask");
    close(orderRows[0].metadata_json.queued_mid_price, MID, "the estimate's mid", 1e-6);
    close(orderRows[0].metadata_json.queued_indicative_price, shown.bid * (1 - slip * (30 / DEPTH)), "the estimate", 1e-6);

    // The batch runs a while later still; the quote hasn't moved, so neither has the fill.
    const batch = await trading.processDueLiveOrders(pool, { now: new Date(Date.now() + 15 * 60_000) });
    assert.equal(batch.filled, 1);
    const { rows: fills } = await pool.query(`SELECT price FROM market.trade_fills WHERE order_id = $1`, [sell.order_id]);
    close(fills[0].price, shown.bid * (1 - slip * (30 / DEPTH)), "the batch fill");
    const next = await stored();
    close(next.mid, afterTrade(MID, "sell", 30), "mid after the batch");
    close(next.fair * Math.exp(next.persistent + next.transient), next.mid, "the offsets agree with it");
  });

  await t.test("a stock with no stored mid prices from its offsets, with nothing faded", async () => {
    const persistent = 0.02;
    const transient = 0.03;
    await pool.query(
      `UPDATE market.market_assets
       SET current_mid_price = NULL, current_bid_price = NULL, current_ask_price = NULL, current_persistent_offset = $2, current_transient_offset = $3,
           offsets_updated_at = now() - interval '6 hours'
       WHERE id = $1`,
      [assetId, persistent, transient]
    );
    const mid = FAIR * Math.exp(persistent + transient);
    const result = await trading.executeOrder(pool, { userId, symbol: "QTE", side: "sell", quantity: 5, refreshDerivedState: false });
    close(result.executed_price, mid * (1 - half) * (1 - slip * (5 / DEPTH)), "fill price");
    close((await stored()).mid, afterTrade(mid, "sell", 5), "mid after");
  });
});
