const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const targetNudge = require("../src/services/targetNudge");
// These tests check rules the market package changes (services/marketPackage.js), so they run with it off; market-package.test.js covers it on.
require("../src/features").override({ "market-package": "off" });

// The fair value's server-side daily factor (services/targetNudge.js): deterministic, bounded, off
// without a secret, never applied to days before its activation date, and never in a public payload.

const ENV_KEYS = ["MARKET_TARGET_SECRET", "MARKET_TARGET_NUDGE_PCT", "MARKET_TARGET_NUDGE_FROM"];

/** Runs `work` with these MARKET_TARGET_* values (undefined: unset), then puts the old ones back. */
async function withEnv(values, work) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await work();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const SECRET = "test-only-secret-0123456789abcdef";
const on = (extra = {}) => targetNudge.settings({ MARKET_TARGET_SECRET: SECRET, ...extra });

// ── The factor ───────────────────────────────────────────────────────────

test("the same stock, day and secret always give the same factor", () => {
  const a = targetNudge.rawNudge("UC_ONE", "2026-11-15", on());
  const b = targetNudge.rawNudge("UC_ONE", "2026-11-15", on());
  assert.equal(a, b);
  assert.notEqual(a, 0);
  // A DATE column comes back from node-pg as local midnight: the same day, the same factor.
  assert.equal(targetNudge.rawNudge("UC_ONE", new Date(2026, 10, 15), on()), a);
});

test("the factor stays within ±pct and spreads across the range", () => {
  for (const pct of [1, 2, 3]) {
    const config = on({ MARKET_TARGET_NUDGE_PCT: String(pct) });
    const values = [];
    for (let i = 0; i < 2000; i += 1) {
      const day = new Date(Date.UTC(2026, 0, 1) + (i % 365) * 86_400_000).toISOString().slice(0, 10);
      values.push(targetNudge.rawNudge(`UC_${Math.floor(i / 365)}`, day, config));
    }
    for (const value of values) assert.ok(value >= -pct / 100 && value < pct / 100, `${value} outside ±${pct}%`);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.ok(Math.abs(mean) < (pct / 100) * 0.08, `mean ${mean} should be near 0`);
    assert.ok(Math.max(...values) > (pct / 100) * 0.95 && Math.min(...values) < -(pct / 100) * 0.95, "uses the whole range");
  }
});

test("the factor varies by stock and by day, and a different secret gives different values", () => {
  const config = on();
  const base = targetNudge.rawNudge("UC_ONE", "2026-11-15", config);
  assert.notEqual(targetNudge.rawNudge("UC_TWO", "2026-11-15", config), base);
  assert.notEqual(targetNudge.rawNudge("UC_ONE", "2026-11-16", config), base);
  const other = targetNudge.settings({ MARKET_TARGET_SECRET: "another-test-only-secret" });
  let differ = 0;
  for (let i = 0; i < 50; i += 1) {
    const day = new Date(Date.UTC(2026, 10, 1) + i * 86_400_000).toISOString().slice(0, 10);
    if (targetNudge.rawNudge("UC_ONE", day, other) !== targetNudge.rawNudge("UC_ONE", day, config)) differ += 1;
  }
  assert.equal(differ, 50);
});

