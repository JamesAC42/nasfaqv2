// The admin market simulator's inputs (services/marketSim.js, GET /api/admin/market-sim/inputs) and
// the pricing numbers its engine must match (fixtures/market-sim-parity.json; the engine's side is
// app-client/app/lib/market-sim/tests).

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const parity = require("./fixtures/market-sim-parity.json");
const trading = require("../src/services/trading");
const adjustments = require("../src/services/marketAdjustments");
const settlement = require("../src/services/settlement");
const weekly = require("../src/services/weeklyEvaluation");
const economy = require("../src/services/economy");
const marketSim = require("../src/services/marketSim");
const adminRoutes = require("../src/routes/admin");

const t = trading._test;
const close = (actual, expected, message, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);

test("the API still prices trades the way the simulator's fixture says", () => {
  const s = parity.settings;
  assert.equal(trading.getTradingFeeRate(), s.fee_rate);
  assert.deepEqual(
    [trading.IMPACT_SETTINGS.slippageWeight, trading.IMPACT_SETTINGS.transientWeight, trading.IMPACT_SETTINGS.persistentWeight, trading.IMPACT_SETTINGS.transientHalfLifeMinutes],
    [s.slippage_weight, s.transient_weight, s.persistent_weight, s.transient_half_life_minutes]
  );
  assert.deepEqual([settlement.PERSISTENT_DAILY_DECAY, settlement.TRANSIENT_SETTLEMENT_DECAY, adjustments.INTERVAL_STRENGTH_TOTAL_PCT], [s.persistent_daily_decay, s.transient_settlement_decay, s.strength_total_pct]);
  assert.deepEqual(s.dividend, { rate_per_sigma: weekly.CONFIG.ratePerSigma, deadzone_sigma: weekly.CONFIG.deadzoneSigma, cap: weekly.CONFIG.cap });

  for (const row of parity.quotes) {
    const quotes = t.computeQuotes(row.mid, row.spread_bps);
    close(quotes.bidPrice, row.bid, "bid");
    close(quotes.askPrice, row.ask, "ask");
  }
  for (const row of parity.execution) {
    close(t.computeExecutionPrice({ side: row.side, bidPrice: row.bid, askPrice: row.ask, quantity: row.quantity, liquidityDepth: row.depth }), row.price, "execution price");
  }
  for (const row of parity.shock) {
    const next = t.applyTradeShock({ side: row.side, quantity: row.quantity, liquidityDepth: row.depth, persistentOffset: row.persistent, transientOffset: row.transient });
    close(next.persistentOffset, row.next_persistent, "persistent");
    close(next.transientOffset, row.next_transient, "transient");
  }
  const now = new Date("2026-11-10T12:00:00Z");
  for (const row of parity.decay) close(t.decayTransientOffset(row.transient, new Date(now.getTime() - row.minutes * 60000), now), row.value, "decay", 1e-9);
  for (const row of parity.live) close(t.computeLiveMidPrice(row.fair, row.persistent, row.transient), row.mid, "live mid");
  for (const row of parity.adjusted) close(adjustments.computeAdjustedPrice(row.mid, row.base, row.strength), row.price, "tick");
  for (const row of parity.opening) {
    const opening = settlement.computeOpeningState({ previousPersistentOffset: row.prev_persistent, previousTransientOffset: row.prev_transient, fairValue: row.fair, carriedMarketPrice: row.carried });
    close(opening.persistentOffset, row.persistent, "opening persistent");
    close(opening.transientOffset, row.transient, "opening transient");
    close(opening.midOpen, row.mid_open, "mid open");
  }
  for (const row of parity.strengths) {
    const real = Math.random;
    let i = 0;
    Math.random = () => row.uniforms[i++];
    try {
      assert.deepEqual(adjustments.generateStrengths({ total: row.total, minPct: row.min_pct, maxPct: row.max_pct }), row.strengths);
    } finally {
      Math.random = real;
    }
  }
  for (const row of parity.dividend) close(weekly.dividendRate(row.z), row.rate, `dividend at z ${row.z}`);
  for (const row of parity.rank) assert.deepEqual(weekly.rankScores(row.values), row.scores);
  for (const row of parity.conversion) close(economy.planCreditConversion([{ userId: 1, credit: row.credit }]).converted, row.converted, "conversion", 1e-9);
});

