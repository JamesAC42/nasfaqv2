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
