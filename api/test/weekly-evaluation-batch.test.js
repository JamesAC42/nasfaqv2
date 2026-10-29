const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const fundamentals = require("../src/services/fundamentals");
const settlement = require("../src/services/settlement");
const weekly = require("../src/services/weeklyEvaluation");
const reference = require("./fixtures/weekly-evaluation-reference");
const pgNumeric = require("../src/services/pgNumeric");
const economy = require("../src/services/economy");

// The batched weekly evaluation against the row-at-a-time one it replaced (frozen in
// fixtures/weekly-evaluation-reference.js). One realistic market is seeded once, cloned, and each
// clone runs one of them: two Saturdays in a row (buybacks started on the first are forced on the
// second) and a first-ever evaluation. Balances, holdings, ledger rows, dividend lines, buybacks,
// stocks, the review and the notifications must come out identical. Then the trading pause, the dry
// run and the locking on the batched one.
//
// WEEKLY_EVAL_TEST_PLAYERS sets the market's size (300 by default; the PR's timings used 2,000).
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const PLAYERS = Math.max(20, Number(process.env.WEEKLY_EVAL_TEST_PLAYERS) || 300);
const quiet = { log() {}, warn() {}, error() {} };

const DAYS = 16;
const day = (i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10); // 2026-10-01 …
const SATURDAY = "2026-10-17";
const NEXT_SATURDAY = "2026-10-24";

// A small deterministic PRNG (mulberry32), so every run seeds the same market.
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

/**
 * The market: 40 listed talents with 16 days of stats, fundamentals and settlement (so every number
 * the evaluation reads comes from the real pipeline), then statuses, buybacks, rookies, players,
 * holdings and wallets laid over it, edge cases included.
 */