test("a missing, empty or whitespace secret means no factor at all", async () => {
  for (const secret of [undefined, "", "   ", "\t\n"]) {
    const config = targetNudge.settings(secret === undefined ? {} : { MARKET_TARGET_SECRET: secret });
    assert.equal(config.enabled, false);
    assert.equal(targetNudge.rawNudge("UC_ONE", "2026-11-15", config), 0);
    // No database access either: a pool that throws is never touched.
    const gate = await targetNudge.loadGate({ query: () => { throw new Error("no queries"); } }, { config });
    const recorded = await targetNudge.recordGate({ query: () => { throw new Error("no queries"); } }, "2026-11-15", { config });
    for (const g of [gate, recorded]) {
      assert.equal(g.nudge("UC_ONE", "2026-11-15"), 0);
      const fair = 12.3456789;
      assert.equal(g.apply(fair, "UC_ONE", "2026-11-15"), fair, "returned untouched");
    }
  }
  await withEnv({ MARKET_TARGET_SECRET: "  " }, async () => assert.match(targetNudge.startupLine(), /target nudge: off$/));
  await withEnv({ MARKET_TARGET_SECRET: SECRET }, async () => {
    const line = targetNudge.startupLine();
    assert.match(line, /target nudge: on \(±2%/);
    assert.ok(!line.includes(SECRET), "the startup line never carries the secret");
  });
  // A zero percent is off too; a bad percent or date falls back with a warning.
  assert.equal(on({ MARKET_TARGET_NUDGE_PCT: "0" }).enabled, false);
  assert.equal(on({ MARKET_TARGET_NUDGE_PCT: "lots" }).pct, targetNudge.DEFAULT_PCT);
  assert.equal(on({ MARKET_TARGET_NUDGE_PCT: "50" }).pct, targetNudge.MAX_PCT);
  assert.equal(on({ MARKET_TARGET_NUDGE_FROM: "2026-13-40" }).from, null);
  assert.match(targetNudge.startupLine(on({ MARKET_TARGET_NUDGE_FROM: "soon" })), /ignored/);
});

test("days before the activation date get no factor", async () => {
  const config = on({ MARKET_TARGET_NUDGE_FROM: "2026-11-10" });
  const gate = await targetNudge.loadGate({ query: () => { throw new Error("env wins, no query"); } }, { config });
  assert.equal(gate.from, "2026-11-10");
  assert.equal(gate.source, "env");
  assert.equal(gate.nudge("UC_ONE", "2026-11-09"), 0);
  assert.equal(gate.nudge("UC_ONE", "2026-11-10"), targetNudge.rawNudge("UC_ONE", "2026-11-10", config));
  assert.equal(gate.nudge("UC_ONE", "2026-12-01"), targetNudge.rawNudge("UC_ONE", "2026-12-01", config));
  const fair = 20;
  assert.equal(gate.apply(fair, "UC_ONE", "2026-11-09"), fair);
  assert.ok(Math.abs(gate.apply(fair, "UC_ONE", "2026-11-12") / fair - Math.exp(gate.nudge("UC_ONE", "2026-11-12"))) < 1e-12);
  // Secret set but nothing recorded and no env date: nothing is nudged yet.
  const unrecorded = await targetNudge.loadGate({ query: async () => ({ rows: [{ from_date: null }] }) }, { config: on() });
  assert.equal(unrecorded.active, false);
  assert.equal(unrecorded.nudge("UC_ONE", "2030-01-01"), 0);
});

// ── Against a database: settlement, activation, rebuilds and public payloads ──

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const DB_NAME = "nasfaq_target_nudge_test";

test("settlement: activation, replays, the refresh and public payloads", { skip: !databaseUrl, timeout: 300_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const { applySchema } = require("../src/migrations");
  const fundamentals = require("../src/services/fundamentals");
  const settlement = require("../src/services/settlement");
  const scheduler = require("../src/services/marketScheduler");
  const { REFERENCE_SUPPLY } = require("../src/services/marketSupply");

  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  target.pathname = `/${DB_NAME}`;
  const pool = new Pool({ connectionString: target.href });
  // pool.end() resolves once it has asked every connection to close, not once they have. Dropping the
  // database WITH (FORCE) before then terminates a connection still on its way out, and the pool
  // throws that "terminating connection" error after the test. So wait for every connection to go.
  const open = new Set();
  pool.on("connect", (client) => open.add(client));
  pool.on("remove", (client) => open.delete(client));
  t.after(async () => {
    const allClosed = new Promise((resolve) => {
      const check = () => open.size === 0 && resolve();
      pool.on("remove", check);
      check();
    });
    await pool.end();
    await allClosed;
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.end();
  });

  const silenced = async (work) => {
    const saved = [console.log, console.info, console.warn];
    console.log = console.info = console.warn = () => {};
    try {
      return await work();
    } finally {
      [console.log, console.info, console.warn] = saved;
    }
  };

  // Two talents, 19 days of stats ending today.
  const today = scheduler.getCurrentDateKey(new Date(), "America/New_York");
  const day = (i) => scheduler.shiftDateKey(today, i - 18); // day(18) is today
  await silenced(() => applySchema(pool));
  const channels = [
    { id: "UCdailyfactor0000000001", symbol: "TNA", subs: 900_000, growth: 0.004 },
    { id: "UCdailyfactor0000000002", symbol: "TNB", subs: 2_400_000, growth: -0.002 },
  ];
  for (const channel of channels) {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1,$2,$2,$3,true)`, [channel.id, `Talent ${channel.symbol}`, channel.symbol]);
    await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps) VALUES ($1,$2,$3,'active',10000,0,10000,2000,400)`,
      [channel.id, channel.symbol, `Talent ${channel.symbol}`]
    );
  }
  const stats = [];
  for (const channel of channels) {
    for (let i = 0; i <= 18; i += 1) {
      stats.push({ time: `${day(i)}T16:00:00Z`, id: channel.id, subs: Math.round(channel.subs * (1 + channel.growth) ** i), views: 40_000_000 + i * 250_000, videos: 400 + i });
    }
  }
  await pool.query(
    `INSERT INTO yt.youtube_channel_daily_stats (time, youtube_channel_id, subscriber_count, view_count, video_count)
     SELECT s.time, s.id, s.subs, s.views, s.videos FROM jsonb_to_recordset($1::jsonb) AS s(time timestamptz, id text, subs bigint, views bigint, videos bigint)`,
    [JSON.stringify(stats)]
  );

  const fairValues = async () =>
    (await pool.query(`SELECT a.youtube_channel_id, d.market_date::text AS day, d.fair_value::float8 AS fair FROM market.asset_daily_market_state d JOIN market.market_assets a ON a.id = d.asset_id ORDER BY 1, 2`)).rows;
  const recorded = async () => (await pool.query(`SELECT target_nudge_from::text AS d FROM market.market_runtime_state WHERE state_key = 'primary'`)).rows[0]?.d ?? null;
  const smoothedPrice = async (channelId, date) => {
    const { rows } = await pool.query(`SELECT fundamental_value_smoothed::float8 AS v FROM market.channel_daily_snapshots WHERE youtube_channel_id = $1 AND snapshot_date = $2`, [channelId, date]);
    return fundamentals.normalizeFundamentalToPrice(rows[0].v, REFERENCE_SUPPLY);
  };
  const close = (a, b, label) => assert.ok(Math.abs(a / b - 1) < 1e-9, `${label}: ${a} vs ${b}`);

  // 1. Days 0–17 settle with no secret: the formula's values, nothing recorded.
  let baseline;
  await withEnv({}, async () => {
    await silenced(() => fundamentals.recalculateFundamentals(pool, { from: day(0), to: today, activeOnly: true, fillMissingDates: true }));
    const settled = await silenced(() => settlement.settleMarketRange(pool, { from: day(0), to: day(17) }));
    assert.equal(settled.settled_count, 18);
    baseline = await fairValues();
    assert.equal(await recorded(), null);
    for (const row of baseline.filter((r) => r.day === day(10))) close(row.fair, await smoothedPrice(row.youtube_channel_id, row.day), "un-nudged");
  });

  await t.test("a whitespace secret settles exactly as no secret", () =>
    withEnv({ MARKET_TARGET_SECRET: "   " }, async () => {
      const replay = await silenced(() => settlement.settleMarketRange(pool, { from: day(0), to: day(17), force: true }));
      assert.equal(replay.settled_count, 18);
      assert.deepEqual(await fairValues(), baseline);
      assert.equal(await recorded(), null);
    }));

  await t.test("a forced replay as the first run with the secret records nothing and nudges nothing", () =>
    withEnv({ MARKET_TARGET_SECRET: SECRET }, async () => {
      const replay = await silenced(() => settlement.settleMarketRange(pool, { from: day(0), to: day(17), force: true }));
      assert.equal(replay.settled_count, 18);
      assert.deepEqual(await fairValues(), baseline);
      assert.equal(await recorded(), null);
    }));

  await t.test("a regular settle of an old gap day records a date after the settled history, not that day", () =>
    withEnv({ MARKET_TARGET_SECRET: SECRET }, async () => {
      const gap = day(5);
      await pool.query(`DELETE FROM market.daily_market_reports WHERE market_date = $1`, [gap]);
      await pool.query(`DELETE FROM market.asset_price_events WHERE event_type = 'daily_reset' AND ts::date = $1::date`, [gap]);
      await pool.query(`DELETE FROM market.asset_daily_market_state WHERE market_date = $1`, [gap]);
      await pool.query(`DELETE FROM market.market_settlement_runs WHERE market_date = $1`, [gap]);
      await silenced(() => settlement.settleMarketDay(pool, { marketDate: gap }));
      assert.equal(await recorded(), today, "the day after the latest completed settlement");
      assert.deepEqual(await fairValues(), baseline, "the gap day settles at the formula's value");
    }));

  let todayValues;
  await t.test("the first regular settlement of a new day with the secret nudges from it", () =>
    withEnv({ MARKET_TARGET_SECRET: SECRET }, async () => {
      await silenced(() => settlement.settleMarketDay(pool, { marketDate: today }));
      assert.equal(await recorded(), today);
      const config = targetNudge.settings();
      todayValues = (await fairValues()).filter((row) => row.day === today);
      assert.equal(todayValues.length, 2);
      for (const row of todayValues) {
        const plain = await smoothedPrice(row.youtube_channel_id, today);
        const n = targetNudge.rawNudge(row.youtube_channel_id, today, config);
        assert.notEqual(n, 0);
        close(row.fair, plain * Math.exp(n), "nudged");
        assert.ok(Math.abs(Math.log(row.fair / plain)) <= targetNudge.DEFAULT_PCT / 100);
      }
      // Old days untouched.
      assert.deepEqual((await fairValues()).filter((row) => row.day < today), baseline);
    }));

  await t.test("a fundamentals refresh between settlements leaves today's fair value where settlement put it", () =>
    withEnv({ MARKET_TARGET_SECRET: SECRET }, async () => {
      const before = (await pool.query(`SELECT youtube_channel_id, current_fair_value::float8 AS fair FROM market.market_assets ORDER BY 1`)).rows;
      await silenced(() => fundamentals.recalculateFundamentals(pool, { from: day(0), to: today, activeOnly: true, fillMissingDates: true }));
      const after = (await pool.query(`SELECT youtube_channel_id, current_fair_value::float8 AS fair FROM market.market_assets ORDER BY 1`)).rows;
      for (const [index, row] of before.entries()) close(after[index].fair, row.fair, "refresh");
      for (const row of todayValues) close(before.find((r) => r.youtube_channel_id === row.youtube_channel_id).fair, row.fair, "current = settled");
    }));

  await t.test("public payloads never carry today's fair value or the factor before the reveal", () =>
    withEnv({ MARKET_TARGET_SECRET: SECRET }, async () => {
      // Fresh copies of the route modules, so no cached body from another test answers.
      for (const key of Object.keys(require.cache)) if (/[\\/]src[\\/](routes[\\/]market|publicMarketCache|responseCache)\.js$/.test(key)) delete require.cache[key];
      const marketRoutes = require("../src/routes/market");
      const data = new Map();
      const redis = { get: async (key) => data.get(key) ?? null, set: async (key, value) => void data.set(key, value), del: async () => {} };
      const app = express();
      app.use((req, _res, next) => {
        const admin = req.headers["x-test-admin"] === "1";
        req.ctx = { pool, redis, user: admin ? { id: 1, is_admin: true, email_verified: true } : null };
        next();
      });
      app.use("/api/market", marketRoutes);
      const server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      try {
        const get = async (path, headers = {}) => {
          const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
          return { status: response.status, text: await response.text() };
        };
        const secretValues = todayValues.map((row) => row.fair);
        const numbers = (text) => (text.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
        const paths = [
          "/api/market/assets",
          "/api/market/assets/TNA",
          "/api/market/assets/TNB",
          "/api/market/assets/TNA/stats",
          "/api/market/assets/TNA/candles",
          "/api/market/hub",
          "/api/market/report/daily/latest",
          `/api/market/report/daily/${today}`,
          "/api/market/status",
          "/api/market/tuning/config",
          "/api/market/indexes/overview",
        ];
        const answered = [];
        for (const path of paths) {
          const { status, text } = await get(path);
          if (status !== 200) continue;
          answered.push(path);
          assert.ok(!/nudge/i.test(text), `${path} mentions the factor`);
          for (const n of numbers(text)) {
            for (const secret of secretValues) assert.ok(Math.abs(n / secret - 1) > 1e-6, `${path} carries today's fair value ${secret}`);
          }
        }
        assert.deepEqual(answered, paths, "every public path answered");
        // Admins see that it's on and since when, never a value.
        const adminConfig = JSON.parse((await get("/api/market/tuning/config", { "x-test-admin": "1" })).text);
        assert.equal(adminConfig.target_nudge_enabled, true);
        assert.equal(adminConfig.target_nudge_from, today);
        assert.equal(adminConfig.target_nudge_from_source, "recorded");
        assert.ok(!JSON.stringify(adminConfig).includes(SECRET));
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }));

  await t.test("a rebuild's replay reproduces every day: old ones as they were, today's nudged the same", () =>
    withEnv({ MARKET_TARGET_SECRET: SECRET }, async () => {
      const replay = await silenced(() => settlement.settleMarketRange(pool, { from: day(0), to: today, force: true }));
      assert.equal(replay.settled_count, 19);
      const all = await fairValues();
      assert.deepEqual(all.filter((row) => row.day < today), baseline);
      assert.deepEqual(all.filter((row) => row.day === today), todayValues);
      assert.equal(await recorded(), today, "the recorded date stays");
    }));

  await t.test("with the secret gone, settlement still runs and today goes back to the formula's value", () =>
    withEnv({}, async () => {
      await silenced(() => settlement.settleMarketDay(pool, { marketDate: today, force: true }));
      for (const row of (await fairValues()).filter((r) => r.day === today)) close(row.fair, await smoothedPrice(row.youtube_channel_id, today), "off again");
    }));
});
