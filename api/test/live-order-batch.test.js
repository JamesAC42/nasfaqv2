const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

// No share limit in these markets: the orders are what's being tested, not the allowance.
process.env.MARKET_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL = "100000000";

const { applySchema } = require("../src/migrations");
const trading = require("../src/services/trading");
const achievements = require("../src/services/achievements");
const marketDb = require("../src/marketDb");
const marketState = require("../src/services/marketState");
const reference = require("./fixtures/live-order-batch-reference");

// The batched settlement against the row-at-a-time batch it replaced (fixtures/live-order-batch-reference.js,
// which fills through the live trading.executeOrder). One market full of edge cases is built once and
// cloned; each clone runs one engine with the clock pinned, since a fill's price decays with the clock.
// Orders, fills, the ledger, wallets, holdings, stocks, the day's stats, buybacks, achievements and the
// events must come out identical, digit for digit. Then what's new: chunks that can't run, the fallback,
// one fill time per chunk, and the one event per run.
//
// LIVE_BATCH_TEST_ORDERS sets the market's size (600 by default).
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const ORDERS = Math.max(120, Number(process.env.LIVE_BATCH_TEST_ORDERS) || 600);
const SEED_DB = "nasfaq_live_batch_seed";
const quiet = { info() {}, log() {}, warn() {}, error() {} };

// mulberry32, so every run builds the same market.
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

function fakeRedis() {
  const events = [];
  return { events, publish: async (_channel, message) => void events.push(JSON.parse(message)), del: async () => 0 };
}

const STOCK_NAMES = {
  shallow: 6, // thin book, wide spread: every fill moves it, buys outrun their holds
  stale: 7, // offsets last moved hours ago, so the first fill decays them
  lastShares: 8, // half a share left for sale: a partial fill, then sold out
  soldOut: 9, // sold out after the orders queued
  buybackOver: 10, // in a buyback, players over the max: sells pay the offer
  buybackAcross: 11, // in a buyback, sells cross from the offer to the frozen price
  halted: 12, // halted after the orders queued
  noFairValue: 13, // lost its fair value after the orders queued
  noSnapshot: 14, // no snapshot, so no day row to update
  blankDay: 15, // a day row that hasn't seen a price yet
  buybackNoRow: 16, // marked frozen with no buyback behind it
  frozenLate: 17, // frozen after buys queued
};
const STOCKS = 18;

