const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const autoBailout = require("../src/services/autoBailout");
const economy = require("../src/services/economy");
const fundamentals = require("../src/services/fundamentals");
const pgNumeric = require("../src/services/pgNumeric");
const settlement = require("../src/services/settlement");
const sideModeFloor = require("../src/services/sideModeFloor");
const trading = require("../src/services/trading");
const weekly = require("../src/services/weeklyEvaluation");

// The Saturday review's auto-bailout (services/autoBailout.js). The pure parts run anywhere. The rest
// needs CHAT_TEST_DATABASE_URL (a local server): one market is seeded once and cloned, and each clone
// runs a real evaluation: one that pays, one with nobody eligible to compare it against, one on demand.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const quiet = { log() {}, warn() {}, error() {} };

const SATURDAY = "2026-10-17";
const NEXT_SATURDAY = "2026-10-24";
const THIRD_SATURDAY = "2026-10-31";

// ── Pure ──────────────────────────────────────────────────────────────────
const stock = (id, mid, extra = {}) => ({
  id: String(id),
  symbol: `S${id}`,
  display_name: `Stock ${id}`,
  max_supply: "30000",
  circulating_supply: "0",
  treasury_supply: "30000",
  broker_buffer_pct: "0.02",
  trading_state: "open",
  current_mid_price: String(mid),
  current_fair_value: String(mid),
  spread_bps: "400",
  liquidity_depth: "2000",
  ...extra,
});
/** Exact wallets from plain numbers: Map player → { cash, credit, held }. */
const walletsOf = (entries) => new Map(Object.entries(entries).map(([id, wallet]) => [Number(id), { cash: pgNumeric.parse(wallet.cash ?? 0), credit: pgNumeric.parse(wallet.credit ?? 0), held: pgNumeric.parse(wallet.held ?? 0) }]));
const COST = trading.oneShareCost(stock(1, 5));
const bailouts = ({ wallets, holdings = new Map(), stocks = [stock(1, 5)], players, ...rest }) =>
  autoBailout.planBailouts({
    evalDate: SATURDAY,
    players: players ?? new Set(Object.keys(wallets).map(Number)),
    wallets: walletsOf(wallets),
    holdings,
    stocks,
    ...rest,
  });

test("one share's cost is the ask, slippage and the fee", () => {
  assert.ok(Math.abs(COST - 5 * 1.02 * (1 + 0.5 / 2000) * 1.01) < 1e-9, `${COST}`);
});

test("the cheapest share only counts stocks a player could actually buy", () => {
  const cost = (stocks) => autoBailout.cheapestShareCost(stocks);
  const frozen = stock(1, 1, { trading_state: "buyback" });
  const soldOut = stock(2, 2, { treasury_supply: "600" }); // all of it the broker's 2% buffer
  const noFairValue = stock(3, 3, { current_fair_value: "0" });
  const noPrice = stock(4, 3, { current_mid_price: null });
  assert.equal(cost([frozen, soldOut, noFairValue, noPrice]), null, "nothing can be bought");
  assert.equal(cost([frozen, soldOut, noFairValue, noPrice, stock(5, 5), stock(6, 9)]), COST);
});

test("bricked means shares, Cash and Credit are each under one share", () => {
  const under = COST - 0.01;
  const base = { sharesValue: 0, cash: 0, held: 0, credit: 0 };
  assert.equal(autoBailout.isBricked(base, COST), true);
  assert.equal(autoBailout.isBricked({ ...base, cash: under, sharesValue: under, credit: under }, COST), true, "a little of each");
  assert.equal(autoBailout.isBricked({ ...base, cash: COST }, COST), false, "Cash buys one");
  assert.equal(autoBailout.isBricked({ ...base, held: COST }, COST), false, "held money counts");
  assert.equal(autoBailout.isBricked({ ...base, cash: -2, held: COST }, COST), true, "Cash and held are one balance");
  assert.equal(autoBailout.isBricked({ ...base, sharesValue: COST }, COST), false, "a share's worth of stock");
  assert.equal(autoBailout.isBricked({ ...base, credit: COST }, COST), false, "Credit that's left keeps converting");
  assert.equal(autoBailout.isBricked({ ...base, cash: -5000, credit: -5000 }, COST), true, "debts are still bricked");
  assert.equal(autoBailout.isBricked({ ...base, cash: -50000, credit: 40000 }, COST), false, "a Cash debt with Credit left waits for the conversion");
});

