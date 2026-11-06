const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const fundamentals = require("../src/services/fundamentals");
const settlement = require("../src/services/settlement");
const weekly = require("../src/services/weeklyEvaluation");
const checkins = require("../src/services/checkins");
const oshi = require("../src/services/oshi");
const pgNumeric = require("../src/services/pgNumeric");
const profileDb = require("../src/profileDb");

// The daily check-in (services/checkins.js), the oshi's 30-day rule (services/oshi.js) and the weekly
// evaluation's oshi protection from share fees (services/weeklyEvaluation.js). The pure parts run
// anywhere; the rest needs CHAT_TEST_DATABASE_URL (a local server) and makes its own database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const quiet = { log() {}, warn() {}, error() {} };

// ── Pure ──────────────────────────────────────────────────────────────────
test("check-in: 100 Credit, plus 25 a streak day, up to 300", () => {
  assert.deepEqual([0, 1, 2, 3, 7, 8, 9, 40].map(checkins.rewardFor), [100, 125, 150, 175, 275, 300, 300, 300]);
  assert.equal(checkins.maxStreakDays(), 8);
  assert.equal(checkins.rewardFor(-3), 100, "never below the base");
});

test("check-in: today's pays for the streak through yesterday", () => {
  const on = (current, last) => checkins.streakOn({ current_streak_days: current, last_trade_day: last }, "2026-11-06", "2026-11-05");
  // Traded today: the streak through yesterday is one shorter, and today already counts.
  assert.deepEqual(on(4, "2026-11-06"), { current: 4, throughYesterday: 3, tradedToday: true, lastTradeDay: "2026-11-06" });
  // Last traded yesterday: still alive, today's trade still to come.
  assert.deepEqual(on(4, "2026-11-05"), { current: 4, throughYesterday: 4, tradedToday: false, lastTradeDay: "2026-11-05" });
  // A day missed: broken.
  assert.deepEqual(on(4, "2026-11-04"), { current: 0, throughYesterday: 0, tradedToday: false, lastTradeDay: "2026-11-04" });
  // A first trade today.
  assert.deepEqual(on(1, "2026-11-06"), { current: 1, throughYesterday: 0, tradedToday: true, lastTradeDay: "2026-11-06" });
  assert.deepEqual(checkins.streakOn(null, "2026-11-06", "2026-11-05"), { current: 0, throughYesterday: 0, tradedToday: false, lastTradeDay: null });
  // node-pg reads a DATE as local midnight: the local parts are the day, in any time zone.
  assert.equal(on(2, new Date(2026, 10, 5)).throughYesterday, 2);
});

test("oshi: what a move counts as", () => {
  assert.equal(oshi.kindOf(null, 5, false), "first_pick");
  assert.equal(oshi.kindOf(null, 5, true), "change", "picking again after clearing counts");
  assert.equal(oshi.kindOf(4, 5, false), "change", "an oshi picked before the log existed: the next move counts");
  assert.equal(oshi.kindOf(4, null, true), "clear");
  assert.equal(oshi.kindOf(4, 4, true), null);
  assert.equal(oshi.protectedShares(100, 0), 100);
  assert.equal(oshi.protectedShares(100, 60), 40);
  assert.equal(oshi.protectedShares(100, 140), 0);
});

/** `count` stocks, the first with the worst week and the last with the best; base rate 10. */
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
    rookie: false,
  }));
}

function plan(protectedOshis) {
  const holdings = new Map([
    ["1", new Map([[1, pgNumeric.parse("100")], [2, pgNumeric.parse("100")], [3, pgNumeric.parse("100")]])],
    ["10", new Map([[1, pgNumeric.parse("50")]])],
  ]);
  const wallets = new Map([1, 2, 3].map((id) => [id, { cash: pgNumeric.parse("1000"), credit: pgNumeric.parse("1000") }]));
  return weekly.planEvaluation({ evalDate: "2026-11-07", evaluationId: 1, firstEvaluation: false, onDemand: false, assets: planAssets(), activeBuybacks: [], holdings, wallets, protectedOshis });
}