/** Builds the market in `pool` and queues its orders. */
async function buildMarket(pool) {
  const random = prng(20261101);
  const today = (await pool.query(`SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS d`)).rows[0].d;
  await pool.query(
    `INSERT INTO market.market_runtime_state (state_key, trading_status, last_settlement_market_date) VALUES ('primary', 'open', $1)
     ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open', last_settlement_market_date = $1`,
    [today]
  );
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, icon, color) SELECT 'UCb' || i, 'Talent ' || i, 'icon-' || i, '#3fb0ff' FROM generate_series(0, ${STOCKS - 1}) i`);
  await pool.query(`
    INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps,
      current_fair_value, current_fair_value_raw, current_mid_price, current_bid_price, current_ask_price, current_persistent_offset, current_transient_offset)
    SELECT 'UCb' || i, 'S' || lpad(i::text, 2, '0'), 'Talent ' || i, 'active', 100000, 1000, 99000, 2000 + i * 300, 80 + i * 10,
      7.5 + i * 1.37, 7.5 + i * 1.37, 7.5 + i * 1.37, (7.5 + i * 1.37) * 0.995, (7.5 + i * 1.37) * 1.005, 0.002 * (i % 5), 0.013 * ((i % 7) - 3)
    FROM generate_series(0, ${STOCKS - 1}) i
  `);
  const { rows: stocks } = await pool.query(`SELECT id, symbol FROM market.market_assets ORDER BY id`);
  const idOf = (index) => Number(stocks[index].id);
  await pool.query(
    `INSERT INTO market.channel_daily_snapshots (youtube_channel_id, snapshot_date, subscriber_count, view_count, calculation_version, calculation_status, size_anchor_raw, view_signal, upload_signal, momentum_raw, momentum_multiplier, fundamental_value_raw, fundamental_value_smoothed)
     SELECT youtube_channel_id, $1, 1000000, 1000000, 1, 'complete', 1, 1, 1, 1, 1, 1, 1 FROM market.market_assets`,
    [today]
  );
  await pool.query(`UPDATE market.market_assets a SET latest_snapshot_date = s.snapshot_date, latest_snapshot_id = s.id FROM market.channel_daily_snapshots s WHERE s.youtube_channel_id = a.youtube_channel_id`);
  await pool.query(
    `INSERT INTO market.asset_daily_market_state (asset_id, market_date, snapshot_id, fair_value, fair_value_raw, mid_open, mid_close, mid_high, mid_low, bid_close, ask_close, premium_close_pct, daily_emission, treasury_supply_start, treasury_supply_end, circulating_supply_start, circulating_supply_end, volume_shares, volume_cash, trade_count)
     SELECT a.id, $1, a.latest_snapshot_id, a.current_fair_value, a.current_fair_value, a.current_mid_price, a.current_mid_price, a.current_mid_price, a.current_mid_price, a.current_bid_price, a.current_ask_price, 0, 0, a.treasury_supply, a.treasury_supply, a.circulating_supply, a.circulating_supply, 12.5, 150.25, 3
     FROM market.market_assets a`,
    [today]
  );
  await pool.query(`UPDATE market.market_assets SET latest_snapshot_date = NULL, latest_snapshot_id = NULL WHERE id = $1`, [idOf(STOCK_NAMES.noSnapshot)]);
  await pool.query(`UPDATE market.asset_daily_market_state SET mid_close = NULL, mid_high = NULL, mid_low = NULL WHERE asset_id = $1`, [idOf(STOCK_NAMES.blankDay)]);
  await pool.query(`UPDATE market.market_assets SET liquidity_depth = 40, spread_bps = 400 WHERE id = $1`, [idOf(STOCK_NAMES.shallow)]);
  await pool.query(`UPDATE market.market_assets SET offsets_updated_at = now() - interval '3 hours', current_transient_offset = 0.05 WHERE id = $1`, [idOf(STOCK_NAMES.stale)]);
  await pool.query(`UPDATE market.market_assets SET max_supply = 100, circulating_supply = 97.5, treasury_supply = 2.5 WHERE id = $1`, [idOf(STOCK_NAMES.lastShares)]);

  const PLAYERS = 60;
  await pool.query(`
    INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, profile_color)
    SELECT 'player' || i, 'player' || i, 'player' || i || '@example.test', true, 'x', 'x', '{}', '#123456' FROM generate_series(1, ${PLAYERS}) i
  `);
  const { rows: players } = await pool.query(`SELECT id FROM market.users ORDER BY id`);
  const playerId = (index) => Number(players[index].id);
  for (let i = 0; i < PLAYERS; i += 1) {
    // Rich, comfortable, or short of cash; lots of Credit, none, or a little that runs out mid-batch.
    const cash = i % 11 === 0 ? 60.125 : i % 3 === 0 ? 1234.5678 : 90000.1;
    const credit = i % 4 === 0 ? 0 : i % 4 === 1 ? 0.75 : 100000;
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, $2, $3)`, [playerId(i), cash, credit]);
  }
  await pool.query(`
    INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis)
    SELECT u.id, a.id, 3 + ((u.id + a.id) % 30), 8.25 + ((u.id * a.id) % 13) / 8.0
    FROM market.users u JOIN market.market_assets a ON (u.id + a.id) % 2 = 0
  `);
  await pool.query(`UPDATE market.market_assets a SET circulating_supply = 1200, treasury_supply = 0, max_supply = 1000, trading_state = 'buyback' WHERE id = $1`, [idOf(STOCK_NAMES.buybackOver)]);
  await pool.query(`UPDATE market.market_assets a SET circulating_supply = 1003.5, treasury_supply = 0, max_supply = 1000, trading_state = 'buyback' WHERE id = $1`, [idOf(STOCK_NAMES.buybackAcross)]);
  for (const name of ["buybackOver", "buybackAcross"]) {
    await pool.query(
      `INSERT INTO market.asset_buybacks (asset_id, frozen_price, target_max_supply, held_at_start, started_at, shares_bought, cash_paid) VALUES ($1, 21.37, 1000, 1200, now() - interval '30 hours', 1.5, 33.125)`,
      [idOf(STOCK_NAMES[name])]
    );
  }

  // Queue through the real path, so holds and ledger rows are the ones players get.
  const quantities = [1, 1, 1, 2, 3, 5, 0.5, 1.25, 2.125, 0.1, 7, 13];
  let queued = 0;
  // The last player only ever sells.
  await pool.query(`UPDATE market.portfolio_holdings SET quantity = 40 WHERE user_id = $1`, [playerId(PLAYERS - 1)]);
  for (let attempt = 0; queued < ORDERS && attempt < ORDERS * 3; attempt += 1) {
    const stock = Math.floor(random() * STOCKS);
    const player = Math.floor(random() * PLAYERS);
    const frozen = stock === STOCK_NAMES.buybackOver || stock === STOCK_NAMES.buybackAcross;
    const side = frozen || player === PLAYERS - 1 || random() < 0.3 ? "sell" : "buy";
    const quantity = quantities[Math.floor(random() * quantities.length)];
    await trading
      .submitLiveOrder(pool, { userId: playerId(player), symbol: stocks[stock].symbol, side, quantity })
      .then(() => {
        queued += 1;
      })
      .catch(() => {});
  }

  // What can change between queueing and the batch.
  await pool.query(`UPDATE market.market_assets SET circulating_supply = max_supply, treasury_supply = 0 WHERE id = $1`, [idOf(STOCK_NAMES.soldOut)]);
  await pool.query(`UPDATE market.market_assets SET status = 'halted' WHERE id = $1`, [idOf(STOCK_NAMES.halted)]);
  await pool.query(`UPDATE market.market_assets SET current_fair_value = NULL, current_fair_value_raw = NULL WHERE id = $1`, [idOf(STOCK_NAMES.noFairValue)]);
  await pool.query(`UPDATE market.market_assets SET trading_state = 'buyback' WHERE id = ANY($1::bigint[])`, [[idOf(STOCK_NAMES.buybackNoRow), idOf(STOCK_NAMES.frozenLate)]]);
  await pool.query(`INSERT INTO market.asset_buybacks (asset_id, frozen_price, target_max_supply, held_at_start) VALUES ($1, 15, 1000, 1000)`, [idOf(STOCK_NAMES.frozenLate)]);
  // Sold some shares away while a sell was queued; a hold too small for what the order now costs.
  await pool.query(`UPDATE market.portfolio_holdings SET quantity = 0.5 WHERE (user_id + asset_id) % 9 = 0`);
  await pool.query(`
    WITH thin AS (SELECT id, user_id, held_cash FROM market.trade_orders WHERE status = 'pending' AND side = 'buy' AND held_cash > 0 AND id % 17 = 0),
    cut AS (UPDATE market.trade_orders o SET held_cash = o.held_cash * 0.25 FROM thin WHERE o.id = thin.id RETURNING o.id)
    UPDATE market.portfolio_cash_balances b SET held_cash = b.held_cash - t.cut
    FROM (SELECT user_id, SUM(held_cash * 0.75) AS cut FROM thin GROUP BY user_id) t WHERE b.user_id = t.user_id
  `);
  // A player whose cash row is gone (an order fill opens it, with the starter grant): sells only, so nothing was held.
  const { rows: sellersOnly } = await pool.query(`
    SELECT o.user_id FROM market.trade_orders o WHERE o.status = 'pending' GROUP BY o.user_id
    HAVING bool_and(o.side = 'sell') ORDER BY o.user_id LIMIT 1
  `);
  assert.equal(sellersOnly.length, 1, "a player with only sells queued");
  await pool.query(`DELETE FROM market.portfolio_cash_balances WHERE user_id = $1`, [sellersOnly[0].user_id]);
  await pool.query(`UPDATE market.trade_orders SET execute_after = now() - interval '1 minute' WHERE status = 'pending'`);
  await pool.query(`ANALYZE`);
  return { queued };
}

