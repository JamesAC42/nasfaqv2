const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const fundamentals = require("../src/services/fundamentals");
const settlement = require("../src/services/settlement");
const trading = require("../src/services/trading");
const ipo = require("../src/services/ipo");

// An IPO end to end on a freshly migrated database (its own): a detected talent becomes a tracked
// prelaunch stock that can't be traded and doesn't hold up settlement, the window prices her from
// her debut fair value, players subscribe with held Cash, listing fills them pro rata and refunds the
// rest, and her first settled day opens at the IPO price.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

const NEW_CHANNEL = "UC8eitCE9Z6EwUCs-VUi1blg";
const day = (i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);

test("an IPO from detection to the first trading day", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_ipo_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_ipo_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_ipo_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const quiet = console.warn;
  console.warn = () => {};
  const log = console.log;
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    console.warn = quiet;
    console.log = log;
  }

  // Three listed talents with 20 days of stats.
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  const listed = [
    ["UClisted00000000000000a1", "Alpha", "ALP", 1_500_000],
    ["UClisted00000000000000b2", "Beta", "BET", 600_000],
    ["UClisted00000000000000c3", "Gamma", "GAM", 300_000],
  ];
  for (const [id, name, symbol] of listed) {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1,$2,$2,$3,true)`, [id, name, symbol]);
    await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps) VALUES ($1,$2,$3,'active',10000,0,10000,2000,400)`,
      [id, symbol, name]
    );
  }
  const addStats = async (id, i, subs) =>
    pool.query(
      `INSERT INTO yt.youtube_channel_daily_stats (time, youtube_channel_id, subscriber_count, view_count, video_count) VALUES ($1,$2,$3,$4,$5)`,
      [`${day(i)}T16:00:00Z`, id, subs + i * 1000, 50_000_000 + i * 300_000, 500 + i]
    );
  for (let i = 0; i < 20; i += 1) for (const [id, , , subs] of listed) await addStats(id, i, subs);

  // ── Creating the IPO tracks her as a prelaunch stock ──
  const created = await ipo.createEvent(
    pool,
    {
      title: "Test debut",
      listing_date: "2099-01-05",
      talents: [{ youtube_channel_id: NEW_CHANNEL, name_short: "Mela", name_english: "Achichi Mela", symbol: "MEL", color: "#ff5a36", unit: "ASOBI★MAWARI-TAI!", profile_id: "achichi-mela" }],
    },
    { now: new Date("2026-10-01T12:00:00Z") }
  );
  const eventId = created.event_id;
  const asset = async () => (await pool.query(`SELECT * FROM market.market_assets WHERE symbol = 'MEL'`)).rows[0];
  assert.equal((await asset()).status, "prelaunch");
  const channel = (await pool.query(`SELECT is_active, unit, color FROM yt.youtube_channels WHERE youtube_channel_id = $1`, [NEW_CHANNEL])).rows[0];
  assert.deepEqual(channel, { is_active: true, unit: "ASOBI★MAWARI-TAI!", color: "#ff5a36" });
  await assert.rejects(
    ipo.createEvent(pool, { title: "Again", listing_date: "2099-01-06", asset_ids: [Number((await asset()).id)] }, { now: new Date("2026-10-01T12:00:00Z") }),
    { code: "already_in_ipo" }
  );

  // Her stats start a few days later. Fundamentals price her (debut mode) and don't need her early days.
  for (let i = 6; i < 20; i += 1) await addStats(NEW_CHANNEL, i, 280_000);
  await fundamentals.recalculateFundamentals(pool, { from: day(0), to: day(19), activeOnly: true, fillMissingDates: true });
  const fairValue = Number((await asset()).current_fair_value);
  assert.ok(fairValue > 0, "she has a (hidden) fair value");
  const listedFair = (await pool.query(`SELECT current_fair_value FROM market.market_assets WHERE symbol = 'GAM'`)).rows[0].current_fair_value;
  assert.ok(fairValue / Number(listedFair) > 0.6, `debut value ${fairValue} is in line with a similar listed talent (${listedFair})`);

  // A prelaunch stock missing days never holds up settlement, and can't be traded.
  const settledEarly = await settlement.settleMarketRange(pool, { from: day(0), to: day(1) });
  assert.equal(settledEarly.settled_count, 2);
  const { rows: earlyStates } = await pool.query(`SELECT a.symbol FROM market.asset_daily_market_state d JOIN market.market_assets a ON a.id = d.asset_id WHERE d.market_date = $1`, [day(1)]);
  assert.ok(!earlyStates.some((row) => row.symbol === "MEL"));
  const { rows: users } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('alice','alice','a@example.test',true,'x','x','{}'), ('bob','bob','b@example.test',true,'x','x','{}'), ('cara','cara','c@example.test',true,'x','x','{}')
     RETURNING id`
  );
  const [alice, bob, cara] = users.map((row) => Number(row.id));
  for (const id of [alice, bob, cara]) await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance) VALUES ($1, 10000)`, [id]);
  await assert.rejects(trading.submitLiveOrder(pool, { userId: alice, symbol: "MEL", side: "buy", quantity: 1 }), { code: "asset_not_active" });
  await assert.rejects(ipo.subscribe(pool, { userId: alice, symbol: "MEL", shares: 5 }), { code: "ipo_window_closed" });

  // ── Opening the window fixes the price and the offering ──
  await ipo.openWindow(pool, eventId, { force: true });
  const listing = (await pool.query(`SELECT * FROM market.ipo_listings WHERE event_id = $1`, [eventId])).rows[0];
  const price = Number(listing.ipo_price);
  assert.equal(price, Math.round(fairValue * 0.9 * 100) / 100, "IPO price is debut fair value less 10%");
  const offered = Number(listing.shares_offered);
  assert.equal(offered, Math.floor(Number(listing.starting_max_supply) * 0.4));
  assert.equal(Number((await asset()).max_supply), Number(listing.starting_max_supply));
  const cap = Math.floor(offered * 0.1);

  // ── Subscribing holds cash; changing it moves only the difference; over the cap is refused ──
  const wallet = async (id) => {
    const { rows } = await pool.query(`SELECT cash_balance, held_cash FROM market.portfolio_cash_balances WHERE user_id = $1`, [id]);
    return { cash: Number(rows[0].cash_balance), held: Number(rows[0].held_cash) };
  };
  const close = (a, b, message) => assert.ok(Math.abs(a - b) < 0.011, `${message}: ${a} vs ${b}`);
  await assert.rejects(ipo.subscribe(pool, { userId: alice, symbol: "MEL", shares: cap + 1 }), { code: "over_player_cap" });
  await ipo.subscribe(pool, { userId: alice, symbol: "MEL", shares: 10 });
  close((await wallet(alice)).held, 10 * price, "10 shares held");
  await ipo.subscribe(pool, { userId: alice, symbol: "MEL", shares: cap });
  let w = await wallet(alice);
  close(w.held, Math.round(cap * price * 100) / 100, "raised to the cap");
  close(w.cash + w.held, 10000, "nothing lost moving the hold");
  await ipo.subscribe(pool, { userId: bob, symbol: "MEL", shares: cap });
  await ipo.subscribe(pool, { userId: cara, symbol: "MEL", shares: 3 });
  await ipo.cancelSubscription(pool, { userId: cara, symbol: "MEL" });
  close((await wallet(cara)).cash, 10000, "cancelling gives it all back");
  await ipo.subscribe(pool, { userId: cara, symbol: "MEL", shares: 3 });
  const view = await ipo.getPublicIpos(pool, { userId: bob });
  const talent = view.events[0].talents[0];
  assert.equal(talent.subscribed_shares, cap * 2 + 3);
  assert.equal(talent.subscribers, 3);
  assert.equal(talent.mine.requested_shares, cap);
  assert.equal(talent.ipo_price, price);
  assert.ok(!("current_fair_value" in talent), "the public view never shows her fair value");

  // ── Listing fills everyone (undersubscribed here) and makes her tradable from the IPO price ──
  const result = await ipo.listEvent(pool, eventId, { marketDate: day(19) });
  assert.equal(result.listed[0].allocated, cap * 2 + 3);
  const after = await asset();
  assert.equal(after.status, "active");
  close(Number(after.current_mid_price), price, "mid starts at the IPO price");
  assert.equal(Number(after.circulating_supply), cap * 2 + 3);
  w = await wallet(alice);
  assert.equal(w.held, 0);
  close(w.cash, 10000 - Math.round(cap * price * 100) / 100, "alice paid for her shares");
  const holding = (await pool.query(`SELECT quantity, avg_cost_basis FROM market.portfolio_holdings WHERE user_id = $1 AND asset_id = $2`, [alice, after.id])).rows[0];
  assert.equal(Number(holding.quantity), cap);
  close(Number(holding.avg_cost_basis), price, "cost basis is the IPO price");
  const settledListing = await settlement.settleMarketRange(pool, { from: day(19), to: day(19) });
  assert.equal(settledListing.settled_count, 1);
  const { rows: firstDay } = await pool.query(`SELECT mid_open FROM market.asset_daily_market_state WHERE asset_id = $1 AND market_date = $2`, [after.id, day(19)]);
  close(Number(firstDay[0].mid_open), price, "her first day opens at the IPO price");
  const { rows: events } = await pool.query(`SELECT status FROM market.ipo_events WHERE id = $1`, [eventId]);
  assert.equal(events[0].status, "listed");
});