test("a bailout puts Cash at the amount and adds the Credit", () => {
  const { paid, summary } = bailouts({
    wallets: {
      1: {},
      2: { cash: 1.5 },
      3: { cash: -300.25 },
      4: { credit: -5000 },
      5: { cash: "-12.345678901234567891" },
      6: { cash: COST }, // not this one
    },
  });
  const amounts = Object.fromEntries(paid.map((row) => [row.userId, [row.cash, row.credit]]));
  assert.deepEqual(amounts, { 1: [1000, 1000], 2: [998.5, 1000], 3: [1300.25, 1000], 4: [1000, 1000], 5: [1012.35, 1000] });
  assert.deepEqual(summary, { qualified: 5, players: 5, cash: 5311.1, credit: 5000, debt_cleared: 312.6, cheapest_share: 5.15 });
});

test("the notification says what happened and points at the market", () => {
  const { paid } = bailouts({ wallets: { 1: {}, 2: { cash: -300 }, 3: { credit: -5000 } } });
  const [plain, debt, margin] = paid.map((row) => row.notice);
  assert.deepEqual([plain.userId, plain.kind, plain.href], [1, "dividend", "/market"]);
  assert.equal(plain.title, "Back in the game: $1,000.00 Cash and $1,000.00 Credit");
  assert.equal(plain.body, "You had no shares and not enough to buy one, so Saturday's review gave you $1,000.00 Cash and $1,000.00 Credit. Pick a stock and get back in.");
  assert.deepEqual(plain.data, { eval_date: SATURDAY, cash: 1000, credit: 1000 });
  assert.equal(debt.title, "Back in the game: $1,300.00 Cash and $1,000.00 Credit");
  assert.match(debt.body, /That clears the \$300\.00 your Cash was below zero\./);
  assert.match(margin.body, /The Credit goes toward what you owe\./);
  assert.ok(![plain, debt, margin].some((notice) => notice.body.length > 300), "notifications are clipped at 300");
});

test("a bailout always leaves enough for a share, whatever the setting", () => {
  const { paid } = bailouts({ wallets: { 1: {} }, stocks: [stock(1, 900)], settings: { bailoutCash: 1000, bailoutCredit: 1000 } });
  const cost = trading.oneShareCost(stock(1, 900));
  assert.ok(cost > 900 && cost < 1000);
  assert.equal(paid[0].cash, Math.ceil(cost * 2), "$1,000 would be too close to the price of one");
});

test("nothing happens when nothing can be bought", () => {
  const none = bailouts({ wallets: { 1: {} }, stocks: [stock(1, 5, { trading_state: "buyback" })] });
  assert.deepEqual(none, { summary: { qualified: 0, players: 0, cash: 0, credit: 0, debt_cleared: 0, cheapest_share: null }, paid: [] });
});

test("an on-demand run pays nobody and still counts; only eligible players with a wallet can qualify", () => {
  const count = (result) => [result.summary.qualified, result.summary.players, result.paid.map((row) => row.userId)];
  const players = new Set([1, 2]);
  assert.deepEqual(count(bailouts({ wallets: { 1: {}, 2: {} }, players })), [2, 2, [1, 2]]);
  assert.deepEqual(count(bailouts({ wallets: { 1: {}, 2: {} }, players, onDemand: true })), [2, 0, []]);
  assert.deepEqual(count(bailouts({ wallets: { 2: {} }, players })), [1, 1, [2]], "no wallet: it opens with the starter balances");
  assert.deepEqual(count(bailouts({ wallets: { 1: {}, 2: {}, 3: {} }, players })), [2, 2, [1, 2]], "player 3 isn't eligible");
});

test("shares only count at what they're worth, in stocks that trade", () => {
  const holds = (quantity) => new Map([["1", new Map([[1, pgNumeric.parse(quantity)]])]]);
  assert.equal(bailouts({ wallets: { 1: {} }, holdings: holds("0.01") }).paid.length, 1, "a leftover fraction is no shares");
  assert.equal(bailouts({ wallets: { 1: {} }, holdings: holds("2") }).paid.length, 0, "two whole shares are");
  const elsewhere = new Map([["99", new Map([[1, pgNumeric.parse("1000")]])]]);
  assert.equal(bailouts({ wallets: { 1: {} }, holdings: elsewhere }).paid.length, 1, "a stock outside the review (halted, delisted) can't be sold");
});