/** A plain market: rich players, deep stocks. Nothing depends on the order across stocks but rounding. */
async function buildPlainMarket(pool) {
  const random = prng(7);
  const today = (await pool.query(`SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS d`)).rows[0].d;
  await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'open', last_settlement_market_date = $1`, [today]);
  await pool.query(`UPDATE market.market_assets SET status = 'active', trading_state = 'open', current_fair_value = COALESCE(current_fair_value, 12), current_fair_value_raw = COALESCE(current_fair_value_raw, 12), max_supply = 1000000, circulating_supply = 2000, treasury_supply = 998000`);
  await pool.query(`UPDATE market.trade_orders SET status = 'cancelled', updated_at = now() WHERE status = 'pending'`);
  await pool.query(`UPDATE market.portfolio_cash_balances SET cash_balance = 10000000, held_cash = 0, credit_balance = 1000000`);
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) SELECT id, 10000000, 1000000 FROM market.users ON CONFLICT DO NOTHING`);
  await pool.query(`UPDATE market.portfolio_holdings SET quantity = 500`);
  const { rows: stocks } = await pool.query(`SELECT symbol FROM market.market_assets ORDER BY id`);
  const { rows: players } = await pool.query(`SELECT id FROM market.users ORDER BY id`);
  for (let i = 0; i < 200; i += 1) {
    await trading.submitLiveOrder(pool, { userId: Number(players[Math.floor(random() * players.length)].id), symbol: stocks[Math.floor(random() * stocks.length)].symbol, side: "buy", quantity: 1 + Math.floor(random() * 4) });
  }
  await pool.query(`UPDATE market.trade_orders SET execute_after = now() - interval '1 minute' WHERE status = 'pending'`);
}

