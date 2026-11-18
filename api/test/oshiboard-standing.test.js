const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const netWorth = require("../src/services/netWorth");

// Oshiboard standing on the leaderboard: each row's place on the player's oshi's oshiboard (ranked over
// the whole board, as the board and the profile rank it), or null for players on no board, for signed-in
// players and visitors alike. Needs CHAT_TEST_DATABASE_URL (a local server) and makes its own database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

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

test("oshiboard standing on the leaderboard", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_oshiboard_standing_test");
  t.after(() => pool.end());

  const asset = {};
  for (const [symbol, name, icon, color] of [["PEK", "Pekora", "pekora", "#a8d8ff"], ["MAR", "Marine", "marine", "#b4202a"]]) {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, icon, color) VALUES ($1, $2, $3, $4)`, [`UC${symbol}`, name, icon, color]);
    const { rows } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_mid_price)
       VALUES ($1, $2, $3, 'active', 10000, 0, 10000, 2000, 400, 10) RETURNING id`,
      [`UC${symbol}`, symbol, name]
    );
    asset[symbol] = Number(rows[0].id);
  }

  /** A player with an oshi (or none) and holdings { symbol: quantity }. */
  const player = async (name, oshi, holdings, { verified = true, admin = false } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin, oshi_coin_asset_id)
       VALUES ($1, lower($1), lower($1) || '@example.test', $2, 'x', 'x', '{}', $3, $4) RETURNING id`,
      [name, verified, admin, oshi ? asset[oshi] : null]
    );
    const id = Number(rows[0].id);
    for (const [symbol, quantity] of Object.entries(holdings)) {
      await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, $3, 10)`, [id, asset[symbol], quantity]);
    }
    return id;
  };

  // Pekora's board: Top (900), Second (500), Third (300), and Fourth (100), who is also rich in cash so
  // they lead the net-worth board. Marine's board: Solo. Nobody's: an oshi that isn't the largest bag,
  // no oshi at all, and an unverified player (not ranked anywhere, so not counted on the board either).
  const top = await player("Top", "PEK", { PEK: 900 });
  const second = await player("Second", "PEK", { PEK: 500 });
  const hidden = await player("Hidden", "PEK", { PEK: 700 }, { verified: false });
  const third = await player("Third", "PEK", { PEK: 300 });
  const fourth = await player("Fourth", "PEK", { PEK: 100 });
  const solo = await player("Solo", "MAR", { MAR: 50 });
  const offBoard = await player("Elsewhere", "PEK", { PEK: 10, MAR: 400 });
  const noOshi = await player("Nobody", null, { MAR: 200 });
  const boss = await player("Boss", null, {}, { admin: true });
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, held_cash) VALUES ($1, 500000, 0)`, [fourth]);
  await netWorth.refreshCurrentLeaderboard(pool);
  await netWorth.refreshCurrentOshiboards(pool);

  await t.test("ranked over the whole board, the same as the board and the profile", async () => {
    const bundle = await netWorth.listLeaderboardBundle(pool, { limit: 100, withOshiboard: true });
    const by = new Map(bundle.entries.map((entry) => [entry.user_id, entry.oshiboard_standing]));
    assert.equal(bundle.entries[0].user_id, fourth, "Fourth leads on net worth");
    assert.deepEqual(by.get(top), { symbol: "PEK", display_name: "Pekora", icon: "pekora", color: "#a8d8ff", rank: 1, member_count: 4 });
    assert.equal(by.get(second).rank, 2);
    assert.equal(by.get(third).rank, 3);
    assert.equal(by.get(fourth).rank, 4, "first on net worth, last on the board");
    assert.deepEqual(by.get(solo), { symbol: "MAR", display_name: "Marine", icon: "marine", color: "#b4202a", rank: 1, member_count: 1 });
    assert.equal(by.get(offBoard), null, "an oshi that isn't the largest bag is no board");
    assert.equal(by.get(noOshi), null);
    assert.ok(!by.has(hidden), "unverified players aren't ranked");

    const board = await netWorth.getAssetOshiboard(pool, "PEK");
    assert.deepEqual(board.entries.map((entry) => [entry.user_id, entry.rank]), [[top, 1], [second, 2], [third, 3], [fourth, 4]]);
    const [membership] = await netWorth.listUserOshiboardMemberships(pool, third);
    assert.equal(membership.rank, 3);
    assert.equal(membership.member_count, 4);

    // A later page and the viewer's own row and neighbors carry the same places.
    const page2 = await netWorth.listLeaderboardBundle(pool, { limit: 2, page: 2, withOshiboard: true, viewerUserId: third });
    for (const entry of page2.entries) assert.equal(entry.oshiboard_standing?.rank ?? null, by.get(entry.user_id)?.rank ?? null);
    assert.equal(page2.me.oshiboard_standing.rank, 3);
    for (const neighbor of page2.me.neighbors) assert.ok("oshiboard_standing" in neighbor);
  });

  await t.test("not looked up unless asked for", async () => {
    const bundle = await netWorth.listLeaderboardBundle(pool, { limit: 100, viewerUserId: top });
    assert.ok(bundle.entries.every((entry) => !("oshiboard_standing" in entry)));
    assert.ok(!("oshiboard_standing" in bundle.me));
  });

  await t.test("the route: every board, for players and visitors", async () => {
    const leaderboard = require("../src/routes/leaderboard");
    const app = express();
    app.use((req, _res, next) => {
      const id = Number(req.headers["x-test-user"]) || null;
      req.ctx = { pool, redis: null, user: id ? { id, is_admin: id === boss, email_verified: true } : null };
      next();
    });
    app.use("/api/leaderboard", leaderboard);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => server.close());
    const get = async (path, userId) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/leaderboard${path}`, { headers: userId ? { "x-test-user": String(userId) } : {} });
      return response.json();
    };
    const standings = (body) => body.entries.filter((entry) => entry.oshiboard_standing).length;
    assert.equal(standings(await get("/?limit=100", top)), 5, "players");
    assert.equal(standings(await get("/?limit=100")), 5, "visitors");
    assert.equal(standings(await get("/?limit=100&scope=friends", top)), 1, "a friends board with no friends: just you");
    const mine = await get("/?limit=100", third);
    assert.equal(mine.me.oshiboard_standing.rank, 3);
  });
});
