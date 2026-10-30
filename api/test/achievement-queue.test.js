const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { advanceStreakState, buildStreakStateFromTradeDays } = require("../src/services/achievements/streaks");

// Streaks and achievements after fills are checked from a queue, a player at a time, once per
// live-order batch with all of that player's fills (services/achievements/index.js). First, the
// streak fold those checks use: from any point of a history, folding in the rest of its days lands
// on exactly what a rebuild from the whole history gives.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

function dayKey(offset) {
  return new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
}

test("folding trade days into a streak matches a rebuild from the whole history", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const empty = { current_streak_days: 0, longest_streak_days: 0, last_trade_day: null };
  for (let run = 0; run < 500; run += 1) {
    const days = [];
    let offset = 0;
    const count = 1 + Math.floor(random() * 40);
    for (let i = 0; i < count; i += 1) {
      // Same day, the next day, or a gap: streaks start, grow and break.
      offset += [0, 1, 1, 1, 2, 5][Math.floor(random() * 6)];
      days.push(dayKey(offset));
    }
    const whole = buildStreakStateFromTradeDays(days);
    assert.deepEqual(advanceStreakState(empty, days), whole, `from nothing: ${days.join(" ")}`);
    const split = Math.floor(random() * days.length);
    const partial = buildStreakStateFromTradeDays(days.slice(0, split));
    assert.deepEqual(advanceStreakState(partial, days.slice(split)), whole, `from day ${split}: ${days.join(" ")}`);
    // Counting the last day again changes nothing.
    assert.deepEqual(advanceStreakState(whole, [days[days.length - 1]]), whole);
  }
  // A day before the streak's last one can't be folded in: the caller rebuilds instead.
  assert.equal(advanceStreakState(buildStreakStateFromTradeDays([dayKey(3)]), [dayKey(2)]), null);
});

