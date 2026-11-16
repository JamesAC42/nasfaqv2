const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const marketAdjustments = require("../src/services/marketAdjustments");
const netWorth = require("../src/services/netWorth");
const economy = require("../src/services/economy");

// The leaderboard (user_leaderboard_current) catches up after a tick and after a Credit move, not
// only after the player's own trades and the daily settlement. Needs CHAT_TEST_DATABASE_URL (a local
// server); makes its own database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("the leaderboard follows ticks, Credit moves and a full refresh", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_leaderboard_refresh_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_leaderboard_refresh_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_leaderboard_refresh_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await netWorth.leaderboardRefreshIdle();
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

  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCboard', 'Board')`);
  const { rows: assetRows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price, current_bid_price, current_ask_price)
     VALUES ('UCboard', 'BRD', 'Board', 'active', 10000, 100, 9900, 2000, 400, 20, 20, 10, 9.8, 10.2) RETURNING id`
  );
  const assetId = Number(assetRows[0].id);
  const { rows: userRows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('boarder', 'boarder', 'boarder@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  const userId = Number(userRows[0].id);
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 1000, 0)`, [userId]);
  await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 100, 10)`, [userId, assetId]);
  await netWorth.refreshCurrentLeaderboard(pool);
  const equity = async () => Number((await pool.query(`SELECT total_equity FROM market.user_leaderboard_current WHERE user_id = $1`, [userId])).rows[0]?.total_equity);
  assert.equal(await equity(), 1000 + 100 * 10);

  // A tick pulls the price from 10 halfway to 20: the board catches up without anyone trading.
  const marketDate = new Date().toISOString().slice(0, 10);
  const { session } = await marketAdjustments.ensureAdjustmentSession(pool, { marketDate });
  const past = new Date(Date.now() - 60_000);
  await pool.query(`UPDATE market.asset_adjustment_intervals SET scheduled_at = CASE WHEN interval_key = 'open' THEN $2::timestamptz ELSE now() + interval '1 hour' END, strength_pct = 50 WHERE session_id = $1`, [session.id, past]);
  const quietLog = console.log;
  console.log = () => {};
  try {
    assert.equal((await marketAdjustments.applyDueAdjustments(pool)).applied_count, 1);
  } finally {
    console.log = quietLog;
  }
  await netWorth.leaderboardRefreshIdle();
  assert.equal(await equity(), 1000 + 100 * 15, "valued at the price the tick left");

  // A Credit payout (a game win, a prediction): the board counts it too.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await economy.pay(client, userId, 250, { to: "credit", entryType: "game_prize_payout", referenceType: "game_session", referenceId: 1 });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await netWorth.leaderboardRefreshIdle();
  assert.equal(await equity(), 1000 + 250 + 100 * 15);

  // A refresh for everyone (the weekly evaluation's): a change made behind the board's back shows up.
  await pool.query(`UPDATE market.portfolio_cash_balances SET cash_balance = cash_balance + 5 WHERE user_id = $1`, [userId]);
  netWorth.queueLeaderboardRefresh(pool, null, { everyone: true });
  await netWorth.leaderboardRefreshIdle();
  assert.equal(await equity(), 1005 + 250 + 100 * 15);
});
