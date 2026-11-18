const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Pool } = require("pg");

// No share limit here: the fee is what's being tested, not the allowance.
process.env.MARKET_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL = "100000000";

const features = require("../src/features");
const marketPackage = require("../src/services/marketPackage");
const fairValueGrowth = require("../src/services/fairValueGrowth");
const targetNudge = require("../src/services/targetNudge");
const weekly = require("../src/services/weeklyEvaluation");
const pgNumeric = require("../src/services/pgNumeric");

// The market package (services/marketPackage.js), behind the market-wide market-package flag: the
// fee only on shares sold within a day of buying them, fair-value growth, the holder dividend at the
// weekly review and the 1.5% spread. The pure parts run anywhere; the rest needs
// CHAT_TEST_DATABASE_URL (a local server) and makes its own databases.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-18T15:00:00Z");
const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString();
const close = (actual, expected, message, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

// ── The switch ────────────────────────────────────────────────────────────

test("the package is one market-wide switch, never staff", (t) => {
  const flag = features.list().find((row) => row.key === "market-package");
  assert.ok(flag, "there is a market-package flag file");
  assert.ok(["off", "on"].includes(flag.state));
  assert.equal(flag.market, true);
  t.after(features.override({ "market-package": "off" }));
  assert.equal(marketPackage.isOn(), false);
  assert.throws(() => features.override({ "market-package": "staff" }), /never "staff"/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "market-flag-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "some-market.json"), JSON.stringify({ state: "staff", market: true, description: "x" }));
  assert.throws(() => features.readFlags(dir), /never "staff"/);
  fs.writeFileSync(path.join(dir, "some-market.json"), JSON.stringify({ state: "on", market: true, description: "x" }));
  assert.equal(features.readFlags(dir).get("some-market").market, true);

  // On, it's on for everyone (and for jobs with no user), and the listing spread follows.
  const restore = features.override({ "market-package": "on" });
  try {
    assert.equal(marketPackage.isOn(), true);
    assert.equal(features.isEnabled("market-package", null), true);
    assert.equal(features.isEnabled("market-package", { is_admin: false }), true);
    assert.equal(marketPackage.listingSpreadBps(), 150);
    assert.equal(marketPackage.growthPerDay(), 0.0005);
    assert.equal(marketPackage.holderDividendRate(), 0.0025);
    assert.deepEqual(marketPackage.publicFeeRule(0.01), { fee_rate: 0.01, fee_on: "quick_sells", quick_sell_hours: 24 });
  } finally {
    restore();
  }
  assert.equal(marketPackage.listingSpreadBps(), 400);
  assert.equal(marketPackage.growthPerDay(), 0);
  assert.equal(marketPackage.holderDividendRate(), 0);
  assert.deepEqual(marketPackage.publicFeeRule(0.01), { fee_rate: 0.01, fee_on: "all_trades", quick_sell_hours: null });
});

// ── The fee: which shares are recent ─────────────────────────────────────

test("fee: a sale takes the newest shares first; shares bought over a day ago are fee-free", () => {
  // 20 shares from before the window (no fills in it), then 10 bought 2 hours ago.
  const fills = [
    { side: "buy", quantity: 5, ts: at(30) }, // outside the window: an old share like the rest
    { side: "buy", quantity: 10, ts: at(2) },
  ];
  const lots = marketPackage.recentLots(fills, NOW);
  assert.deepEqual(lots.map((lot) => lot.quantity), [10]);
  assert.equal(marketPackage.recentShares(lots, 35), 10);
  assert.equal(marketPackage.feeFreeAt(lots, 35), new Date(Date.parse(at(2)) + 24 * HOUR).toISOString());

  // Mixed: a sale of 15 out of 35 pays the fee on the 10 recent ones only.
  assert.equal(marketPackage.feeSharesForSale(lots, 35, 15), 10);
  assert.equal(marketPackage.feeSharesForSale(lots, 35, 4), 4, "a small sale is all recent shares");
  const mixed = marketPackage.fillFee({ side: "sell", price: 12, quantity: 15, feeRate: 0.01, lots, held: 35, on: true });
  close(mixed.feeCash, 12 * 10 * 0.01, "fee on the 10 recent shares");
  assert.equal(mixed.feeShares, 10);

  // After that sale, nothing recent is left: the next sale is free.
  const after = marketPackage.recentLots([...fills, { side: "sell", quantity: 15, ts: at(1) }], NOW);
  assert.equal(marketPackage.recentShares(after, 20), 0);
  assert.equal(marketPackage.feeFreeAt(after, 20), null);
  assert.equal(marketPackage.fillFee({ side: "sell", price: 12, quantity: 5, feeRate: 0.01, lots: after, held: 20, on: true }).feeCash, 0);

  // A partial sale of recent shares leaves the rest of the newest lot, and older lots still count.
  const two = marketPackage.recentLots(
    [
      { side: "buy", quantity: 8, ts: at(20) },
      { side: "buy", quantity: 6, ts: at(3) },
      { side: "sell", quantity: 9, ts: at(1) }, // 6 from the newest lot, 3 from the one before
    ],
    NOW
  );
  assert.deepEqual(two.map((lot) => lot.quantity), [5]);
  assert.equal(marketPackage.feeFreeAt(two, 100), new Date(Date.parse(at(20)) + 24 * HOUR).toISOString());
  // Four hours later the 20-hour-old lot ages out.
  assert.equal(marketPackage.recentShares(marketPackage.recentLots([{ side: "buy", quantity: 8, ts: at(20) }], NOW + 4 * HOUR + 1), 100), 0);

  // Never more than the holding (shares can leave without a fill: a forced buyback).
  assert.equal(marketPackage.feeSharesForSale(lots, 6, 6), 6);
  assert.equal(marketPackage.recentShares(lots, 6), 6);
});

test("fee: buys pay none while on; with it off every fill pays the whole rate", () => {
  assert.deepEqual(marketPackage.fillFee({ side: "buy", price: 12, quantity: 10, feeRate: 0.01, on: true }), { feeCash: 0, feeShares: 0 });
  const offBuy = marketPackage.fillFee({ side: "buy", price: 12.34, quantity: 7, feeRate: 0.01, on: false });
  assert.equal(offBuy.feeCash, 12.34 * 7 * 0.01, "the same arithmetic as before the package");
  const offSell = marketPackage.fillFee({ side: "sell", price: 12.34, quantity: 7, feeRate: 0.01, lots: [], held: 7, on: false });
  assert.equal(offSell.feeCash, 12.34 * 7 * 0.01);
  // A sale of only old shares while on: free.
  assert.equal(marketPackage.fillFee({ side: "sell", price: 12, quantity: 7, feeRate: 0.01, lots: [], held: 7, on: true }).feeCash, 0);

  // The auto-bailout's cheapest share (trading.oneShareCost) carries the buy fee only while it's off.
  const trading = require("../src/services/trading");
  const stock = { current_mid_price: 10, spread_bps: 150, liquidity_depth: 2000 };
  const restoreOff = features.override({ "market-package": "off" });
  const withFee = trading.oneShareCost(stock);
  restoreOff();
  const restoreOn = features.override({ "market-package": "on" });
  const free = trading.oneShareCost(stock);
  restoreOn();
  close(withFee / free, 1.01, "one share costs the fee more with the package off", 1e-12);
});

// ── Growth ────────────────────────────────────────────────────────────────

test("growth: the latest recorded day's growth applies, folded into the nudge's gate", () => {
  const growth = fairValueGrowth.fromRows([
    { market_date: "2026-11-20", log_growth: 0.0005 },
    { market_date: "2026-11-21", log_growth: 0.001 },
    { market_date: "2026-11-24", log_growth: 0.0025 },
  ]);
  assert.equal(growth.active, true);
  assert.equal(growth.logAt("2026-11-19"), 0, "before the first row: none");
  assert.equal(growth.logAt("2026-11-20"), 0.0005);
  assert.equal(growth.logAt("2026-11-22"), 0.001, "a day with no row takes the one before");
  assert.equal(growth.logAt("2026-12-30"), 0.0025);
  assert.equal(growth.logAt(new Date(2026, 10, 21)), 0.001, "a DATE column's local-midnight Date");

  // Without the nudge: the gate is the growth alone.
  const gate = fairValueGrowth.combine(targetNudge.OFF, growth);
  assert.equal(gate.active, true);
  assert.equal(gate.nudge("UC_ANY", "2026-11-21"), 0.001);
  close(gate.apply(20, "UC_ANY", "2026-11-21"), 20 * Math.exp(0.001), "applied");
  assert.equal(gate.apply(20, "UC_ANY", "2026-11-01"), 20, "untouched before it");
  // With the nudge: both add in log terms.
  const config = targetNudge.settings({ MARKET_TARGET_SECRET: "test-only-secret-growth", MARKET_TARGET_NUDGE_FROM: "2026-11-01" });
  const nudge = targetNudge.makeGate(config, "2026-11-01", "env");
  const both = fairValueGrowth.combine(nudge, growth);
  close(both.nudge("UC_ANY", "2026-11-21"), nudge.nudge("UC_ANY", "2026-11-21") + 0.001, "nudge + growth", 1e-15);
  assert.equal(both.pct, nudge.pct, "the nudge's own fields stay for the admin status");
  // No growth recorded: the nudge's gate itself.
  assert.equal(fairValueGrowth.combine(nudge, fairValueGrowth.NONE), nudge);
});

// ── The holder dividend at the weekly review ──────────────────────────────

/** Ten stocks, S0 the worst week and S9 the best; base rate 10. S5 sits in the dead zone. */
function planAssets(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    symbol: `S${i}`,
    display_name: `Stock ${i}`,
    max_supply: "30000",
    circulating_supply: "0",
    treasury_supply: "30000",
    broker_buffer_pct: "0.02",
    trading_state: "open",
    current_mid_price: "10",
    day_open: "10",
    subscriber_count: String(100000 * (i + 1)),
    value_now: String(100 * (1 + (i - count / 2) / 1000)),
    value_before: "100",
    avg_base: "10",
    last_revealed_base: "10",
    rookie: i === 7,
  }));
}

