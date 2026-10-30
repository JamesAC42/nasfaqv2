const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const alerts = require("../src/services/alerts");
const health = require("../src/services/schedulerHealth");
const scheduler = require("../src/services/marketScheduler");
const watchdog = require("../src/services/watchdog");

// The watchdog's conditions (settlement missing, a failed cycle, an incomplete scrape, a quiet or
// failing scheduler, a burst of unhandled errors), the heartbeats it reads, and settlement's backoff.
// The database conditions run on a disposable local database next to CHAT_TEST_DATABASE_URL's.

for (const name of ["MARKET_SETTLEMENT_HOUR", "MARKET_SETTLEMENT_MINUTE", "SCRAPE_AT_LOCAL_HOUR", "SCRAPE_AT_LOCAL_MIN", "WATCHDOG_ERROR_THRESHOLD"]) delete process.env[name];
process.env.MARKET_SETTLEMENT_TIMEZONE = "America/New_York";
process.env.MARKET_DATA_TIMEZONE = "America/New_York";

const URL_ = "https://discord.com/api/webhooks/1/token-secret";
const quiet = { info() {}, warn() {}, error() {}, log() {} };
const MIN = 60_000;

/** Redis's calls used by heartbeats, alerts and the error counter, in memory. */
function fakeRedis() {
  const store = alerts.memoryStore();
  return {
    ...store,
    async mGet(keys) {
      return Promise.all(keys.map((key) => store.get(key)));
    },
    async incr(key) {
      const next = Number((await store.get(key)) || 0) + 1;
      await store.set(key, String(next));
      return next;
    },
    async expire() {
      return 1;
    },
  };
}

function recorder() {
  const posts = [];
  return { posts, fetchImpl: async (_to, init) => (posts.push(JSON.parse(init.body)), { ok: true, status: 204 }) };
}

const row = (now, overrides = {}) => ({
  enabled: true,
  interval_ms: 60_000,
  state: "idle",
  started_at: new Date(now - 60 * MIN).toISOString(),
  last_seen_at: new Date(now - 5_000).toISOString(),
  last_success_at: new Date(now - 30_000).toISOString(),
  error_code: null,
  ...overrides,
});

async function setHeartbeats(redis, now, overrides = {}) {
  for (const spec of health.SCHEDULERS) {
    const value = overrides[spec.name] === undefined ? row(now) : overrides[spec.name];
    if (value === null) await redis.del(health.KEY_PREFIX + spec.name);
    else await redis.set(health.KEY_PREFIX + spec.name, JSON.stringify(value));
  }
}

test("a heartbeat is missing, gone, stalled or failing; off and settlement's own errors don't count", () => {
  const now = Date.parse("2026-10-29T13:00:00Z");
  const spec = (name) => health.SCHEDULERS.find((item) => item.name === name);
  assert.equal(health.checkHeartbeat(spec("wire"), row(now), now), null);
  assert.equal(health.checkHeartbeat(spec("wire"), null, now).problem, "missing");
  assert.equal(health.checkHeartbeat(spec("wire"), row(now, { enabled: false, last_seen_at: new Date(now - 10 * MIN).toISOString() }), now), null);
  assert.equal(health.checkHeartbeat(spec("wire"), row(now, { last_seen_at: new Date(now - 2 * MIN).toISOString() }), now), null);
  const gone = health.checkHeartbeat(spec("wire"), row(now, { last_seen_at: new Date(now - 7 * MIN).toISOString() }), now);
  assert.deepEqual(gone, { problem: "gone", detail: "no heartbeat for 7m" });

  // A running tick: fine until its stall limit (the spec's, or 3 intervals and at least 2 minutes).
  const running = (minutes) => ({ state: "running", tick_started_at: new Date(now - minutes * MIN).toISOString() });
  assert.equal(health.checkHeartbeat(spec("live-orders"), row(now, { interval_ms: 1000, ...running(1.5) }), now), null);
  assert.equal(health.checkHeartbeat(spec("live-orders"), row(now, { interval_ms: 1000, ...running(3) }), now).problem, "stalled");
  assert.equal(health.checkHeartbeat(spec("settlement"), row(now, running(25)), now), null);
  assert.equal(health.checkHeartbeat(spec("settlement"), row(now, running(31)), now).problem, "stalled");

  // No clean tick past the spec's staleness. The weekly evaluation gets an hour of 15-minute retries.
  const failing = (minutes) => row(now, { state: "error", error_code: "ECONNREFUSED", last_success_at: new Date(now - minutes * MIN).toISOString() });
  assert.equal(health.checkHeartbeat(spec("ipo"), failing(10), now), null);
  assert.deepEqual(health.checkHeartbeat(spec("ipo"), failing(20), now), { problem: "failing", detail: "no clean tick for 20m (last error: ECONNREFUSED)" });
  assert.equal(health.checkHeartbeat(spec("weekly-evaluation"), failing(45), now), null);
  assert.equal(health.checkHeartbeat(spec("weekly-evaluation"), failing(61), now).problem, "failing");
  assert.equal(health.checkHeartbeat(spec("chatter"), failing(120), now), null);
  // Never a clean tick since the process started: counted from its start.
  assert.equal(health.checkHeartbeat(spec("ipo"), row(now, { last_success_at: null }), now).problem, "failing");
  // Settlement's failures have their own alerts; its heartbeat only says whether the loop is alive.
  assert.equal(health.checkHeartbeat(spec("settlement"), failing(600), now), null);
});