test("oshi protection: the shares held all week skip the fee; a dividend still pays", () => {
  const off = plan(null);
  const fee = off.writes.payouts.find((row) => row.userId === 2 && row.assetId === "1");
  assert.ok(fee.amount < 0, "S0 charges a fee");
  const full = fee.amount;

  // Player 1: S0 is their oshi, held all week. Player 3: their oshi too, but 70 of the 100 shares came this week.
  const on = plan(new Map([[1, { assetId: 1, added: 0 }], [3, { assetId: 1, added: 70 }]]));
  const payout = (userId, assetId) => on.writes.payouts.find((row) => row.userId === userId && row.assetId === assetId);
  assert.deepEqual(payout(1, "1"), { userId: 1, assetId: "1", quantity: 100, perShare: fee.perShare, amount: 0, protectedQuantity: 100, waived: -full });
  assert.equal(payout(2, "1").amount, full, "not their oshi: the whole fee");
  assert.equal(payout(2, "1").waived, 0);
  const partial = payout(3, "1");
  assert.equal(partial.protectedQuantity, 30);
  assert.equal(partial.amount, Math.round(70 * fee.perShare * 100) / 100);
  assert.equal(Math.round((partial.amount - partial.waived) * 100) / 100, full, "charged plus skipped is the whole fee");
  // No share_fee move for the fully protected player, the partial one pays only the rest.
  const feeMoves = (userId) => on.writes.moves.filter((row) => row.userId === userId && row.entryType === "share_fee");
  assert.equal(feeMoves(1).length, 0);
  assert.equal(feeMoves(3).length, 1);
  assert.equal(Math.round((feeMoves(3)[0].cash + feeMoves(3)[0].credit) * 100) / 100, partial.amount);
  // The dividend on S9 (not their oshi) pays as before.
  assert.deepEqual(payout(1, "10"), off.writes.payouts.find((row) => row.userId === 1 && row.assetId === "10"));

  assert.deepEqual(on.report.oshi_protection, { enabled: true, players: 2, shares: 130, waived: Math.round((-full + partial.waived) * 100) / 100 });
  assert.equal(on.report.assets.find((row) => row.symbol === "S0").oshi_waived, on.report.oshi_protection.waived);
  assert.equal(on.report.holders_charged, 2, "the fully protected player isn't counted as charged");
  assert.deepEqual(off.report.oshi_protection, { enabled: false, players: 0, shares: 0, waived: 0 });
  const rate = `${(Math.abs(on.report.assets.find((row) => row.symbol === "S0").rate) * 100).toFixed(1)}%`;
  const notice = on.notices.find((row) => row.userId === 1);
  assert.match(notice.body, new RegExp(`your oshi S0 skipped ${rate.startsWith("8") ? "an" : "a"} ${rate.replace(".", "\\.")} share fee \\(\\$${(-full).toFixed(2)}\\) on the 100 shares you held all week`));
  // Nothing else moved for player 1 on S0, but the dividend on S9 did: that's the title.
  assert.match(notice.title, /^DIVS: /);
});

test("oshi protection: the notice reads \"an 8.5%\" for today's 73 stocks' worst week", () => {
  const holdings = new Map([["1", new Map([[1, pgNumeric.parse("10")]])]]);
  const result = weekly.planEvaluation({ evalDate: "2026-11-07", evaluationId: 1, firstEvaluation: false, onDemand: false, assets: planAssets(73), activeBuybacks: [], holdings, wallets: new Map(), protectedOshis: new Map([[1, { assetId: 1, added: 0 }]]) });
  assert.match(result.notices[0].body, /your oshi S0 skipped an 8\.5% share fee/);
});

test("oshi protection: a week of only a skipped fee says so in the title", () => {
  const holdings = new Map([["1", new Map([[1, pgNumeric.parse("100")]])]]);
  const wallets = new Map(); // no account yet
  const result = weekly.planEvaluation({ evalDate: "2026-11-07", evaluationId: 1, firstEvaluation: false, onDemand: false, assets: planAssets(), activeBuybacks: [], holdings, wallets, protectedOshis: new Map([[1, { assetId: 1, added: 0 }]]) });
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0].title, /^Oshi protection: \$\d+\.\d{2} fee skipped$/);
  assert.equal(result.writes.accountsOpened.length, 0, "no money moved, so no account is opened");
  assert.equal(result.writes.moves.length, 0);
});