function planWeek({ holderRate, protectedOshis = null }) {
  const holdings = new Map([
    ["1", new Map([[1, pgNumeric.parse("100")], [2, pgNumeric.parse("40")]])], // S0: a share fee
    ["6", new Map([[1, pgNumeric.parse("30")]])], // S5: the dead zone
    ["8", new Map([[2, pgNumeric.parse("12.5")]])], // S7: a rookie
    ["10", new Map([[1, pgNumeric.parse("50")]])], // S9: a dividend
  ]);
  const wallets = new Map([1, 2].map((id) => [id, { cash: pgNumeric.parse("1000"), credit: pgNumeric.parse("0") }]));
  return weekly.planEvaluation({ evalDate: "2026-11-21", evaluationId: 7, firstEvaluation: false, onDemand: false, assets: planAssets(), activeBuybacks: [], holdings, wallets, protectedOshis, holderRate });
}

test("weekly: every holder gets 0.25% of the basis a share, on top of the ranked dividend or fee", () => {
  const off = planWeek({ holderRate: 0 });
  const on = planWeek({ holderRate: 0.0025 });
  const payout = (plan, userId, assetId) => plan.writes.payouts.find((row) => row.userId === userId && row.assetId === assetId);
  const rate = (plan, symbol) => plan.report.assets.find((row) => row.symbol === symbol).rate;
  const holderPerShare = 0.0025 * 10;

  // The ranked part is untouched: same rates, same fees and dividends.
  assert.deepEqual(on.report.assets.map((row) => row.rate), off.report.assets.map((row) => row.rate));
  assert.ok(rate(off, "S0") < 0 && rate(off, "S9") > 0);
  assert.equal(rate(off, "S5"), 0, "S5 is in the dead zone");
  assert.equal(rate(off, "S7"), 0, "a rookie isn't ranked");

  // Off: dead-zone and rookie holders get nothing, and nothing new is written.
  assert.equal(payout(off, 1, "6"), undefined);
  assert.equal(payout(off, 2, "8"), undefined);
  assert.equal(off.report.holder_dividend_rate, undefined);
  for (const row of off.writes.payouts) assert.ok(!("holderAmount" in row));

  // On: each holding gets quantity × 0.025, as Credit, in the payout's amount.
  assert.deepEqual(payout(on, 1, "6"), { userId: 1, assetId: "6", quantity: 30, perShare: 0, amount: 0.75, protectedQuantity: 0, waived: 0, holderAmount: 0.75 });
  assert.equal(payout(on, 2, "8").holderAmount, Math.round(12.5 * holderPerShare * 100) / 100, "rookies too");
  const fee = payout(off, 1, "1");
  const feeOn = payout(on, 1, "1");
  assert.equal(feeOn.holderAmount, 2.5);
  assert.equal(feeOn.amount, Math.round((fee.amount + 2.5) * 100) / 100, "a fee stock nets the holder dividend against its fee");
  const dividend = payout(off, 1, "10");
  assert.equal(payout(on, 1, "10").amount, Math.round((dividend.amount + 1.25) * 100) / 100);

  // The fee is still charged in full (Credit first, then Cash) and the holder dividend is its own Credit move.
  const moves = (plan, userId, assetId) => plan.writes.moves.filter((row) => row.userId === userId && row.assetId === assetId);
  assert.deepEqual(moves(on, 1, "1").map((row) => row.entryType), ["share_fee", "dividend"]);
  assert.equal(moves(on, 1, "1")[1].credit, 2.5);
  assert.deepEqual(moves(on, 1, "1")[0], moves(off, 1, "1")[0]);

  // The report: the rate, the total (inside dividends_total) and each stock's part.
  const holderTotal = 0.75 + 2.5 + 1 + 1.25 + Math.round(12.5 * holderPerShare * 100) / 100;
  assert.equal(on.report.holder_dividend_rate, 0.0025);
  close(on.report.holder_dividends_total, holderTotal, "holder total", 1e-9);
  close(on.report.dividends_total, off.report.dividends_total + holderTotal, "dividends total", 1e-9);
  assert.equal(on.report.fees_total, off.report.fees_total, "fees unchanged");
  const s5 = on.report.assets.find((row) => row.symbol === "S5");
  assert.equal(s5.holder_per_share, holderPerShare);
  assert.equal(s5.holder_paid, 0.75);
  assert.equal(s5.paid, 0.75);
  assert.equal(on.writes.assetEvaluations.find((row) => row.assetId === "6").holderPerShare, holderPerShare);
  assert.ok(!("holderPerShare" in off.writes.assetEvaluations[0]));
  // Player 2 only had a fee before; now their notice counts the holder dividends as dividends.
  assert.match(on.notices.find((row) => row.userId === 2).title, /^Weekly evaluation: /);
});