async function clone(name, template = SEED_DB) {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
  });
  return new Pool({ connectionString: databaseNamed(name), max: 14 });
}

/** Everything a batch decides, as Postgres stores it (text, so a last digit can't hide). */
async function resultsOf(pool, { ledgerFrom = 0 } = {}) {
  const read = async (sql) => (await pool.query(sql)).rows;
  return {
    orders: await read(`SELECT id, status, filled_quantity::text, rejection_reason, quote_bid_at_submit::text, quote_ask_at_submit::text, held_cash::text, live_order_batch_id IS NOT NULL AS batched FROM market.trade_orders ORDER BY id`),
    fills: await read(`SELECT id, order_id, asset_id, user_id, side, price::text, quantity::text, gross_cash::text, fee_cash::text, net_cash::text, counterparty_type FROM market.trade_fills ORDER BY id`),
    // One player's rows in the order they happened; across players the ids only say who got the sequence first.
    ledger: await read(`SELECT user_id, asset_id, entry_type, quantity_delta::text, cash_delta::text, credit_delta::text, reference_type, reference_id FROM market.ledger_entries WHERE id > ${Number(ledgerFrom)} ORDER BY user_id, id`),
    wallets: await read(`SELECT user_id, cash_balance::text, held_cash::text, credit_balance::text FROM market.portfolio_cash_balances ORDER BY user_id`),
    holdings: await read(`SELECT user_id, asset_id, quantity::text, avg_cost_basis::text FROM market.portfolio_holdings ORDER BY user_id, asset_id`),
    stocks: await read(`SELECT id, current_mid_price::text, current_bid_price::text, current_ask_price::text, current_premium_pct::text, current_persistent_offset::text, current_transient_offset::text, offsets_updated_at, circulating_supply::text, treasury_supply::text, trading_state, status FROM market.market_assets ORDER BY id`),
    days: await read(`SELECT asset_id, mid_close::text, mid_high::text, mid_low::text, bid_close::text, ask_close::text, premium_close_pct::text, volume_shares::text, volume_cash::text, trade_count FROM market.asset_daily_market_state ORDER BY asset_id`),
    buybacks: await read(`SELECT asset_id, shares_bought::text, cash_paid::text FROM market.asset_buybacks ORDER BY asset_id`),
    achievements: await read(`SELECT user_id, achievement_key FROM market.user_achievements ORDER BY user_id, achievement_key`),
    streaks: await read(`SELECT user_id, current_streak_days, longest_streak_days, last_trade_fill_id FROM market.user_trade_streaks ORDER BY user_id`),
    notifications: await read(`SELECT user_id, kind, title FROM market.notifications ORDER BY user_id, id`),
  };
}