// ── With a database ───────────────────────────────────────────────────────
async function freshDatabase(name) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname), "a local test server only");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${name}`;
  // UTC, as the API's pools are (db.js): streak and check-in days are UTC dates.
  const pool = new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
  const log = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.log, console.warn] = log;
  }
  return pool;
}

async function addUser(pool, name, { verified = true, cash = 0, credit = 0 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ($1, lower($1), lower($1) || '@example.test', $2, 'x', 'x', '{}') RETURNING id`,
    [name, verified]
  );
  const id = Number(rows[0].id);
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, $2, $3)`, [id, cash, credit]);
  return id;
}

test("the daily check-in", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_checkin_test");
  t.after(() => pool.end());
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCcheckin', 'C')`);
  const { rows: assets } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
     VALUES ('UCcheckin', 'CHK', 'Check', 'active', 10000, 0, 10000, 2000, 400) RETURNING id`
  );
  const assetId = Number(assets[0].id);
  // A fill at noon UTC, `daysAgo` days before today (UTC).
  const fill = async (userId, daysAgo) => {
    const { rows: order } = await pool.query(
      `INSERT INTO market.trade_orders (user_id, asset_id, side, order_type, status, requested_quantity, filled_quantity, requested_at)
       VALUES ($1, $2, 'buy', 'market', 'filled', 1, 1, (CURRENT_DATE - $3::int)::timestamptz + interval '12 hours') RETURNING id, requested_at`,
      [userId, assetId, daysAgo]
    );
    await pool.query(
      `INSERT INTO market.trade_fills (order_id, user_id, asset_id, side, price, quantity, gross_cash, fee_cash, net_cash, counterparty_type, ts)
       VALUES ($1, $2, $3, 'buy', 10, 1, 10, 0.1, -10.1, 'treasury', $4)`,
      [order[0].id, userId, assetId, order[0].requested_at]
    );
  };
  const credit = async (userId) => Number((await pool.query(`SELECT credit_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [userId])).rows[0].credit_balance);
  const refused = async (promise, code) => {
    try {
      await promise;
    } catch (error) {
      assert.equal(error.code, code);
      return error;
    }
    assert.fail(`expected ${code}`);
  };

  await t.test("no streak: the base, once a day", async () => {
    const fresh = await addUser(pool, "Fresh");
    const before = await checkins.getCheckin(pool, fresh);
    assert.equal(before.eligible, true);
    assert.equal(before.claimed, null);
    assert.equal(before.reward, 100);
    assert.deepEqual(before.tomorrow, { if_trade: 125, if_skip: 100 });
    assert.equal((await pool.query(`SELECT 1 FROM market.user_trade_streaks WHERE user_id = $1`, [fresh])).rowCount, 0, "reading it wrote no streak row");
    // Yesterday's check-in doesn't count against today's.
    await pool.query(`INSERT INTO market.daily_checkins (user_id, checkin_day, streak_days, reward) VALUES ($1, CURRENT_DATE - 1, 0, 100)`, [fresh]);

    const claimed = await checkins.claimCheckin(pool, fresh);
    assert.equal(claimed.claimed.reward, 100);
    assert.equal(claimed.credit_balance, 100);
    assert.equal(await credit(fresh), 100);
    const { rows: ledger } = await pool.query(`SELECT entry_type, cash_delta::text, credit_delta::text, reference_type, reference_id FROM market.ledger_entries WHERE user_id = $1`, [fresh]);
    const { rows: claim } = await pool.query(`SELECT id FROM market.daily_checkins WHERE user_id = $1 AND checkin_day = CURRENT_DATE`, [fresh]);
    assert.deepEqual(ledger, [{ entry_type: "daily_checkin", cash_delta: "0", credit_delta: "100", reference_type: "daily_checkin", reference_id: claim[0].id }]);

    const again = await refused(checkins.claimCheckin(pool, fresh), "already_checked_in");
    assert.equal(again.checkin.claimed.reward, 100);
    assert.equal(await credit(fresh), 100, "paid once");
    assert.equal((await checkins.getCheckin(pool, fresh)).claimed.reward, 100);
  });

  await t.test("the trade streak through yesterday sets it, whether or not they've traded today", async () => {
    const streaker = await addUser(pool, "Streaker");
    for (const daysAgo of [3, 2, 1]) await fill(streaker, daysAgo);
    const before = await checkins.getCheckin(pool, streaker);
    assert.equal(before.reward, 175, "a 3-day streak: 100 + 3 × 25");
    assert.deepEqual(before.streak, { current: 3, through_yesterday: 3, traded_today: false, last_trade_day: before.streak.last_trade_day });
    assert.deepEqual(before.tomorrow, { if_trade: 200, if_skip: 100 });
    // Trading today first changes tomorrow's, not today's.
    await fill(streaker, 0);
    const after = await checkins.getCheckin(pool, streaker);
    assert.equal(after.reward, 175);
    assert.equal(after.streak.current, 4);
    assert.deepEqual(after.tomorrow, { if_trade: 200, if_skip: null });
    const claimed = await checkins.claimCheckin(pool, streaker);
    assert.equal(claimed.claimed.reward, 175);
    assert.equal(claimed.claimed.streak_days, 3);
    assert.equal(await credit(streaker), 175);

    const lapsed = await addUser(pool, "Lapsed");
    for (const daysAgo of [4, 3, 2]) await fill(lapsed, daysAgo);
    const broken = await checkins.claimCheckin(pool, lapsed);
    assert.equal(broken.claimed.reward, 100, "a day missed: back to the base");
    assert.deepEqual(broken.tomorrow, { if_trade: 125, if_skip: 100 });

    const long = await addUser(pool, "Marathon");
    for (let daysAgo = 12; daysAgo >= 1; daysAgo -= 1) await fill(long, daysAgo);
    assert.equal((await checkins.claimCheckin(pool, long)).claimed.reward, 300, "capped");
  });

  await t.test("one claim a day, however many race for it", async () => {
    const racer = await addUser(pool, "Racer");
    await fill(racer, 1);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => checkins.claimCheckin(pool, racer)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.reason.code === "already_checked_in"));
    assert.equal(await credit(racer), 125);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'daily_checkin'`, [racer])).rows[0].n, 1);
    // The database itself refuses a second row for the day.
    await assert.rejects(pool.query(`INSERT INTO market.daily_checkins (user_id, checkin_day, streak_days, reward) VALUES ($1, CURRENT_DATE, 0, 100)`, [racer]), { code: "23505" });
  });

  await t.test("verified accounts only", async () => {
    const unverified = await addUser(pool, "Unverified", { verified: false });
    assert.equal((await checkins.getCheckin(pool, unverified)).eligible, false);
    await refused(checkins.claimCheckin(pool, unverified), "email_verification_required");
    assert.equal(await credit(unverified), 0);
    assert.equal((await pool.query(`SELECT 1 FROM market.daily_checkins WHERE user_id = $1`, [unverified])).rowCount, 0);
  });
});

test("the oshi changes once every 30 days; the first pick is free", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_oshi_rule_test");
  t.after(() => pool.end());
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) SELECT 'UCo' || s, s FROM unnest(ARRAY['a', 'b', 'c']) s`);
  const { rows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
     SELECT 'UCo' || s, upper(s || s || s), upper(s), 'active', 10000, 0, 10000, 2000, 400 FROM unnest(ARRAY['a', 'b', 'c']) s RETURNING id, symbol`
  );
  const asset = Object.fromEntries(rows.map((row) => [row.symbol, Number(row.id)]));
  const set = async (userId, assetId) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const kind = await oshi.setOshiWithClient(client, userId, assetId);
      await client.query("COMMIT");
      return kind;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const history = async (userId) =>
    (await pool.query(`SELECT asset_id_before, asset_id_after, kind FROM market.user_oshi_changes WHERE user_id = $1 ORDER BY id`, [userId])).rows.map((row) => [
      row.asset_id_before === null ? null : Number(row.asset_id_before),
      row.asset_id_after === null ? null : Number(row.asset_id_after),
      row.kind,
    ]);
  const current = async (userId) => (await pool.query(`SELECT oshi_coin_asset_id FROM market.users WHERE id = $1`, [userId])).rows[0].oshi_coin_asset_id;

  const fan = await addUser(pool, "Fan");
  assert.equal(await set(fan, asset.AAA), "first_pick");
  assert.equal(await set(fan, asset.AAA), null, "the same oshi again isn't a change");
  assert.equal(await set(fan, asset.BBB), "change", "the first pick didn't use the month's change");
  await assert.rejects(set(fan, asset.CCC), (error) => {
    assert.equal(error.code, "oshi_change_cooldown");
    const days = (new Date(error.available_at).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `available in 30 days (${days})`);
    return true;
  });
  assert.equal(Number(await current(fan)), asset.BBB);
  assert.equal(await set(fan, null), "clear", "going back to no oshi is always allowed");
  await assert.rejects(set(fan, asset.CCC), { code: "oshi_change_cooldown" }, "picking again after clearing is the change");
  await pool.query(`UPDATE market.user_oshi_changes SET changed_at = changed_at - interval '30 days 1 minute' WHERE user_id = $1`, [fan]);
  assert.equal(await set(fan, asset.CCC), "change", "30 days on");
  assert.deepEqual(await history(fan), [
    [null, asset.AAA, "first_pick"],
    [asset.AAA, asset.BBB, "change"],
    [asset.BBB, null, "clear"],
    [null, asset.CCC, "change"],
  ]);

  // An oshi picked before the log existed: one change now, then the wait.
  const veteran = await addUser(pool, "Veteran");
  await pool.query(`UPDATE market.users SET oshi_coin_asset_id = $2 WHERE id = $1`, [veteran, asset.AAA]);
  assert.equal(await set(veteran, asset.BBB), "change");
  await assert.rejects(set(veteran, asset.CCC), { code: "oshi_change_cooldown" });

  // Two changes at once: only one gets through.
  const racer = await addUser(pool, "Racer");
  await pool.query(`UPDATE market.users SET oshi_coin_asset_id = $2 WHERE id = $1`, [racer, asset.AAA]);
  const raced = await Promise.allSettled([set(racer, asset.BBB), set(racer, asset.CCC)]);
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(raced.find((result) => result.status === "rejected").reason.code, "oshi_change_cooldown");
  assert.equal((await history(racer)).length, 1);

  await t.test("through the profile save: a refused change saves nothing, and leaving the oshi out keeps it", async () => {
    const saver = await addUser(pool, "Saver");
    const save = (fields) => profileDb.updateProfileSettings(pool, saver, { username: "Saver", bio: "", profileColor: null, ...fields });
    await save({ oshiCoinAssetId: asset.AAA });
    await save({ oshiCoinAssetId: asset.BBB, bio: "switched" });
    await assert.rejects(save({ oshiCoinAssetId: asset.CCC, bio: "again" }), { code: "oshi_change_cooldown" });
    const { rows: after } = await pool.query(`SELECT bio, oshi_coin_asset_id FROM market.users WHERE id = $1`, [saver]);
    assert.deepEqual([after[0].bio, Number(after[0].oshi_coin_asset_id)], ["switched", asset.BBB]);
    await save({ bio: "no oshi field" });
    assert.equal(Number(await current(saver)), asset.BBB);
    const bundle = await profileDb.getProfileBundle(pool, { viewerUserId: saver, selfOnly: true });
    assert.equal(bundle.profile.oshi_change.cooldown_days, 30);
    assert.ok(bundle.profile.oshi_change.available_at);
    assert.equal(bundle.profile.oshi_change.first_pick, false);
  });
});

/**
 * A small market run through the real pipeline (like weekly-evaluation-batch.test.js): 12 talents with
 * 16 days of stats, fundamentals and settlement, every day's ticks landed.
 */
async function seedMarket(pool) {
  const DAYS = 16;
  const day = (i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  const stats = [];
  for (let i = 0; i < 12; i += 1) {
    const id = `UCoshi${String(i).padStart(18, "0")}`;
    const symbol = `O${String(i).padStart(2, "0")}`;
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1,$2,$2,$3,true)`, [id, `Talent ${symbol}`, symbol]);
    await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps) VALUES ($1,$2,$3,'active',30000,0,30000,2000,400)`,
      [id, symbol, `Talent ${symbol}`]
    );
    const growth = -0.004 + 0.0015 * i;
    for (let d = 0; d < DAYS; d += 1) {
      stats.push({ time: `${day(d)}T16:00:00Z`, id, subs: Math.round(500_000 * (1 + growth) ** d), views: Math.round(5e7 * (1 + growth * 2) ** d), videos: 300 + d });
    }
  }
  await pool.query(
    `INSERT INTO yt.youtube_channel_daily_stats (time, youtube_channel_id, subscriber_count, view_count, video_count)
     SELECT s.time, s.id, s.subs, s.views, s.videos FROM jsonb_to_recordset($1::jsonb) AS s(time timestamptz, id text, subs bigint, views bigint, videos bigint)`,
    [JSON.stringify(stats)]
  );
  const log = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    await fundamentals.recalculateFundamentals(pool, { from: day(0), to: day(DAYS - 1), activeOnly: true, fillMissingDates: true });
    await settlement.settleMarketRange(pool, { from: day(0), to: day(DAYS - 1) });
  } finally {
    [console.log, console.warn] = log;
  }
  await pool.query(`INSERT INTO market.adjustment_sessions (market_date, status) SELECT d::date, 'completed' FROM generate_series($1::date, $2::date, '1 day') d ON CONFLICT DO NOTHING`, [day(0), day(DAYS - 1)]);
  const { rows } = await pool.query(`SELECT id, symbol FROM market.market_assets ORDER BY symbol`);
  return Object.fromEntries(rows.map((row) => [row.symbol, Number(row.id)]));
}

test("the weekly evaluation skips the share fee on oshi shares held all week", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_oshi_eval_test");
  t.after(() => pool.end());
  const asset = await seedMarket(pool);
  const SATURDAY = "2026-10-17";
  const weekStart = weekly.weekStartFor(SATURDAY);
  assert.equal(weekStart.toISOString(), "2026-10-10T04:00:00.000Z", "the Saturday before, 00:00 ET");

  // Which stock charges the most and which pays, from a dry run (holdings don't move the ranking).
  const preview = await weekly.runWeeklyEvaluation(pool, { evalDate: SATURDAY, dryRun: true, logger: quiet });
  const feeRow = [...preview.report.assets].sort((a, b) => a.rate - b.rate)[0];
  const divRow = [...preview.report.assets].sort((a, b) => b.rate - a.rate)[0];
  assert.ok(feeRow.rate < 0 && divRow.rate > 0);
  const fee = asset[feeRow.symbol];
  const div = asset[divRow.symbol];

  const users = {};
  for (const name of ["fan", "newfan", "topup", "seller", "plain", "divfan"]) users[name] = await addUser(pool, name, { cash: 10000, credit: 100000 });
  // Shares, with the ledger rows that put them there (created_at set: the week's moves are what count).
  const holds = async (userId, assetId, moves) => {
    const total = moves.reduce((sum, [quantity]) => sum + quantity, 0);
    await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, $3, 10)`, [userId, assetId, total]);
    for (const [quantity, at] of moves) {
      await pool.query(
        `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id, created_at) VALUES ($1, $2, $3, $4, 0, 'test', 0, $5)`,
        [userId, assetId, quantity > 0 ? "buy" : "sell", quantity, at]
      );
    }
  };
  const BEFORE = "2026-10-01T15:00:00Z";
  // fan: their oshi since before the log, 100 shares all week. Fully protected.
  await holds(users.fan, fee, [[100, BEFORE]]);
  // newfan: the same shares, but picked their oshi midweek. Charged.
  await holds(users.newfan, fee, [[100, BEFORE]]);
  await pool.query(`INSERT INTO market.user_oshi_changes (user_id, asset_id_before, asset_id_after, kind, changed_at) VALUES ($1, NULL, $2, 'first_pick', '2026-10-13T15:00:00Z')`, [users.newfan, fee]);
  // topup: oshi since September; 40 shares all week and 60 bought midweek. 40 protected.
  await holds(users.topup, fee, [[40, BEFORE], [60, "2026-10-14T15:00:00Z"]]);
  await pool.query(`INSERT INTO market.user_oshi_changes (user_id, asset_id_before, asset_id_after, kind, changed_at) VALUES ($1, NULL, $2, 'first_pick', '2026-09-20T15:00:00Z')`, [users.topup, fee]);
  // seller: sold out midweek and bought back. Held none at one point, so none protected.
  await holds(users.seller, fee, [[100, BEFORE], [-100, "2026-10-12T15:00:00Z"], [100, "2026-10-15T15:00:00Z"]]);
  // plain: no oshi.
  await holds(users.plain, fee, [[100, BEFORE]]);
  // divfan: their oshi pays a dividend, on every share.
  await holds(users.divfan, div, [[100, BEFORE], [50, "2026-10-14T15:00:00Z"]]);
  for (const name of ["fan", "newfan", "topup", "seller"]) await pool.query(`UPDATE market.users SET oshi_coin_asset_id = $2 WHERE id = $1`, [users[name], fee]);
  await pool.query(`UPDATE market.users SET oshi_coin_asset_id = $2 WHERE id = $1`, [users.divfan, div]);

  // What the stock page shows before the run.
  const status = (name) => oshi.getOshiStatus(pool, users[name], { weekStart, nextReviewAt: weekly.evaluationStartsAt(SATURDAY) });
  assert.deepEqual([(await status("fan")).covered, (await status("fan")).protected_shares], [true, 100]);
  assert.deepEqual([(await status("newfan")).covered, (await status("newfan")).protected_shares], [false, 0]);
  assert.deepEqual([(await status("topup")).covered, (await status("topup")).protected_shares], [true, 40]);
  assert.equal((await status("seller")).protected_shares, 0);
  assert.equal((await status("plain")).oshi, null);

  const result = await weekly.runWeeklyEvaluation(pool, { evalDate: SATURDAY, closeTrading: false, logger: quiet });
  assert.equal(result.ok, true);
  const { rows: payoutRows } = await pool.query(`SELECT user_id, asset_id, quantity::float, per_share::float, amount::float, protected_quantity::float, waived::float FROM market.dividend_payouts`);
  const payout = (name, assetId = fee) => payoutRows.find((row) => Number(row.user_id) === users[name] && Number(row.asset_id) === assetId);
  const full = payout("plain").amount;
  assert.ok(full < 0);
  const perShare = payout("plain").per_share;
  assert.deepEqual(payout("fan"), { user_id: String(users.fan), asset_id: String(fee), quantity: 100, per_share: perShare, amount: 0, protected_quantity: 100, waived: -full });
  assert.equal(payout("newfan").amount, full);
  assert.equal(payout("newfan").waived, 0);
  assert.equal(payout("seller").amount, full);
  assert.equal(payout("topup").protected_quantity, 40);
  assert.equal(payout("topup").amount, Math.round(60 * perShare * 100) / 100, "charged on the 60 bought this week");
  assert.ok(Math.abs(payout("topup").amount - payout("topup").waived - full) < 0.011, "charged plus skipped is the whole fee, to the cent");
  assert.equal(payout("divfan", div).waived, 0);
  assert.ok(payout("divfan", div).amount > 0 && payout("divfan", div).quantity === 150, "a dividend pays on every share");

  // The ledger: no share fee at all for the fully protected fan.
  const feeLedger = async (name) => (await pool.query(`SELECT COUNT(*)::int AS n FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'share_fee'`, [users[name]])).rows[0].n;
  assert.equal(await feeLedger("fan"), 0);
  assert.equal(await feeLedger("topup"), 1);
  assert.equal(await feeLedger("plain"), 1);

  const report = (await weekly.getEvaluation(pool, SATURDAY));
  assert.deepEqual(report.oshi_protection, { enabled: true, players: 2, shares: 140, waived: Math.round((payout("fan").waived + payout("topup").waived) * 100) / 100 });
  assert.equal(report.assets.find((row) => row.symbol === feeRow.symbol).oshi_waived, report.oshi_protection.waived);

  const { rows: notices } = await pool.query(`SELECT title, body FROM market.notifications WHERE user_id = $1`, [users.fan]);
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /^Oshi protection: \$\d+\.\d{2} fee skipped$/);
  assert.match(notices[0].body, new RegExp(`your oshi ${feeRow.symbol} skipped an? ${(Math.abs(feeRow.rate) * 100).toFixed(1).replace(".", "\\.")}% share fee`));

  const [week] = await weekly.listUserDividends(pool, users.fan);
  assert.equal(week.net, 0);
  assert.equal(week.waived, -full);
  assert.deepEqual([week.lines[0].symbol, week.lines[0].amount, week.lines[0].protected_quantity, week.lines[0].waived], [feeRow.symbol, 0, 100, -full]);
});
