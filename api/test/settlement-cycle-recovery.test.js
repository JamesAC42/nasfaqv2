const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const fundamentals = require("../src/services/fundamentals");
const settlement = require("../src/services/settlement");
const marketState = require("../src/services/marketState");
const marketAdjustments = require("../src/services/marketAdjustments");
const scheduler = require("../src/services/marketScheduler");

// The daily cycle when it fails partway, from the state-machine audit:
// - MC-A: a failure after the settlement commits (the tick session, the cache, the reopen) used to
//   leave the day without ticks and the market on the day before, and no later cycle finished it.
// - MC-B: a failure after fundamentals commits used to reopen trading on the new fair values, which
//   stay hidden until the Open.
// One market (two talents, 20 days of stats ending today, the first 19 settled) is seeded once and
// cloned for each case. On databases of their own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const config = { enabled: true, timeZone: "America/New_York", hour: 9, minute: 0 };
const SEED = "nasfaq_cycle_recovery_seed";

const today = scheduler.getCurrentDateKey(new Date(), "America/New_York");
const day = (i) => scheduler.shiftDateKey(today, i - 19); // day(19) is today
const yesterday = day(18);

function databaseNamed(name) {
  const target = new URL(databaseUrl);
  target.pathname = `/${name}`;
  return target.href;
}

async function withAdmin(work) {
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
}

async function silenced(work) {
  const saved = [console.log, console.info, console.warn];
  console.log = console.info = console.warn = () => {};
  try {
    return await work();
  } finally {
    [console.log, console.info, console.warn] = saved;
  }
}

async function seedMarket(pool) {
  await silenced(() => applySchema(pool));
  const channels = [
    { id: "UCcyclerecovery000000001", symbol: "CRA", subs: 900_000, growth: 0.004 },
    { id: "UCcyclerecovery000000002", symbol: "CRB", subs: 2_400_000, growth: -0.002 },
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
    for (let i = 0; i < 20; i += 1) {
      // A jump on the last day, so today's fair values differ clearly from yesterday's.
      const lift = i === 19 ? 1.08 : 1;
      stats.push({ time: `${day(i)}T16:00:00Z`, id: channel.id, subs: Math.round(channel.subs * (1 + channel.growth) ** i * lift), views: 40_000_000 + i * 250_000 * lift, videos: 400 + i });
    }
  }
  await pool.query(
    `INSERT INTO yt.youtube_channel_daily_stats (time, youtube_channel_id, subscriber_count, view_count, video_count)
     SELECT s.time, s.id, s.subs, s.views, s.videos FROM jsonb_to_recordset($1::jsonb) AS s(time timestamptz, id text, subs bigint, views bigint, videos bigint)`,
    [JSON.stringify(stats)]
  );
  await silenced(async () => {
    await fundamentals.recalculateFundamentals(pool, { from: day(0), to: yesterday, activeOnly: true, fillMissingDates: true });
    const settled = await settlement.settleMarketRange(pool, { from: day(0), to: yesterday });
    assert.equal(settled.settled_count, 19);
  });
  // The market as the scheduler left it yesterday: open on yesterday, its ticks done.
  await pool.query(`INSERT INTO market.adjustment_sessions (market_date, status) VALUES ($1, 'completed')`, [yesterday]);
  const client = await pool.connect();
  try {
    await marketState.setMarketOpen(client, { lastSettlementMarketDate: yesterday, clearError: true });
  } finally {
    client.release();
  }
}

/** Replaces `object[name]` for its next call only, with `impl` (given the real function). */
function failOnce(t, object, name, impl) {
  const real = object[name];
  let used = false;
  object[name] = async (...args) => {
    if (used) return real(...args);
    used = true;
    return impl(real, ...args);
  };
  t.after(() => {
    object[name] = real;
  });
}

async function read(pool) {
  const state = (await pool.query(`SELECT trading_status, last_settlement_market_date::text AS market_date, last_cycle_error FROM market.market_runtime_state WHERE state_key = 'primary'`)).rows[0];
  const run = (await pool.query(`SELECT status FROM market.market_settlement_runs WHERE market_date = $1`, [today])).rows[0];
  const sessions = (await pool.query(`SELECT count(*)::int AS n FROM market.adjustment_sessions WHERE market_date = $1`, [today])).rows[0].n;
  const intervals = (await pool.query(`SELECT count(*)::int AS n FROM market.asset_adjustment_intervals i JOIN market.adjustment_sessions s ON s.id = i.session_id WHERE s.market_date = $1`, [today])).rows[0].n;
  const assets = (await pool.query(`SELECT symbol, current_fair_value::text AS fair, latest_snapshot_date::text AS snapshot_date FROM market.market_assets ORDER BY symbol`)).rows;
  return { state, run: run?.status || null, sessions, intervals, assets };
}

async function settledFairValues(pool, marketDate) {
  const { rows } = await pool.query(
    `SELECT a.symbol, d.fair_value::text AS fair FROM market.asset_daily_market_state d JOIN market.market_assets a ON a.id = d.asset_id WHERE d.market_date = $1 ORDER BY a.symbol`,
    [marketDate]
  );
  return rows.map((row) => [row.symbol, row.fair]);
}