async function seedMarket(pool) {
  const random = prng(20261017);
  const between = (low, high) => low + (high - low) * random();
  const cents = (value) => value.toFixed(2);
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);

  const channels = [];
  for (let i = 0; i < 40; i += 1) {
    const id = `UCweekly${String(i).padStart(16, "0")}`;
    const symbol = `T${String(i).padStart(2, "0")}`;
    // Two small channels (their max shares fall below what's held: buybacks), the rest spread out.
    const subs = i === 0 ? 60_000 : i === 1 ? 400_000 : Math.round(between(150_000, 4_000_000));
    channels.push({ id, symbol, subs, growth: between(-0.004, 0.012), views: Math.round(between(5e6, 2e8)), viewGrowth: between(-0.002, 0.02) });
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1,$2,$2,$3,true)`, [id, `Talent ${symbol}`, symbol]);
    await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps) VALUES ($1,$2,$3,'active',10000,0,10000,2000,400)`,
      [id, symbol, `Talent ${symbol}`]
    );
  }
  const stats = [];
  for (const channel of channels) {
    for (let i = 0; i < DAYS; i += 1) {
      stats.push({
        time: `${day(i)}T16:00:00Z`,
        id: channel.id,
        subs: Math.round(channel.subs * (1 + channel.growth) ** i),
        views: Math.round(channel.views * (1 + channel.viewGrowth) ** i),
        videos: 300 + i,
      });
    }
  }
  await pool.query(
    `INSERT INTO yt.youtube_channel_daily_stats (time, youtube_channel_id, subscriber_count, view_count, video_count)
     SELECT s.time, s.id, s.subs, s.views, s.videos FROM jsonb_to_recordset($1::jsonb) AS s(time timestamptz, id text, subs bigint, views bigint, videos bigint)`,
    [JSON.stringify(stats)]
  );
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await fundamentals.recalculateFundamentals(pool, { from: day(0), to: day(DAYS - 1), activeOnly: true, fillMissingDates: true });
    const settled = await settlement.settleMarketRange(pool, { from: day(0), to: day(DAYS - 1) });
    assert.equal(settled.settled_count, DAYS);
  } finally {
    console.log = log;
    console.warn = warn;
  }
  // Every settled day's ticks have landed.
  await pool.query(`INSERT INTO market.adjustment_sessions (market_date, status) SELECT d::date, 'completed' FROM generate_series($1::date, $2::date, '1 day') d ON CONFLICT DO NOTHING`, [day(0), day(DAYS - 1)]);

  const { rows: assetRows } = await pool.query(`SELECT id, symbol FROM market.market_assets ORDER BY symbol`);
  const asset = Object.fromEntries(assetRows.map((row) => [row.symbol, Number(row.id)]));
  // Listed, but not all trading: two delisted (one with a buyback left open), two back to prelaunch,
  // one halted. The evaluation leaves them all alone.
  await pool.query(`UPDATE market.market_assets SET status = 'delisted' WHERE symbol IN ('T36', 'T37')`);
  await pool.query(`UPDATE market.market_assets SET status = 'prelaunch' WHERE symbol IN ('T38', 'T39')`);
  await pool.query(`UPDATE market.market_assets SET status = 'halted' WHERE symbol = 'T35'`);
  // A stock listed after the last settled day: no history, so no shift and no dividend basis.
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ('UCweeklyfresh00000000000', 'Fresh', 'Fresh', 'FRS', true)`);
  const { rows: fresh } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps) VALUES ('UCweeklyfresh00000000000','FRS','Fresh','active',10000,0,10000,2000,400) RETURNING id`
  );
  asset.FRS = Number(fresh[0].id);
  // Rookies: two listed by an IPO this month, one listed long enough ago to count, one called off.
  const { rows: events } = await pool.query(
    `INSERT INTO market.ipo_events (title, status, listing_date, window_opens_at, window_closes_at) VALUES ('Debut', 'listed', $1, $2, $3) RETURNING id`,
    [day(8), `${day(5)}T13:00:00Z`, `${day(8)}T13:00:00Z`]
  );
  const eventId = events[0].id;
  for (const [symbol, listedOn, status] of [["T10", day(8), "listed"], ["T11", day(12), "listed"], ["T12", "2026-08-01", "listed"], ["T13", null, "cancelled"]]) {
    await pool.query(`INSERT INTO market.ipo_listings (event_id, asset_id, status, listed_on) VALUES ($1,$2,$3,$4)`, [eventId, asset[symbol], status, listedOn]);
  }

  // Players. Two hold stocks with no cash account at all (one only holds the stock whose buyback is
  // forced, so the forced buyback opens it, the other gets the starter balances from a dividend or fee).
  const { rows: userRows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     SELECT 'player' || g, 'player' || g, 'player' || g || '@example.test', true, 'x', 'x', '{}' FROM generate_series(1, $1) g RETURNING id`,
    [PLAYERS]
  );
  const users = userRows.map((row) => Number(row.id));
  const [forcedOnly, starterOnly] = users.slice(-2);
  const tradable = assetRows.map((row) => row.symbol).filter((symbol) => !["T36", "T37", "T38", "T39", "T35"].includes(symbol)).concat("FRS");
  const everyStock = assetRows.map((row) => row.symbol).concat("FRS");
  // Holdings sized so a stock's players hold around 8,000 shares whatever the number of players.
  const typical = Math.max(5, Math.round(35_000 / PLAYERS));
  const quantity = () => {
    const kind = random();
    if (kind < 0.5) return String(Math.ceil(between(1, 2 * typical)));
    if (kind < 0.85) return between(0.5, 2 * typical).toFixed(6);
    return `${Math.floor(between(1, 2 * typical))}.${String(Math.floor(random() * 1e9)).padStart(9, "0")}${String(Math.floor(random() * 1e9)).padStart(9, "0")}`;
  };
  const holdings = [];
  const wallets = [];
  for (const userId of users) {
    if (userId === forcedOnly) {
      holdings.push({ userId, symbol: "T20", quantity: "37.5" });
      continue;
    }
    if (userId === starterOnly) {
      for (const symbol of tradable) if (symbol !== "T20") holdings.push({ userId, symbol, quantity: "50" });
      continue;
    }
    // One in ten holds nothing (the conversion still reaches them); the others 1–20 stocks.
    const count = random() < 0.1 ? 0 : Math.ceil(between(1, 20));
    const picks = new Set();
    while (picks.size < count) picks.add(everyStock[Math.floor(random() * everyStock.length)]);
    for (const symbol of picks) holdings.push({ userId, symbol, quantity: quantity() });

    const kind = random();
    let credit;
    if (kind < 0.1) credit = "0"; // fees fall through to Cash
    else if (kind < 0.15) credit = cents(-between(1, 100)); // already below zero: covers nothing
    else if (kind < 0.25) credit = cents(between(0.01, 9_999.99)); // under the minimum: all of it converts
    else if (kind < 0.3) credit = cents(between(0.01, 5)); // a fee takes the little there is, Cash the rest
    else if (kind < 0.4) credit = `${Math.floor(between(1, 200_000))}.${String(Math.floor(random() * 1e9)).padStart(9, "0")}${String(Math.floor(random() * 1e9)).padStart(9, "0")}`; // more digits than a double holds
    else if (kind < 0.45) credit = "10000.00"; // exactly the minimum
    else credit = cents(between(10_000, 400_000));
    const cashKind = random();
    const cash = cashKind < 0.05 ? cents(-between(1, 500)) : cashKind < 0.1 ? `${Math.floor(between(0, 900))}.123456789012345678` : cents(between(0, 60_000));
    wallets.push({ userId, cash, credit });
  }
  await pool.query(
    `INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance)
     SELECT w."userId", w.cash, w.credit FROM jsonb_to_recordset($1::jsonb) AS w("userId" bigint, cash numeric, credit numeric)`,
    [JSON.stringify(wallets)]
  );
  // Make the two small channels heavily held, so their max shares fall below what players hold.
  for (const [index, userId] of users.slice(0, 120).entries()) {
    if (userId === forcedOnly || userId === starterOnly) continue;
    holdings.push({ userId, symbol: index % 2 ? "T00" : "T01", quantity: String(80 + (index % 7) * 13) });
  }
  const merged = new Map();
  for (const holding of holdings) merged.set(`${holding.userId}:${holding.symbol}`, holding);
  await pool.query(
    `INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis)
     SELECT h."userId", a.id, h.quantity, 5 FROM jsonb_to_recordset($1::jsonb) AS h("userId" bigint, symbol text, quantity numeric)
     JOIN market.market_assets a ON a.symbol = h.symbol`,
    [JSON.stringify([...merged.values()])]
  );
  // Shares held are the circulating supply; max shares leave room for them, except where a buyback is due.
  await pool.query(`
    UPDATE market.market_assets a
    SET circulating_supply = h.held,
        max_supply = GREATEST(10000, CEIL(h.held / 100) * 100 + 500),
        treasury_supply = GREATEST(GREATEST(10000, CEIL(h.held / 100) * 100 + 500) - h.held, 0)
    FROM (SELECT asset_id, SUM(quantity) AS held FROM market.portfolio_holdings GROUP BY asset_id) h
    WHERE a.id = h.asset_id
  `);
  // Buybacks already running: T20's is still over its max (forced), T21's got back under (met),
  // T36's stock was delisted meanwhile (left open).
  await pool.query(`UPDATE market.market_assets SET max_supply = GREATEST(circulating_supply - 120.25, 1), treasury_supply = 0, trading_state = 'buyback' WHERE symbol = 'T20'`);
  await pool.query(`UPDATE market.market_assets SET trading_state = 'buyback' WHERE symbol IN ('T21', 'T36')`);
  for (const symbol of ["T20", "T21", "T36"]) {
    await pool.query(
      `INSERT INTO market.asset_buybacks (asset_id, started_evaluation_id, frozen_price, target_max_supply, held_at_start, shares_bought, cash_paid, started_at)
       SELECT id, NULL, 7.25, max_supply, circulating_supply, 12.5, 90.625, now() - interval '3 days' FROM market.market_assets WHERE symbol = $1`,
      [symbol]
    );
  }
  // A week was evaluated before (so this isn't the first evaluation).
  await pool.query(`INSERT INTO market.weekly_evaluations (eval_date, status, completed_at, report_json) VALUES ('2026-10-10', 'completed', now(), '{}')`);
  return { users, asset, forcedOnly, starterOnly };
}

test("NUMERIC arithmetic in JS lands where Postgres does", () => {
  const text = (value) => pgNumeric.toString(pgNumeric.parse(value));
  assert.equal(text(1e-7), "0.0000001", "a JS number as node-pg writes it, exponent and all");
  assert.equal(text(-1.5e21), "-1500000000000000000000");
  assert.equal(text("0012.3400"), "12.3400", "NUMERIC text keeps its scale");
  const round2 = (value) => pgNumeric.toString(pgNumeric.round(pgNumeric.parse(value), 2));
  assert.deepEqual(["2.345", "-2.345", "2.344999", "0.005", "7"].map(round2), ["2.35", "-2.35", "2.34", "0.01", "7"], "half away from zero");
  // A balance with more digits than a double holds, after a JS-number delta: exact, then Number() of that.
  const sum = pgNumeric.add(pgNumeric.parse("100012.345678901234567891"), pgNumeric.parse(0.1));
  assert.equal(pgNumeric.toString(sum), "100012.445678901234567891");
  assert.equal(pgNumeric.toNumber(sum), Number("100012.445678901234567891"));
  assert.equal(pgNumeric.compare(pgNumeric.parse("-0.000"), pgNumeric.ZERO), 0);
  // The conversion: 5% or the minimum, all of a smaller balance, nothing for zero or less.
  const plan = economy.planCreditConversion(
    [{ userId: 1, credit: "1000000" }, { userId: 2, credit: "99000" }, { userId: 3, credit: "4000.123456789012345678" }, { userId: 4, credit: "0" }, { userId: 5, credit: "-3" }, { userId: 6, credit: "300000.10" }],
    { rate: 0.05, minimum: 10000 }
  );
  assert.deepEqual(plan.moves, [{ userId: 1, amount: 50000 }, { userId: 2, amount: 10000 }, { userId: 3, amount: Number("4000.123456789012345678") }, { userId: 6, amount: 15000.01 }]);
  assert.equal(plan.players, 4);
});

/** Everything an evaluation writes, in a form two databases can be compared by. */
async function snapshot(pool) {
  const q = async (sql) => (await pool.query(sql)).rows;
  const report = (row) => {
    const { generated_at: _ignored, ...rest } = row.report_json || {};
    return { eval_date: row.eval_date, status: row.status, completed: row.completed, report: rest };
  };
  return {
    balances: await q(`SELECT user_id, cash_balance::text AS cash, credit_balance::text AS credit, held_cash::text AS held FROM market.portfolio_cash_balances ORDER BY user_id`),
    holdings: await q(`SELECT user_id, asset_id, quantity::text AS quantity FROM market.portfolio_holdings ORDER BY user_id, asset_id`),
    ledger: await q(`
      SELECT user_id, asset_id, entry_type, quantity_delta::text AS quantity, cash_delta::text AS cash, credit_delta::text AS credit, reference_type, reference_id
      FROM market.ledger_entries
      ORDER BY user_id, asset_id NULLS FIRST, entry_type, reference_id, quantity_delta, cash_delta, credit_delta`),
    payouts: await q(`SELECT evaluation_id, user_id, asset_id, quantity::text, per_share::text, amount::text FROM market.dividend_payouts ORDER BY evaluation_id, user_id, asset_id`),
    stocks: await q(`SELECT id, symbol, status, trading_state, max_supply::text, circulating_supply::text, treasury_supply::text FROM market.market_assets ORDER BY id`),
    buybacks: await q(`
      SELECT asset_id, started_evaluation_id, closed_evaluation_id, status, frozen_price::text, target_max_supply::text, held_at_start::text,
             shares_bought::text, cash_paid::text, forced_shares::text, forced_price::text, ended_at IS NULL AS open
      FROM market.asset_buybacks ORDER BY asset_id, started_evaluation_id NULLS FIRST, status`),
    lines: await q(`SELECT * FROM market.weekly_asset_evaluations ORDER BY evaluation_id, asset_id`),
    evaluations: (await q(`SELECT id, eval_date::text, status, completed_at IS NOT NULL AS completed, report_json FROM market.weekly_evaluations ORDER BY eval_date`)).map(report),
    notifications: await q(`SELECT user_id, kind, title, body, href, data FROM market.notifications ORDER BY user_id, kind, title, body`),
    trading: (await q(`SELECT trading_status FROM market.market_runtime_state`))[0]?.trading_status,
  };
}

/** Equal, or a short message naming the first rows that differ. */
function same(label, actual, expected) {
  if (!Array.isArray(expected)) return assert.deepStrictEqual(actual, expected, label);
  const differences = [];
  for (let i = 0; i < Math.max(actual.length, expected.length) && differences.length < 5; i += 1) {
    if (JSON.stringify(actual[i]) !== JSON.stringify(expected[i])) differences.push(`  #${i}\n    batched:      ${JSON.stringify(actual[i])}\n    row-at-a-time: ${JSON.stringify(expected[i])}`);
  }
  assert.ok(!differences.length && actual.length === expected.length, `${label}: ${actual.length} vs ${expected.length} rows\n${differences.join("\n")}`);
}