test("weekly: oshi-protected shares skip the fee and still get the holder dividend", () => {
  const plan = planWeek({ holderRate: 0.0025, protectedOshis: new Map([[1, { assetId: 1, added: 0 }]]) });
  const row = plan.writes.payouts.find((p) => p.userId === 1 && p.assetId === "1");
  assert.equal(row.protectedQuantity, 100);
  assert.equal(row.amount, 2.5, "no fee, just the holder dividend");
  assert.equal(row.holderAmount, 2.5);
  assert.ok(row.waived > 0);
});

// ── Against a database ────────────────────────────────────────────────────

function silenced(work) {
  const saved = [console.log, console.info, console.warn];
  console.log = console.info = console.warn = () => {};
  return Promise.resolve()
    .then(work)
    .finally(() => {
      [console.log, console.info, console.warn] = saved;
    });
}

async function freshDatabase(t, name) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.href });
  const open = new Set();
  pool.on("connect", (client) => open.add(client));
  pool.on("remove", (client) => open.delete(client));
  t.after(async () => {
    await require("../src/services/achievements").tradeFillsIdle();
    const allClosed = new Promise((resolve) => {
      const check = () => open.size === 0 && resolve();
      pool.on("remove", check);
      check();
    });
    await pool.end();
    await allClosed;
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });
  const { applySchema } = require("../src/migrations");
  await silenced(() => applySchema(pool));
  return pool;
}

