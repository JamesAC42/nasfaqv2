const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const trading = require("../src/services/trading");
const netWorth = require("../src/services/netWorth");

// Queued buys hold their cost out of spendable cash when they're placed, on a freshly migrated
// database (its own): the hold, refusing orders the cash can't cover, cancel and reject giving it
// back, the batch charging the real price and returning the rest, queued sells reserving shares, and
// net worth counting held cash.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("live orders hold their cash", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_holds_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_holds_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_holds_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    // Fills kick off achievement checks in the background; let them finish first.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const quiet = console.warn;
  console.warn = () => {};
  const log = console.log;
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    console.warn = quiet;
    console.log = log;
  }

  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCtest', 'Test')`);
  const { rows: assetRows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
     VALUES ('UCtest', 'TST', 'Test', 'active', 100000, 0, 100000, 1000000000, 100, 100, 100, 100) RETURNING id`
  );
  const assetId = Number(assetRows[0].id);
  const { rows: userRows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('alice', 'alice', 'alice@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  const alice = Number(userRows[0].id);
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance) VALUES ($1, 10000)`, [alice]);

  const wallet = async () => {
    const { rows } = await pool.query(`SELECT cash_balance, held_cash FROM market.portfolio_cash_balances WHERE user_id = $1`, [alice]);
    return { cash: Number(rows[0].cash_balance), held: Number(rows[0].held_cash) };
  };
  const order = async (id) => (await pool.query(`SELECT status, rejection_reason, held_cash FROM market.trade_orders WHERE id = $1`, [id])).rows[0];
  const buy = (quantity) => trading.submitLiveOrder(pool, { userId: alice, symbol: "TST", side: "buy", quantity });
  const sell = (quantity) => trading.submitLiveOrder(pool, { userId: alice, symbol: "TST", side: "sell", quantity });
  const runBatch = () => trading.processDueLiveOrders(pool, { now: new Date(Date.now() + 15 * 60_000) });
  const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);

  // ── Placing a buy holds its cost and a margin ──
  const first = await buy(10);
  assert.ok(first.held_cash > 10 * 100, "holds at least the cost");
  assert.ok(first.held_cash < 10 * 100 * 1.2, "and only a small margin over it");
  let w = await wallet();
  close(w.cash, 10000 - first.held_cash, "cash drops when the order is placed");
  close(w.held, first.held_cash, "the cash row knows what's held");
  close(first.cash_balance, w.cash, "the response says what's left to spend");
  const holds = await pool.query(`SELECT entry_type, cash_delta FROM market.ledger_entries WHERE user_id = $1 AND reference_type = 'trade_order'`, [alice]);
  assert.deepEqual(holds.rows.map((row) => row.entry_type), ["order_cash_hold"]);

  // ── Orders can't promise more cash than there is ──
  const second = await buy(80);
  w = await wallet();
  assert.ok(w.cash < 1000, `most of the cash is held now (${w.cash})`);
  await assert.rejects(buy(10), { code: "insufficient_cash" }, "before holds, this order was accepted and failed at the batch");

  // ── Net worth still counts held cash ──
  const summary = await trading.getPortfolioSummary(pool, alice);
  close(summary.held_cash, first.held_cash + second.held_cash, "the summary reports what's held");
  close(summary.total_equity, 10000, "held cash is still the player's");
  const worth = await netWorth.getCurrentNetWorth(pool, alice);
  close(Number(worth.cash_balance), 10000, "net worth counts held cash");

  // ── Cancelling gives the hold back ──
  await trading.cancelLiveOrder(pool, { orderId: second.order_id, userId: alice });
  w = await wallet();
  close(w.cash, 10000 - first.held_cash, "cancel returns the hold");
  close(w.held, first.held_cash, "only the first order is held now");

  // ── The batch charges the real price and returns the rest ──
  const batch = await runBatch();
  assert.equal(batch.filled, 1);
  const fill = (await pool.query(`SELECT net_cash FROM market.trade_fills WHERE order_id = $1`, [first.order_id])).rows[0];
  w = await wallet();
  close(w.cash, 10000 + Number(fill.net_cash), "cash is down by exactly the fill's cost");
  close(w.held, 0, "nothing held once it fills");
  assert.equal((await order(first.order_id)).status, "filled");

  // ── A rise the hold covers with spare cash still fills ──
  const before = (await wallet()).cash;
  const third = await buy(5);
  await pool.query(`UPDATE market.market_assets SET current_fair_value = 115, current_fair_value_raw = 115, current_mid_price = 115 WHERE id = $1`, [assetId]);
  assert.equal((await runBatch()).filled, 1);
  const thirdFill = (await pool.query(`SELECT net_cash FROM market.trade_fills WHERE order_id = $1`, [third.order_id])).rows[0];
  assert.ok(-Number(thirdFill.net_cash) > third.held_cash, "the fill cost more than the hold");
  close((await wallet()).cash, before + Number(thirdFill.net_cash), "the difference came out of spare cash");

  // ── A rise past the hold and the cash rejects, and gives the hold back ──
  const all = (await wallet()).cash;
  const fourth = await buy(Math.floor(all / (115 * 1.02)));
  assert.ok((await wallet()).cash < 120, "nearly everything is held");
  await pool.query(`UPDATE market.market_assets SET current_fair_value = 400, current_fair_value_raw = 400, current_mid_price = 400 WHERE id = $1`, [assetId]);
  const rejectedBatch = await runBatch();
  assert.equal(rejectedBatch.rejected, 1);
  const rejected = await order(fourth.order_id);
  assert.deepEqual([rejected.status, rejected.rejection_reason], ["rejected", "insufficient_cash"]);
  w = await wallet();
  close(w.cash, all, "the rejection gave all of it back");
  close(w.held, 0, "nothing held after the rejection");

  // ── Queued sells reserve their shares ──
  await pool.query(`UPDATE market.market_assets SET current_fair_value = 100, current_fair_value_raw = 100, current_mid_price = 100 WHERE id = $1`, [assetId]);
  const held = Number((await pool.query(`SELECT quantity FROM market.portfolio_holdings WHERE user_id = $1 AND asset_id = $2`, [alice, assetId])).rows[0].quantity);
  assert.equal(held, 15);
  const firstSell = await sell(10);
  assert.equal(firstSell.held_cash, 0, "sells hold no cash");
  await assert.rejects(sell(6), (error) => error.code === "insufficient_holdings" && error.queuedShares === 10);
  await sell(5);
  assert.equal((await runBatch()).filled, 2);
  close((await wallet()).held, 0, "still nothing held");
});