function compareSnapshots(actual, expected) {
  for (const key of Object.keys(expected)) same(key, actual[key], expected[key]);
}

/** A pool that counts the statements it sends (each one a round trip to the database). */
function countingPool(connectionString) {
  const pool = new Pool({ connectionString, max: 4 });
  pool.statements = 0;
  pool.on("connect", (client) => {
    const query = client.query.bind(client);
    client.query = (...args) => {
      pool.statements += 1;
      return query(...args);
    };
  });
  return pool;
}

test("the batched weekly evaluation matches the row-at-a-time one", { skip: !databaseUrl, timeout: 900_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");

  const names = { seed: "nasfaq_weekly_seed", old: "nasfaq_weekly_old", batched: "nasfaq_weekly_batched", oldFirst: "nasfaq_weekly_old_first", batchedFirst: "nasfaq_weekly_batched_first" };
  await withAdmin(async (admin) => {
    for (const name of Object.values(names)) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${names.seed}`);
  });
  const seedPool = new Pool({ connectionString: databaseNamed(names.seed) });
  let seeded;
  try {
    const log = console.log;
    const warn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
      await applySchema(seedPool);
    } finally {
      console.log = log;
      console.warn = warn;
    }
    seeded = await seedMarket(seedPool);
  } finally {
    await seedPool.end();
  }
  await withAdmin(async (admin) => {
    for (const name of [names.old, names.batched, names.oldFirst, names.batchedFirst]) await admin.query(`CREATE DATABASE ${name} TEMPLATE ${names.seed}`);
  });
  const oldPool = countingPool(databaseNamed(names.old));
  const newPool = countingPool(databaseNamed(names.batched));
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await Promise.all([oldPool.end(), newPool.end()]);
  });

  const timed = async (pool, run) => {
    pool.statements = 0;
    const started = Date.now();
    const result = await run();
    return { result, ms: Date.now() - started, statements: pool.statements };
  };
  const timings = [];

  await t.test("two Saturdays in a row: same balances, ledger, holdings, buybacks, review and notifications", async () => {
    const before = await snapshot(newPool);
    assert.equal(before.trading, "open");

    const oldRun = await timed(oldPool, () => reference.runWeeklyEvaluation(oldPool, { evalDate: SATURDAY, logger: quiet }));
    const newRun = await timed(newPool, () => weekly.runWeeklyEvaluation(newPool, { evalDate: SATURDAY, logger: quiet }));
    timings.push({ run: SATURDAY, old: oldRun, batched: newRun });
    assert.equal(newRun.result.ok, true);
    assert.equal(newRun.result.trading_closed, true, "trading was closed for it");
    const first = await snapshot(newPool);
    compareSnapshots(first, await snapshot(oldPool));

    // The market has every case in it.
    const report = newRun.result.report;
    assert.ok(report.paying_count > 3 && report.charging_count > 3, "dividends and fees");
    assert.deepEqual(report.buybacks_closed.map((row) => [row.symbol, row.status]), [["T20", "forced"], ["T21", "met"]]);
    const started = report.buybacks_started.map((row) => row.symbol);
    assert.ok(started.includes("T00") && started.includes("T01"), `buybacks start on the small channels (${started})`);
    assert.equal(report.assets.length, 36, "35 listed stocks trading, plus the one without history");
    assert.ok(!report.assets.some((row) => ["T35", "T36", "T37", "T38", "T39"].includes(row.symbol)), "halted, delisted and prelaunch stocks are left out");
    for (const symbol of ["T10", "T11"]) assert.equal(report.assets.find((row) => row.symbol === symbol).rate, 0, `${symbol} is a rookie`);
    const fees = first.ledger.filter((row) => row.entry_type === "share_fee");
    assert.ok(fees.some((row) => Number(row.cash) < 0 && Number(row.credit) < 0), "a fee split between Credit and Cash");
    assert.ok(fees.some((row) => Number(row.cash) < 0 && Number(row.credit) === 0), "a fee all from Cash");
    assert.ok(first.balances.some((row) => Number(row.cash) < 0), "a fee took Cash below zero");
    const conversions = first.ledger.filter((row) => row.entry_type === "credit_conversion");
    assert.ok(conversions.some((row) => Number(row.cash) === 10000) && conversions.some((row) => Number(row.cash) < 10000), "the minimum, and small balances converted whole");
    const opened = first.ledger.filter((row) => row.entry_type === "starter_cash_grant");
    assert.deepEqual(opened.map((row) => Number(row.user_id)), [seeded.starterOnly], "the holder without an account got the starter balances");
    assert.ok(first.balances.some((row) => Number(row.user_id) === seeded.forcedOnly), "the forced buyback opened the other one's account");
    const delisted = first.buybacks.find((row) => Number(row.asset_id) === seeded.asset.T36);
    assert.equal(delisted.status, "active", "a delisted stock's buyback is left alone");

    // Between the two Saturdays, T01's channel shrinks, so its max drops again after the forced buyback.
    for (const pool of [oldPool, newPool]) {
      await pool.query(
        `UPDATE market.channel_daily_snapshots SET subscriber_count = 20000 WHERE youtube_channel_id = (SELECT youtube_channel_id FROM market.market_assets WHERE symbol = 'T01') AND snapshot_date = $1`,
        [day(DAYS - 1)]
      );
    }
    const oldSecond = await timed(oldPool, () => reference.runWeeklyEvaluation(oldPool, { evalDate: NEXT_SATURDAY, logger: quiet }));
    const newSecond = await timed(newPool, () => weekly.runWeeklyEvaluation(newPool, { evalDate: NEXT_SATURDAY, logger: quiet }));
    timings.push({ run: NEXT_SATURDAY, old: oldSecond, batched: newSecond });
    compareSnapshots(await snapshot(newPool), await snapshot(oldPool));
    const second = newSecond.result.report;
    const closed = Object.fromEntries(second.buybacks_closed.map((row) => [row.symbol, row.status]));
    assert.equal(closed.T00, "forced");
    assert.equal(closed.T01, "forced");
    assert.equal(second.assets.find((row) => row.symbol === "T01").buyback, "forced+started");
  });

  await t.test("a first evaluation (no max below what's held)", async () => {
    const oldFirst = new Pool({ connectionString: databaseNamed(names.oldFirst) });
    const newFirst = new Pool({ connectionString: databaseNamed(names.batchedFirst) });
    try {
      for (const pool of [oldFirst, newFirst]) {
        await pool.query(`DELETE FROM market.weekly_evaluations`);
        await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'manual_closed', trading_message = 'Launch prep'`);
      }
      await reference.runWeeklyEvaluation(oldFirst, { evalDate: SATURDAY, logger: quiet });
      const result = await weekly.runWeeklyEvaluation(newFirst, { evalDate: SATURDAY, logger: quiet });
      assert.equal(result.report.first_evaluation, true);
      assert.equal(result.trading_closed, false, "an admin's pause is left as it is");
      const snap = await snapshot(newFirst);
      compareSnapshots(snap, await snapshot(oldFirst));
      assert.equal(snap.trading, "manual_closed");
      const { rows } = await newFirst.query(`SELECT trading_message FROM market.market_runtime_state`);
      assert.equal(rows[0].trading_message, "Launch prep");
    } finally {
      await Promise.all([oldFirst.end(), newFirst.end()]);
    }
  });

  await t.test("a dry run works out the same review, writes nothing and takes no row locks", async () => {
    const evalDate = "2026-10-31";
    const before = await snapshot(newPool);
    // Someone is mid-fill on a stock and mid-bet on a wallet.
    const blocker = await newPool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT 1 FROM market.market_assets WHERE id = $1 FOR UPDATE`, [seeded.asset.T05]);
      await blocker.query(`SELECT 1 FROM market.portfolio_cash_balances WHERE user_id = $1 FOR UPDATE`, [seeded.users[0]]);
      const preview = await weekly.runWeeklyEvaluation(newPool, { evalDate, dryRun: true, logger: quiet });
      assert.equal(preview.dry_run, true);
      compareSnapshots(await snapshot(newPool), before);
      await blocker.query("ROLLBACK");
      const real = await weekly.runWeeklyEvaluation(newPool, { evalDate, logger: quiet });
      const strip = ({ generated_at: _ignored, ...rest }) => rest;
      assert.deepStrictEqual(strip(preview.report), strip(real.report));
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
    }
  });

  await t.test("trading is closed while it runs and reopens after; it waits for the stocks a fill holds", async () => {
    const evalDate = "2026-11-07";
    await newPool.query(`UPDATE market.market_runtime_state SET trading_message = 'Daily settlement completed. Trading is open.', last_cycle_error = 'fundamentals_timeout'`);
    const blocker = await newPool.connect();
    let running;
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT 1 FROM market.market_assets WHERE id = $1 FOR UPDATE`, [seeded.asset.T07]);
      running = weekly.runWeeklyEvaluation(newPool, { evalDate, logger: quiet });
      let status = null;
      for (let i = 0; i < 100 && status !== "settling"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        status = (await newPool.query(`SELECT trading_status FROM market.market_runtime_state`)).rows[0].trading_status;
      }
      assert.equal(status, "settling", "trading closes for the evaluation");
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { rows: waiting } = await newPool.query(`SELECT 1 FROM market.weekly_evaluations WHERE eval_date = $1 AND status = 'completed'`, [evalDate]);
      assert.equal(waiting.length, 0, "it waits for the fill holding a stock");
      await blocker.query("COMMIT");
      const result = await running;
      assert.equal(result.ok, true);
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
      await running?.catch(() => {});
    }
    const { rows } = await newPool.query(`SELECT trading_status, trading_message, last_cycle_error FROM market.market_runtime_state`);
    assert.deepEqual(rows[0], { trading_status: "open", trading_message: "Daily settlement completed. Trading is open.", last_cycle_error: "fundamentals_timeout" });
  });

  await t.test("it waits for a live-order batch that is filling, and skips while the daily settlement runs", async () => {
    const other = await newPool.connect();
    try {
      // A live-order batch is filling: trading stays open until it is done.
      await other.query(`SELECT pg_advisory_lock(9204003)`);
      const running = weekly.runWeeklyEvaluation(newPool, { evalDate: "2026-11-14", logger: quiet });
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal((await newPool.query(`SELECT trading_status FROM market.market_runtime_state`)).rows[0].trading_status, "open");
      await other.query(`SELECT pg_advisory_unlock(9204003)`);
      assert.equal((await running).ok, true);
      // The daily settlement holds the scheduler: the evaluation tries again on a later tick.
      await other.query(`SELECT pg_advisory_lock(9204001)`);
      const skipped = await weekly.runWeeklyEvaluation(newPool, { evalDate: "2026-11-21", logger: quiet });
      assert.deepEqual(skipped, { ok: false, skipped: "settlement_running" });
      assert.equal((await newPool.query(`SELECT 1 FROM market.weekly_evaluations WHERE eval_date = '2026-11-21'`)).rows.length, 0);
      await other.query(`SELECT pg_advisory_unlock(9204001)`);
      // Done already: it doesn't close trading for nothing.
      assert.deepEqual(await weekly.runWeeklyEvaluation(newPool, { evalDate: "2026-11-14", logger: quiet }), { ok: true, skipped: "already_completed", eval_date: "2026-11-14" });
    } finally {
      await other.query(`SELECT pg_advisory_unlock_all()`).catch(() => {});
      other.release();
    }
  });

  const line = ({ run, old, batched }) =>
    `${run}: row-at-a-time ${old.ms} ms / ${old.statements} statements; batched ${batched.ms} ms / ${batched.statements} statements (rows locked ${batched.result.timings_ms.rows_locked} ms)`;
  t.diagnostic(`${PLAYERS} players, ${(await newPool.query(`SELECT COUNT(*)::int AS n FROM market.portfolio_holdings`)).rows[0].n} holdings`);
  for (const timing of timings) t.diagnostic(line(timing));
});