test("the default amounts leave a bailed-out player far under the side-mode floor", () => {
  const { bailoutCash, bailoutCredit, sideModeMinNetWorth } = economy.SETTINGS;
  assert.ok(bailoutCash > 0 && bailoutCredit > 0);
  assert.ok(bailoutCash + bailoutCredit + COST * 3 < sideModeMinNetWorth / 10, "shares, Cash and Credit were each under a share");
});

/** Ten stocks at $10, the first with the worst week and the last with the best. */
const ratedStocks = () =>
  Array.from({ length: 10 }, (_, i) => ({
    ...stock(i + 1, 10),
    subscriber_count: String(100000 * (i + 1)),
    day_open: "10",
    value_now: String(100 * (1 + (i - 5) / 1000)),
    value_before: "100",
    avg_base: "10",
    last_revealed_base: "10",
    rookie: false,
  }));
const planReview = ({ wallets, holdings = new Map(), onDemand = false }) =>
  weekly.planEvaluation({ evalDate: SATURDAY, evaluationId: 1, firstEvaluation: false, onDemand, assets: ratedStocks(), activeBuybacks: [], holdings, wallets: walletsOf(wallets), bailoutPlayers: new Set(Object.keys(wallets).map(Number)) });

test("it's worked out after the review's fees and conversion", () => {
  const cost = trading.oneShareCost(stock(1, 10));
  const justEnough = cost + 0.01;
  // Half a share of the worst stock (worth less than a share either way), and just enough Cash: its fee is what bricks them.
  const holdings = new Map([["1", new Map([[1, pgNumeric.parse("0.5")]])]]);
  const fee = planReview({ wallets: { 1: { cash: justEnough } }, holdings });
  const bailout = (plan, userId) => plan.writes.moves.find((row) => row.userId === userId && row.entryType === "weekly_bailout");
  assert.ok(fee.writes.moves.some((row) => row.userId === 1 && row.entryType === "share_fee"), "the fee was charged");
  assert.ok(bailout(fee, 1), "the fee left them short of a share");
  assert.equal(bailout(fee, 1).referenceType, "weekly_evaluation");
  assert.equal(bailout(fee, 1).referenceId, 1);
  assert.equal(planReview({ wallets: { 1: { cash: justEnough } } }).report.auto_bailout.qualified, 0, "without the fee they could still buy one");

  // Credit that just became Cash isn't bricked, and neither is Credit that's left.
  const converted = planReview({ wallets: { 2: { credit: 5000 }, 3: { credit: 1 }, 4: { cash: -30000, credit: 50000 }, 5: { cash: -20000, credit: 10003 } } });
  const moves = (userId) => converted.writes.moves.filter((row) => row.userId === userId).map((row) => row.entryType);
  assert.deepEqual(moves(2), ["credit_conversion"], "$5,000 became Cash: enough for a share");
  assert.deepEqual(moves(3), ["credit_conversion", "weekly_bailout"], "$1 became Cash: still not enough");
  assert.deepEqual(moves(4), ["credit_conversion"], "$40,000 is still to convert");
  assert.deepEqual(moves(5), ["credit_conversion", "weekly_bailout"], "$3 of Credit left isn't a share");
  assert.equal(bailout(converted, 5).cash, 11000, "Cash was −$10,000 after the conversion");
  assert.equal(converted.report.auto_bailout.debt_cleared, 10000);
  // The report and the notices carry it.
  assert.deepEqual([converted.report.auto_bailout.qualified, converted.report.auto_bailout.players], [2, 2]);
  assert.deepEqual(converted.notices.map((row) => row.userId).sort(), [3, 5]);
});

// ── With a database ───────────────────────────────────────────────────────
function databaseNamed(name) {
  const target = new URL(databaseUrl);
  target.pathname = `/${name}`;
  return target.href;
}

async function withAdmin(work) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname), "a local test server only");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
}

const silently = async (work) => {
  const saved = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    return await work();
  } finally {
    [console.log, console.warn] = saved;
  }
};

/**
 * Twelve stocks with sixteen days of real history, one halted, one frozen for a buyback that closes on
 * Saturday, then a player for every case. Returns who's who: `qualify` names the ones who qualify.
 */
