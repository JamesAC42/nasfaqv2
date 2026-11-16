const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const { computeDerivedSnapshot, upsertCalculatedSnapshots } = require("../src/services/fundamentals");
const settlement = require("../src/services/settlement");
const marketAdjustments = require("../src/services/marketAdjustments");
const trading = require("../src/services/trading");
const netWorth = require("../src/services/netWorth");
const authService = require("../src/services/auth");
const features = require("../src/features");
const { ALWAYS_HIDDEN } = require("../src/services/marketSecrecy");

// Today's fair value (the target the day's four ticks pull toward) is secret until the last of them
// lands (services/marketSecrecy.js). This walks every GET route a signed-in player can call, on a day
// whose ticks are still landing, with that player holding the stock, and fails if any response
// carries a hidden field or today's exact fair value. Routes are found by reading the routers, so a
// new endpoint is checked without touching this file.
//
// Needs CHAT_TEST_DATABASE_URL (a local server); makes its own database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const DAY = 86_400_000;
const shift = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

// Where server.js mounts each router under /api. Every file in src/routes is either here or skipped
// with a reason, so a new routes file has to be placed (the test fails until it is).
const MOUNTS = {
  "admin.js": "/admin",
  "adminAssets.js": "/admin/assets",
  "adminHolonews.js": "/admin/holonews",
  "adminIpo.js": "/admin/ipo",
  "analysis.js": "/analysis",
  "articles.js": "/articles",
  "assets.js": "/assets",
  "auth.js": "/auth",
  "channels.js": "/channels",
  "chat.js": "/chat",
  "features.js": "/features",
  "games.js": "/games",
  "leaderboard.js": "/leaderboard",
  "livestreams.js": "/livestreams",
  // Its site router (records, leaderboards, rules); the live one is the table owner's, like gameTables.js.
  "mahjong.js": "/games/mahjong",
  "market.js": "/market",
  "news.js": "/news",
  "notifications.js": "/notifications",
  "overview.js": "/overview",
  "portfolio.js": "/portfolio",
  "predictions.js": "/prediction-markets",
  "profiles.js": "/profiles",
  "referrals.js": "/referrals",
  "site.js": "/site",
  "settings.js": "/settings",
  "stats.js": "/stats",
  "v1Link.js": "/v1-link",
};
const SKIPPED = {
  "gameTables.js": "served only by the process holding the live tables; no market fields",
  "internalMarket.js": "behind the internal admin token, not a player route",
  "internalSite.js": "behind the internal admin token, not a player route",
  "nasfaqThread.js": "fetches from an outside site; no market fields",
};

// Also secret, beyond the scrubber's lists: how hard each tick pulls (until its day is done).
const SECRET_UNTIL_DAY_DONE = new Set(["strength_pct"]);

async function freshDatabase(t, name) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.href, max: 8 });
  const quiet = [console.warn, console.log];
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log] = quiet;
  }
  return pool;
}

async function addTalent(pool, symbol, last, { subs = 1_500_000, jump = 40_000 } = {}) {
  const channel = `UC${symbol}`;
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1, $2, $2, $3, true)`, [channel, symbol, symbol]);
  await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
     VALUES ($1, $2, $2, 'active', 100000, 0, 100000, 2000, 400)`,
    [channel, symbol]
  );
  // Forty days of channel numbers; the last day's subscribers jump, so today's target differs from yesterday's.
  const points = [];
  let views = 90_000_000;
  let videos = 700;
  for (let index = 39; index >= 0; index -= 1) {
    subs += index === 0 ? jump : 1_000;
    views += 300_000;
    if (index % 2 === 0) videos += 1;
    points.push({ youtube_channel_id: channel, snapshot_date: shift(last, -index), subscriber_count: subs, view_count: views, video_count: videos, has_video_count_data: true });
  }
  const history = new Map(points.map((point) => [point.snapshot_date, point]));
  let previous = null;
  const snapshots = points.map((point) => (previous = computeDerivedSnapshot(point, history, previous, 1, null, null)));
  const client = await pool.connect();
  try {
    await upsertCalculatedSnapshots(client, snapshots);
  } finally {
    client.release();
  }
}

/** Every GET route on an Express router, as [path pattern] (nested routers' own paths aren't recoverable; none hold GETs today). */
function getRoutes(router) {
  const out = [];
  for (const layer of router.stack || []) {
    if (layer.route?.methods?.get && typeof layer.route.path === "string") out.push(layer.route.path);
  }
  return out;
}

/** The hidden fields in a JSON value, and today's secret numbers anywhere in its text. */
function findLeaks(body, secretTexts) {
  const leaks = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${at}[${index}]`));
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const where = `${at}.${key}`;
      const set = item !== null && item !== undefined;
      if (set && ALWAYS_HIDDEN.has(key)) leaks.push(`${where} (always hidden)`);
      if (set && SECRET_UNTIL_DAY_DONE.has(key)) leaks.push(`${where} (secret until the day is done)`);
      walk(item, where);
    }
  };
  walk(body, "$");
  const text = JSON.stringify(body);
  for (const secret of secretTexts) if (text.includes(secret)) leaks.push(`today's fair value ${secret} in the text`);
  return leaks;
}