test("behavior profiles from fills", () => {
  const hour = 3_600_000;
  const at = (day, h) => Date.parse(`2026-11-${String(day).padStart(2, "0")}T12:00:00Z`) + h * hour;
  const fill = (player, asset, side, quantity, price, when, date) => ({ player, asset, side, quantity, price, gross: price * quantity, fee: price * quantity * 0.01, at: when, date });
  const fills = [
    fill(0, 1, "buy", 10, 10, at(2, 0), "2026-11-02"),
    fill(0, 1, "buy", 10, 12, at(2, 2), "2026-11-02"),
    fill(0, 2, "buy", 40, 5, at(3, 0), "2026-11-03"),
    fill(0, 1, "sell", 20, 13, at(4, 2), "2026-11-04"), // +15.8% on an 11.11 cost, 48h after the last buy
    fill(0, 2, "sell", 20, 4, at(5, 0), "2026-11-05"), // −21.6%, 48h
    fill(0, 2, "sell", 20, 6, at(6, 0), "2026-11-06"), // +17.6%, 72h, empties it
    fill(1, 3, "sell", 5, 9, at(6, 0), "2026-11-06"), // bought before the window: cost unknown
  ];
  const closes = { "1:2026-11-01": 9, "1:2026-10-29": 8, "2:2026-11-02": 4, "2:2026-10-30": 6, "1:2026-10-30": 9 };
  const profiles = marketSim.buildProfiles(fills, { profileDays: 30, closeOf: (asset, date) => closes[`${asset}:${date}`] ?? null });
  const a = profiles.get(0);
  assert.equal(a.active_day_rate, Number((5 / 30).toFixed(4)));
  assert.equal(a.fills_per_active_day, 1.2);
  assert.equal(a.buy_share, 0.5);
  assert.equal(a.after_rise_share, Number((2 / 3).toFixed(4)), "two of three buys came after a rise");
  assert.equal(a.hold_hours_median, 48);
  assert.equal(a.stop_loss, null, "one losing sell isn't enough to call a level");
  close(a.take_profit, ((13 * 0.99) / ((10 * 10 * 1.01 + 10 * 12 * 1.01) / 20) - 1 + (6 * 0.99) / (5 * 1.01) - 1) / 2, "take profit", 1e-3);
  assert.equal(a.sell_all_share, Number((2 / 3).toFixed(4)));
  assert.deepEqual(a.favorites.map(([asset]) => asset), [1, 2]);
  assert.equal(a.favorite_share, 1);
  const b = profiles.get(1);
  assert.equal(b.buy_share, 0);
  assert.equal(b.take_profit, null);
  assert.equal(b.sell_all_share, null);
});

test("players get a shuffled index that stays the same while the API runs", () => {
  const index = marketSim.anonymousIndex(["1", "2", "3", "4", "5", "6", "7", "8", 9, "9"]);
  assert.equal(index.size, 9);
  assert.deepEqual([...index.values()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(marketSim.anonymousIndex(["1", "2", "3", "4", "5", "6", "7", "8", "9"]), index, "the same order every time");
});

/** An app with the admin routes behind `user`. */
async function serve(t, pool, user) {
  const app = express();
  app.use((req, _res, next) => {
    req.ctx = { pool, user: user() };
    next();
  });
  app.use("/api/admin", adminRoutes);
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error?.message || error) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  return async (path) => {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: await res.json().catch(() => null), cacheControl: res.headers.get("cache-control") };
  };
}