test("trades: the fee only on recent shares, the same through the instant path and the batch", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const trading = require("../src/services/trading");
  const pool = await freshDatabase(t, "nasfaq_market_package_fee_test");
  t.after(features.override({ "market-package": "on" }));

  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCpackage', 'Package')`);
  const { rows: assetRows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
     VALUES ('UCpackage', 'PKG', 'Package', 'active', 100000, 40, 99960, 2000, 150, 12, 12, 12) RETURNING id`
  );
  const assetId = Number(assetRows[0].id);
  const player = async (name) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}') RETURNING id`,
      [name]
    );
    const id = Number(rows[0].id);
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 100000, 0)`, [id]);
    // 20 shares bought long ago (no fills in the last day): fee-free.
    await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 20, 9)`, [id, assetId]);
    return id;
  };
  const feeRows = async (userId) => (await pool.query(`SELECT count(*)::int AS n FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'trade_fee'`, [userId])).rows[0].n;
  const holdingOf = async (userId) => (await trading.getPortfolioSummary(pool, userId)).holdings.find((row) => row.symbol === "PKG");

  // The instant path, one order at a time.
  const alice = await player("pkg_alice");
  const buy = await trading.executeOrder(pool, { userId: alice, symbol: "PKG", side: "buy", quantity: 10, refreshDerivedState: false });
  assert.equal(buy.fee, 0, "a buy pays no fee");
  close(buy.total_cost, buy.executed_price * 10, "a buy costs the shares alone");
  close(Number(buy.updated_holdings.avg_cost_basis), (20 * 9 + buy.executed_price * 10) / 30, "cost basis has no fee in it");
  assert.equal(await feeRows(alice), 0, "no fee row for a free fill");
  const summary = await trading.getPortfolioSummary(pool, alice);
  assert.equal(summary.economy.fee_on, "quick_sells");
  const held = await holdingOf(alice);
  assert.equal(held.fee_shares, 10);
  const freeAt = Date.parse(held.fee_free_at);
  assert.ok(Math.abs(freeAt - (Date.now() + 24 * HOUR)) < 60_000, "fee-free a day after the buy");

  const sell = await trading.executeOrder(pool, { userId: alice, symbol: "PKG", side: "sell", quantity: 15, refreshDerivedState: false });
  close(sell.fee, sell.executed_price * 10 * 0.01, "the fee on the 10 shares bought today, not the 5 old ones");
  close(sell.total_proceeds, sell.executed_price * 15 - sell.fee, "proceeds less that fee");
  close(sell.realized_pnl, sell.executed_price * 15 - sell.fee - sell.cost_basis_sold, "P/L agrees");
  assert.equal(await feeRows(alice), 1);
  assert.equal((await holdingOf(alice)).fee_shares, 0, "the recent shares are the ones sold");
  const last = await trading.executeOrder(pool, { userId: alice, symbol: "PKG", side: "sell", quantity: 5, refreshDerivedState: false });
  assert.equal(last.fee, 0, "what's left is old: no fee");

  // The batch: the same three orders queued together, so the sale sees the buy filled in its own chunk.
  const bob = await player("pkg_bob");
  for (const [side, quantity] of [["buy", 10], ["sell", 15], ["sell", 5]]) await trading.submitLiveOrder(pool, { userId: bob, symbol: "PKG", side, quantity });
  await pool.query(`UPDATE market.trade_orders SET execute_after = now() - interval '1 second' WHERE user_id = $1`, [bob]);
  const run = await trading.processDueLiveOrders(pool, {});
  assert.equal(run.filled, 3);
  const { rows: fills } = await pool.query(`SELECT side, quantity::float8 AS quantity, price::float8 AS price, fee_cash::float8 AS fee FROM market.trade_fills WHERE user_id = $1 ORDER BY id`, [bob]);
  assert.deepEqual(fills.map((row) => [row.side, row.quantity]), [["buy", 10], ["sell", 15], ["sell", 5]]);
  assert.equal(fills[0].fee, 0);
  close(fills[1].fee, fills[1].price * 10 * 0.01, "batch: the fee on the 10 recent shares", 1e-6);
  assert.equal(fills[2].fee, 0);
  assert.equal(await feeRows(bob), 1);
  const bobHolding = await holdingOf(bob);
  assert.equal(Number(bobHolding.quantity), 10);
  close(Number(bobHolding.avg_cost_basis), (20 * 9 + fills[0].price * 10) / 30, "batch: cost basis has no fee in it", 1e-6);

  // A new sale queued right after a buy of the day before still sees the buy (read from the fills).
  const carol = await player("pkg_carol");
  await trading.executeOrder(pool, { userId: carol, symbol: "PKG", side: "buy", quantity: 4, refreshDerivedState: false });
  await trading.submitLiveOrder(pool, { userId: carol, symbol: "PKG", side: "sell", quantity: 24 });
  await pool.query(`UPDATE market.trade_orders SET execute_after = now() - interval '1 second' WHERE user_id = $1 AND status = 'pending'`, [carol]);
  await trading.processDueLiveOrders(pool, {});
  const { rows: carolSell } = await pool.query(`SELECT price::float8 AS price, fee_cash::float8 AS fee FROM market.trade_fills WHERE user_id = $1 AND side = 'sell'`, [carol]);
  close(carolSell[0].fee, carolSell[0].price * 4 * 0.01, "batch: the fee on the 4 shares bought earlier today", 1e-6);

  // Bought more than a day ago: fee-free.
  await pool.query(`UPDATE market.trade_fills SET ts = ts - interval '25 hours' WHERE user_id = $1`, [alice]);
  await trading.executeOrder(pool, { userId: alice, symbol: "PKG", side: "buy", quantity: 3, refreshDerivedState: false });
  await pool.query(`UPDATE market.trade_fills SET ts = ts - interval '25 hours' WHERE user_id = $1`, [alice]);
  const aged = await trading.executeOrder(pool, { userId: alice, symbol: "PKG", side: "sell", quantity: 3, refreshDerivedState: false });
  assert.equal(aged.fee, 0, "shares held over a day sell free");

  // With the package off, every trade pays the whole fee, buys included, and their basis carries it.
  const restore = features.override({ "market-package": "off" });
  try {
    const dave = await player("pkg_dave");
    const offBuy = await trading.executeOrder(pool, { userId: dave, symbol: "PKG", side: "buy", quantity: 10, refreshDerivedState: false });
    close(offBuy.fee, offBuy.executed_price * 10 * 0.01, "off: a buy pays the fee");
    close(Number(offBuy.updated_holdings.avg_cost_basis), (20 * 9 + offBuy.executed_price * 10 * 1.01) / 30, "off: and its basis carries it");
    const offSell = await trading.executeOrder(pool, { userId: dave, symbol: "PKG", side: "sell", quantity: 5, refreshDerivedState: false });
    close(offSell.fee, offSell.executed_price * 5 * 0.01, "off: a sale of old shares pays it too");
    assert.equal((await trading.getPortfolioSummary(pool, dave)).holdings[0].fee_shares, undefined, "off: no fee_shares in the payload");
  } finally {
    restore();
  }

  // The price chart works a fill's mid out from the spread in force when it landed: one from before
  // a change at an Open uses the old spread.
  const marketDb = require("../src/marketDb");
  const erin = await player("pkg_erin");
  await trading.executeOrder(pool, { userId: erin, symbol: "PKG", side: "buy", quantity: 10, refreshDerivedState: false });
  const { rows: erinFill } = await pool.query(`UPDATE market.trade_fills SET ts = now() - interval '3 hours' WHERE user_id = $1 RETURNING date_trunc('minute', ts) AS minute`, [erin]);
  const pointOf = async () => {
    const candles = await marketDb.getAssetCandles(pool, "PKG", { interval: "1m", range: "24h" });
    return Number(candles.find((row) => new Date(row.bucket).getTime() === new Date(erinFill[0].minute).getTime()).open);
  };
  const atToday = await pointOf();
  await pool.query(`INSERT INTO market.asset_spread_changes (asset_id, old_spread_bps, new_spread_bps, changed_at) VALUES ($1, 400, 150, now() - interval '1 hour')`, [assetId]);
  const atTheTime = await pointOf();
  close(atTheTime / atToday, (1 + 0.0075) / (1 + 0.02), "a fill before the change is priced at the old 4% spread", 1e-9);
  // A change before the fill doesn't touch it.
  await pool.query(`UPDATE market.asset_spread_changes SET changed_at = now() - interval '5 hours'`);
  close(await pointOf(), atToday, "a fill after the change is priced at today's spread", 1e-12);
});

