const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const auth = require("../src/services/auth");
const firstDays = require("../src/services/firstDays");
const activity = require("../src/services/activity");

// End to end on a freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("first-days guide and the live band, end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_first_days_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_first_days_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_first_days_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const quiet = async (fn) => {
    const saved = [console.warn, console.log, console.info];
    console.warn = console.log = console.info = () => {};
    try {
      return await fn();
    } finally {
      [console.warn, console.log, console.info] = saved;
    }
  };
  await quiet(() => require("../src/migrations").applySchema(pool));

  // An account from before the guide shipped: inserted directly, so first_days_until stays NULL.
  const { rows: veteranRows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('veteran', 'veteran', 'veteran@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  const veteran = Number(veteranRows[0].id);
  const fresh = await quiet(() => auth.createUser(pool, { username: "fresh_player", email: "fresh@example.test", password: "correct horse battery" }));

  const { rows: channelRows } = await pool.query(
    `INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, icon, color, unit)
     VALUES ('UCpekotest', 'Pekora', 'Usada Pekora', 'PEK', 'pekora', '#7ac3ff', 'hololive 3rd Generation') RETURNING youtube_channel_id`
  );
  const { rows: assetRows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply,
       liquidity_depth, spread_bps, current_mid_price, current_bid_price, current_ask_price)
     VALUES ($1, 'PEK', 'Usada Pekora', 'active', 10000, 0, 10000, 1000, 400, 20, 19.6, 20.4) RETURNING id`,
    [channelRows[0].youtube_channel_id]
  );
  const pek = Number(assetRows[0].id);

  await t.test("only accounts made since it shipped get the guide", async () => {
    assert.ok(fresh.first_days_until, "createUser sets the date");
    const days = (new Date(fresh.first_days_until).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > firstDays.FIRST_DAYS - 1 && days <= firstDays.FIRST_DAYS, `about ${firstDays.FIRST_DAYS} days out, got ${days}`);
    assert.deepEqual(await firstDays.getFirstDays(pool, veteran), { active: false, until: null });
    const guide = await firstDays.getFirstDays(pool, fresh.id);
    assert.equal(guide.active, true);
    assert.equal(guide.oshi, null);
    assert.equal(guide.first_fill, null);
    assert.equal(guide.first_tick, null);
    assert.equal(guide.first_review, null);
    assert.equal(guide.cards_claimed, false);
  });

  await t.test("each step ticks from what the player actually did", async () => {
    await pool.query(`UPDATE market.users SET oshi_coin_asset_id = $2 WHERE id = $1`, [fresh.id, pek]);
    const { rows: orders } = await pool.query(
      `INSERT INTO market.trade_orders (user_id, asset_id, side, requested_quantity, filled_quantity, status, requested_at)
       VALUES ($1, $2, 'buy', 25, 25, 'filled', now() - interval '3 hours') RETURNING id`,
      [fresh.id, pek]
    );
    await pool.query(
      `INSERT INTO market.trade_fills (order_id, asset_id, user_id, ts, side, price, quantity, gross_cash, fee_cash, net_cash, counterparty_type)
       VALUES ($1, $2, $3, now() - interval '3 hours', 'buy', 20, 25, 500, 5, -505, 'treasury')`,
      [orders[0].id, pek, fresh.id]
    );
    // A tick before the fill doesn't count; the first one after it does.
    const { rows: sessions } = await pool.query(`INSERT INTO market.adjustment_sessions (market_date, status) VALUES (current_date, 'active') RETURNING id`);
    await pool.query(
      `INSERT INTO market.asset_adjustment_intervals (session_id, asset_id, interval_key, scheduled_at, strength_pct, base_rate, price_before, price_after, status, applied_at)
       VALUES ($1, $2, 'open', now() - interval '5 hours', 50, 1, 18, 19, 'applied', now() - interval '5 hours'),
              ($1, $2, 'lunch', now() - interval '1 hour', 50, 1, 20, 21, 'applied', now() - interval '1 hour')`,
      [sessions[0].id, pek]
    );
    const { rows: evals } = await pool.query(
      `INSERT INTO market.weekly_evaluations (eval_date, status, completed_at) VALUES (current_date, 'completed', now() - interval '30 minutes') RETURNING id`
    );
    await pool.query(
      `INSERT INTO market.dividend_payouts (evaluation_id, user_id, asset_id, quantity, per_share, amount) VALUES ($1, $2, $3, 25, 0.5, 12.5)`,
      [evals[0].id, fresh.id, pek]
    );
    await pool.query(`INSERT INTO games.user_reward_claims (user_id, reward_key) VALUES ($1, 'starter')`, [fresh.id]);

    const guide = await firstDays.getFirstDays(pool, fresh.id);
    assert.deepEqual(guide.oshi, { symbol: "PEK", name: "Usada Pekora" });
    assert.equal(guide.first_fill.symbol, "PEK");
    assert.equal(guide.first_tick.key, "lunch");
    assert.equal(guide.first_tick.symbol, "PEK");
    assert.ok(Math.abs(guide.first_tick.move_pct - 0.05) < 1e-9);
    assert.equal(guide.first_review.net, 12.5);
    assert.equal(guide.cards_claimed, true);
  });

  await t.test("closing it ends it, and only for that player", async () => {
    await firstDays.dismissFirstDays(pool, fresh.id);
    assert.equal((await firstDays.getFirstDays(pool, fresh.id)).active, false);
    await firstDays.dismissFirstDays(pool, veteran);
    assert.equal((await pool.query(`SELECT first_days_until FROM market.users WHERE id = $1`, [veteran])).rows[0].first_days_until, null);
  });

  await t.test("the live band counts real actions and names the newest of each kind", async () => {
    const { rows: rounds } = await pool.query(
      `INSERT INTO games.blackjack_rounds (table_key, status, settled_at) VALUES ('mid', 'settled', now() - interval '2 minutes') RETURNING id`
    );
    // A doubled 200 that won pays 800: up 400. A refunded hand isn't a hand.
    await pool.query(
      `INSERT INTO games.blackjack_bets (round_id, user_id, seat, bet_cash, doubled, outcome, payout_cash, created_at)
       VALUES ($1, $2, 0, 200, true, 'win', 800, now() - interval '3 minutes'),
              ($1, $3, 1, 100, false, 'refund', 100, now() - interval '3 minutes')`,
      [rounds[0].id, veteran, fresh.id]
    );
    const { rows: channels } = await pool.query(
      `INSERT INTO chat.channels (scope_type, scope_key, display_name) VALUES ('market', 'global', 'Global') RETURNING id`
    );
    await pool.query(`INSERT INTO chat.messages (channel_id, author_id, body) VALUES ($1, $2, 'ogey')`, [channels[0].id, veteran]);

    const band = await activity.getActivity(pool);
    assert.equal(band.window_hours, 24);
    assert.equal(band.totals.trades, 1);
    assert.equal(band.totals.traders, 1);
    assert.equal(band.totals.blackjack_hands, 1);
    assert.equal(band.totals.blackjack_players, 1);
    assert.equal(band.totals.card_pulls, 0);
    assert.equal(band.totals.prediction_bets, 0);
    // The trader, the blackjack winner (who also chatted); the refunded seat isn't counted.
    assert.equal(band.totals.players, 2);
    assert.equal(band.totals.last_hour, 2);
    assert.deepEqual(
      band.latest.map((item) => item.kind),
      ["blackjack", "trade"]
    );
    const [hand, trade] = band.latest;
    assert.equal(hand.username, "veteran");
    assert.equal(hand.net, 400);
    assert.equal(hand.table, "Mid table");
    assert.equal(trade.username, "fresh_player");
    assert.equal(trade.symbol, "PEK");
    assert.equal(trade.quantity, 25);
    // Chat counts toward players and nothing else: no message text goes out.
    assert.ok(!JSON.stringify(band).includes("ogey"));
  });

  await t.test("a quiet day is an honest zero, not an error", async () => {
    await pool.query(`TRUNCATE market.trade_fills, games.blackjack_bets, chat.messages CASCADE`);
    const band = await activity.getActivity(pool, { hours: 1 });
    assert.equal(band.totals.players, 0);
    assert.equal(band.totals.last_action_at, null);
  });
});