function assertSameRows(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: row count`);
  for (let i = 0; i < expected.length; i += 1) {
    assert.deepEqual(actual[i], expected[i], `${label}: row ${i}`);
  }
}

function assertSameResults(actual, expected) {
  for (const table of Object.keys(expected)) assertSameRows(actual[table], expected[table], table);
}

/** Timestamps are the one thing an event can't have the same; only that they're there is compared. */
function withoutTimes(value) {
  const { ts, updated_at, ...rest } = value;
  assert.ok(ts === undefined || ts, "has a time");
  return rest;
}

function assertSameEvents(reference, batched) {
  const expectedFills = reference.filter((event) => event.type === "market.trade_fill");
  const landings = batched.filter((event) => event.type === "market.trade_fills");
  assert.equal(landings.reduce((sum, event) => sum + event.fills, 0), expectedFills.length, "fills announced");
  // Every trade a landing carries, as the row-at-a-time event had it.
  const byFill = new Map(expectedFills.map((event) => [String(event.trade.id), event]));
  for (const landing of landings) {
    for (const trade of landing.trades) assert.deepEqual(withoutTimes(trade), withoutTimes(byFill.get(String(trade.id)).trade));
  }
  // Each stock's quote, as its last fill's event left it, and the shares it traded.
  const lastQuote = new Map();
  const shares = new Map();
  for (const event of expectedFills) {
    lastQuote.set(event.quote.symbol, event.quote);
    shares.set(event.quote.symbol, (shares.get(event.quote.symbol) || 0) + event.trade.quantity);
  }
  const quotes = new Map(landings.flatMap((landing) => landing.quotes.map((quote) => [quote.symbol, quote])));
  assert.equal(quotes.size, lastQuote.size);
  for (const [symbol, expected] of lastQuote) {
    const { volume_shares: volume, ...quote } = quotes.get(symbol);
    assert.deepEqual(withoutTimes(quote), withoutTimes(expected), `${symbol} quote`);
    assert.ok(Math.abs(volume - shares.get(symbol)) < 1e-9, `${symbol} volume`);
  }
  // Rejections: the same orders, for the same reasons, reported the same way.
  const rejected = (events) =>
    events
      .filter((event) => event.type === "market.live_order_rejected")
      .map((event) => ({ reason: event.reason, ...withoutTimes({ ...event.order, live_order_batch_id: null, requested_at: null }) }))
      .sort((a, b) => Number(a.id) - Number(b.id));
  assert.deepEqual(rejected(batched), rejected(reference));
}

test("the batched live-order settlement", { skip: !databaseUrl, timeout: 600_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");

  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${SEED_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${SEED_DB}`);
  });
  const seed = new Pool({ connectionString: databaseNamed(SEED_DB) });
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    await applySchema(seed);
  } finally {
    console.log = log;
    console.warn = warn;
  }
  const { queued } = await buildMarket(seed);
  const ledgerFrom = Number((await seed.query(`SELECT COALESCE(MAX(id), 0) AS id FROM market.ledger_entries`)).rows[0].id);
  await seed.end();
  assert.ok(queued >= ORDERS, `queued ${queued}`);

  // Two minutes on: orders are due, and the clock every fill reads is the same on each clone.
  const pinned = Date.now() + 120_000;
  const pinClock = (scope) => scope.mock.timers.enable({ apis: ["Date"], now: pinned });

  const cleanup = [];
  const open = async (name, template) => {
    const pool = await clone(name, template);
    cleanup.push(async () => {
      await achievements.tradeFillsIdle();
      // The leaderboard refresh a batch queues coalesces for 2 s, on this pool.
      await new Promise((resolve) => setTimeout(resolve, 2300));
      await pool.end().catch(() => {});
      await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    });
    return pool;
  };
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
    await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS ${SEED_DB} WITH (FORCE)`));
  });

  // The row-at-a-time batch in queue order: the reference every run below has to match.
  let expected;
  let expectedEvents;
  await t.test("one at a time, in queue order (the reference)", async (st) => {
    pinClock(st);
    const pool = await open("nasfaq_live_batch_ref");
    const redis = fakeRedis();
    const result = await reference.processDueLiveOrders(pool, { now: new Date(pinned), limit: 1_000_000, redis, order: "fifo" });
    st.mock.timers.reset();
    assert.equal(result.attempted, queued);
    assert.ok(result.filled > queued / 3 && result.rejected > 0, `the market has fills and rejections (${result.filled} filled, ${result.rejected} rejected)`);
    assert.equal(result.error, null);
    await achievements.tradeFillsIdle();
    expected = await resultsOf(pool, { ledgerFrom });
    expectedEvents = redis.events;
    const reasons = new Set(expected.orders.map((order) => order.rejection_reason).filter(Boolean));
    for (const reason of ["sold_out", "buyback_frozen", "asset_not_active", "insufficient_cash", "insufficient_holdings"]) {
      assert.ok(reasons.has(reason), `the market exercises ${reason}`);
    }
    assert.ok(expected.fills.some((fill) => Number(fill.quantity) !== Math.round(Number(fill.quantity))), "fractional fills");
    assert.ok(expected.buybacks.some((row) => Number(row.shares_bought) > 1.5), "sells into a buyback");
    assert.ok(expected.ledger.some((row) => row.entry_type === "starter_cash_grant"), "an account opened in passing");
    assert.ok(expected.ledger.some((row) => row.entry_type === "sell_credit"), "sales earned Credit");
    assert.ok(expected.orders.some((order) => order.status === "filled" && Number(order.filled_quantity) === 0.5), "a partial fill");
  });

  await t.test("the batched run matches it digit for digit", async (st) => {
    pinClock(st);
    const pool = await open("nasfaq_live_batch_new");
    const redis = fakeRedis();
    await trading.drainDueLiveOrders(pool, { redis, logger: quiet });
    st.mock.timers.reset();
    await achievements.tradeFillsIdle();
    assertSameResults(await resultsOf(pool, { ledgerFrom }), expected);
    assert.equal(redis.events.filter((event) => event.type === "market.trade_fills").length, 1, "one event for the run");
    assertSameEvents(expectedEvents, redis.events);
  });

  await t.test("so does one in tiny chunks, each committed before the next reads it", async (st) => {
    pinClock(st);
    const pool = await open("nasfaq_live_batch_tiny");
    const redis = fakeRedis();
    const landing = trading._test.newFillLanding();
    const release = achievements.holdTradeFills();
    let chunks = 0;
    for (;;) {
      const result = await trading.processDueLiveOrders(pool, { redis, limit: 7, now: new Date(pinned), landing });
      chunks += 1;
      if (!result.more) break;
    }
    release();
    trading._test.publishFillLanding(redis, landing);
    st.mock.timers.reset();
    assert.ok(chunks >= Math.floor(queued / 7));
    await achievements.tradeFillsIdle();
    assertSameResults(await resultsOf(pool, { ledgerFrom }), expected);
    assertSameEvents(expectedEvents, redis.events);
  });

  await t.test("across stocks the old workers raced; with nothing riding on that race, only rounding differs", async (st) => {
    const plainSeed = await open("nasfaq_live_batch_plain");
    await buildPlainMarket(plainSeed);
    const plainLedgerFrom = Number((await plainSeed.query(`SELECT COALESCE(MAX(id), 0) AS id FROM market.ledger_entries`)).rows[0].id);
    await plainSeed.end();
    cleanup.pop();
    const runs = {};
    for (const engine of ["workers", "batched"]) {
      pinClock(st);
      const pool = await open(`nasfaq_live_batch_plain_${engine}`, "nasfaq_live_batch_plain");
      const release = achievements.holdTradeFills();
      if (engine === "workers") {
        for (;;) {
          const result = await reference.processDueLiveOrders(pool, { now: new Date(pinned), limit: 100, order: "workers" });
          if (result.attempted < 100) break;
        }
      } else {
        await trading.drainDueLiveOrders(pool, { logger: quiet });
      }
      release();
      st.mock.timers.reset();
      await achievements.tradeFillsIdle();
      runs[engine] = await resultsOf(pool, { ledgerFrom: plainLedgerFrom });
    }
    const byOrder = (fills) => new Map(fills.map((fill) => [String(fill.order_id), fill]));
    const workerFills = byOrder(runs.workers.fills);
    for (const fill of runs.batched.fills) {
      const { id: _a, ...mine } = fill;
      const { id: _b, ...theirs } = workerFills.get(String(fill.order_id));
      assert.deepEqual(mine, theirs, "same price, shares, cash and fee on every order");
    }
    assertSameRows(runs.batched.holdings, runs.workers.holdings, "holdings");
    assertSameRows(runs.batched.stocks, runs.workers.stocks, "stocks");
    assertSameRows(runs.batched.days, runs.workers.days, "day rows");
    assert.equal(runs.batched.wallets.length, runs.workers.wallets.length);
    runs.batched.wallets.forEach((wallet, index) => {
      assert.ok(Math.abs(Number(wallet.cash_balance) - Number(runs.workers.wallets[index].cash_balance)) < 1e-6, "cash, to rounding");
      assert.ok(Math.abs(Number(wallet.credit_balance) - Number(runs.workers.wallets[index].credit_balance)) < 1e-6, "credit, to rounding");
    });
    await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS nasfaq_live_batch_plain WITH (FORCE)`));
  });

  await t.test("a chunk writes one fill time, in queue order, and the tape pages through it", async () => {
    const pool = await open("nasfaq_live_batch_tape");
    const redis = fakeRedis();
    await trading.processDueLiveOrders(pool, { redis, limit: 400 });
    const { rows } = await pool.query(`SELECT f.id, f.ts, f.order_id FROM market.trade_fills f ORDER BY f.id`);
    assert.ok(rows.length > 100);
    assert.equal(new Set(rows.map((row) => row.ts.getTime())).size, 1, "one time for the chunk");
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.trade_fills WHERE ts <> date_trunc('milliseconds', ts)`)).rows[0].n, 0, "whole milliseconds, what a cursor holds");
    assert.deepEqual(rows.map((row) => Number(row.order_id)), rows.map((row) => Number(row.order_id)).sort((a, b) => a - b), "ids run in queue order");

    // Page the way the site does: the cursor goes through JSON.
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 50; page += 1) {
      const result = await marketDb.listRecentMarketTrades(pool, { limit: 25, beforeTs: cursor?.ts ?? null, beforeId: cursor?.id ?? null });
      seen.push(...result.items.map((item) => Number(item.id)));
      if (!result.next_cursor) break;
      cursor = JSON.parse(JSON.stringify(result.next_cursor));
    }
    assert.deepEqual(seen, rows.map((row) => Number(row.id)).reverse(), "every fill once, newest first");

    // A stock's candle opens on its first fill of the chunk and closes on its last, not on whichever
    // the database reads first.
    const { rows: busiest } = await pool.query(
      `SELECT a.symbol, (array_agg(f.price::text ORDER BY f.id))[1] AS first_price, (array_agg(f.price::text ORDER BY f.id DESC))[1] AS last_price
       FROM market.trade_fills f JOIN market.market_assets a ON a.id = f.asset_id GROUP BY a.symbol ORDER BY COUNT(*) DESC LIMIT 1`
    );
    assert.notEqual(busiest[0].first_price, busiest[0].last_price);
    const candles = await marketDb.getAssetCandles(pool, busiest[0].symbol, { interval: "1h", range: "24h" });
    assert.equal(candles.length, 1);
    assert.equal(String(candles[0].open), busiest[0].first_price);
    assert.equal(String(candles[0].close), busiest[0].last_price);
  });

  await t.test("however big the run, the site hears once, with the newest fills", async () => {
    const pool = await open("nasfaq_live_batch_event");
    const release = achievements.holdTradeFills();
    const redis = fakeRedis();
    const result = await trading.drainDueLiveOrders(pool, { redis, logger: quiet });
    release();
    assert.equal(result.attempted, queued);
    const landings = redis.events.filter((event) => event.type === "market.trade_fills");
    assert.equal(landings.length, 1);
    assert.equal(redis.events.filter((event) => event.type === "market.trade_fill").length, 0, "no per-fill events");
    const [landing] = landings;
    const fills = (await pool.query(`SELECT f.id::text AS fill_id, f.gross_cash, f.side FROM market.trade_fills f ORDER BY f.id`)).rows;
    assert.equal(landing.fills, fills.length);
    assert.ok(landing.trades.length <= 200);
    assert.deepEqual(landing.trades.map((trade) => String(trade.id)), fills.slice(-landing.trades.length).map((fill) => fill.fill_id), "the newest, in fill order");
    assert.ok(Math.abs(landing.gross_cash - fills.reduce((sum, fill) => sum + Number(fill.gross_cash), 0)) < 1e-6);
  });

  await t.test("a stock another transaction holds: the chunk waits a turn instead of queueing behind it", async () => {
    const pool = await open("nasfaq_live_batch_busy");
    const other = await pool.connect();
    await other.query("BEGIN");
    await other.query(`SELECT id FROM market.market_assets ORDER BY id LIMIT 1 FOR UPDATE`);
    const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM market.trade_orders WHERE status = 'pending'`)).rows[0].n;
    const started = Date.now();
    const result = await trading.processDueLiveOrders(pool, { limit: 1000 });
    assert.equal(result.skipped, "stocks_busy");
    assert.ok(Date.now() - started < 2000, "without waiting");
    assert.equal(result.attempted, 0);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.trade_orders WHERE status = 'pending'`)).rows[0].n, before, "nothing touched");
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.live_order_batches`)).rows[0].n, 0, "no batch row for a turn not taken");
    await other.query("ROLLBACK");
    // A row being inserted that references the stock (a player placing an order) is no reason to wait.
    await other.query("BEGIN");
    await other.query(`SELECT id FROM market.market_assets ORDER BY id FOR KEY SHARE`);
    const retried = await trading.processDueLiveOrders(pool, { limit: 1000 });
    await other.query("ROLLBACK");
    other.release();
    assert.equal(retried.attempted, queued);
    assert.equal(retried.row_by_row, undefined);
  });

  await t.test("a wallet someone else is holding: that chunk goes row by row, nobody else waits on it", async () => {
    const pool = await open("nasfaq_live_batch_fallback");
    const { rows: busy } = await pool.query(`SELECT user_id FROM market.trade_orders WHERE status = 'pending' GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1`);
    const other = await pool.connect();
    await other.query("BEGIN");
    await other.query(`SELECT user_id FROM market.portfolio_cash_balances WHERE user_id = $1 FOR UPDATE`, [busy[0].user_id]);
    const consoleError = console.error;
    const complaints = [];
    console.error = (...args) => complaints.push(args.join(" "));
    const redis = fakeRedis();
    const running = trading.processDueLiveOrders(pool, { redis, limit: 60 });
    // Past the chunk's lock timeout, others' orders fill while this player's wait.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const midway = (await pool.query(`SELECT COUNT(*)::int AS n FROM market.trade_fills`)).rows[0].n;
    await other.query("ROLLBACK");
    other.release();
    const result = await running;
    console.error = consoleError;
    assert.ok(midway > 0, "fills went through while the wallet was held");
    assert.equal(result.row_by_row, true);
    assert.equal(result.attempted, 60);
    assert.equal(result.error, null);
    assert.ok(complaints.some((line) => line.includes("row-by-row")), "and it says so");
    assert.ok(redis.events.some((event) => event.type === "market.trade_fill"), "the slow path's own events");
  });

  await t.test("trading closing as a chunk starts: its orders wait, none are rejected", async (st) => {
    const pool = await open("nasfaq_live_batch_closed");
    await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'settling'`);
    st.mock.method(marketState, "getMarketStatus", async () => ({ is_trading_open: true }));
    const result = await trading.processDueLiveOrders(pool, { limit: 1000 });
    assert.equal(result.skipped, "market_closed");
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.trade_orders WHERE status = 'rejected'`)).rows[0].n, 0);
  });

  await t.test("an order cancelled after the batch picked it isn't filled or rejected", async () => {
    const pool = await open("nasfaq_live_batch_cancel");
    const { rows } = await pool.query(`SELECT id, user_id FROM market.trade_orders WHERE status = 'pending' AND side = 'buy' AND held_cash > 0 ORDER BY id LIMIT 3`);
    await trading.cancelLiveOrder(pool, { orderId: rows[0].id, userId: rows[0].user_id });
    const redis = fakeRedis();
    const landing = trading._test.newFillLanding();
    const result = await trading._test.settleLiveOrderChunk(pool, rows.map((row) => ({ id: Number(row.id) })), { redis, landing });
    assert.equal(result.filled + result.rejected, 3);
    const { rows: after } = await pool.query(`SELECT status FROM market.trade_orders WHERE id = $1`, [rows[0].id]);
    assert.equal(after[0].status, "cancelled");
    assert.equal(redis.events.some((event) => event.type === "market.live_order_rejected" && String(event.order.id) === String(rows[0].id)), false, "no rejection for it");
    assert.equal(landing.trades.some((trade) => String(trade.order_id) === String(rows[0].id)), false);
  });
});