test("the daily cycle finishes or rolls back what a failed cycle left half done", { skip: !databaseUrl, timeout: 300_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${SEED} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${SEED}`);
  });
  const seedPool = new Pool({ connectionString: databaseNamed(SEED) });
  try {
    await seedMarket(seedPool);
  } finally {
    await seedPool.end();
  }

  const clones = [];
  t.after(() => withAdmin(async (admin) => {
    for (const name of [...clones, SEED]) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }));
  async function clone(t, name) {
    const full = `nasfaq_cycle_recovery_${name}`;
    clones.push(full);
    await withAdmin(async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS ${full} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${full} TEMPLATE ${SEED}`);
    });
    const pool = new Pool({ connectionString: databaseNamed(full) });
    t.after(() => pool.end());
    return pool;
  }
  const cycle = (pool) => silenced(() => scheduler.runScheduledCycle(pool, config, quiet, null));

  await t.test("MC-A: the tick session fails after the settlement commits, and the next cycle finishes the day", async (t) => {
    const pool = await clone(t, "ticks");
    failOnce(t, marketAdjustments, "ensureAdjustmentSession", async () => {
      throw new Error("Cannot use a pool after calling end on the pool");
    });
    await assert.rejects(cycle(pool), /pool after calling end/);
    let now = await read(pool);
    assert.equal(now.run, "completed", "today's settlement committed");
    assert.equal(now.sessions, 0, "but today has no tick session");
    assert.equal(now.state.trading_status, "open");
    assert.equal(now.state.market_date, yesterday, "and the market is still on yesterday");
    assert.ok(now.state.last_cycle_error);

    const finished = await cycle(pool);
    assert.equal(finished.finished, today, "the next cycle finishes today's bookkeeping");
    now = await read(pool);
    assert.equal(now.sessions, 1, "today's tick session exists");
    assert.equal(now.intervals, 8, "four ticks for each of the two stocks");
    assert.equal(now.state.market_date, today, "the market is on today");
    assert.equal(now.state.last_cycle_error, null, "and the error is cleared");
    assert.equal(now.state.trading_status, "open");

    // Done once: later cycles have nothing left to do and change nothing.
    assert.equal((await cycle(pool)).skipped, "nothing_ready");
    const again = await read(pool);
    assert.equal(again.sessions, 1);
    assert.equal(again.intervals, 8);
    assert.equal(again.state.market_date, today);
  });

  await t.test("MC-A: only the reopen fails, after the tick session is made, and the next cycle moves the market onto today", async (t) => {
    const pool = await clone(t, "reopen");
    failOnce(t, marketState, "setMarketOpen", async () => {
      throw new Error("Connection terminated unexpectedly");
    });
    await assert.rejects(cycle(pool), /Connection terminated/);
    let now = await read(pool);
    assert.equal(now.run, "completed");
    assert.equal(now.sessions, 1, "the tick session was made before the failure");
    assert.equal(now.state.market_date, yesterday);

    assert.equal((await cycle(pool)).finished, today);
    now = await read(pool);
    assert.equal(now.state.market_date, today);
    assert.equal(now.state.last_cycle_error, null);
    assert.equal(now.sessions, 1, "the session isn't made twice");
    assert.equal(now.intervals, 8, "and its ticks aren't either");
  });

  await t.test("MC-B: settlement fails after fundamentals commits, and trading reopens on yesterday's fair values", async (t) => {
    const pool = await clone(t, "fair");
    const before = await read(pool);
    const yesterdays = await settledFairValues(pool, yesterday);
    assert.deepEqual(before.assets.map((asset) => [asset.symbol, asset.fair]), yesterdays, "the stocks start on yesterday's settled fair values");

    failOnce(t, settlement, "settleMarketRange", async () => {
      throw new Error("canceling statement due to statement timeout");
    });
    await assert.rejects(cycle(pool), /statement timeout/);
    const now = await read(pool);
    const computed = (await pool.query(`SELECT count(*)::int AS n FROM market.channel_daily_snapshots WHERE snapshot_date = $1 AND calculation_status = 'complete'`, [today])).rows[0].n;
    assert.equal(computed, 2, "fundamentals committed today's snapshots");
    assert.equal(now.run, null, "settlement didn't");
    assert.equal(now.state.trading_status, "open");
    assert.ok(now.state.last_cycle_error);
    assert.deepEqual(now.assets.map((asset) => [asset.symbol, asset.fair]), yesterdays, "trading reopened on yesterday's fair values");
    assert.deepEqual(now.assets.map((asset) => asset.snapshot_date), [yesterday, yesterday]);

    // The retry settles today, and only then do today's fair values reach the stocks.
    const settled = await cycle(pool);
    assert.equal(settled.settlement.settled_count, 1);
    const after = await read(pool);
    const todays = await settledFairValues(pool, today);
    assert.deepEqual(after.assets.map((asset) => [asset.symbol, asset.fair]), todays);
    assert.notDeepEqual(todays, yesterdays, "today's fair values differ, so the check above means something");
    assert.equal(after.state.market_date, today);
    assert.equal(after.sessions, 1);
  });

  await t.test("MC-B: a cycle cut off after fundamentals (a restart), and the reopen at boot puts yesterday's fair values back", async (t) => {
    const pool = await clone(t, "boot");
    const yesterdays = await settledFairValues(pool, yesterday);
    await silenced(() => fundamentals.recalculateFundamentals(pool, { from: today, to: today, activeOnly: true, fillMissingDates: true }));
    const moved = (await read(pool)).assets.map((asset) => [asset.symbol, asset.fair]);
    assert.notDeepEqual(moved, yesterdays, "fundamentals put today's fair values on the stocks");

    const client = await pool.connect();
    try {
      assert.equal(await marketState.restoreSettledFairValues(client), 2);
      assert.equal(await marketState.restoreSettledFairValues(client), 0, "a second run has nothing to do");
    } finally {
      client.release();
    }
    const now = await read(pool);
    assert.deepEqual(now.assets.map((asset) => [asset.symbol, asset.fair]), yesterdays);
    assert.deepEqual(now.assets.map((asset) => asset.snapshot_date), [yesterday, yesterday]);
  });
});