test("no player-facing route sends a hidden market field or today's fair value", { skip: !databaseUrl, timeout: 300_000 }, async (t) => {
  const pool = await freshDatabase(t, "nasfaq_hidden_fields_test");
  t.after(async () => {
    await require("../src/services/achievements").tradeFillsIdle();
    await pool.end();
  });
  // Every flag on, so routes still behind one are walked too.
  t.after(features.override(Object.fromEntries(features.list().map((flag) => [flag.key, "on"]))));

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = shift(today, -1);
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  await addTalent(pool, "PEK", today);
  await addTalent(pool, "MIK", today, { subs: 900_000, jump: 25_000 });

  const quiet = [console.warn, console.log, console.info];
  console.warn = () => {};
  console.log = () => {};
  console.info = () => {};
  const at = (minutes) => new Date(Date.now() + minutes * 60_000);
  const schedule = async (marketDate, times, strengths) => {
    const { session } = await marketAdjustments.ensureAdjustmentSession(pool, { marketDate });
    for (const [index, key] of ["open", "lunch", "late", "overnight"].entries()) {
      await pool.query(`UPDATE market.asset_adjustment_intervals SET scheduled_at = $3, strength_pct = $4 WHERE session_id = $1 AND interval_key = $2`, [session.id, key, times[index], strengths[index]]);
    }
  };
  try {
    // Yesterday: settled, all four ticks landed (its fair values are out).
    await settlement.settleMarketDay(pool, { marketDate: yesterday });
    await schedule(yesterday, [at(-300), at(-280), at(-260), at(-240)], [40, 50, 60, 50]);
    assert.equal((await marketAdjustments.applyDueAdjustments(pool, { now: at(-239) })).applied_count, 8);
    // Today: settled, the Open tick landed, three to go.
    await settlement.settleMarketDay(pool, { marketDate: today });
    await schedule(today, [at(-30), at(60), at(120), at(180)], [60, 50, 40, 50]);
    assert.equal((await marketAdjustments.applyDueAdjustments(pool, { now: at(-29) })).applied_count, 2);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }
  const revealed = async (date) => (await pool.query("SELECT market.marks_revealed($1::date) AS ok", [date])).rows[0].ok;
  assert.equal(await revealed(yesterday), true);
  assert.equal(await revealed(today), false);

  // A player who holds both stocks, with a fill, a queued order and a place on the leaderboard.
  const { rows: userRows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('holder', 'holder', 'holder@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  const userId = Number(userRows[0].id);
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 100000, 500)`, [userId]);
  await trading.executeOrder(pool, { userId, symbol: "PEK", side: "buy", quantity: 10, refreshDerivedState: false });
  await trading.executeOrder(pool, { userId, symbol: "MIK", side: "buy", quantity: 3, refreshDerivedState: false });
  const queued = await trading.submitLiveOrder(pool, { userId, symbol: "MIK", side: "buy", quantity: 2 });
  await netWorth.refreshCurrentLeaderboard(pool);
  const cookie = `nasfaq_session=${(await authService.createSession(pool, userId)).token}`;

  // Today's secrets, as the database and JSON would spell them: each stock's fair value, and what
  // gives it away beside the public mid (its premium over it, the offsets).
  const { rows: fairRows } = await pool.query(
    `SELECT a.symbol, a.current_fair_value::float8 AS fair, a.current_premium_pct::float8 AS premium, a.current_transient_offset::float8 AS transient,
            d.premium_close_pct::float8 AS premium_close
     FROM market.market_assets a LEFT JOIN market.asset_daily_market_state d ON d.asset_id = a.id AND d.market_date = $1
     ORDER BY a.symbol`,
    [today]
  );
  const { rows: yesterdayRows } = await pool.query(`SELECT fair_value::float8 AS fair FROM market.asset_daily_market_state WHERE market_date = $1`, [yesterday]);
  const secretTexts = new Set();
  for (const { fair, premium, transient, premium_close: premiumClose } of fairRows) {
    assert.ok(fair > 0);
    assert.ok(!yesterdayRows.some((row) => Math.abs(row.fair - fair) < 0.0001), "today's target differs from yesterday's (revealed) one");
    secretTexts.add(String(fair));
    secretTexts.add(fair.toFixed(4));
    for (const value of [premium, transient, premiumClose]) if (value) secretTexts.add(String(value));
  }
  for (const secret of secretTexts) assert.ok(secret.replace(/^-?0?\./, "").replace(/^0+/, "").length >= 4, `distinctive enough to search for: ${secret}`);
  assert.deepEqual(findLeaks(queued, secretTexts), [], "a queued order's response");

  // The app as server.js builds it, every router mounted where it is there.
  const routeFiles = fs.readdirSync(path.join(__dirname, "../src/routes")).filter((file) => file.endsWith(".js"));
  const unplaced = routeFiles.filter((file) => !(file in MOUNTS) && !(file in SKIPPED));
  assert.deepEqual(unplaced, [], "a new routes file: add it to MOUNTS (or SKIPPED, with the reason)");
  const app = express();
  app.use(async (req, _res, next) => {
    try {
      req.ctx = { pool, redis: null, user: await authService.getAuthenticatedUser(pool, req) };
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json());
  const routes = [];
  for (const [file, mount] of Object.entries(MOUNTS)) {
    const loaded = require(`../src/routes/${file}`);
    const router = typeof loaded === "function" ? loaded : loaded.router || loaded.site;
    app.use(`/api${mount}`, router);
    for (const route of getRoutes(router)) routes.push(`/api${mount}${route === "/" ? "" : route}`);
  }
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error?.message || error) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  // Path parameters filled with things that exist: the held stock, the player, today (unrevealed).
  const params = { symbol: "PEK", username: "holder", userId: String(userId), date: today, channelId: "UCPEK", sessionId: "1" };
  const fill = (route) => route.replace(/:(\w+)\??/g, (_match, name) => encodeURIComponent(params[name] ?? "1"));

  const leaks = [];
  const answered = new Set();
  const unanswered = [];
  const quietLogs = [console.warn, console.log, console.error];
  console.warn = () => {};
  console.log = () => {};
  console.error = () => {};
  try {
    for (const route of [...new Set(routes)]) {
      const url = fill(route);
      let res;
      try {
        res = await fetch(`${base}${url}`, { headers: { cookie }, signal: AbortSignal.timeout(10_000) });
      } catch {
        unanswered.push(`${url} (timed out)`);
        continue; // a route that waits on something outside has nothing to check
      }
      const body = await res.json().catch(() => null);
      if (res.status !== 200 || body === null) {
        unanswered.push(`${url} (${res.status})`);
        continue;
      }
      answered.add(route);
      for (const leak of findLeaks(body, secretTexts)) leaks.push(`GET ${url}: ${leak}`);
    }
  } finally {
    [console.warn, console.log, console.error] = quietLogs;
  }

  t.diagnostic(`walked ${routes.length} GET routes; ${answered.size} answered 200 with JSON; not checked: ${unanswered.join(", ")}`);
  // The walk reached the routes that matter (a broken setup would pass vacuously otherwise).
  for (const route of [
    "/api/portfolio/me",
    "/api/portfolio/me/orders",
    "/api/portfolio/me/ledger",
    "/api/profiles/me",
    "/api/profiles/:username",
    "/api/profiles/:username/trades",
    "/api/market/assets",
    "/api/market/assets/:symbol",
    "/api/market/assets/:symbol/stats",
    "/api/market/assets/:symbol/candles",
    "/api/market/assets/:symbol/adjustments",
    "/api/market/assets/:symbol/trades",
    "/api/market/hub",
    "/api/market/trades",
    "/api/market/report/daily/latest",
    "/api/market/report/daily/:date",
    "/api/market/report/daily/:date/session",
    "/api/market/adjustments/summary",
    "/api/market/rankings",
    "/api/market/ipo",
    "/api/leaderboard",
    "/api/leaderboard/net-worth",
    "/api/leaderboard/oshiboard/:symbol",
    "/api/overview/wire",
  ]) {
    assert.ok(answered.has(route), `${route} answered 200 with JSON`);
  }
  assert.deepEqual(leaks, []);

  // The summary ranks ticks by their move only.
  const summary = await (await fetch(`${base}/api/market/adjustments/summary`, { headers: { cookie } })).json();
  assert.deepEqual(Object.keys(summary.leaderboards), ["movers"]);
});

test("the leak finder catches a hidden field and today's number", () => {
  const secrets = new Set(["12.3456", "12.345678"]);
  assert.deepEqual(findLeaks({ holdings: [{ symbol: "PEK", current_fair_value: "12.345678" }] }, secrets), [
    "$.holdings[0].current_fair_value (always hidden)",
    "today's fair value 12.3456 in the text",
    "today's fair value 12.345678 in the text",
  ]);
  assert.deepEqual(findLeaks({ rows: [{ price_after: 12.3456 }] }, secrets), ["today's fair value 12.3456 in the text"]);
  assert.deepEqual(findLeaks({ steps: [{ strength_pct: 60 }, { strength_pct: null }] }, new Set()), ["$.steps[0].strength_pct (secret until the day is done)"]);
  assert.deepEqual(findLeaks({ current_fair_value: null, mid: 11.2 }, secrets), []);
});
