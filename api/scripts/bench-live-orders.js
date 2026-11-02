// Load test for the 10-minute live-order batch, on a local database only. Builds a realistic market
// once, queues each scenario's orders through the real submitLiveOrder, clones the database per run
// and times the batch, counting statements, commits, connections and market events.
//
//   CHAT_TEST_DATABASE_URL=postgres://nasfaq_test:...@127.0.0.1:5432/nasfaq_chat_test \
//     node scripts/bench-live-orders.js --engine=old,new --scenario=one-player-77,mixed-100 --rtt=0,17
//
// --rtt adds that many ms before every statement, the round trip production pays (the API is in nyc3,
// the database in us-east-2; 17 makes the old path fill one player's orders at 3.5 a second, close to
// the 3.71 production measured). "old" is the row-at-a-time batch (test/fixtures/live-order-batch-reference.js).
// Refuses to run against anything but localhost, so it can never touch production.
process.env.MARKET_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL = "100000000";
process.env.ACHIEVEMENT_WORKER_CONCURRENCY = process.env.ACHIEVEMENT_WORKER_CONCURRENCY || "2";

const { performance } = require("node:perf_hooks");
const { Client, Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const { createPool } = require("../src/db");
const trading = require("../src/services/trading");
const achievements = require("../src/services/achievements");
const reference = require("../test/fixtures/live-order-batch-reference");

const baseUrl = process.env.CHAT_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Set CHAT_TEST_DATABASE_URL to a local test database");
if (!["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)) throw new Error("bench-live-orders only runs against localhost");
const argOf = (name, fallback) => (process.argv.find((arg) => arg.startsWith(`--${name}=`)) || `--${name}=${fallback}`).split("=")[1];

const STOCKS = 77;
const PLAYERS = Number(argOf("players", 2000));
const HISTORY_FILLS = Number(argOf("history", 100000));
const POOL_MAX = 14; // deploy/k8s/20-api.yaml, the scheduler pod
const SEED_DB = "nasfaq_bench_seed";

// mulberry32: every run queues the same orders.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const urlFor = (name) => {
  const target = new URL(baseUrl);
  target.pathname = `/${name}`;
  return target.href;
};

async function admin(work) {
  const client = new Client({ connectionString: baseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function seedMarket() {
  await admin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${SEED_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${SEED_DB}`);
  });
  const pool = new Pool({ connectionString: urlFor(SEED_DB) });
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    await applySchema(pool);
  } finally {
    console.log = log;
    console.warn = warn;
  }
  const today = (await pool.query(`SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS d`)).rows[0].d;
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status, last_settlement_market_date) VALUES ('primary', 'open', $1) ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open', last_settlement_market_date = $1`, [today]);
  await pool.query(`
    INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, icon, color)
    SELECT 'UCbench' || i, 'Talent ' || i, 'talent-' || i, '#3fb0ff' FROM generate_series(1, ${STOCKS}) i
  `);
  await pool.query(`
    INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply,
      liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price, current_bid_price, current_ask_price, current_transient_offset, current_persistent_offset)
    SELECT 'UCbench' || i, 'S' || lpad(i::text, 2, '0'), 'Talent ' || i, 'active', 400000, 100000, 300000, 100000, 100,
      5 + (i % 15), 5 + (i % 15), 5 + (i % 15), (5 + (i % 15)) * 0.995, (5 + (i % 15)) * 1.005, 0.01, 0.002
    FROM generate_series(1, ${STOCKS}) i
  `);
  {
    await pool.query(
      `
      INSERT INTO market.channel_daily_snapshots (youtube_channel_id, snapshot_date, subscriber_count, view_count, calculation_version, calculation_status,
        size_anchor_raw, view_signal, upload_signal, momentum_raw, momentum_multiplier, fundamental_value_raw, fundamental_value_smoothed)
      SELECT youtube_channel_id, $1, 1000000, 1000000, 1, 'complete', 1, 1, 1, 1, 1, 1, 1 FROM market.market_assets
    `,
      [today]
    );
    await pool.query(
      `
      UPDATE market.market_assets a SET latest_snapshot_date = s.snapshot_date, latest_snapshot_id = s.id
      FROM market.channel_daily_snapshots s WHERE s.youtube_channel_id = a.youtube_channel_id
    `
    );
    await pool.query(
      `
      INSERT INTO market.asset_daily_market_state (asset_id, market_date, snapshot_id, fair_value, fair_value_raw, mid_open, mid_close, mid_high, mid_low, bid_close, ask_close,
        premium_close_pct, daily_emission, treasury_supply_start, treasury_supply_end, circulating_supply_start, circulating_supply_end)
      SELECT a.id, $1, a.latest_snapshot_id, a.current_fair_value, a.current_fair_value, a.current_mid_price, a.current_mid_price, a.current_mid_price, a.current_mid_price,
        a.current_bid_price, a.current_ask_price, 0, 0, a.treasury_supply, a.treasury_supply, a.circulating_supply, a.circulating_supply
      FROM market.market_assets a
    `,
      [today]
    );
  }
  await pool.query(`
    INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, profile_color)
    SELECT 'player' || i, 'player' || i, 'player' || i || '@example.test', true, 'x', 'x', '{}', '#3fb0ff' FROM generate_series(1, ${PLAYERS}) i
  `);
  // Most players still have Credit (fees come out of it first); a fifth have run out.
  await pool.query(`
    INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance)
    SELECT id, 1000000, CASE WHEN id % 5 = 0 THEN 0 ELSE 100000 END FROM market.users
  `);
  await pool.query(`
    INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis)
    SELECT u.id, a.id, 200, 9.5 FROM market.users u JOIN market.market_assets a ON (u.id + a.id) % 7 = 0
  `);
  // History, so the indexes every fill writes are the size they'd be on a busy site.
  await pool.query(`
    INSERT INTO market.live_order_batches (id, status, completed_at, orders_attempted, orders_filled) VALUES (1, 'completed', now(), 0, 0)
  `);
  await pool.query(`
    WITH o AS (
      INSERT INTO market.trade_orders (user_id, asset_id, side, order_type, requested_quantity, filled_quantity, status, execute_after, requested_at, updated_at, live_order_batch_id)
      SELECT 1 + (i % ${PLAYERS}), 1 + (i % ${STOCKS}), CASE WHEN i % 3 = 0 THEN 'sell' ELSE 'buy' END, 'live_market', 2, 2, 'filled',
        now() - (i || ' seconds')::interval, now() - (i || ' seconds')::interval, now() - (i || ' seconds')::interval, 1
      FROM generate_series(1, ${HISTORY_FILLS}) i
      RETURNING id, user_id, asset_id, side, requested_at
    )
    INSERT INTO market.trade_fills (order_id, asset_id, user_id, ts, side, price, quantity, gross_cash, fee_cash, net_cash, counterparty_type)
    SELECT id, asset_id, user_id, requested_at, side, 10, 2, 20, 0.2, -20.2, 'treasury' FROM o
  `);
  await pool.query(`
    INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id, created_at)
    SELECT user_id, asset_id, unnest(ARRAY['buy_asset_credit', 'buy_cash_debit', 'trade_fee']), 2, -20, 'trade_fill', id, ts FROM market.trade_fills
  `);
  await pool.query(`SELECT setval('market.live_order_batches_id_seq', 1)`);
  await pool.query(`ANALYZE`);
  await pool.end();
}

// Each scenario: [userIndex, stockIndex, side, quantity] orders in the order they're placed.
const SCENARIOS = {
  // One player, 1 share of each stock (the 15:40 batch on 2026-11-01).
  "one-player-77": () => Array.from({ length: STOCKS }, (_, i) => [1, i + 1, "buy", 1]),
  // One player at the share limit (180 a window), small orders all over the board.
  "one-player-180": () => Array.from({ length: 180 }, (_, i) => [1, (i % STOCKS) + 1, "buy", 1]),
  // Over the limit, as a worst case for one player's cash row.
  "one-player-1000": () => Array.from({ length: 1000 }, (_, i) => [1, (i % STOCKS) + 1, "buy", 1]),
  "mixed-100": () => mixed(100, 11),
  "mixed-1000": () => mixed(1000, 12),
  "mixed-5000": () => mixed(5000, 13),
  "mixed-50000": () => mixed(50000, 14),
};

/** Many players, popular stocks busier than others, two buys to each sell, mostly small orders. */
function mixed(count, seed) {
  const random = prng(seed);
  const orders = [];
  for (let i = 0; i < count; i += 1) {
    const stock = 1 + Math.floor(STOCKS * Math.pow(random(), 2));
    // Only as many players as the batch needs, a few placing several orders.
    const user = 1 + Math.floor(Math.min(PLAYERS, count) * random());
    const quantity = 1 + Math.floor(Math.pow(random(), 3) * 20);
    if (random() < 0.33 && (user + stock) % 7 === 0) orders.push([user, stock, "sell", quantity]);
    else orders.push([user, stock, "buy", quantity]);
  }
  return orders;
}

async function prepareTemplate(scenario) {
  const name = `nasfaq_bench_t_${scenario.replace(/-/g, "_")}`;
  await admin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name} TEMPLATE ${SEED_DB}`);
  });
  const pool = new Pool({ connectionString: urlFor(name), max: 8 });
  const { rows: stocks } = await pool.query(`SELECT id, symbol FROM market.market_assets ORDER BY id`);
  const orders = SCENARIOS[scenario]();
  // Queued one player at a time so ids land in the order above.
  let failures = 0;
  for (const [user, stock, side, quantity] of orders) {
    await trading.submitLiveOrder(pool, { userId: user, symbol: stocks[stock - 1].symbol, side, quantity }).catch(() => {
      failures += 1;
    });
  }
  await pool.end();
  return { name, orders: orders.length - failures };
}

// Every statement any client sends, counted and classified, after waiting out the round trip.
const stats = { on: false, rttMs: 0, statements: 0, commits: 0, byKind: new Map(), lockWaitMs: 0, active: 0, peakActive: 0 };
function classify(text) {
  const sql = String(typeof text === "string" ? text : text?.text || "").replace(/\s+/g, " ").trim();
  if (/^BEGIN/i.test(sql)) return "BEGIN";
  if (/^COMMIT/i.test(sql)) return "COMMIT";
  if (/^ROLLBACK/i.test(sql)) return "ROLLBACK";
  if (/FOR UPDATE/i.test(sql)) {
    if (/portfolio_cash_balances/i.test(sql)) return "lock: player cash row";
    if (/portfolio_holdings/i.test(sql)) return "lock: holding row";
    if (/asset_buybacks/i.test(sql)) return "lock: buyback row";
    if (/market_assets/i.test(sql) && !/trade_orders/i.test(sql)) return "lock: stock row";
    if (/trade_orders/i.test(sql)) return "lock: order row";
    return "lock: other";
  }
  const write = /^(INSERT INTO|UPDATE|WITH .* (INSERT INTO|UPDATE))\s+([\w.]+)/i.exec(sql);
  if (write) return `write: ${write[3].replace(/^market\./, "")}`;
  if (/market_runtime_state/i.test(sql)) return "read: market status";
  if (/market\.users/i.test(sql)) return "read: player name";
  return "read: other";
}

function exactDelay(ms) {
  if (!(ms > 0)) return Promise.resolve();
  const end = performance.now() + ms;
  return new Promise((resolve) => {
    const poll = () => (performance.now() >= end ? resolve() : setImmediate(poll));
    poll();
  });
}

const realQuery = Client.prototype.query;
Client.prototype.query = function query(...args) {
  if (!stats.on || !args[0] || typeof args[0].submit === "function") return realQuery.apply(this, args);
  const kind = classify(args[0]);
  stats.statements += 1;
  if (kind === "COMMIT") stats.commits += 1;
  const entry = stats.byKind.get(kind) || { count: 0, dbMs: 0, maxMs: 0 };
  stats.byKind.set(kind, entry);
  entry.count += 1;
  stats.active += 1;
  stats.peakActive = Math.max(stats.peakActive, stats.active);
  const done = (started) => {
    const ms = performance.now() - started;
    entry.dbMs += ms;
    entry.maxMs = Math.max(entry.maxMs, ms);
    if (kind.startsWith("lock:")) stats.lockWaitMs += ms;
    stats.active -= 1;
  };
  const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
  if (callback) {
    void exactDelay(stats.rttMs).then(() => {
      const started = performance.now();
      realQuery.call(this, ...args, (...result) => {
        done(started);
        callback(...result);
      });
    });
    return undefined;
  }
  return exactDelay(stats.rttMs).then(() => {
    const started = performance.now();
    return realQuery.apply(this, args).finally(() => done(started));
  });
};

function fakeRedis() {
  const counts = { publishes: 0, bytes: 0, fillEvents: 0, largest: 0 };
  return {
    counts,
    publish: async (_channel, message) => {
      counts.publishes += 1;
      counts.bytes += Buffer.byteLength(message);
      counts.largest = Math.max(counts.largest, Buffer.byteLength(message));
      if (message.includes('"market.trade_fill"')) counts.fillEvents += 1;
      else if (message.includes('"market.trade_fills"')) counts.fillEvents += (message.match(/"order_id"/g) || []).length;
    },
  };
}

/** The scheduler's loop: one call a second while orders are due, never overlapping. */
async function runEngine(engine, pool, redis) {
  const startedAt = performance.now();
  let attempted = 0;
  let filled = 0;
  let rejected = 0;
  let calls = 0;
  let skipped = 0;
  let rowByRow = 0;
  const landing = engine === "new" ? trading._test.newFillLanding() : null;
  for (;;) {
    const now = new Date();
    const result = engine === "old" ? await reference.processDueLiveOrders(pool, { now, redis }) : await trading.processDueLiveOrders(pool, { now, redis, landing });
    calls += 1;
    attempted += result.attempted;
    filled += result.filled;
    rejected += result.rejected;
    if (result.skipped) skipped += 1;
    if (result.row_by_row) rowByRow += 1;
    // The old batch took 100 orders a call, one call a second. A turn the new one skipped comes round in a second.
    if (engine === "new" ? !result.more && !result.skipped : result.attempted < 100) break;
    if (result.skipped) await new Promise((resolve) => setTimeout(resolve, 1000));
    if (engine === "old") {
      const elapsed = performance.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 1000 - (elapsed % 1000)));
    }
  }
  if (landing) trading._test.publishFillLanding(redis, landing);
  return { ms: performance.now() - startedAt, attempted, filled, rejected, calls, skipped, rowByRow };
}

async function runOnce({ engine, template, rttMs, label }) {
  const name = `nasfaq_bench_run_${process.pid}`;
  await admin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name} TEMPLATE ${template.name}`);
  });
  const pool = createPool(urlFor(name), { max: POOL_MAX, statementTimeoutMs: 0 });
  await pool.query(`UPDATE market.trade_orders SET execute_after = now() - interval '1 second' WHERE status = 'pending'`);
  const redis = fakeRedis();

  Object.assign(stats, { on: true, rttMs, statements: 0, commits: 0, lockWaitMs: 0, active: 0, peakActive: 0 });
  stats.byKind = new Map();
  const cpuStart = process.cpuUsage();
  const run = await runEngine(engine, pool, redis);
  const cpu = process.cpuUsage(cpuStart);
  const statements = stats.statements;
  const commits = stats.commits;
  const byKind = stats.byKind;
  const lockWaitMs = stats.lockWaitMs;
  const peakActive = stats.peakActive;
  stats.on = false;

  await achievements.tradeFillsIdle();
  const { rows: spans } = await pool.query(
    `SELECT extract(epoch FROM max(f.ts) - min(f.ts)) AS span_s, count(DISTINCT f.ts) AS stamps FROM market.trade_fills f JOIN market.trade_orders o ON o.id = f.order_id WHERE o.live_order_batch_id > 1`
  );
  const row = {
    label,
    engine,
    rtt_ms: rttMs,
    orders: template.orders,
    filled: run.filled,
    rejected: run.rejected,
    seconds: Number((run.ms / 1000).toFixed(2)),
    fills_per_s: Number((run.filled / (run.ms / 1000)).toFixed(1)),
    statements,
    statements_per_order: Number((statements / Math.max(1, template.orders)).toFixed(1)),
    commits,
    commits_per_order: Number((commits / Math.max(1, template.orders)).toFixed(2)),
    peak_active_statements: peakActive,
    lock_statement_s: Number((lockWaitMs / 1000).toFixed(2)),
    calls: run.calls,
    turns_skipped: run.skipped,
    chunks_row_by_row: run.rowByRow,
    distinct_fill_times: Number(spans[0]?.stamps || 0),
    fill_span_s: Number(Number(spans[0]?.span_s || 0).toFixed(2)),
    event_publishes: redis.counts.publishes,
    event_bytes: redis.counts.bytes,
    largest_event_bytes: redis.counts.largest,
    node_cpu_s: Number(((cpu.user + cpu.system) / 1e6).toFixed(2)),
  };
  if (process.argv.includes("--breakdown")) {
    row.breakdown = [...byKind.entries()]
      .sort((a, b) => b[1].dbMs - a[1].dbMs)
      .map(([kind, entry]) => ({ kind, per_order: Number((entry.count / Math.max(1, template.orders)).toFixed(2)), db_ms_avg: Number((entry.dbMs / entry.count).toFixed(2)), db_ms_max: Number(entry.maxMs.toFixed(1)) }));
  }
  // The leaderboard refresh the batch queued (it coalesces for 2 s) runs on this pool: let it finish.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await pool.end().catch(() => {});
  await admin((client) => client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  return row;
}

async function main() {
  const engines = argOf("engine", "old").split(",");
  const scenarios = argOf("scenario", "one-player-77").split(",");
  const rtts = argOf("rtt", "0").split(",").map(Number);
  const repeat = Number(argOf("repeat", 1));
  const out = argOf("out", "");
  console.error(`seeding ${PLAYERS} players, ${STOCKS} stocks, ${HISTORY_FILLS} past fills`);
  if (!process.argv.includes("--reuse-seed")) await seedMarket();
  const rows = [];
  for (const scenario of scenarios) {
    const template = await prepareTemplate(scenario);
    console.error(`${scenario}: ${template.orders} orders queued`);
    for (const rttMs of rtts) {
      for (const engine of engines) {
        for (let i = 0; i < repeat; i += 1) {
          const row = await runOnce({ engine, template, rttMs, label: scenario });
          rows.push(row);
          console.log(JSON.stringify(row));
          if (out) require("node:fs").appendFileSync(out, `${JSON.stringify(row)}\n`);
        }
      }
    }
    await admin((client) => client.query(`DROP DATABASE IF EXISTS ${template.name} WITH (FORCE)`));
  }
  if (!process.argv.includes("--keep-seed")) await admin((client) => client.query(`DROP DATABASE IF EXISTS ${SEED_DB} WITH (FORCE)`));
  // The batches queue a coalesced leaderboard refresh on a timer; it may fire against a dropped database.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