test("a batch of fills still awards every achievement, once per player", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_achievements_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_achievements_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_achievements_test";
  // UTC, as the API's pools are: trade days are UTC dates.
  const pool = new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
  const { applySchema } = require("../src/migrations");
  const trading = require("../src/services/trading");
  const achievements = require("../src/services/achievements");
  t.after(async () => {
    await achievements.tradeFillsIdle();
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
  await achievements.syncDefinitions(pool);

  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCa', 'A'), ('UCb', 'B'), ('UCc', 'C')`);
  const { rows: assets } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
     SELECT 'UC' || s, upper(s || s || s), upper(s), 'active', 100000, 0, 100000, 1000000000, 100, 100, 100, 100 FROM unnest(ARRAY['a', 'b', 'c']) s
     RETURNING id, symbol`
  );
  const assetId = Object.fromEntries(assets.map((row) => [row.symbol, Number(row.id)]));
  const users = {};
  for (const name of ["alice", "bob", "carol", "dave", "erin"]) {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}') RETURNING id`,
      [name]
    );
    users[name] = Number(rows[0].id);
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance) VALUES ($1, 100000)`, [users[name]]);
  }
  // A fill from before (no batch, so no check of its own), `daysAgo` days back.
  const pastFill = async (userId, symbol, daysAgo) => {
    const { rows: order } = await pool.query(
      `INSERT INTO market.trade_orders (user_id, asset_id, side, order_type, status, requested_quantity, filled_quantity, requested_at)
       VALUES ($1, $2, 'buy', 'market', 'filled', 1, 1, now() - $3 * interval '1 day') RETURNING id, requested_at`,
      [userId, assetId[symbol], daysAgo]
    );
    const { rows } = await pool.query(
      `INSERT INTO market.trade_fills (order_id, user_id, asset_id, side, price, quantity, gross_cash, fee_cash, net_cash, counterparty_type, ts)
       VALUES ($1, $2, $3, 'buy', 100, 1, 100, 1, -101, 'treasury', $4) RETURNING id, ts`,
      [order[0].id, userId, assetId[symbol], order[0].requested_at]
    );
    return { fillId: Number(rows[0].id), filledAt: rows[0].ts };
  };
  const buy = (name, symbol) => trading.submitLiveOrder(pool, { userId: users[name], symbol, side: "buy", quantity: 1 });
  const runBatch = () => trading.processDueLiveOrders(pool, { now: new Date(Date.now() + 15 * 60_000) });
  const earned = async (name) =>
    (await pool.query(`SELECT achievement_key FROM market.user_achievements WHERE user_id = $1 ORDER BY achievement_key`, [users[name]])).rows.map((row) => row.achievement_key);
  const rewards = async (name) =>
    (await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(cash_delta + credit_delta), 0)::float AS total FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'achievement_reward'`, [users[name]])).rows[0];
  const notes = async (name) =>
    (await pool.query(`SELECT COUNT(*)::int AS n FROM market.notifications WHERE user_id = $1 AND kind = 'achievement'`, [users[name]])).rows[0].n;
  const runs = async (name) =>
    (await pool.query(`SELECT status, trigger_event_id, metadata_json FROM market.achievement_evaluation_runs WHERE target_user_id = $1 AND trigger_event_type = 'trade_fill' ORDER BY id`, [users[name]])).rows;
  const streak = async (name) =>
    (await pool.query(`SELECT current_streak_days, longest_streak_days, last_trade_fill_id FROM market.user_trade_streaks WHERE user_id = $1`, [users[name]])).rows[0];

  // Carol traded the two days before; her streak row is from then.
  await pastFill(users.carol, "AAA", 2);
  await pastFill(users.carol, "AAA", 1);
  await achievements.backfillAchievements(pool, { userIds: [users.carol] });
  assert.deepEqual(await earned("carol"), ["first_trade"]);
  assert.equal((await streak("carol")).current_streak_days, 2);

  // ── One batch: twelve orders from alice over three stocks, one each from bob and carol ──
  for (let i = 0; i < 12; i += 1) await buy("alice", ["AAA", "BBB", "CCC"][i % 3]);
  await buy("bob", "BBB");
  await buy("carol", "CCC");
  const batch = await runBatch();
  assert.equal(batch.filled, 14);
  await achievements.tradeFillsIdle();

  assert.deepEqual(await earned("alice"), ["first_trade", "trade_3_assets", "trade_count_10"]);
  assert.deepEqual(await rewards("alice"), { n: 3, total: 100 + 300 + 250 });
  assert.equal(await notes("alice"), 3);
  assert.deepEqual(await earned("bob"), ["first_trade"]);
  assert.deepEqual(await rewards("bob"), { n: 1, total: 100 });
  assert.deepEqual(await earned("carol"), ["first_trade", "streak_3"], "today's fill made it three days in a row");
  assert.equal((await streak("carol")).current_streak_days, 3);

  // Each player was checked once for the batch, alice with all twelve fills.
  const aliceFills = (await pool.query(`SELECT id FROM market.trade_fills WHERE user_id = $1 ORDER BY id`, [users.alice])).rows.map((row) => Number(row.id));
  const aliceRuns = await runs("alice");
  assert.equal(aliceRuns.length, 1);
  assert.equal(aliceRuns[0].status, "completed");
  assert.deepEqual(aliceRuns[0].metadata_json.fill_ids, aliceFills);
  assert.equal(Number(aliceRuns[0].trigger_event_id), aliceFills[aliceFills.length - 1]);
  assert.equal((await runs("bob")).length, 1);
  assert.deepEqual(await streak("alice"), { current_streak_days: 1, longest_streak_days: 1, last_trade_fill_id: String(aliceFills[aliceFills.length - 1]) });

  // ── The next batch: nothing new to earn, nothing paid twice ──
  await buy("alice", "AAA");
  assert.equal((await runBatch()).filled, 1);
  await achievements.tradeFillsIdle();
  assert.equal((await runs("alice")).length, 2);
  assert.deepEqual(await rewards("alice"), { n: 3, total: 650 });

  // ── While a batch holds the queue, nothing is checked; releasing it runs what waited ──
  const daveFill = await pastFill(users.dave, "AAA", 0);
  const release = achievements.holdTradeFills();
  achievements.queueTradeFill(pool, { userId: users.dave, ...daveFill });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await runs("dave")).length, 0);
  release();
  await achievements.tradeFillsIdle();
  assert.deepEqual(await earned("dave"), ["first_trade"]);

  // ── A check that fails (here, no connection) is tried again rather than lost ──
  const { fillQueue } = achievements._test;
  const savedDelay = fillQueue.retryDelayMs;
  fillQueue.retryDelayMs = 50;
  let refused = 0;
  const flaky = {
    connect: async () => {
      if (refused === 0) {
        refused += 1;
        throw new Error("timeout exceeded when trying to connect");
      }
      return pool.connect();
    },
  };
  const erinToday = await pastFill(users.erin, "AAA", 0);
  achievements.queueTradeFill(flaky, { userId: users.erin, ...erinToday });
  await achievements.tradeFillsIdle();
  fillQueue.retryDelayMs = savedDelay;
  assert.equal(refused, 1);
  assert.deepEqual(await earned("erin"), ["first_trade"]);
  assert.equal((await streak("erin")).current_streak_days, 1);

  // ── A fill counted after a later one (yesterday's, after today's) rebuilds the streak ──
  const erinYesterday = await pastFill(users.erin, "BBB", 1);
  achievements.queueTradeFill(pool, { userId: users.erin, ...erinYesterday });
  await achievements.tradeFillsIdle();
  assert.equal((await streak("erin")).current_streak_days, 2);
});
