const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const { computeDerivedSnapshot, upsertCalculatedSnapshots } = require("../src/services/fundamentals");
const marketAdjustments = require("../src/services/marketAdjustments");
const marketDb = require("../src/marketDb");
const reportSession = require("../src/services/reportSession");
const { scrubPublicMarketPayload } = require("../src/services/marketSecrecy");
const express = require("express");
const features = require("../src/features");
const marketRoutes = require("../src/routes/market");
const { invalidateCachedJson } = require("../src/responseCache");

// The live tick end to end on a real database: it records why it moved, the next tick carries that
// forward, and every public read has the line but never the private split behind it.

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const DAY = 86_400_000;
const shift = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

async function freshDatabase(t, name) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    console.warn = warn;
    console.log = log;
  }
  return pool;
}

async function addTalent(pool, symbol, { status = "active" } = {}) {
  const channel = `UC${symbol}`;
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1, $2, $2, $3, true)`, [channel, symbol, symbol]);
  const { rows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
     VALUES ($1, $2, $2, $3, 10000, 0, 10000, 2000, 400) RETURNING id`,
    [channel, symbol, status]
  );
  return { channel, id: Number(rows[0].id) };
}

test("a tick records why it moved, and public reads never carry the private split", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const pool = await freshDatabase(t, "nasfaq_tick_drivers_test");
  const { channel, id: assetId } = await addTalent(pool, "PEK");

  // Forty days of channel numbers; on the last day subscribers jump.
  const last = "2026-11-02";
  const points = [];
  let subs = 1_500_000;
  let views = 90_000_000;
  let videos = 700;
  for (let index = 39; index >= 0; index -= 1) {
    const date = shift(last, -index);
    subs += index === 0 ? 40_000 : 1_000;
    views += 300_000;
    if (index % 2 === 0) videos += 1;
    points.push({ youtube_channel_id: channel, snapshot_date: date, subscriber_count: subs, view_count: views, video_count: videos, has_video_count_data: true });
  }
  const history = new Map(points.map((point) => [point.snapshot_date, point]));
  let previous = null;
  const snapshots = points.map((point) => (previous = computeDerivedSnapshot(point, history, previous, 1, null, null)));
  const client = await pool.connect();
  try {
    await upsertCalculatedSnapshots(client, snapshots);
  } finally {
    client.release();
  }
  const fairOn = (date) => snapshots.find((row) => row.snapshot_date === date).fundamental_value_smoothed / 50_000;

  const setFair = (fair, mid) =>
    pool.query(
      `UPDATE market.market_assets SET current_fair_value = $2, current_fair_value_raw = $2, current_mid_price = COALESCE($3, current_mid_price),
         current_bid_price = COALESCE($3, current_mid_price) * 0.98, current_ask_price = COALESCE($3, current_mid_price) * 1.02,
         current_persistent_offset = 0, current_transient_offset = 0, offsets_updated_at = now()
       WHERE id = $1`,
      [assetId, fair, mid]
    );
  const schedule = async (marketDate, times, strengths) => {
    const { session } = await marketAdjustments.ensureAdjustmentSession(pool, { marketDate });
    for (const [index, key] of ["open", "lunch", "late", "overnight"].entries()) {
      await pool.query(`UPDATE market.asset_adjustment_intervals SET scheduled_at = $3, strength_pct = $4 WHERE session_id = $1 AND interval_key = $2`, [session.id, key, times[index], strengths[index]]);
    }
    return session;
  };
  const at = (minutes) => new Date(Date.now() + minutes * 60_000);

  // The day before: four ticks land toward that day's fair value (all in one batch).
  const dayBefore = shift(last, -1);
  await setFair(fairOn(dayBefore), fairOn(dayBefore) * 0.97);
  await schedule(dayBefore, [at(-240), at(-180), at(-120), at(-60)], [50, 50, 50, 50]);
  const first = await marketAdjustments.applyDueAdjustments(pool, { now: at(-55) });
  assert.equal(first.applied_count, 4);
  assert.deepEqual(first.adjustments.map((item) => item.interval_key), ["open", "lunch", "late", "overnight"]);

  // Settlement: the subscriber jump lifts the fair value. The Open tick names it.
  await setFair(fairOn(last), null);
  // The day's row settlement writes (the report's session view reads it).
  await pool.query(
    `INSERT INTO market.asset_daily_market_state (asset_id, market_date, snapshot_id, fair_value, mid_open, daily_emission, treasury_supply_start, circulating_supply_start)
     SELECT a.id, $2::date, s.id, a.current_fair_value, a.current_mid_price, 0, 10000, 0
     FROM market.market_assets a JOIN market.channel_daily_snapshots s ON s.youtube_channel_id = a.youtube_channel_id AND s.snapshot_date = $2::date
     WHERE a.id = $1`,
    [assetId, last]
  );
  await schedule(last, [at(-40), at(-1), at(60), at(120)], [60, 50, 40, 50]);
  const open = await marketAdjustments.applyDueAdjustments(pool, { now: at(-39) });
  assert.equal(open.applied_count, 1);
  const openTick = open.adjustments[0];
  assert.ok(openTick.price_after > openTick.price_before);
  assert.equal(openTick.reasons[0].kind, "subs", JSON.stringify(openTick.reasons));
  assert.match(openTick.reasons[0].text, /^Subscribers up [\d.]+% this week$/);

  // Players buy hard after the Open tick (prices move the way trading.js moves them).
  const { rows: user } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('buyer', 'buyer', 'buyer@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  for (const [minutes, quantity] of [[-30, 90], [-20, 80]]) {
    const { rows: asset } = await pool.query(`SELECT current_fair_value::float8 AS fair, current_persistent_offset::float8 AS p, current_transient_offset::float8 AS tr, offsets_updated_at FROM market.market_assets WHERE id = $1`, [assetId]);
    const ts = at(minutes);
    const fade = 0.5 ** ((ts - new Date(asset[0].offsets_updated_at)) / 60_000 / 60);
    const persistent = asset[0].p + 0.15 * (quantity / 2000);
    const transient = asset[0].tr * fade + 0.7 * (quantity / 2000);
    const mid = asset[0].fair * Math.exp(persistent + transient);
    const { rows: order } = await pool.query(
      `INSERT INTO market.trade_orders (user_id, asset_id, side, order_type, requested_quantity, filled_quantity, status) VALUES ($1, $2, 'buy', 'market', $3, $3, 'filled') RETURNING id`,
      [user[0].id, assetId, quantity]
    );
    await pool.query(
      `INSERT INTO market.trade_fills (order_id, asset_id, user_id, ts, side, price, quantity, gross_cash, fee_cash, net_cash, counterparty_type)
       VALUES ($1, $2, $3, $4, 'buy', $5::numeric, $6::numeric, $5::numeric * $6::numeric, 0, -$5::numeric * $6::numeric, 'treasury')`,
      [order[0].id, assetId, user[0].id, ts, mid, quantity]
    );
    await pool.query(
      `UPDATE market.market_assets SET current_mid_price = $2, current_persistent_offset = $3, current_transient_offset = $4, offsets_updated_at = $5 WHERE id = $1`,
      [assetId, mid, persistent, transient, ts]
    );
  }

  // The Lunch tick takes the buying back and says so.
  const lunch = await marketAdjustments.applyDueAdjustments(pool, { now: at(0) });
  assert.equal(lunch.applied_count, 1);
  const lunchTick = lunch.adjustments[0];
  assert.ok(lunchTick.price_after < lunchTick.price_before);
  assert.equal(lunchTick.reasons[0].text, "Eased after player buying since the Open tick");
  assert.equal(lunchTick.reasons[0].detail, "170 shares net bought since the Open tick");

  // Stored: the line in public form, the split privately.
  const { rows: stored } = await pool.query(`SELECT interval_key, reasons_json, driver_state_json FROM market.asset_adjustment_intervals WHERE asset_id = $1 AND status = 'applied' ORDER BY scheduled_at`, [assetId]);
  assert.equal(stored.length, 6);
  for (const row of stored) assert.ok(row.driver_state_json?.parts, `${row.interval_key} has a carried split`);
  assert.deepEqual(stored[5].reasons_json, lunchTick.reasons);

  // Every public read: the reasons, and nothing of the split.
  const reads = {
    history: await marketAdjustments.getAssetAdjustmentHistory(pool, "PEK", { recentLimit: 10, upcomingLimit: 2 }),
    summary: await marketAdjustments.getAdjustmentSummary(pool, { recentLimit: 20 }),
    assets: await marketDb.listAssets(pool),
    asset: await marketDb.getAssetBySymbol(pool, "PEK"),
    session: await reportSession.getSessionBreakdown(pool, last),
  };
  for (const [name, payload] of Object.entries(reads)) {
    const text = JSON.stringify(scrubPublicMarketPayload(payload));
    assert.ok(!text.includes("driver_state"), `${name} leaks the split`);
    assert.ok(!text.includes('"parts"'), `${name} leaks the split's parts`);
    assert.ok(text.includes("Eased after player buying since the Open tick"), `${name} carries the line`);
  }
  const latestOpen = reads.history.items.find((item) => item.interval_key === "open" && item.status === "applied");
  assert.equal(latestOpen.reasons[0].kind, "subs", "the stock page's tick log has the Open tick's line");
  assert.equal(reads.history.items.find((item) => item.status === "scheduled").reasons, null, "a tick still to come has no line");
  const sessionAsset = reads.session.assets.find((row) => row.symbol === "PEK");
  assert.equal(sessionAsset.steps.find((step) => step.key === "lunch").reasons[0].kind, "players");
  assert.equal(sessionAsset.steps.find((step) => step.key === "late").reasons, null, "a tick still to come has no line");
  const listed = (Array.isArray(reads.assets) ? reads.assets : reads.assets.assets ?? reads.assets.items).find((row) => row.symbol === "PEK");
  assert.equal(listed.latest_adjustment.reasons[0].kind, "players");

  // A forced tick goes through the same path.
  const forced = await marketAdjustments.forceNextAdjustment(pool, { marketDate: last, now: at(1) });
  assert.equal(forced.applied_count, 1);
  assert.ok(Array.isArray(forced.adjustments[0].reasons));

  // Over HTTP, as each viewer. While tick-reasons is staff-only, only admins get any tick's line,
  // whoever warms a shared cache first; turned on, everyone does.
  const { rows: written } = await pool.query(`SELECT reasons_json FROM market.asset_adjustment_intervals WHERE reasons_json IS NOT NULL`);
  const lines = [...new Set(written.flatMap((row) => row.reasons_json.flatMap((reason) => [reason.text, reason.detail].filter(Boolean))))];
  assert.ok(lines.length >= 2);
  let viewer = null;
  const app = express();
  app.use((req, _res, next) => {
    req.ctx = { pool, redis: null, user: viewer };
    next();
  });
  app.use("/api/market", marketRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/market`;
  const routes = ["/assets", "/hub", "/assets/PEK", "/assets/PEK/adjustments", "/adjustments/summary", `/report/daily/${last}/session`];
  const cacheKeys = ["market:assets", "market:hub:20", "market:asset:PEK", "market:adjustments:20", `market:report:session:${last}`];
  const read = async (user, route) => {
    viewer = user;
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, `${route}: ${response.status}`);
    return { text: await response.text(), cache: response.headers.get("cache-control") };
  };
  const anonymous = null;
  const player = { id: Number(user[0].id), username: "buyer", is_admin: false, can_manage_assets: true };
  const admin = { id: 999, username: "boss", is_admin: true };

  const staffOnly = features.override({ "tick-reasons": "staff" });
  try {
    for (const route of routes) {
      // Signed out first (warming everyone's copy), then an admin, then a player after the admin.
      for (const [who, user] of [["signed out", anonymous], ["admin", admin], ["player", player]]) {
        const { text, cache } = await read(user, route);
        assert.equal(cache, "private, no-cache", `${route} as ${who}: no proxy may keep a copy`);
        if (user?.is_admin) {
          assert.ok(text.includes('"reasons"'), `${route}: an admin gets the lines`);
        } else {
          assert.ok(!text.includes('"reasons"'), `${route} as ${who} carries tick reasons`);
          for (const line of lines) assert.ok(!text.includes(line), `${route} as ${who} carries "${line}"`);
        }
        assert.ok(!text.includes("driver_state") && !text.includes('"parts"'), `${route} as ${who} leaks the split`);
      }
    }
  } finally {
    staffOnly();
  }

  const everyone = features.override({ "tick-reasons": "on" });
  try {
    await invalidateCachedJson(null, cacheKeys);
    for (const route of routes) {
      for (const user of [anonymous, player]) {
        const { text } = await read(user, route);
        assert.ok(text.includes('"reasons"'), `${route}: turned on, everyone gets the lines`);
        assert.ok(!text.includes("driver_state"), route);
      }
    }
  } finally {
    everyone();
  }
});
