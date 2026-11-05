const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const { applyPredictionsSchema } = require("../src/services/predictions/schema");
const auto = require("../src/services/predictions/auto");
const core = require("../src/services/predictions/core");
const guards = require("../src/services/predictions/guards");
const lmsr = require("../src/services/predictions/lmsr");
const resolution = require("../src/services/predictions/resolution");
const scheduler = require("../src/services/predictions/scheduler");
const trading = require("../src/services/predictions/trading");

const round2 = (value) => Math.round(value * 100) / 100;

// Nobody can bet once the outcome could be known: streams close before they start (early starts
// included), a forced tick shuts its markets, and a bet that still slips through never pays.

test("the stream line stays within 5% of the median and reads cleanly", () => {
  for (const [median, line] of [
    [45_231, 45_000],
    [1_499, 1_500],
    [12_300, 12_000],
    [123_456, 120_000],
    [426, 430],
    [0, 1],
  ]) {
    assert.equal(auto.niceLine(median), line, `median ${median}`);
  }
  for (let median = 10; median < 300_000; median += 137) {
    assert.ok(Math.abs(auto.niceLine(median) - median) / median <= 0.05 + 1e-9, `median ${median} got ${auto.niceLine(median)}`);
  }
});

test("rounding never lets a round trip make money", () => {
  let seed = 42;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let run = 0; run < 2000; run += 1) {
    const b = 50 + random() * 2000;
    const q = lmsr.seedShares([0.05 + random() * 0.9, 0], b).map((value, index) => (index ? 0 : value));
    const state = { b, q, prices: lmsr.prices(q, b) };
    const cash = Math.round((1 + random() * (random() < 0.5 ? 5 : 2000)) * 100) / 100;
    const buy = trading.priceBuy(state, 0, cash, 0.01);
    if (!buy) continue;
    assert.ok(buy.total <= cash + 1e-9, "a buy never costs more than offered");
    const after = { b, q: q.map((value, index) => (index ? value : value + buy.shares)), prices: buy.pricesAfter };
    const sell = trading.priceSell(after, 0, buy.shares, 0.01);
    assert.ok(sell.payout <= buy.total + 1e-9, `paid ${buy.total}, got back ${sell.payout}`);
  }
});

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("prediction lockdown end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_predictions_lockdown_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_predictions_lockdown_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_predictions_lockdown_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const quiet = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    console.warn = quiet;
    console.log = log;
  }

  // ── Fixtures ──
  const makeUser = async (name) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}') RETURNING id`,
      [name]
    );
    return Number(rows[0].id);
  };
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  const wallet = async (id) => {
    const balance = await core.inTransaction(pool, (client) => client.query(`SELECT credit_balance, cash_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [id]));
    return { credit: Number(balance.rows[0]?.credit_balance ?? 0), cash: Number(balance.rows[0]?.cash_balance ?? 0) };
  };
  const touchWallet = (id) => core.inTransaction(pool, (client) => core.cashBalance(client, id));
  await touchWallet(alice);
  await touchWallet(bob);

  const addTalent = async (symbol, name) => {
    const channel = `UC${symbol}`;
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1, $2, $2, $3, true)`, [channel, name, symbol]);
    const { rows } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
       VALUES ($1, $2, $3, 'active', 10000, 0, 10000, 2000, 400) RETURNING id`,
      [channel, symbol, name]
    );
    return { channel, id: Number(rows[0].id), symbol };
  };
  const minutes = (n) => new Date(Date.now() + n * 60_000);
  let videoCounter = 0;
  const addStream = async (channel, fields = {}) => {
    videoCounter += 1;
    const videoId = fields.video_id || `vid${videoCounter}`;
    await pool.query(
      `INSERT INTO yt.livestream_sessions (youtube_channel_id, video_id, status, video_title, scheduled_start_at, actual_start_at, first_seen_at, last_seen_at, max_concurrent_viewers, updated_at)
       VALUES ($1, $2, $3, 'A stream', $4, $5, now(), COALESCE($6, now()), $7, now())`,
      [channel, videoId, fields.status || "upcoming", fields.scheduled ?? null, fields.actual ?? null, fields.last_seen ?? null, fields.peak ?? null]
    );
    return videoId;
  };
  const updateStream = (videoId, sets, values = []) => pool.query(`UPDATE yt.livestream_sessions SET ${sets} WHERE video_id = $1`, [videoId, ...values]);
  const addHistory = async (channel, peaks) => {
    for (const [index, peak] of peaks.entries()) {
      await addStream(channel, { status: "ended", actual: new Date(Date.now() - (index + 1) * 86_400_000), peak });
    }
  };
  const marketFor = async (videoId) => (await pool.query(`SELECT * FROM market.prediction_markets WHERE auto_key = $1`, [`stream-peak:${videoId}`])).rows[0] || null;
  const closedReason = async (id) => (await pool.query(`SELECT event_data->>'reason' AS reason FROM market.prediction_market_events WHERE market_id = $1 AND event_type = 'market_closed' ORDER BY id DESC LIMIT 1`, [id])).rows[0]?.reason;
  const buy = (slug, userId, outcomeCode = "yes", amount = 100) => trading.trade(pool, { userId, slug, outcomeCode, side: "buy", amount });
  const refused = { code: "prediction_market_closed" };
  const setTemplate = (key, { enabled, params }) => pool.query(`UPDATE market.prediction_auto_templates SET enabled = COALESCE($2, enabled), params_json = params_json || $3::jsonb WHERE key = $1`, [key, enabled ?? null, JSON.stringify(params || {})]);
  const openStreamMarkets = async () => (await pool.query(`SELECT count(*)::int AS n FROM market.prediction_markets WHERE auto_template = 'stream-peak' AND status = 'open'`)).rows[0].n;
  const clearStreamMarkets = async () => {
    await pool.query(`DELETE FROM market.prediction_market_trades WHERE market_id IN (SELECT id FROM market.prediction_markets WHERE auto_template = 'stream-peak')`);
    await pool.query(`DELETE FROM market.prediction_markets WHERE auto_template = 'stream-peak'`);
    await pool.query(`DELETE FROM yt.livestream_sessions WHERE status <> 'ended'`);
  };

  const kor = await addTalent("KOR", "Inugami Korone");
  const pek = await addTalent("PEK", "Usada Pekora");
  const mio = await addTalent("MIO", "Ookami Mio");
  for (const talent of [kor, pek, mio]) await addHistory(talent.channel, [10_000, 20_000, 30_000, 40_000, 50_000]);

  await t.test("templates start locked down", async () => {
    const { rows } = await pool.query(`SELECT key, enabled, params_json FROM market.prediction_auto_templates ORDER BY key`);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    assert.equal(byKey["tick-direction"].enabled, false);
    assert.equal(byKey["tick-direction"].params_json.count, 3);
    assert.deepEqual(
      ["talents", "daily_cap", "close_lead_minutes", "open_lead_hours"].map((key) => byKey["stream-peak"].params_json[key]),
      [15, 5, 15, 24]
    );
  });

  await t.test("the lockdown runs once and doesn't undo the owner's choices", async () => {
    // A database from before it: tick calls on at the old count, an existing stream setting.
    await pool.query(`UPDATE market.prediction_auto_templates SET enabled = true, params_json = '{"count": 6, "liquidity_b": 400, "fee_bps": 100}' WHERE key = 'tick-direction'`);
    await pool.query(`UPDATE market.prediction_auto_templates SET params_json = '{"liquidity_b": 500, "fee_bps": 100, "min_past_streams": 3, "daily_cap": 9}' WHERE key = 'stream-peak'`);
    await applyPredictionsSchema(pool);
    let { rows } = await pool.query(`SELECT enabled, params_json FROM market.prediction_auto_templates WHERE key = 'tick-direction'`);
    assert.equal(rows[0].enabled, false);
    assert.equal(rows[0].params_json.count, 3);
    // The owner turns them back on, at 6: the next deploy leaves that alone.
    await setTemplate("tick-direction", { enabled: true, params: { count: 6 } });
    await applyPredictionsSchema(pool);
    ({ rows } = await pool.query(`SELECT enabled, params_json FROM market.prediction_auto_templates WHERE key = 'tick-direction'`));
    assert.equal(rows[0].enabled, true);
    assert.equal(rows[0].params_json.count, 6);
    ({ rows } = await pool.query(`SELECT params_json FROM market.prediction_auto_templates WHERE key = 'stream-peak'`));
    assert.equal(rows[0].params_json.daily_cap, 9, "a setting already there stays");
    assert.equal(rows[0].params_json.close_lead_minutes, 15, "a missing one is filled in");
    await setTemplate("tick-direction", { enabled: false, params: { count: 3 } });
    await setTemplate("stream-peak", { params: { daily_cap: 5 } });
  });

  await t.test("markets open only on streams that haven't started, with time left to bet", async () => {
    const scheduled = minutes(120);
    const upcoming = await addStream(kor.channel, { scheduled });
    const live = await addStream(pek.channel, { status: "live", actual: minutes(-2), scheduled: minutes(-2) });
    const tooSoon = await addStream(pek.channel, { scheduled: minutes(30) });
    const tooFar = await addStream(mio.channel, { scheduled: minutes(60 * 30) });
    const unscheduled = await addStream(mio.channel, {});
    const staleData = await addStream(mio.channel, { scheduled: minutes(90), last_seen: minutes(-120) });
    await auto.runAutoTemplates(pool);
    const market = await marketFor(upcoming);
    assert.ok(market, "a scheduled stream gets a market");
    for (const id of [live, tooSoon, tooFar, unscheduled, staleData]) assert.equal(await marketFor(id), null, id);
    assert.equal(market.status, "open");
    assert.equal(new Date(market.closes_at).getTime(), scheduled.getTime() - 15 * 60_000, "closes 15 minutes before the scheduled start");
    assert.equal(new Date(market.resolves_after).getTime(), scheduled.getTime());
    assert.equal(market.auto_data.line, 30_000);
    assert.equal(market.auto_data.closes_before_start, true);
    assert.equal(market.title, "Korone's stream peaks above 30k?");
    await clearStreamMarkets();
  });

  await t.test("a stream going live early shuts betting at once, even before the scheduler runs", async () => {
    const video = await addStream(kor.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    const { slug, id } = await marketFor(video);
    await buy(slug, alice);
    const { order } = await trading.placeLimitOrder(pool, { userId: bob, slug, outcomeCode: "no", side: "buy", limitPrice: 0.05, amount: 50 });
    const before = await wallet(bob);
    assert.equal((await trading.quote(pool, { slug, outcomeCode: "yes", side: "buy", amount: 10 })).tradeable, true);

    await updateStream(video, `status = 'live', actual_start_at = now()`);
    await assert.rejects(buy(slug, bob), refused);
    await assert.rejects(trading.trade(pool, { userId: alice, slug, outcomeCode: "yes", side: "sell", shares: 1 }), refused);
    await assert.rejects(trading.placeLimitOrder(pool, { userId: bob, slug, outcomeCode: "no", side: "buy", limitPrice: 0.9, amount: 10 }), refused);
    assert.equal((await trading.quote(pool, { slug, outcomeCode: "yes", side: "buy", amount: 10 })).tradeable, false);
    // A resting order can't fill either, even at a limit the price has reached.
    await pool.query(`UPDATE market.prediction_limit_orders SET limit_price = 0.99 WHERE id = $1`, [order.id]);
    assert.deepEqual(await trading.sweepMarket(pool, id), []);

    const closed = await auto.closeLockedMarkets(pool);
    assert.deepEqual(closed.map((row) => row.slug), [slug]);
    assert.equal(await closedReason(id), "stream_started");
    assert.equal((await pool.query(`SELECT status FROM market.prediction_limit_orders WHERE id = $1`, [order.id])).rows[0].status, "released");
    assert.equal((await wallet(bob)).credit, before.credit + 50, "the resting order's money goes back");
    await clearStreamMarkets();
  });

  await t.test("a schedule moved earlier moves the close, a later one doesn't", async () => {
    const video = await addStream(kor.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    const market = await marketFor(video);
    const closesAt = new Date(market.closes_at).getTime();

    const later = minutes(300);
    await updateStream(video, `scheduled_start_at = $2`, [later]);
    await auto.closeLockedMarkets(pool);
    assert.equal(new Date((await marketFor(video)).closes_at).getTime(), closesAt);
    await buy(market.slug, alice);

    const earlier = minutes(60);
    await updateStream(video, `scheduled_start_at = $2`, [earlier]);
    await auto.closeLockedMarkets(pool);
    assert.equal(new Date((await marketFor(video)).closes_at).getTime(), earlier.getTime() - 15 * 60_000);
    await buy(market.slug, alice);

    // Moved to inside the lead: shut before the scheduler gets to it, and it closes.
    await updateStream(video, `scheduled_start_at = $2`, [minutes(10)]);
    await assert.rejects(buy(market.slug, alice), refused);
    await auto.closeLockedMarkets(pool);
    assert.equal(await closedReason(market.id), "stream_starting");
    await clearStreamMarkets();
  });

  await t.test("betting shuts when the data can't be trusted", async () => {
    const stale = await addStream(kor.channel, { scheduled: minutes(120) });
    const gone = await addStream(pek.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    const staleMarket = await marketFor(stale);
    const goneMarket = await marketFor(gone);
    await updateStream(stale, `last_seen_at = now() - interval '2 hours'`);
    await pool.query(`DELETE FROM yt.livestream_sessions WHERE video_id = $1`, [gone]);
    await assert.rejects(buy(staleMarket.slug, alice), refused);
    await assert.rejects(buy(goneMarket.slug, alice), refused);
    assert.equal(await guards.autoMarketLock(pool, staleMarket), "stream_data_stale");
    assert.equal(await guards.autoMarketLock(pool, goneMarket), "stream_missing");
    await clearStreamMarkets();
  });

  await t.test("a bet that lands after the real start voids the market, so it never pays", async () => {
    const start = await wallet(alice);
    const video = await addStream(kor.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    const { slug, id } = await marketFor(video);
    await buy(slug, alice, "yes", 500);
    // The tracker only learns afterward that it had started 10 minutes ago, and it beat the line.
    await updateStream(video, `status = 'ended', actual_start_at = now() - interval '10 minutes', max_concurrent_viewers = 99999`);
    const resolved = await auto.resolveAutoMarkets(pool);
    assert.deepEqual(resolved.map((row) => row.slug), [slug]);
    const { rows } = await pool.query(`SELECT status, resolution_notes FROM market.prediction_markets WHERE id = $1`, [id]);
    assert.equal(rows[0].status, "voided");
    assert.equal(rows[0].resolution_notes, "A bet landed after the stream started");
    assert.deepEqual(await wallet(alice), start, "the stake is back, fee included, and nothing more");
    await clearStreamMarkets();
  });

  await t.test("bets made in time settle on the stream: YES as the peak crosses, once", async () => {
    const start = await wallet(alice);
    const video = await addStream(kor.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    const { slug, id, auto_data: data } = await marketFor(video);
    const { fill } = await buy(slug, alice, "yes", 500);
    // The bet went in an hour ago, well before the stream started.
    await pool.query(`UPDATE market.prediction_market_trades SET matched_at = now() - interval '1 hour' WHERE market_id = $1`, [id]);
    await updateStream(video, `status = 'live', actual_start_at = now() - interval '30 minutes'`);
    assert.deepEqual(await auto.resolveAutoMarkets(pool), [], "under the line: waits");
    await pool.query(
      `INSERT INTO yt.livestream_viewer_buckets_5m (livestream_video_id, bucket_start, bucket_end, duration_seconds, avg_viewers, max_viewers)
       VALUES ($1, now() - interval '5 minutes', now(), 300, $2, $3)`,
      [video, data.line - 100, data.line + 100]
    );
    assert.deepEqual((await auto.resolveAutoMarkets(pool)).map((row) => row.outcome), ["yes"], "the running peak crossed");
    const paid = round2(fill.shares);
    const after = await wallet(alice);
    assert.ok(Math.abs(after.credit - (start.credit - fill.cash + paid)) < 0.011, `${after.credit} vs ${start.credit - fill.cash + paid}`);
    // No second payout, however it's asked for.
    assert.deepEqual(await auto.resolveAutoMarkets(pool), []);
    assert.equal(await auto.resolveBySystem(pool, id, { outcome: "yes", evidence: {} }), null);
    await assert.rejects(resolution.confirm(pool, { id: alice, is_admin: true }, id), { code: "no_open_proposal" });
    assert.deepEqual(await wallet(alice), after);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM market.ledger_entries WHERE reference_type = 'prediction_resolution' AND reference_id = $1 AND entry_type = 'prediction_payout_win'`, [id]);
    assert.equal(rows[0].n, 1);
    await clearStreamMarkets();
  });

  await t.test("streams that end under the line, or never happen", async () => {
    const under = await addStream(kor.channel, { scheduled: minutes(120) });
    const noPeak = await addStream(pek.channel, { scheduled: minutes(120) });
    const cancelled = await addStream(mio.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    const [underMarket, noPeakMarket, cancelledMarket] = [await marketFor(under), await marketFor(noPeak), await marketFor(cancelled)];

    await updateStream(under, `status = 'ended', actual_start_at = now() - interval '2 hours', ended_at = now(), max_concurrent_viewers = 1000`);
    await updateStream(noPeak, `status = 'ended', actual_start_at = now() - interval '2 hours', ended_at = now()`);
    // Canceled: the tracker never hears of it again, and its scheduled time is well past.
    await pool.query(`UPDATE market.prediction_markets SET auto_data = auto_data || jsonb_build_object('scheduled_at', $2::text) WHERE id = $1`, [cancelledMarket.id, new Date(Date.now() - 13 * 3_600_000).toISOString()]);
    await updateStream(cancelled, `scheduled_start_at = now() - interval '13 hours'`);

    const results = await auto.resolveAutoMarkets(pool);
    const outcome = (market) => results.find((row) => row.slug === market.slug);
    assert.equal(outcome(underMarket).outcome, "no");
    assert.equal(outcome(noPeakMarket).refunded, 0);
    const voided = await pool.query(`SELECT resolution_notes FROM market.prediction_markets WHERE id = $1`, [cancelledMarket.id]);
    assert.equal(voided.rows[0].resolution_notes, "stream didn't start within 12h of its scheduled time");
    await clearStreamMarkets();
  });

  await t.test("a stream moved later doesn't void while it could still happen", async () => {
    const video = await addStream(kor.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    await updateStream(video, `scheduled_start_at = now() + interval '3 hours'`);
    assert.deepEqual(await auto.resolveAutoMarkets(pool), []);
    assert.equal((await marketFor(video)).status, "open");
    await clearStreamMarkets();
  });

  await t.test("the daily cap and the talent rules limit how many get made", async () => {
    await setTemplate("stream-peak", { params: { daily_cap: 2 } });
    // Two on one talent, one each on the others: the cap is 2 and it's one per talent.
    for (const talent of [kor, kor, pek, mio]) await addStream(talent.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    assert.equal(await openStreamMarkets(), 2);
    const { rows } = await pool.query(`SELECT DISTINCT auto_data->>'symbol' AS symbol FROM market.prediction_markets WHERE auto_template = 'stream-peak'`);
    assert.equal(rows.length, 2, "one per talent");
    const results = await auto.runAutoTemplates(pool);
    assert.equal(results["stream-peak"].created, 0, "a rerun makes none");
    assert.match(results["stream-peak"].note, /daily cap of 2 reached/);
    await clearStreamMarkets();

    await setTemplate("stream-peak", { params: { daily_cap: 0 } });
    await addStream(kor.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    assert.equal(await openStreamMarkets(), 0, "a cap of 0 makes none");
    await clearStreamMarkets();

    // Only the K most active talents; here the most held.
    await setTemplate("stream-peak", { params: { daily_cap: 5, talents: 1 } });
    await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 5, 1)`, [alice, mio.id]);
    await addStream(kor.channel, { scheduled: minutes(120) });
    const held = await addStream(mio.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    assert.equal(await openStreamMarkets(), 1);
    assert.ok(await marketFor(held));
    await clearStreamMarkets();
    await setTemplate("stream-peak", { params: { daily_cap: 5, talents: 15 } });
  });

  await t.test("the admin console can change the limits, within bounds", async () => {
    const owner = { id: alice, is_admin: true };
    const { params } = await auto.updateTemplate(pool, owner, "stream-peak", { params: { daily_cap: 3, close_lead_minutes: 0, talents: 9999, open_lead_hours: 12 } });
    assert.equal(params.daily_cap, 3);
    assert.equal(params.close_lead_minutes, 5, "the lead can't go below 5 minutes");
    assert.equal(params.talents, 200);
    assert.equal(params.open_lead_hours, 12);
    await assert.rejects(auto.updateTemplate(pool, { id: bob }, "stream-peak", { params: { daily_cap: 50 } }), { code: "forbidden" });
    await auto.updateTemplate(pool, owner, "stream-peak", { params: { daily_cap: 5, close_lead_minutes: 15, talents: 15, open_lead_hours: 24 } });
  });

  await t.test("markets from before the fix close on deploy and settle as they were", async () => {
    const video = await addStream(kor.channel, { status: "live", scheduled: minutes(-5), actual: minutes(-5) });
    const market = await core.inTransaction(pool, (client) =>
      require("../src/services/predictions/markets").createMarketWithClient(
        client,
        {
          title: "Korone's old stream peaks above 30k?",
          rules_text: "Opened after the stream started, the old way.",
          resolution_source_text: "tracker",
          market_type: "binary",
          closes_at: minutes(25),
          resolves_after: minutes(25),
          publish: true,
        },
        { status: "open", kind: "auto", autoTemplate: "stream-peak", autoKey: `stream-peak:${video}`, autoData: { video_id: video, line: 30_000, started_at: minutes(-5).toISOString() } }
      )
    );
    await assert.rejects(buy(market.slug, alice), refused);
    await auto.closeLockedMarkets(pool);
    assert.equal((await marketFor(video)).status, "closed");
    await pool.query(`INSERT INTO market.prediction_market_trades (market_id, outcome_id, trade_kind, taker_user_id, price, quantity, notional_cash, fee_cash_buy, fee_cash_sell, matched_at)
      SELECT $1, o.id, 'amm', $2, 0.5, 10, 5, 0, 0, now() FROM market.prediction_market_outcomes o WHERE o.market_id = $1 AND o.outcome_code = 'yes'`, [market.id, alice]);
    await updateStream(video, `status = 'ended', max_concurrent_viewers = 40000`);
    const results = await auto.resolveAutoMarkets(pool);
    assert.equal(results.find((row) => row.slug === market.slug).outcome, "yes", "not voided by the new rule");
    await clearStreamMarkets();
  });

  // ── Ticks ──
  const addTick = async (key, at) => {
    const session = await pool.query(
      `INSERT INTO market.adjustment_sessions (market_date, status) VALUES (($1::timestamptz)::date, 'active')
       ON CONFLICT (market_date) DO UPDATE SET updated_at = now() RETURNING id`,
      [at]
    );
    for (const talent of [kor, pek, mio]) {
      await pool.query(
        `INSERT INTO market.asset_adjustment_intervals (session_id, asset_id, interval_key, scheduled_at, strength_pct, base_rate, status)
         VALUES ($1, $2, $3, $4, 50, 10, 'scheduled')`,
        [session.rows[0].id, talent.id, key, at]
      );
    }
  };
  const tickMarkets = async () => (await pool.query(`SELECT * FROM market.prediction_markets WHERE auto_template LIKE 'tick-%' ORDER BY id`)).rows;

  await t.test("ticks: only Lunch gets markets, and tick calls stay off", async () => {
    const lateAt = minutes(60);
    await addTick("late", lateAt);
    await auto.runAutoTemplates(pool);
    assert.equal((await tickMarkets()).length, 0, "the Late tick is next, but it gets none");

    const lunchAt = minutes(180);
    await addTick("lunch", lunchAt);
    await auto.runAutoTemplates(pool);
    const made = await tickMarkets();
    assert.deepEqual(made.map((row) => row.auto_template), ["tick-top-gainer"]);
    assert.equal(made[0].auto_data.interval_key, "lunch");
    assert.equal(new Date(made[0].closes_at).getTime(), lunchAt.getTime() - 5 * 60_000);
    assert.deepEqual(auto.TICKS_WITH_MARKETS, ["lunch"]);

    await setTemplate("tick-direction", { enabled: true });
    await auto.runAutoTemplates(pool);
    assert.equal((await tickMarkets()).filter((row) => row.auto_template === "tick-direction").length, 3, "on again, they respect count");
  });

  await t.test("ticks: a tick forced early shuts its markets at once", async () => {
    const [gainer, ...calls] = await tickMarkets();
    await buy(calls[0].slug, alice, "yes", 50);
    await buy(gainer.slug, alice, "o1", 50);
    const asset = calls[0].auto_data.asset_id;
    await pool.query(`UPDATE market.asset_adjustment_intervals SET status = 'applied', price_before = 10, price_after = 11, applied_at = now() WHERE scheduled_at = $1 AND asset_id = $2`, [calls[0].auto_data.tick_at, asset]);
    await assert.rejects(buy(calls[0].slug, alice, "yes", 50), refused, "that talent's tick has landed");
    await assert.rejects(buy(gainer.slug, alice, "o1", 50), refused, "so one row in is enough to shut the top gainer");
    assert.ok(calls[1], "another talent's call");
    await buy(calls[1].slug, alice, "yes", 50);

    await auto.closeLockedMarkets(pool);
    assert.equal(await closedReason(calls[0].id), "tick_landed");
    assert.equal(await closedReason(gainer.id), "tick_landed");
  });

  await t.test("turning a template off shuts its open markets, which still settle", async () => {
    const calls = (await tickMarkets()).filter((row) => row.auto_template === "tick-direction" && row.status === "open");
    assert.ok(calls.length);
    await setTemplate("tick-direction", { enabled: false });
    await assert.rejects(buy(calls[0].slug, alice, "yes", 50), refused);
    await auto.closeLockedMarkets(pool);
    for (const market of calls) assert.equal(await closedReason(market.id), "template_off");
    const { rows } = await pool.query(`SELECT status FROM market.prediction_markets WHERE id = $1`, [calls[0].id]);
    assert.equal(rows[0].status, "closed");
    await pool.query(`UPDATE market.asset_adjustment_intervals SET status = 'applied', price_before = 10, price_after = 9, applied_at = now() WHERE scheduled_at = $1`, [calls[0].auto_data.tick_at]);
    const results = await auto.resolveAutoMarkets(pool);
    assert.ok(results.some((row) => row.slug === calls[0].slug && row.outcome === "no"));
  });

  // ── Voids and the close ──
  const eventMarket = async (title) => {
    const { slug, id } = await require("../src/services/predictions/markets").createMarket(
      pool,
      { id: alice, is_admin: true },
      { title, rules_text: "Resolves by the rules of the test.", resolution_source_text: "the test", market_type: "binary", closes_at: minutes(600), publish: true, liquidity_b: 100 }
    );
    return { slug, id };
  };

  await t.test("a void undoes the market for everyone, gains included", async () => {
    const [startAlice, startBob] = [await wallet(alice), await wallet(bob)];
    const { slug, id } = await eventMarket("A market that voids after a sale at a profit");
    const { fill } = await buy(slug, alice, "yes", 100);
    await buy(slug, bob, "yes", 1000);
    const sale = await trading.trade(pool, { userId: alice, slug, outcomeCode: "yes", side: "sell", shares: fill.shares });
    assert.ok(sale.fill.cash > 100, `sold for more than it cost: ${sale.fill.cash}`);
    const result = await resolution.voidMarket(pool, { id: alice, is_admin: true }, id, { reason: "Test void" });
    assert.ok(result.clawed_back > 0);
    assert.deepEqual(await wallet(alice), startAlice, "the seller is back where they started");
    assert.deepEqual(await wallet(bob), startBob, "the buyer too");
    const { rows } = await pool.query(`SELECT house_net_cash FROM market.prediction_markets WHERE id = $1`, [id]);
    assert.equal(Number(rows[0].house_net_cash), 0, "the house neither paid nor kept anything");
    const positions = await pool.query(`SELECT SUM(realized_pnl_cash) AS pnl, SUM(shares) AS shares FROM market.prediction_market_positions WHERE market_id = $1`, [id]);
    assert.deepEqual([Number(positions.rows[0].pnl), Number(positions.rows[0].shares)], [0, 0], "no P&L left for the leaderboard");
  });

  await t.test("a void can take Credit below zero rather than leave a gain behind", async () => {
    const { slug, id } = await eventMarket("A market that voids after the gain is spent");
    const { fill } = await buy(slug, alice, "yes", 100);
    await buy(slug, bob, "yes", 1000);
    await trading.trade(pool, { userId: alice, slug, outcomeCode: "yes", side: "sell", shares: fill.shares });
    await pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = 0 WHERE user_id = $1`, [alice]);
    const { clawed_back: owed } = await resolution.voidMarket(pool, { id: alice, is_admin: true }, id, { reason: "Test void" });
    assert.equal((await wallet(alice)).credit, -owed);
    await pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = 100000 WHERE user_id = $1`, [alice]);
  });

  await t.test("bets racing the close: each lands before it or not at all", async () => {
    const { slug, id } = await eventMarket("A market that closes while people are betting");
    const start = await wallet(bob);
    const results = await Promise.allSettled([
      ...Array.from({ length: 6 }, () => buy(slug, bob, "yes", 10)),
      resolution.closeMarket(pool, { id: alice, is_admin: true }, id),
      ...Array.from({ length: 6 }, () => buy(slug, bob, "yes", 10)),
    ]);
    const closeIndex = 6;
    assert.equal(results[closeIndex].status, "fulfilled");
    const bets = results.filter((_, index) => index !== closeIndex);
    for (const bet of bets) if (bet.status === "rejected") assert.equal(bet.reason.code, "prediction_market_closed");
    const landed = bets.filter((bet) => bet.status === "fulfilled").length;
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM market.prediction_market_trades WHERE market_id = $1`, [id]);
    assert.equal(rows[0].n, landed, "every trade on the books is a bet that was accepted");
    const spent = Math.round((start.credit - (await wallet(bob)).credit) * 100) / 100;
    assert.equal(spent, landed * 10, "and only those were charged");
    await assert.rejects(buy(slug, bob, "yes", 10), refused);
  });

  await t.test("the scheduler closes locked markets in its cycle", async () => {
    const video = await addStream(kor.channel, { scheduled: minutes(120) });
    await auto.runAutoTemplates(pool);
    const market = await marketFor(video);
    await updateStream(video, `status = 'live', actual_start_at = now()`);
    const quietLogger = { error: () => {}, log: () => {} };
    const steps = await scheduler.runCycle(pool, null, quietLogger);
    assert.deepEqual(steps.failed, []);
    assert.ok(steps.auto_locked.some((row) => row.slug === market.slug));
    assert.equal((await marketFor(video)).status, "closed");
  });

  await t.test("event markets have no data lock and trade until they close", async () => {
    const { slug } = await eventMarket("An event market stays tradeable");
    await buy(slug, alice, "yes", 10);
    assert.equal(await guards.autoMarketLock(pool, { kind: "event" }), null);
  });
});