async function seedMarket(pool) {
  const DAYS = 16;
  const day = (i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  const stats = [];
  for (let i = 0; i < 12; i += 1) {
    const id = `UCbailout${String(i).padStart(15, "0")}`;
    const symbol = `B${String(i).padStart(2, "0")}`;
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1,$2,$2,$3,true)`, [id, `Talent ${symbol}`, symbol]);
    await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps) VALUES ($1,$2,$3,'active',30000,0,30000,2000,400)`,
      [id, symbol, `Talent ${symbol}`]
    );
    const growth = -0.004 + 0.0015 * i;
    for (let d = 0; d < DAYS; d += 1) stats.push({ time: `${day(d)}T16:00:00Z`, id, subs: Math.round(500_000 * (1 + growth) ** d), views: Math.round(5e7 * (1 + growth * 2) ** d), videos: 300 + d });
  }
  await pool.query(
    `INSERT INTO yt.youtube_channel_daily_stats (time, youtube_channel_id, subscriber_count, view_count, video_count)
     SELECT s.time, s.id, s.subs, s.views, s.videos FROM jsonb_to_recordset($1::jsonb) AS s(time timestamptz, id text, subs bigint, views bigint, videos bigint)`,
    [JSON.stringify(stats)]
  );
  await silently(async () => {
    await fundamentals.recalculateFundamentals(pool, { from: day(0), to: day(DAYS - 1), activeOnly: true, fillMissingDates: true });
    await settlement.settleMarketRange(pool, { from: day(0), to: day(DAYS - 1) });
  });
  await pool.query(`INSERT INTO market.adjustment_sessions (market_date, status) SELECT d::date, 'completed' FROM generate_series($1::date, $2::date, '1 day') d ON CONFLICT DO NOTHING`, [day(0), day(DAYS - 1)]);
  await pool.query(`INSERT INTO market.weekly_evaluations (eval_date, status, completed_at, report_json) VALUES ('2026-10-10', 'completed', now(), '{}')`);
  // Known prices: B05 is the cheapest stock at $5 (the ranking reads the settled days, not these).
  await pool.query(`UPDATE market.market_assets SET current_fair_value = 12, current_mid_price = 12`);
  await pool.query(`UPDATE market.market_assets SET current_fair_value = 5, current_mid_price = 5 WHERE symbol = 'B05'`);
  await pool.query(`UPDATE market.market_assets SET status = 'halted' WHERE symbol = 'B10'`);
  const { rows: assetRows } = await pool.query(`SELECT id, symbol FROM market.market_assets ORDER BY symbol`);
  const asset = Object.fromEntries(assetRows.map((row) => [row.symbol, Number(row.id)]));

  // B11's buyback closes on Saturday, forcing nearly all of a holder's shares out for Cash.
  await pool.query(`UPDATE market.market_assets SET circulating_supply = 100, treasury_supply = 0, max_supply = 0.01, trading_state = 'buyback' WHERE symbol = 'B11'`);
  await pool.query(
    `INSERT INTO market.asset_buybacks (asset_id, started_evaluation_id, frozen_price, target_max_supply, held_at_start, shares_bought, cash_paid, started_at) VALUES ($1, NULL, 12, 0.01, 100, 0, 0, now() - interval '3 days')`,
    [asset.B11]
  );

  const user = async (name, { cash = 0, credit = 0, held = 0, wallet = true, verified = true, admin = false, activeOn = "2026-10-15", suspended = false, shares = null } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, is_admin, password_hash, password_salt, password_params_json, suspended_at, suspended_until, suspension_reason)
       VALUES ($1, lower($1), lower($1) || '@example.test', $2, $3, 'x', 'x', '{}', $4, NULL, $5) RETURNING id`,
      [name, verified, admin, suspended ? new Date(0) : null, suspended ? "test" : null]
    );
    const id = Number(rows[0].id);
    if (wallet) await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance, held_cash) VALUES ($1, $2, $3, $4)`, [id, cash, credit, held]);
    if (activeOn) await pool.query(`INSERT INTO market.user_active_days (user_id, day) VALUES ($1, $2)`, [id, activeOn]);
    for (const [symbol, quantity] of Object.entries(shares || {})) {
      await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, $3, 10)`, [id, asset[symbol], quantity]);
    }
    return id;
  };

  const players = {
    // Bricked.
    broke: await user("broke"),
    pennies: await user("pennies", { cash: 1 }),
    lastCredit: await user("lastcredit", { credit: 3 }), // it converts, and $3 still isn't a share
    feeDebt: await user("feedebt", { cash: -300 }),
    margin: await user("margin", { credit: -5000 }),
    dust: await user("dust", { shares: { B00: "0.01" } }),
    haltedOnly: await user("haltedonly", { shares: { B10: "100" } }),
    bigDebtLittleCredit: await user("bigdebt", { cash: -20000, credit: 10003 }), // −$10,000 and $3 after the conversion
    theAdmin: await user("theadmin", { admin: true }), // like anyone else
    visitedAtTheEdge: await user("edge", { activeOn: "2026-10-04" }), // 13 days before
    // Not bricked.
    converted: await user("converted", { credit: 5000 }),
    creditLeft: await user("creditleft", { cash: -30000, credit: 50000 }),
    canAfford: await user("canafford", { cash: 6 }),
    queuedBuy: await user("queuedbuy", { held: 50 }),
    shareholder: await user("shareholder", { shares: { B01: "10" } }),
    forcedOut: await user("forcedout", { shares: { B11: "100" } }), // a forced buyback pays them Cash
    rich: await user("rich", { cash: 10000, credit: 100000 }),
    // Bricked, but not eligible.
    unverified: await user("unverified", { verified: false }),
    suspended: await user("suspended", { suspended: true }),
    stale: await user("stale", { activeOn: "2026-10-03" }), // 14 days before
    neverSeen: await user("neverseen", { activeOn: null }),
    noWallet: await user("nowallet", { wallet: false }),
  };
  const qualify = ["broke", "pennies", "lastCredit", "feeDebt", "margin", "dust", "haltedOnly", "bigDebtLittleCredit", "theAdmin", "visitedAtTheEdge"];
  return { asset, players, qualify };
}

async function snapshot(pool) {
  const q = async (sql) => (await pool.query(sql)).rows;
  return {
    balances: await q(`SELECT user_id, cash_balance::text AS cash, credit_balance::text AS credit, held_cash::text AS held FROM market.portfolio_cash_balances ORDER BY user_id`),
    ledger: await q(`SELECT user_id, asset_id, entry_type, quantity_delta::text AS quantity, cash_delta::text AS cash, credit_delta::text AS credit, reference_type, reference_id FROM market.ledger_entries ORDER BY user_id, asset_id NULLS FIRST, entry_type, reference_id, quantity_delta, cash_delta, credit_delta`),
    holdings: await q(`SELECT user_id, asset_id, quantity::text AS quantity FROM market.portfolio_holdings ORDER BY user_id, asset_id`),
    notifications: await q(`SELECT user_id, kind, title, body, href, data FROM market.notifications ORDER BY user_id, kind, title, body`),
    evaluations: await q(`SELECT eval_date::text AS eval_date, status FROM market.weekly_evaluations ORDER BY eval_date`),
  };
}

const money = (rows, userId) => {
  const row = rows.find((entry) => Number(entry.user_id) === userId);
  return row ? { cash: Number(row.cash), credit: Number(row.credit) } : null;
};

test("the review pays once, and only the players who qualify", { skip: !databaseUrl, timeout: 300_000 }, async (t) => {
  const names = { seed: "nasfaq_bailout_seed", paid: "nasfaq_bailout_paid", nobody: "nasfaq_bailout_nobody", onDemand: "nasfaq_bailout_on_demand" };
  await withAdmin(async (admin) => {
    for (const name of Object.values(names)) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${names.seed}`);
  });
  const options = "-c timezone=UTC";
  const seedPool = new Pool({ connectionString: databaseNamed(names.seed), options });
  let seeded;
  try {
    await silently(() => applySchema(seedPool));
    seeded = await seedMarket(seedPool);
  } finally {
    await seedPool.end();
  }
  await withAdmin(async (admin) => {
    for (const name of [names.paid, names.nobody, names.onDemand]) await admin.query(`CREATE DATABASE ${name} TEMPLATE ${names.seed}`);
  });
  const pools = { paid: new Pool({ connectionString: databaseNamed(names.paid), options }), nobody: new Pool({ connectionString: databaseNamed(names.nobody), options }), onDemand: new Pool({ connectionString: databaseNamed(names.onDemand), options }) };
  t.after(async () => {
    await require("../src/services/achievements").tradeFillsIdle();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await Promise.all(Object.values(pools).map((pool) => pool.end()));
  });
  const { players, qualify, asset } = seeded;
  const qualifying = new Set(qualify.map((name) => players[name]));
  const review = (pool, options = {}) => weekly.runWeeklyEvaluation(pool, { evalDate: SATURDAY, closeTrading: false, logger: quiet, ...options });

  // The same review with nobody eligible (nobody has been on the site): what the others are compared against.
  await pools.nobody.query(`DELETE FROM market.user_active_days`);
  const nobodyResult = await review(pools.nobody);
  const baseline = await snapshot(pools.nobody);
  const withoutBailouts = (rows) => rows.filter((row) => row.entry_type !== autoBailout.ENTRY_TYPE);

  await t.test("with nobody eligible nothing is paid", () => {
    assert.deepEqual(nobodyResult.report.auto_bailout.qualified, 0);
    assert.deepEqual(nobodyResult.report.auto_bailout.players, 0);
    assert.equal(baseline.ledger.filter((row) => row.entry_type === autoBailout.ENTRY_TYPE).length, 0);
  });

  await t.test("who's eligible, and the setting that turns it off", async () => {
    const eligible = await autoBailout.loadPlayers(pools.paid, SATURDAY);
    for (const name of [...qualify, "converted", "rich", "noWallet"]) assert.ok(eligible.has(players[name]), `${name} is eligible`);
    for (const name of ["unverified", "suspended", "stale", "neverSeen"]) assert.ok(!eligible.has(players[name]), `${name} isn't`);
    assert.equal((await autoBailout.loadPlayers(pools.paid, SATURDAY, { activeDays: 0 })).size, 0);
  });

  let paidState;
  await t.test("a preview writes nothing and reports what the real run does", async () => {
    const before = await snapshot(pools.paid);
    const preview = await review(pools.paid, { dryRun: true });
    assert.deepEqual(await snapshot(pools.paid), before);
    assert.equal(preview.report.auto_bailout.qualified, qualify.length);
    assert.equal(preview.report.auto_bailout.players, qualify.length);
    const real = await review(pools.paid);
    paidState = await snapshot(pools.paid);
    const strip = ({ generated_at: _ignored, ...rest }) => rest;
    assert.deepStrictEqual(strip(preview.report), strip(real.report));
    const stored = await pools.paid.query(`SELECT report_json->'auto_bailout' AS block FROM market.weekly_evaluations WHERE eval_date = $1`, [SATURDAY]);
    assert.deepEqual(stored.rows[0].block, real.report.auto_bailout, "it's in the stored review");
    // The review is public, so its block holds totals and nothing about who.
    assert.deepEqual(Object.keys(real.report.auto_bailout).sort(), ["cash", "cheapest_share", "credit", "debt_cleared", "players", "qualified"]);
  });

  await t.test("each case lands where it should", () => {
    const after = (name) => money(paidState.balances, players[name]);
    const was = (name) => money(baseline.balances, players[name]);
    // A bailout sets Cash to $1,000 and adds $1,000 to Credit, on top of what the review did.
    assert.deepEqual(after("broke"), { cash: 1000, credit: 1000 });
    assert.deepEqual(after("pennies"), { cash: 1000, credit: 1000 });
    assert.deepEqual(after("lastCredit"), { cash: 1000, credit: 1000 });
    assert.deepEqual(after("feeDebt"), { cash: 1000, credit: 1000 });
    assert.deepEqual(after("margin"), { cash: 1000, credit: -4000 }, "margin debt is paid down, not forgiven");
    assert.deepEqual(after("bigDebtLittleCredit"), { cash: 1000, credit: 1003 });
    assert.deepEqual(after("haltedOnly"), { cash: 1000, credit: 1000 });
    assert.deepEqual(after("theAdmin"), { cash: 1000, credit: 1000 });
    assert.deepEqual(after("visitedAtTheEdge"), { cash: 1000, credit: 1000 });
    assert.equal(after("dust").cash, 1000, "a fee or dividend on a fraction moves cents at most");
    assert.ok(Math.abs(after("dust").credit - 1000) < 1);

    // Everyone else comes out exactly as they would with nobody paid.
    for (const name of ["converted", "creditLeft", "canAfford", "queuedBuy", "shareholder", "forcedOut", "rich", "unverified", "suspended", "stale", "neverSeen"]) {
      assert.deepEqual(after(name), was(name), name);
    }
    assert.deepEqual(after("converted"), { cash: 5000, credit: 0 }, "Credit that just became Cash isn't paid");
    assert.deepEqual(after("creditLeft"), { cash: -20000, credit: 40000 }, "Credit left keeps converting");
    const forcedShares = paidState.holdings.find((row) => Number(row.user_id) === players.forcedOut);
    assert.ok(Number(forcedShares.quantity) * 12 < 5, "only a fraction of a share is left");
    assert.ok(after("forcedOut").cash > 5.2, "so what keeps them out is the forced buyback's Cash");
    assert.equal(after("noWallet"), null, "no wallet was opened for the account that doesn't have one");
  });

  await t.test("nobody else's money moves, and the rest of the review is untouched", () => {
    const paidIds = new Set(paidState.ledger.filter((row) => row.entry_type === autoBailout.ENTRY_TYPE).map((row) => Number(row.user_id)));
    assert.deepEqual([...paidIds].sort((a, b) => a - b), [...qualifying].sort((a, b) => a - b));
    assert.deepEqual(withoutBailouts(paidState.ledger), withoutBailouts(baseline.ledger), "every other ledger row is the same");
    assert.deepEqual(paidState.holdings, baseline.holdings);
    assert.equal(paidState.balances.length, baseline.balances.length);
    for (const row of paidState.balances) {
      if (qualifying.has(Number(row.user_id))) continue;
      assert.deepEqual(row, baseline.balances.find((other) => other.user_id === row.user_id));
    }
    assert.deepEqual(paidState.notifications.filter((row) => !qualifying.has(Number(row.user_id))), baseline.notifications.filter((row) => !qualifying.has(Number(row.user_id))));
    // And each payment matches its one ledger row to the digit.
    for (const userId of qualifying) {
      const rows = paidState.ledger.filter((row) => Number(row.user_id) === userId && row.entry_type === autoBailout.ENTRY_TYPE);
      assert.equal(rows.length, 1, "one row a player");
      assert.equal(rows[0].reference_type, "weekly_evaluation");
      assert.equal(rows[0].asset_id, null);
      const was = baseline.balances.find((row) => Number(row.user_id) === userId);
      const now = paidState.balances.find((row) => Number(row.user_id) === userId);
      assert.equal(pgNumeric.compare(pgNumeric.parse(now.cash), pgNumeric.add(pgNumeric.parse(was.cash), pgNumeric.parse(rows[0].cash))), 0, "Cash");
      assert.equal(pgNumeric.compare(pgNumeric.parse(now.credit), pgNumeric.add(pgNumeric.parse(was.credit), pgNumeric.parse(rows[0].credit))), 0, "Credit");
    }
  });

  await t.test("players hear about it, once", () => {
    const notices = paidState.notifications.filter((row) => row.title.startsWith("Back in the game"));
    assert.deepEqual(notices.map((row) => Number(row.user_id)).sort((a, b) => a - b), [...qualifying].sort((a, b) => a - b));
    const notice = notices.find((row) => Number(row.user_id) === players.feeDebt);
    assert.equal(notice.title, "Back in the game: $1,300.00 Cash and $1,000.00 Credit");
    assert.equal(notice.href, "/market");
    assert.equal(notice.kind, "dividend");
    assert.match(notice.body, /That clears the \$300\.00 your Cash was below zero\./);
  });

  await t.test("a rerun of the same date pays nothing", async () => {
    const again = await review(pools.paid);
    assert.deepEqual(again, { ok: true, skipped: "already_completed", eval_date: SATURDAY });
    assert.deepEqual(await snapshot(pools.paid), paidState);
    const preview = await review(pools.paid, { dryRun: true });
    assert.equal(preview.skipped, "already_completed", "and a preview of it does nothing either");
  });

  await t.test("a bailed-out player can really buy, and the games stay closed", async () => {
    await pools.paid.query(`UPDATE market.market_runtime_state SET trading_status = 'open'`);
    const buyers = ["broke", "feeDebt", "margin", "bigDebtLittleCredit"];
    for (const name of buyers) {
      const order = await trading.submitLiveOrder(pools.paid, { userId: players[name], symbol: "B05", side: "buy", quantity: 1 });
      assert.equal(order.status, "pending", name);
    }
    await trading.processDueLiveOrders(pools.paid, { now: new Date(Date.now() + 15 * 60_000) });
    for (const name of buyers) {
      const { rows } = await pools.paid.query(`SELECT quantity::float AS quantity FROM market.portfolio_holdings WHERE user_id = $1 AND asset_id = $2`, [players[name], asset.B05]);
      assert.equal(rows[0]?.quantity, 1, `${name} holds the share`);
    }
    // The floor still stands: the money can only go to the market.
    await assert.rejects(sideModeFloor.assertAboveFloor(pools.paid, players.broke), { code: "net_worth_floor" });
    await assert.rejects(sideModeFloor.assertAboveFloor(pools.paid, players.margin), { code: "net_worth_floor" });
  });

  await t.test("next Saturday nobody who still has the money is paid again; running out again pays again", async () => {
    const before = await pools.paid.query(`SELECT COUNT(*)::int AS n FROM market.ledger_entries WHERE entry_type = $1`, [autoBailout.ENTRY_TYPE]);
    await pools.paid.query(`INSERT INTO market.user_active_days (user_id, day) SELECT unnest($1::bigint[]), '2026-10-22'`, [[...qualifying]]);
    const next = await review(pools.paid, { evalDate: NEXT_SATURDAY });
    assert.equal(next.report.auto_bailout.players, 0);
    const after = await pools.paid.query(`SELECT COUNT(*)::int AS n FROM market.ledger_entries WHERE entry_type = $1`, [autoBailout.ENTRY_TYPE]);
    assert.equal(after.rows[0].n, before.rows[0].n);
    // Their $1,000 of bailout Credit came through as Cash.
    assert.equal(money((await snapshot(pools.paid)).balances, players.pennies).credit, 0);
    assert.equal(money((await snapshot(pools.paid)).balances, players.pennies).cash, 2000);

    // One of them loses it all somehow. There's no cooldown, so the next review pays them again. And
    // an account that had gone quiet qualifies once it comes back.
    await pools.paid.query(`UPDATE market.portfolio_cash_balances SET cash_balance = 0, credit_balance = 0 WHERE user_id = $1`, [players.pennies]);
    await pools.paid.query(`INSERT INTO market.user_active_days (user_id, day) SELECT unnest($1::bigint[]), '2026-10-30'`, [[players.pennies, players.stale]]);
    const third = await review(pools.paid, { evalDate: THIRD_SATURDAY });
    assert.equal(third.report.auto_bailout.players, 2);
    const balances = (await snapshot(pools.paid)).balances;
    assert.deepEqual(money(balances, players.pennies), { cash: 1000, credit: 1000 });
    assert.deepEqual(money(balances, players.stale), { cash: 1000, credit: 1000 });
  });

  await t.test("an on-demand run pays nobody and says who would qualify", async () => {
    const result = await review(pools.onDemand, { onDemand: true });
    const state = await snapshot(pools.onDemand);
    assert.equal(result.report.on_demand, true);
    assert.equal(result.report.auto_bailout.qualified, qualify.length);
    assert.equal(result.report.auto_bailout.players, 0);
    assert.equal(result.report.auto_bailout.cash, 0);
    assert.equal(state.ledger.filter((row) => row.entry_type === autoBailout.ENTRY_TYPE).length, 0);
    assert.deepEqual(state.balances, baseline.balances);
    assert.equal(state.notifications.filter((row) => row.title.startsWith("Back in the game")).length, 0);
  });

  await t.test("it runs with trading paused like any other review", async () => {
    await pools.onDemand.query(`UPDATE market.market_runtime_state SET trading_status = 'open'`);
    const result = await weekly.runWeeklyEvaluation(pools.onDemand, { evalDate: NEXT_SATURDAY, logger: quiet });
    assert.equal(result.ok, true);
    assert.equal(result.trading_closed, true);
    assert.ok(result.report.auto_bailout.players > 0, "the next real review pays them");
    assert.equal((await pools.onDemand.query(`SELECT trading_status FROM market.market_runtime_state`)).rows[0].trading_status, "open");
  });

  await withAdmin(async (admin) => admin.query(`DROP DATABASE IF EXISTS ${names.seed} WITH (FORCE)`));
});