test("settlement: the spread moves at the Open, growth compounds per day, replays and the refresh reproduce it", { skip: !databaseUrl, timeout: 300_000 }, async (t) => {
  const fundamentals = require("../src/services/fundamentals");
  const settlement = require("../src/services/settlement");
  const scheduler = require("../src/services/marketScheduler");
  const { REFERENCE_SUPPLY } = require("../src/services/marketSupply");
  const pool = await freshDatabase(t, "nasfaq_market_package_growth_test");
  t.after(features.override({ "market-package": "off" }));

  const today = scheduler.getCurrentDateKey(new Date(), "America/New_York");
  const day = (i) => scheduler.shiftDateKey(today, i - 18); // day(18) is today
  const channels = [
    { id: "UCpackagegrowth00000001", symbol: "PGA", subs: 900_000, growth: 0.004 },
    { id: "UCpackagegrowth00000002", symbol: "PGB", subs: 2_400_000, growth: -0.002 },
  ];
  for (const channel of channels) {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1,$2,$2,$3,true)`, [channel.id, `Talent ${channel.symbol}`, channel.symbol]);
    await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps) VALUES ($1,$2,$3,'active',10000,0,10000,2000,400)`,
      [channel.id, channel.symbol, `Talent ${channel.symbol}`]
    );
  }
  // A stock on a spread of its own is left alone.
  await pool.query(`UPDATE market.market_assets SET spread_bps = 600 WHERE symbol = 'PGB'`);
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
  const smoothed = async () =>
    (await pool.query(`SELECT youtube_channel_id, snapshot_date::text AS day, fundamental_value_smoothed::float8 AS v FROM market.channel_daily_snapshots ORDER BY 1, 2`)).rows;
  const smoothedPrice = async (channelId, date) => {
    const { rows } = await pool.query(`SELECT fundamental_value_smoothed::float8 AS v FROM market.channel_daily_snapshots WHERE youtube_channel_id = $1 AND snapshot_date = $2`, [channelId, date]);
    return fundamentals.normalizeFundamentalToPrice(rows[0].v, REFERENCE_SUPPLY);
  };
  const growthRows = async () => (await pool.query(`SELECT market_date::text AS d, log_growth FROM market.fair_value_growth ORDER BY 1`)).rows;
  const spreads = async () => (await pool.query(`SELECT symbol, spread_bps, current_mid_price::float8 AS mid, current_bid_price::float8 AS bid, current_ask_price::float8 AS ask FROM market.market_assets ORDER BY symbol`)).rows;
  const ratio = (a, b, expected, label) => assert.ok(Math.abs(a / b - expected) < 1e-9, `${label}: ${a / b} vs ${expected}`);

  // Days 0–15 settle with the package off: formula values, no growth rows, spreads as they were.
  await silenced(() => fundamentals.recalculateFundamentals(pool, { from: day(0), to: today, activeOnly: true, fillMissingDates: true }));
  assert.equal((await silenced(() => settlement.settleMarketRange(pool, { from: day(0), to: day(15) }))).settled_count, 16);
  const baseline = await fairValues();
  const smoothedBefore = await smoothed();
  assert.deepEqual(await growthRows(), [], "nothing is written while it has never been on");
  assert.deepEqual((await spreads()).map((row) => row.spread_bps), [400, 600]);

  // On: day 16 opens with a day's growth and the new spread; day 17 with two days'.
  const restore = features.override({ "market-package": "on" });
  try {
    await silenced(() => settlement.settleMarketDay(pool, { marketDate: day(16) }));
    const opened = await spreads();
    assert.deepEqual(opened.map((row) => row.spread_bps), [150, 600], "the old spread moves to 1.5%; a stock's own spread stays");
    ratio(opened[0].ask - opened[0].bid, opened[0].mid, 0.015, "PGA's quotes are 1.5% apart");
    const changes = (await pool.query(`SELECT old_spread_bps, new_spread_bps FROM market.asset_spread_changes`)).rows;
    assert.deepEqual(changes, [{ old_spread_bps: 400, new_spread_bps: 150 }], "the change is logged for the chart");
    await silenced(() => settlement.settleMarketDay(pool, { marketDate: day(17) }));
    assert.deepEqual((await growthRows()).map((row) => [row.d, row.log_growth]), [[day(16), 0.0005], [day(17), 0.001]]);
    const values = await fairValues();
    for (const channel of channels) {
      const on16 = values.find((row) => row.youtube_channel_id === channel.id && row.day === day(16));
      const on17 = values.find((row) => row.youtube_channel_id === channel.id && row.day === day(17));
      ratio(on16.fair, await smoothedPrice(channel.id, day(16)), Math.exp(0.0005), `${channel.symbol} day 16`);
      ratio(on17.fair, await smoothedPrice(channel.id, day(17)), Math.exp(0.001), `${channel.symbol} day 17`);
    }
    assert.deepEqual(values.filter((row) => row.day < day(16)), baseline, "earlier days untouched");
    assert.deepEqual(await smoothed(), smoothedBefore, "the smoothed chain itself never carries the growth");
  } finally {
    restore();
  }

  // Off again: growth stops where it got to (day 18 keeps day 17's), the spread goes back at the Open.
  await silenced(() => settlement.settleMarketDay(pool, { marketDate: today }));
  assert.deepEqual((await growthRows()).map((row) => [row.d, row.log_growth]), [[day(16), 0.0005], [day(17), 0.001], [today, 0.001]]);
  assert.deepEqual((await spreads()).map((row) => row.spread_bps), [400, 600]);
  for (const channel of channels) {
    const row = (await fairValues()).find((r) => r.youtube_channel_id === channel.id && r.day === today);
    ratio(row.fair, await smoothedPrice(channel.id, today), Math.exp(0.001), `${channel.symbol} keeps its growth`);
  }
  const settled = await fairValues();

  // A refresh between settlements leaves the current fair value where settlement put it.
  const current = async () => (await pool.query(`SELECT symbol, current_fair_value::float8 AS fair FROM market.market_assets ORDER BY symbol`)).rows;
  const beforeRefresh = await current();
  await silenced(() => fundamentals.recalculateFundamentals(pool, { from: day(0), to: today, activeOnly: true, fillMissingDates: true }));
  const afterRefresh = await current();
  for (const [index, row] of beforeRefresh.entries()) ratio(afterRefresh[index].fair, row.fair, 1, `${row.symbol} refresh`);

  // A rebuild's forced replay reproduces every day, growth included, and records nothing new.
  const replay = await silenced(() => settlement.settleMarketRange(pool, { from: day(0), to: today, force: true }));
  assert.equal(replay.settled_count, 19);
  const replayed = await fairValues();
  for (const [index, row] of settled.entries()) ratio(replayed[index].fair, row.fair, 1, `${row.day} replay`);
  assert.equal((await growthRows()).length, 3);
});
