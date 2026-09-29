const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const secrecy = require("../src/services/marketSecrecy");

test("a lone settlement mark never leaves in a scrubbed payload", () => {
  const out = secrecy.scrubPublicMarketPayload({ symbol: "PEK", mid_close: 20.1, mid_close_mark: 19.96, candles: [{ bucket: "2026-09-29", close: 20.1, close_mark: 19.8 }] });
  assert.equal(out.mid_close_mark, undefined);
  assert.equal(out.mid_close, 20.1);
  // Candle marks stay: the queries already dropped the ones whose day isn't finished.
  assert.equal(out.candles[0].close_mark, 19.8);
});

// Against a real database when CI provides one (its own, so its tables can't collide with others).
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
test("marks_revealed: a day's mark is out only once its last tick has landed", { skip: !databaseUrl }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("CREATE DATABASE nasfaq_secrecy_test");
  } catch (error) {
    if (error.code !== "42P04") throw error;
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_secrecy_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS market;
    DROP TABLE IF EXISTS market.asset_adjustment_intervals, market.adjustment_sessions, market.daily_market_reports CASCADE;
    CREATE TABLE market.adjustment_sessions (id bigint PRIMARY KEY, market_date date NOT NULL);
    CREATE TABLE market.asset_adjustment_intervals (id bigserial PRIMARY KEY, session_id bigint NOT NULL, status text NOT NULL);
    CREATE TABLE market.daily_market_reports (market_date date PRIMARY KEY);
  `);
  await pool.query(secrecy.schema);
  await pool.query(`
    INSERT INTO market.daily_market_reports VALUES ('2026-09-27'), ('2026-09-28'), ('2026-09-29'), ('2026-09-30');
    INSERT INTO market.adjustment_sessions VALUES (28, '2026-09-28'), (29, '2026-09-29');
    -- 09-28: all four ticks landed. 09-29: two landed, two to go.
    INSERT INTO market.asset_adjustment_intervals (session_id, status) VALUES
      (28, 'applied'), (28, 'applied'), (28, 'skipped'), (28, 'applied'),
      (29, 'applied'), (29, 'applied'), (29, 'scheduled'), (29, 'scheduled');
  `);
  const revealed = async (date) => (await pool.query("SELECT market.marks_revealed($1::date) AS ok", [date])).rows[0].ok;
  assert.equal(await revealed("2026-09-28"), true, "all ticks landed");
  assert.equal(await revealed("2026-09-29"), false, "ticks still to land");
  assert.equal(await revealed("2026-09-30"), false, "just settled: its ticks aren't even scheduled yet");
  assert.equal(await revealed("2026-09-27"), true, "no session, but a newer day has settled");

  // The last ticks land: the day's marks come out.
  await pool.query("UPDATE market.asset_adjustment_intervals SET status = 'applied' WHERE session_id = 29");
  assert.equal(await revealed("2026-09-29"), true);
});

test("the day's breakdown: landed adjustments only, strengths once the day is done", { skip: !databaseUrl }, async (t) => {
  const target = new URL(databaseUrl);
  target.pathname = "/nasfaq_secrecy_test";
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("CREATE DATABASE nasfaq_secrecy_test");
  } catch (error) {
    if (error.code !== "42P04") throw error;
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS market;
    DROP TABLE IF EXISTS market.asset_adjustment_intervals, market.adjustment_sessions, market.daily_market_reports, market.asset_daily_market_state, market.market_assets CASCADE;
    CREATE TABLE market.adjustment_sessions (id bigint PRIMARY KEY, market_date date NOT NULL);
    CREATE TABLE market.asset_adjustment_intervals (
      id bigserial PRIMARY KEY, session_id bigint NOT NULL, asset_id bigint NOT NULL, interval_key text NOT NULL,
      scheduled_at timestamptz NOT NULL, applied_at timestamptz, status text NOT NULL,
      price_before numeric, price_after numeric, strength_pct numeric, base_rate numeric
    );
    CREATE TABLE market.daily_market_reports (market_date date PRIMARY KEY);
    CREATE TABLE market.market_assets (id bigint PRIMARY KEY, symbol text, status text);
    CREATE TABLE market.asset_daily_market_state (asset_id bigint, market_date date, mid_open numeric, mid_close numeric);
  `);
  await pool.query(secrecy.schema);
  await pool.query(`
    INSERT INTO market.market_assets VALUES (1, 'PEK', 'active');
    INSERT INTO market.asset_daily_market_state VALUES (1, '2026-09-29', 20, 19.5);
    INSERT INTO market.daily_market_reports VALUES ('2026-09-29');
    INSERT INTO market.adjustment_sessions VALUES (29, '2026-09-29');
    INSERT INTO market.asset_adjustment_intervals (session_id, asset_id, interval_key, scheduled_at, applied_at, status, price_before, price_after, strength_pct, base_rate) VALUES
      (29, 1, 'open', '2026-09-29T13:00:00Z', '2026-09-29T13:00:01Z', 'applied', 20, 19.9, 5, 18),
      (29, 1, 'lunch', '2026-09-29T19:00:00Z', '2026-09-29T19:00:01Z', 'applied', 20.1, 19.8, 12, 18),
      (29, 1, 'late', '2026-09-30T01:00:00Z', NULL, 'scheduled', NULL, NULL, 150, 18),
      (29, 1, 'overnight', '2026-09-30T07:00:00Z', NULL, 'scheduled', NULL, NULL, 33, 18);
  `);
  const { getSessionBreakdown } = require("../src/services/reportSession");
  let day = await getSessionBreakdown(pool, "2026-09-29");
  assert.equal(day.finished, false);
  assert.equal(new Date(day.reveal_at).toISOString(), "2026-09-30T07:00:00.000Z");
  assert.deepEqual(day.adjustments.map((a) => [a.key, a.landed, a.total]), [["open", 1, 1], ["lunch", 1, 1], ["late", 0, 1], ["overnight", 0, 1]]);
  const pek = day.assets[0];
  assert.deepEqual([pek.open, pek.close], [20, 19.5]);
  assert.deepEqual(pek.steps.map((s) => [s.key, s.before, s.after, s.strength_pct]), [["open", 20, 19.9, null], ["lunch", 20.1, 19.8, null], ["late", null, null, null], ["overnight", null, null, null]]);
  assert.ok(!JSON.stringify(day).includes("base_rate"));

  await pool.query("UPDATE market.asset_adjustment_intervals SET status = 'applied', applied_at = scheduled_at, price_before = 19.8, price_after = 19.6 WHERE status = 'scheduled'");
  day = await getSessionBreakdown(pool, "2026-09-29");
  assert.equal(day.finished, true);
  assert.equal(day.reveal_at, null);
  assert.deepEqual(day.assets[0].steps.map((s) => s.strength_pct), [5, 12, 150, 33]);
  await assert.rejects(getSessionBreakdown(pool, "yesterday"), { code: "invalid_date" });
});