test("the inputs endpoint: 401 signed out, 403 for players, before any query", async (t) => {
  let queries = 0;
  const pool = { query: async () => (queries += 1, { rows: [] }), connect: async () => { queries += 1; throw new Error("no"); } };
  let user = null;
  const get = await serve(t, pool, () => user);
  assert.equal((await get("/market-sim/inputs")).status, 401);
  user = { id: 2, username: "pleb", is_admin: false, can_manage_assets: true };
  assert.equal((await get("/market-sim/inputs")).status, 403);
  assert.equal(queries, 0);
});

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("the inputs endpoint end to end: real fills, anonymous players, no secret base rate", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_market_sim_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_market_sim_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_market_sim_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const { applySchema } = require("../src/migrations");
  const quiet = [console.warn, console.log];
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log] = quiet;
  }

  const names = ["sim_alpha_trader", "sim_beta_trader", "sim_gamma_trader"];
  const ids = [];
  for (const name of names) {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
       VALUES ($1, $1, $2, true, 'x', 'x', '{}') RETURNING id`,
      [name, `${name}@example.test`]
    );
    ids.push(Number(rows[0].id));
  }
  const { asset, fills } = parity.fill_sequence;
  const SECRET_FAIR = 13.37;
  const REVEALED_FAIR = 11.5;
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCsim', 'Sim')`);
  const { rows: assetRows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
     VALUES ('UCsim', 'SIM', 'Sim', 'active', 100000, 900, 99100, $1, $2, $3, $3, $3) RETURNING id`,
    [asset.depth, asset.spread_bps, asset.fair]
  );
  const assetId = Number(assetRows[0].id);
  // Yesterday's ticks have all landed (revealed); today's are still running (secret).
  for (const [offset, fair, scheduled] of [[1, REVEALED_FAIR, false], [0, SECRET_FAIR, true]]) {
    const { rows: snap } = await pool.query(
      `INSERT INTO market.channel_daily_snapshots (youtube_channel_id, snapshot_date, subscriber_count, view_count, calculation_status)
       VALUES ('UCsim', (now() AT TIME ZONE 'America/New_York')::date - $1::int, 1000, 1000, 'pending') RETURNING id`,
      [offset]
    );
    await pool.query(
      `INSERT INTO market.asset_daily_market_state (asset_id, market_date, snapshot_id, fair_value, mid_open, mid_close, daily_emission, treasury_supply_start, circulating_supply_start)
       VALUES ($1, (now() AT TIME ZONE 'America/New_York')::date - $2::int, $3, $4, 12, 12, 0, 99100, 900)`,
      [assetId, offset, snap[0].id, fair]
    );
    const { rows: session } = await pool.query(
      `INSERT INTO market.adjustment_sessions (market_date, status) VALUES ((now() AT TIME ZONE 'America/New_York')::date - $1::int, $2) RETURNING id`,
      [offset, scheduled ? "active" : "completed"]
    );
    await pool.query(
      `INSERT INTO market.asset_adjustment_intervals (session_id, asset_id, interval_key, scheduled_at, strength_pct, base_rate, status)
       VALUES ($1, $2, 'overnight', now(), 50, $3, $4)`,
      [session[0].id, assetId, fair, scheduled ? "scheduled" : "applied"]
    );
  }
  for (const id of ids) {
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 100000, 500)`, [id]);
    await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 300, 12)`, [id, assetId]);
  }
  // Outside income for the first player: a check-in counts, starter money and trades don't.
  await pool.query(
    `INSERT INTO market.ledger_entries (user_id, entry_type, cash_delta, credit_delta, reference_type, reference_id)
     VALUES ($1, 'daily_checkin', 300, 600, 'test', 1), ($1, 'starter_cash_grant', 5000, 0, 'test', 2)`,
    [ids[0]]
  );

  // The fixture's run of fills, through the real trading code.
  for (const [i, fill] of fills.entries()) {
    const result = await trading.executeOrder(pool, { userId: ids[i % 3], symbol: "SIM", side: fill.side, quantity: fill.quantity, refreshDerivedState: false });
    // Milliseconds of transient decay between fills is all that separates them from the fixture.
    close(result.executed_price, fill.price, `fill ${i} price`, 1e-5);
  }

  let user = null;
  const get = await serve(t, pool, () => user);
  user = { id: ids[0], username: names[0], is_admin: false };
  assert.equal((await get("/market-sim/inputs")).status, 403);
  user = { id: 999, username: "boss", is_admin: true };
  const response = await get("/market-sim/inputs?replay_days=999&profile_days=5");
  assert.equal(response.status, 200);
  assert.equal(response.cacheControl, "no-store");
  const body = response.body;

  // Bounded windows.
  assert.equal(body.window.replay_days, 30);
  assert.equal(body.window.profile_days, 30);

  // Nobody's name, address or id leaves, and nothing keyed like one.
  const text = JSON.stringify(body);
  for (const name of names) {
    assert.ok(!text.includes(name), `no username ${name}`);
    assert.ok(!text.includes(`${name}@example.test`), "no email");
  }
  const keys = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) (keys.add(key), walk(inner));
  };
  walk(body);
  for (const forbidden of ["user_id", "userId", "username", "email", "id"]) assert.ok(!keys.has(forbidden), `no "${forbidden}" field`);

  // Today's base rate stays secret: no current fair value, offsets or premium, and today's history has no fair value.
  assert.ok(!text.includes(String(SECRET_FAIR)), "the secret base rate isn't anywhere");
  for (const forbidden of ["current_fair_value", "current_persistent_offset", "current_transient_offset", "current_premium_pct", "fair_value"]) assert.ok(!keys.has(forbidden));
  const [sim] = body.assets;
  assert.equal(body.dates[body.dates.length - 1], body.today);
  assert.equal(sim.fair[sim.fair.length - 1], null);
  assert.equal(sim.fair[sim.fair.length - 2], REVEALED_FAIR);
  assert.equal(sim.symbol, "SIM");
  assert.equal(sim.spread_bps, asset.spread_bps);
  assert.equal(sim.depth, asset.depth);

  // The settings in force.
  assert.deepEqual(body.settings, marketSim.simSettings());

  // The fills, in order, with their real prices and fees, under three anonymous players.
  assert.equal(body.players.length, 3);
  assert.equal(body.fills.length, fills.length);
  body.fills.forEach((fill, i) => {
    assert.equal(fill.side, fills[i].side);
    assert.equal(fill.quantity, fills[i].quantity);
    close(fill.price, fills[i].price, `fill ${i}`, 1e-5);
    close(fill.fee, fills[i].fee, `fee ${i}`, 1e-5);
  });
  const traders = body.fills.map((fill) => fill.player);
  assert.equal(new Set(traders).size, 3);
  assert.equal(traders[0], traders[3], "the same player keeps the same index");
  const totalHeld = body.players.reduce((sum, player) => sum + player.holdings.reduce((s, [, quantity]) => s + quantity, 0), 0);
  const net = fills.reduce((sum, fill) => sum + (fill.side === "buy" ? fill.quantity : -fill.quantity), 0);
  close(totalHeld, 900 + net, "holdings after the fills");
  for (const player of body.players) {
    assert.ok(player.cash > 0 && player.credit >= 0);
    assert.ok(player.profile.active_day_rate > 0);
  }
  // Over the 30-day profile window: $300 Cash and $600 Credit is $10 and $20 a day.
  const first = body.players[body.fills[0].player].profile;
  assert.deepEqual([first.outside_cash_per_day, first.outside_credit_per_day], [10, 20]);
  const others = body.players.filter((_, index) => index !== body.fills[0].player);
  for (const player of others) assert.deepEqual([player.profile.outside_cash_per_day, player.profile.outside_credit_per_day], [0, 0]);
});