test("shared loops report from the scheduler pod only, and a skipped tick isn't a clean one", async (t) => {
  const saved = { owner: process.env.SCHEDULER_STATUS_OWNER, settlement: process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED };
  t.after(() => {
    for (const [name, value] of [["SCHEDULER_STATUS_OWNER", saved.owner], ["MARKET_SETTLEMENT_SCHEDULER_ENABLED", saved.settlement]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  // A web pod: no status owner, settlement off.
  delete process.env.SCHEDULER_STATUS_OWNER;
  process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED = "false";
  assert.equal(health.ownsSharedSchedulers(), false);
  const redis = fakeRedis();
  const web = health.startSchedulerHeartbeat(redis, "wire", { enabled: true, intervalMs: 600_000, shared: true }, quiet);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await redis.get(`${health.KEY_PREFIX}wire`), null);
  web.stop();
  // A lone local process, and the scheduler pod.
  delete process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED;
  assert.equal(health.ownsSharedSchedulers(), true);
  process.env.SCHEDULER_STATUS_OWNER = "true";
  process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED = "false";
  assert.equal(health.ownsSharedSchedulers(), true);

  t.mock.timers.enable({ apis: ["setInterval"] });
  const beat = health.startSchedulerHeartbeat(redis, "wire", { enabled: true, intervalMs: 600_000, shared: true }, quiet);
  t.after(() => beat.stop());
  const published = async () => {
    t.mock.timers.tick(15_000);
    await new Promise((resolve) => setImmediate(resolve));
    return JSON.parse(await redis.get(`${health.KEY_PREFIX}wire`));
  };
  assert.equal((await published()).last_success_at, null);
  beat.update("running");
  beat.update("idle");
  const clean = (await published()).last_success_at;
  assert.ok(clean);
  beat.update("running");
  beat.update("error", { code: "wire_failed" });
  let wire = await published();
  assert.deepEqual([wire.state, wire.error_code, wire.last_success_at], ["error", "wire_failed", clean]);
  // The next tick keeps the error while it runs; finding the lock taken elsewhere leaves it at that.
  beat.update("running");
  assert.deepEqual([(await published()).state, (await published()).error_code], ["running", "wire_failed"]);
  beat.skip();
  wire = await published();
  assert.deepEqual([wire.state, wire.error_code, wire.last_success_at], ["error", "wire_failed", clean]);

  const list = await health.listSchedulerHealth(redis);
  assert.deepEqual(list.map((item) => item.name), health.SCHEDULERS.map((spec) => spec.name));
  assert.equal(list.find((item) => item.name === "wire").scheduler_status, "error");
  assert.equal(list.find((item) => item.name === "settlement").problem, "missing");
  assert.equal((await health.listSchedulerHealth(null)).every((item) => item.scheduler_status === "unknown"), true);
});

test("settlement backs off after repeated failures, alerts once, and resolves when a cycle goes through", async () => {
  alerts._test.reset();
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(scheduler.settlementRetryDelayMs), [0, 0, 2 * MIN, 4 * MIN, 8 * MIN, 16 * MIN, 30 * MIN, 30 * MIN]);

  let now = Date.parse("2026-10-29T13:01:00Z");
  let failing = true;
  let cycles = 0;
  const updates = [];
  const heartbeat = { update: (state, error, extra) => updates.push({ state, error: error?.code || null, ...extra }), skip() {}, stop() {} };
  const { posts, fetchImpl } = recorder();
  const tick = scheduler.createSettlementTick(null, {
    config: { enabled: true, timeZone: "America/New_York", hour: 9, minute: 0 },
    heartbeat,
    logger: quiet,
    now: () => now,
    alertOptions: { url: URL_, fetchImpl },
    runCycle: async () => {
      cycles += 1;
      if (failing) throw Object.assign(new Error("scheduled_settlement_incomplete:[]"), { code: "scheduled_settlement_incomplete" });
      return { ok: true };
    },
  });

  // Minute by minute for 20 minutes: two quick retries, then 2, 4 and 8 minutes apart.
  const attempts = [];
  for (let minute = 0; minute < 20; minute += 1) {
    const before = cycles;
    await tick();
    if (cycles > before) attempts.push(minute);
    now += MIN;
  }
  assert.deepEqual(attempts, [0, 1, 2, 4, 8, 16]);
  assert.equal(posts.length, 1, "one alert for the whole run of failures");
  assert.equal(posts[0].embeds[0].title, "Daily settlement keeps failing");
  assert.match(posts[0].embeds[0].description, /^3 settlement cycles in a row have failed\..*Next try: 09:05 EDT\.$/s);
  assert.equal(posts[0].embeds[0].fields[0].value, "scheduled_settlement_incomplete:[]");
  const last = updates.filter((update) => update.state === "error").at(-1);
  assert.equal(last.consecutive_failures, 6);
  assert.equal(last.error, "scheduled_settlement_incomplete");

  // Before 09:00 the loop has nothing to do: a clean tick, no attempt.
  now = Date.parse("2026-10-30T12:00:00Z");
  failing = false;
  const before = cycles;
  await tick();
  assert.equal(cycles, before);
  assert.equal(updates.at(-1).state, "idle");

  now = Date.parse("2026-10-30T13:00:00Z");
  await tick();
  assert.equal(cycles, before + 1);
  assert.deepEqual(updates.at(-1), { state: "idle", error: null, consecutive_failures: 0, retry_at: null });
  assert.equal(posts.length, 2);
  assert.equal(posts[1].embeds[0].title, "Resolved: Daily settlement keeps failing");
});

test("a burst of unhandled errors fires past the threshold, counting the last 5 minutes only", async () => {
  const redis = fakeRedis();
  const now = Date.parse("2026-10-29T13:00:30Z");
  process.env.WATCHDOG_ERROR_THRESHOLD = "3";
  try {
    // Six minutes ago: outside the window.
    for (let i = 0; i < 10; i += 1) await watchdog.recordError(redis, { source: "http", error: new Error("old") }, { now: now - 6 * MIN });
    for (let i = 0; i < 3; i += 1) await watchdog.recordError(redis, { source: "http", error: new Error("x") }, { now: now - i * MIN });
    assert.equal((await watchdog.checkErrors(redis, { now: new Date(now) }))[0].firing, false);
    await watchdog.recordError(redis, { source: "http", method: "POST", path: "/api/market/orders?token=secret", error: Object.assign(new Error("relation \"x\" does not exist\n at ..."), { code: "42P01" }) }, { now });
    const [check] = await watchdog.checkErrors(redis, { now: new Date(now) });
    assert.equal(check.firing, true);
    assert.match(check.message, /^4 unhandled errors in the last 5 minutes/);
    assert.equal(check.fields[0].value, 'POST /api/market/orders · 42P01 · relation "x" does not exist');
  } finally {
    delete process.env.WATCHDOG_ERROR_THRESHOLD;
  }
  // Client mistakes aren't counted.
  assert.equal(watchdog.isServerFault(Object.assign(new Error("bad json"), { status: 400, type: "entity.parse.failed" })), false);
  assert.equal(watchdog.isServerFault(Object.assign(new Error("CORS origin not allowed: x"), { code: "cors_origin_not_allowed" })), false);
  assert.equal(watchdog.isServerFault(new Error("boom")), true);
  // Without Redis, or with Redis down, counting is a no-op that never throws.
  await watchdog.recordError(null, { source: "http", error: new Error("x") });
  await watchdog.recordError({ incr: async () => { throw new Error("down"); } }, { source: "http", error: new Error("x") });
});

test("scheduler heartbeats: a problem must show twice, one alert lists them all, a newcomer re-sends", async () => {
  alerts._test.reset();
  const redis = fakeRedis();
  const now = new Date("2026-10-29T13:00:00Z");
  const t0 = now.getTime();
  const memory = {};
  const { posts, fetchImpl } = recorder();
  const send = async (checks) => {
    for (const check of checks) {
      if (check.firing === true) await alerts.raise(redis, check.key, check, { url: URL_, fetchImpl, force: check.force, state: check.state, logger: quiet });
      else if (check.firing === false) await alerts.resolve(redis, check.key, check, { url: URL_, fetchImpl, logger: quiet });
    }
  };
  const heartbeats = async () => (await watchdog.checkHeartbeats(redis, { now, memory, logger: quiet })).find((check) => check.key === "scheduler-heartbeats");

  await setHeartbeats(redis, t0);
  assert.equal((await heartbeats()).firing, false);

  await setHeartbeats(redis, t0, { wire: row(t0, { last_seen_at: new Date(t0 - 10 * MIN).toISOString() }) });
  const first = await heartbeats();
  assert.equal(first.firing, null, "seen once: no verdict yet");
  const second = await heartbeats();
  assert.equal(second.firing, true);
  assert.equal(second.title, "Scheduler not healthy: Wire");
  assert.equal(second.message, "**Wire**: no heartbeat for 10m");
  await send([second]);
  assert.equal(posts.length, 1);

  // Still the same: the cooldown holds it.
  await send([await heartbeats()]);
  assert.equal(posts.length, 1);

  // The scheduler pod goes down: everything goes quiet, the watchdog included. One post, sent at once.
  const down = Object.fromEntries(health.SCHEDULERS.map((spec) => [spec.name, row(t0, { last_seen_at: new Date(t0 - 6 * MIN).toISOString() })]));
  await setHeartbeats(redis, t0, down);
  assert.equal((await heartbeats()).force, false, "only the confirmed ones count; the rest show once first");
  const all = await heartbeats();
  assert.equal(all.firing, true);
  assert.equal(all.force, true);
  assert.equal(all.title, `${health.SCHEDULERS.length} schedulers not healthy`);
  assert.match(all.message, /api-scheduler pod is probably down/);
  await send([all]);
  assert.equal(posts.length, 2);

  await setHeartbeats(redis, t0);
  const clear = await heartbeats();
  assert.equal(clear.firing, false);
  await send([clear]);
  assert.equal(posts.length, 3);
  assert.equal(posts[2].embeds[0].title, `Resolved: ${health.SCHEDULERS.length} schedulers not healthy`);

  // Redis itself failing is its own alert.
  const broken = { mGet: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); } };
  const [redisCheck] = await watchdog.checkHeartbeats(broken, { now, memory: {}, logger: quiet });
  assert.equal(redisCheck.key, "redis-unreachable");
  assert.equal(redisCheck.firing, true);
});

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("settlement, cycle errors and the scrape on PostgreSQL, and the whole watchdog run", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_watchdog_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_watchdog_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_watchdog_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    await applySchema(pool);
  } finally {
    console.log = log;
    console.warn = warn;
  }

  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  const talents = [
    ["UCwatchdog0000000000000a1", "Alpha", "ALP", "active"],
    ["UCwatchdog0000000000000b2", "Beta", "BET", "halted"],
    // Coming to market: tracked, but never holds up settlement, so never "missing" either.
    ["UCwatchdog0000000000000c3", "Gamma", "GAM", "prelaunch"],
  ];
  for (const [id, name, symbol, status] of talents) {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1,$2,$2,$3,true)`, [id, name, symbol]);
    await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps) VALUES ($1,$2,$3,$4,10000,0,10000,2000,400)`,
      [id, symbol, name, status]
    );
  }
  const stats = (id, time) => pool.query(`INSERT INTO yt.youtube_channel_daily_stats (time, youtube_channel_id, subscriber_count, view_count, video_count) VALUES ($1,$2,1000,1000,10)`, [time, id]);
  // 2026-10-29 in New York (EDT, UTC-4): Alpha scraped at 00:10, Beta only on the 28th (and late on
  // the 29th's UTC date, 23:30 ET on the 28th, which must not count for the 29th).
  await stats(talents[0][0], "2026-10-29T04:10:00Z");
  await stats(talents[1][0], "2026-10-28T04:10:00Z");
  await stats(talents[1][0], "2026-10-29T03:30:00Z");
  await pool.query(`INSERT INTO market.market_settlement_runs (market_date, source_market_date, status, completed_at) VALUES ('2026-10-28', '2026-10-28', 'completed', now())`);

  const at = (iso) => ({ now: new Date(iso) });
  const byKey = (checks) => Object.fromEntries(checks.map((check) => [check.key, check]));

  await t.test("no settlement for the day by 09:30 ET", async () => {
    // 09:15 ET: today's isn't due yet, and yesterday's is in.
    let market = byKey(await watchdog.checkMarket(pool, at("2026-10-29T13:15:00Z")));
    assert.equal(market["settlement-missing"].firing, false);
    // 09:45 ET: today's is overdue.
    market = byKey(await watchdog.checkMarket(pool, at("2026-10-29T13:45:00Z")));
    assert.equal(market["settlement-missing"].firing, true);
    assert.equal(market["settlement-missing"].title, "No settlement for 2026-10-29");
    assert.match(market["settlement-missing"].message, /past 09:30 EDT\. Trading is open on the last settled day \(2026-10-28\)/);
    // A failed run isn't a completed one.
    await pool.query(`INSERT INTO market.market_settlement_runs (market_date, source_market_date, status) VALUES ('2026-10-29', '2026-10-29', 'failed')`);
    assert.equal(byKey(await watchdog.checkMarket(pool, at("2026-10-29T13:45:00Z")))["settlement-missing"].firing, true);
    // Paused by hand: no opinion.
    await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'manual_closed'`);
    assert.equal(byKey(await watchdog.checkMarket(pool, at("2026-10-29T13:45:00Z")))["settlement-missing"].firing, null);
    await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'open'`);
    // A day late: before 09:30 on the 30th, the 29th is the one missing.
    market = byKey(await watchdog.checkMarket(pool, at("2026-10-30T12:00:00Z")));
    assert.equal(market["settlement-missing"].title, "No settlement for 2026-10-29");
    assert.equal(market["settlement-missing"].firing, true);
  });

  await t.test("the last settlement cycle errored", async () => {
    assert.equal(byKey(await watchdog.checkMarket(pool, at("2026-10-29T13:45:00Z")))["settlement-error"].firing, false);
    await pool.query(`UPDATE market.market_runtime_state SET last_cycle_error = 'scheduled_settlement_incomplete:[{"market_date":"2026-10-29"}]'`);
    let market = byKey(await watchdog.checkMarket(pool, at("2026-10-29T13:45:00Z")));
    assert.equal(market["settlement-error"].firing, true);
    assert.equal(market["settlement-error"].fields[0].value, 'scheduled_settlement_incomplete:[{"market_date":"2026-10-29"}]');
    assert.deepEqual(market["settlement-missing"].fields, [{ name: "Last cycle error", value: 'scheduled_settlement_incomplete:[{"market_date":"2026-10-29"}]' }]);
    // Mid-cycle (a retry clears the error as it starts): wait for the outcome.
    await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'settling', last_cycle_error = NULL`);
    market = byKey(await watchdog.checkMarket(pool, at("2026-10-29T13:45:00Z")));
    assert.equal(market["settlement-error"].firing, null);
    await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'open', last_cycle_error = 'boom'`);
  });

  await t.test("listed talents missing today's YouTube stats after the scrape", async () => {
    // 00:30 ET: the scrape (00:05) may still be running. 01:10 ET: its first retry (an hour after it) may be.
    assert.equal((await watchdog.checkScrape(pool, at("2026-10-29T04:30:00Z")))[0].firing, null);
    assert.equal((await watchdog.checkScrape(pool, at("2026-10-29T05:10:00Z")))[0].firing, null);
    // 02:00 ET: Beta has nothing for the 29th (her 23:30 row on the 28th doesn't count). Gamma isn't listed yet.
    let [scrape] = await watchdog.checkScrape(pool, at("2026-10-29T06:00:00Z"));
    assert.equal(scrape.firing, true);
    assert.deepEqual(scrape.fields, [{ name: "Missing", value: "BET" }]);
    assert.match(scrape.message, /^1 listed talent has no YouTube stats for 2026-10-29 yet \(it's past 01:20 EDT\)/);
    assert.match(scrape.message, /ytscraper hasn't reported on today's scrape/);

    // The scraper says what it's doing about it: the alert passes that on.
    const redis = fakeRedis();
    const status = (fields) => redis.set("nasfaq:ytscraper:daily_stats", JSON.stringify({ day: "2026-10-29", missing: [talents[1][0]], attempts: 2, ...fields }));
    await status({ next_retry_at: "2026-10-29T07:06:00Z", quota_exceeded: true, last_error: "youtube quota used up; 1/3 channels not scraped" });
    [scrape] = await watchdog.checkScrape(pool, { ...at("2026-10-29T06:00:00Z"), redis });
    assert.match(scrape.message, /ytscraper is retrying them on its own: attempt 2 didn't get them all, next try at 03:06 EDT\. The YouTube quota is used up/);
    assert.deepEqual(scrape.fields[1], { name: "Scraper's last error", value: "youtube quota used up; 1/3 channels not scraped" });
    await status({ next_retry_at: null, quota_exceeded: false });
    [scrape] = await watchdog.checkScrape(pool, { ...at("2026-10-29T06:00:00Z"), redis });
    assert.match(scrape.message, /ytscraper has no retry left today \(attempt 2\)\. Fill them in with ytscraper's backfill-missing-daily-stats/);
    // Yesterday's word doesn't count for today.
    await redis.set("nasfaq:ytscraper:daily_stats", JSON.stringify({ day: "2026-10-28", attempts: 1, next_retry_at: null }));
    [scrape] = await watchdog.checkScrape(pool, { ...at("2026-10-29T06:00:00Z"), redis });
    assert.match(scrape.message, /ytscraper hasn't reported on today's scrape/);

    await stats(talents[1][0], "2026-10-29T05:40:00Z");
    [scrape] = await watchdog.checkScrape(pool, at("2026-10-29T06:00:00Z"));
    assert.equal(scrape.firing, false);
    await pool.query(`DELETE FROM yt.youtube_channel_daily_stats WHERE youtube_channel_id = $1 AND time = '2026-10-29T05:40:00Z'`, [talents[1][0]]);
  });

  await t.test("the whole run: each alert posts once, then Resolved once", async () => {
    alerts._test.reset();
    const redis = fakeRedis();
    const { posts, fetchImpl } = recorder();
    const memory = {};
    const now = new Date("2026-10-29T13:45:00Z");
    const run = async () => {
      const before = posts.length;
      await watchdog.runWatchdog(pool, redis, { now, memory, logger: quiet, alertOptions: { url: URL_, fetchImpl } });
      return posts.slice(before).map((post) => post.embeds[0].title).sort();
    };
    await setHeartbeats(redis, now.getTime(), { ipo: row(now.getTime(), { state: "error", error_code: "ipo_failed", last_success_at: new Date(now.getTime() - 40 * MIN).toISOString() }) });
    for (let i = 0; i < 25; i += 1) await watchdog.recordError(redis, { source: "http", method: "GET", path: "/api/market", error: new Error("boom") }, { now: now.getTime() });

    assert.deepEqual(await run(), ["Burst of unhandled API errors", "No settlement for 2026-10-29", "YouTube scrape incomplete"]);
    // The next minute: the same conditions say nothing more; the heartbeat problem and the cycle
    // error (it outlasted a retry) are now confirmed.
    assert.deepEqual(await run(), ["Scheduler not healthy: IPO", "Settlement cycle failed"]);
    assert.deepEqual(await run(), []);

    // Everything clears.
    await pool.query(`UPDATE market.market_runtime_state SET last_cycle_error = NULL`);
    await pool.query(`UPDATE market.market_settlement_runs SET status = 'completed', completed_at = now() WHERE market_date = '2026-10-29'`);
    await setHeartbeats(redis, now.getTime());
    const later = new Date(now.getTime() + 6 * MIN);
    await setHeartbeats(redis, later.getTime());
    const resolved = [];
    await watchdog.runWatchdog(pool, redis, { now: later, memory, logger: quiet, alertOptions: { url: URL_, fetchImpl: async (_to, init) => (resolved.push(JSON.parse(init.body).embeds[0].title), { ok: true }) } });
    assert.deepEqual(resolved.sort(), [
      "Resolved: Burst of unhandled API errors",
      "Resolved: No settlement for 2026-10-29",
      "Resolved: Scheduler not healthy: IPO",
      "Resolved: Settlement cycle failed",
      "Resolved: YouTube scrape incomplete",
    ]);
  });

  await t.test("a check that can't run is an alert of its own", async () => {
    alerts._test.reset();
    const { posts, fetchImpl } = recorder();
    const broken = { query: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); } };
    const checks = await watchdog.runWatchdog(broken, fakeRedis(), { now: new Date("2026-10-29T13:45:00Z"), logger: quiet, alertOptions: { url: URL_, fetchImpl } });
    const failing = checks.find((check) => check.key === "watchdog-checks");
    assert.equal(failing.firing, true);
    assert.equal(failing.message, "These checks couldn't run, so their alerts can't fire: market (ECONNREFUSED), scrape (ECONNREFUSED).");
    assert.deepEqual(posts.map((post) => post.embeds[0].title), ["Watchdog checks failing"]);
  });
});
