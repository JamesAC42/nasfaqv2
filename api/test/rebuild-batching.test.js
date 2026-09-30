const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool, Client } = require("pg");
const adjustments = require("../src/services/marketAdjustments");
const fundamentals = require("../src/services/fundamentals");

// The rebuild's two bulk writes (a day's adjustment intervals, and the fundamentals snapshots), each
// once in one statement per batch where they used to be one statement per row. Against a real
// database when CI provides one: its own, with just the tables these touch.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

async function openDatabase(t) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("CREATE DATABASE nasfaq_batching_test");
  } catch (error) {
    if (error.code !== "42P04") throw error;
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_batching_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  return pool;
}

/** Counts statements whose text matches `pattern` while `fn` runs. */
async function countingStatements(pattern, fn) {
  const original = Client.prototype.query;
  let count = 0;
  Client.prototype.query = function counted(config, ...rest) {
    const text = typeof config === "string" ? config : config?.text;
    if (text && pattern.test(text)) count += 1;
    return original.call(this, config, ...rest);
  };
  try {
    const result = await fn();
    return { result, count };
  } finally {
    Client.prototype.query = original;
  }
}

test("a day's adjustment intervals go in as one statement", { skip: !databaseUrl }, async (t) => {
  const pool = await openDatabase(t);
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS market;
    DROP TABLE IF EXISTS market.asset_adjustment_intervals, market.adjustment_sessions, market.market_assets;
    CREATE TABLE market.market_assets (
      id BIGSERIAL PRIMARY KEY, symbol TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      adjustment_enabled BOOLEAN NOT NULL DEFAULT true, current_fair_value NUMERIC, current_mid_price NUMERIC,
      adjustment_min_pct NUMERIC, adjustment_max_pct NUMERIC
    );
    CREATE TABLE market.adjustment_sessions (
      id BIGSERIAL PRIMARY KEY, market_date DATE NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'scheduled',
      generated_at TIMESTAMPTZ, opened_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE market.asset_adjustment_intervals (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES market.adjustment_sessions(id) ON DELETE CASCADE,
      asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
      interval_key TEXT NOT NULL, scheduled_at TIMESTAMPTZ NOT NULL, strength_pct NUMERIC NOT NULL, base_rate NUMERIC NOT NULL,
      price_before NUMERIC, price_after NUMERIC, status TEXT NOT NULL DEFAULT 'scheduled', applied_at TIMESTAMPTZ,
      metadata_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (session_id, asset_id, interval_key),
      CHECK (interval_key IN ('open', 'lunch', 'late', 'overnight')), CHECK (strength_pct >= 0), CHECK (base_rate > 0)
    );
    INSERT INTO market.market_assets (symbol, display_name, current_fair_value, current_mid_price, adjustment_min_pct, adjustment_max_pct, adjustment_enabled, status) VALUES
      ('AAA', 'Talent A', 12.5, 11.25, 10, 90, true, 'active'),
      ('BBB', 'Talent B', 8.123456, 9.5, 0, 200, true, 'active'),
      ('CCC', 'Talent C', 20, 20, 60, 90, true, 'active'),      -- 4 x 60 > 200: skipped, bounds can't be met
      ('DDD', 'Talent D', 5, 5, 0, 200, false, 'active'),       -- adjustments off: not listed
      ('EEE', 'Talent E', 7, 7, 0, 200, true, 'delisted');      -- not active: not listed
  `);

  const marketDate = "2026-09-29";
  const { result: first, count } = await countingStatements(/INSERT INTO market\.asset_adjustment_intervals/, () =>
    adjustments.ensureAdjustmentSession(pool, { marketDate })
  );
  assert.equal(count, 1);
  assert.equal(first.created, true);
  assert.equal(first.interval_count, 8);
  assert.deepEqual(first.skipped_assets.map((asset) => [asset.symbol, asset.error]), [["CCC", "invalid_adjustment_strength_bounds"]]);

  const schedule = adjustments.getIntervalSchedule(marketDate);
  const { rows } = await pool.query(`
    SELECT a.symbol, i.interval_key, i.scheduled_at, i.strength_pct::float8 AS strength, i.base_rate::text AS base_rate, i.status, i.metadata_json
    FROM market.asset_adjustment_intervals i JOIN market.market_assets a ON a.id = i.asset_id
    ORDER BY a.symbol, i.scheduled_at`);
  assert.equal(rows.length, 8);
  for (const symbol of ["AAA", "BBB"]) {
    const mine = rows.filter((row) => row.symbol === symbol);
    assert.deepEqual(mine.map((row) => row.interval_key), schedule.map((slot) => slot.key));
    assert.deepEqual(mine.map((row) => row.scheduled_at.toISOString()), schedule.map((slot) => slot.scheduledAt.toISOString()));
    assert.equal(mine.reduce((sum, row) => sum + row.strength, 0), adjustments.INTERVAL_STRENGTH_TOTAL_PCT);
    assert.ok(mine.every((row) => row.status === "scheduled"));
    assert.deepEqual(mine[0].metadata_json, { label: schedule[0].label, timezone: schedule[0].timeZone, generated_market_price: symbol === "AAA" ? 11.25 : 9.5 });
  }
  const aaa = rows.filter((row) => row.symbol === "AAA");
  assert.ok(aaa.every((row) => row.strength >= 10 && row.strength <= 90));
  assert.ok(aaa.every((row) => row.base_rate === "12.5"));
  assert.ok(rows.filter((row) => row.symbol === "BBB").every((row) => row.base_rate === "8.123456"));

  // Already generated: left alone. Forced: a fresh session with the same shape.
  const again = await adjustments.ensureAdjustmentSession(pool, { marketDate });
  assert.deepEqual([again.created, again.interval_count], [false, 8]);
  const forced = await adjustments.ensureAdjustmentSession(pool, { marketDate, force: true });
  assert.equal(forced.created, true);
  assert.notEqual(forced.session.id, first.session.id);
  const { rows: counts } = await pool.query(`SELECT count(*)::int AS n, count(DISTINCT session_id)::int AS sessions FROM market.asset_adjustment_intervals`);
  assert.deepEqual(counts[0], { n: 8, sessions: 1 });

  // Nothing adjustable: a session with no intervals, and no insert at all.
  await pool.query(`UPDATE market.market_assets SET adjustment_enabled = false`);
  const { result: empty, count: none } = await countingStatements(/INSERT INTO market\.asset_adjustment_intervals/, () =>
    adjustments.ensureAdjustmentSession(pool, { marketDate: "2026-09-30" })
  );
  assert.deepEqual([empty.created, empty.interval_count, none], [true, 0, 0]);
});

test("fundamentals snapshots are written a thousand at a time, exactly as given", { skip: !databaseUrl }, async (t) => {
  const pool = await openDatabase(t);
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS market;
    DROP TABLE IF EXISTS market.channel_daily_snapshots;
    CREATE TABLE market.channel_daily_snapshots (
      id BIGSERIAL PRIMARY KEY, youtube_channel_id TEXT NOT NULL, snapshot_date DATE NOT NULL,
      subscriber_count BIGINT NOT NULL, view_count BIGINT NOT NULL, video_count BIGINT,
      view_delta_1d BIGINT, view_delta_7d BIGINT, view_delta_30d BIGINT, video_delta_7d INTEGER, video_delta_30d INTEGER,
      estimated_sub_delta_7d NUMERIC, estimated_sub_delta_30d NUMERIC,
      size_anchor_raw NUMERIC, view_signal NUMERIC, upload_signal NUMERIC, sub_signal NUMERIC, momentum_raw NUMERIC,
      momentum_multiplier NUMERIC, fundamental_value_raw NUMERIC, fundamental_value_smoothed NUMERIC,
      calculation_version INTEGER, calculation_status TEXT NOT NULL DEFAULT 'pending', calculation_error TEXT,
      event_signal NUMERIC, event_kinds TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (youtube_channel_id, snapshot_date)
    );
  `);

  const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
  const snapshot = (channel, n, extra = {}) => ({
    youtube_channel_id: channel,
    snapshot_date: day(n),
    subscriber_count: String(1_000_000 + n), // bigint columns arrive from pg as strings
    view_count: 250_000_000 + n * 1000,
    video_count: n % 7 === 0 ? null : 900 + n,
    view_delta_1d: 1000,
    view_delta_7d: "7000",
    view_delta_30d: undefined,
    video_delta_7d: 2,
    video_delta_30d: Number.NaN, // numberOrNull: not a number, stored empty
    estimated_sub_delta_7d: 123.456789,
    estimated_sub_delta_30d: null,
    size_anchor_raw: 0.000012345678901234,
    view_signal: 1.5e-9,
    upload_signal: -0.25,
    sub_signal: 3,
    momentum_raw: 0.1 + 0.2,
    momentum_multiplier: 1.0625,
    fundamental_value_raw: 98765.4321,
    fundamental_value_smoothed: 98000.125,
    calculation_version: 1,
    calculation_status: "complete",
    calculation_error: null,
    event_signal: n % 5 === 0 ? 0.25 : undefined,
    event_kinds: n % 5 === 0 ? ["three_d", "birthday"] : undefined,
    ...extra,
  });
  const all = [];
  for (const channel of ["UCaaa", "UCbbb", "UCccc"]) for (let n = 0; n < 900; n += 1) all.push(snapshot(channel, n));
  // The same day twice: the later one wins, as in-order writes would.
  all.push(snapshot("UCaaa", 3, { sub_signal: 42, event_kinds: ["milestone"] }));

  const { result: written, count } = await countingStatements(/INSERT INTO market\.channel_daily_snapshots/, () => fundamentals.upsertCalculatedSnapshots(pool, all));
  assert.equal(written, 2700);
  assert.equal(count, 3);

  const { rows } = await pool.query(`SELECT * FROM market.channel_daily_snapshots WHERE youtube_channel_id = 'UCaaa' AND snapshot_date IN ('2026-01-01', '2026-01-03', '2026-01-04') ORDER BY snapshot_date`);
  const [first, third, fourth] = rows;
  assert.equal(first.snapshot_date instanceof Date ? first.snapshot_date.toISOString().slice(0, 10) : first.snapshot_date, "2026-01-01");
  assert.equal(first.subscriber_count, "1000000");
  assert.equal(first.view_count, "250000000");
  assert.equal(first.video_count, null);
  assert.equal(first.view_delta_7d, "7000");
  assert.equal(first.view_delta_30d, null);
  assert.equal(first.video_delta_30d, null);
  assert.equal(first.estimated_sub_delta_7d, "123.456789");
  assert.equal(first.size_anchor_raw, "0.000012345678901234");
  assert.equal(Number(first.view_signal), 1.5e-9);
  assert.equal(first.momentum_raw, String(0.1 + 0.2));
  assert.equal(first.event_signal, "0.25");
  assert.deepEqual(first.event_kinds, ["three_d", "birthday"]);
  assert.equal(fourth.sub_signal, "42");
  assert.deepEqual(fourth.event_kinds, ["milestone"]);
  assert.equal(third.event_signal, "0");
  assert.equal(third.event_kinds, null);

  // Again with new values: the same rows are updated in place.
  const { rows: before } = await pool.query(`SELECT count(*)::int AS n, sum(id)::text AS ids FROM market.channel_daily_snapshots`);
  await fundamentals.upsertCalculatedSnapshots(pool, all.map((row) => ({ ...row, fundamental_value_smoothed: 1, calculation_error: "recalculated" })));
  const { rows: after } = await pool.query(`SELECT count(*)::int AS n, sum(id)::text AS ids, bool_and(fundamental_value_smoothed = 1 AND calculation_error = 'recalculated') AS updated FROM market.channel_daily_snapshots`);
  assert.deepEqual(after[0], { ...before[0], updated: true });

  assert.equal(await fundamentals.upsertCalculatedSnapshots(pool, []), 0);
});
