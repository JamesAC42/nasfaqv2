const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const siteState = require("../src/services/siteState");
const pvp = require("../src/services/games/tables/pvp");
const blackjack = require("../src/services/games/tables/blackjack");
const internalSite = require("../src/routes/internalSite");
const maintenance = require("../scripts/maintenance");

const setState = (state) => siteState.applyEvent({ version: null, released_at: null, maintenance: { state, source: "admin", message: null, started_at: null } });

test("maintenance turns new games away, and listeners hear each change once", async () => {
  const seen = [];
  const stop = siteState.onGamesPausedChange((paused) => seen.push(paused));
  try {
    setState("draining");
    setState("on");
    assert.equal(siteState.gamesPaused(), true);
    // The guard comes before anything touches the database or a table.
    await assert.rejects(pvp.createTable({ userId: 1, gameKey: "oshi-duel", stake: 10, deck: [] }), { code: "games_paused" });
    await assert.rejects(pvp.joinTable({ userId: 2, tableId: 5, deck: [] }), { code: "games_paused" });
    await assert.rejects(blackjack.bet({ userId: 1, tableKey: "low", amount: 10 }), { code: "games_paused" });
    setState("off");
    assert.equal(siteState.gamesPaused(), false);
    assert.deepEqual(seen, [true, false]);
  } finally {
    stop();
    setState("off");
  }
});

test("site events without a maintenance block are ignored", () => {
  siteState.applyEvent(null);
  siteState.applyEvent({ version: "sha-x" });
  assert.equal(siteState.gamesPaused(), false);
});

// The guard runs before any handler touches the database, so a fake ctx is enough.
async function call(user, body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ctx = { pool: null, redis: null, user };
    next();
  });
  app.use("/internal/site", internalSite);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/internal/site/maintenance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

test("POST /internal/site/maintenance is admin only and wants a yes or no", async () => {
  assert.equal((await call(null, { on: true })).status, 401);
  assert.equal((await call({ id: 5, is_admin: false }, { on: true })).status, 403);
  const bad = await call({ id: 1, is_admin: true }, { on: "yes" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_request");
});

// Against a real database when CI provides one (the chat retention test's disposable PostgreSQL).
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

/** Two test files may create the same schema at once; the loser of that race just retries. */
async function ddl(pool, sql) {
  try {
    await pool.query(sql);
  } catch (error) {
    if (error.code !== "23505" && error.code !== "42P07") throw error;
    await pool.query(sql);
  }
}

test("site state against PostgreSQL", { skip: !databaseUrl }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  await ddl(pool, "CREATE SCHEMA IF NOT EXISTS market");
  await ddl(pool, "CREATE SCHEMA IF NOT EXISTS games");
  await pool.query("DROP TABLE IF EXISTS market.site_state");
  await pool.query(siteState.schema);
  await pool.query(`
    DROP TABLE IF EXISTS games.pvp_matches;
    DROP TABLE IF EXISTS games.blackjack_rounds;
    CREATE TABLE games.pvp_matches (id bigint PRIMARY KEY, status text, created_at timestamptz DEFAULT now(), started_at timestamptz, updated_at timestamptz);
    CREATE TABLE games.blackjack_rounds (id bigint PRIMARY KEY, status text, started_at timestamptz DEFAULT now());
  `);

  await t.test("a release drains, reopens, and announces its version; a failed one doesn't announce", async () => {
    await pool.query(`INSERT INTO games.pvp_matches (id, status, updated_at) VALUES (1, 'active', now()), (2, 'active', now() - interval '2 hours'), (3, 'queued', now())`);
    await pool.query(`INSERT INTO games.blackjack_rounds (id, status) VALUES (1, 'playing'), (2, 'settled')`);
    // The two-hour-old match is abandoned and the queued one hasn't started: neither holds a release.
    assert.deepEqual(await maintenance.gamesInPlay(pool), { matches: 1, rounds: 1 });

    // A zero timeout goes ahead with games still in play.
    await maintenance.drain(pool, null, { timeoutSeconds: 0, pollMs: 1 });
    let site = await siteState.getSiteState(pool);
    assert.deepEqual([site.maintenance.state, site.maintenance.source], ["draining", "deploy"]);
    assert.ok(site.maintenance.started_at);
    assert.equal(siteState.gamesPaused(), true);

    await maintenance.end(pool, null, { version: null }); // the abort path
    site = await siteState.getSiteState(pool);
    assert.equal(site.maintenance.state, "off");
    assert.equal(site.version, null);

    await maintenance.drain(pool, null, { timeoutSeconds: 0, pollMs: 1 });
    await maintenance.end(pool, null, { version: "sha-abc" });
    site = await siteState.getSiteState(pool);
    assert.equal(site.maintenance.state, "off");
    assert.equal(site.version, "sha-abc");
    assert.ok(site.released_at);
  });

  await t.test("a release neither takes over nor ends an admin's maintenance", async () => {
    await siteState.setMaintenance(pool, { state: "on", source: "admin", message: "  Back at 5  " });
    await maintenance.drain(pool, null, { timeoutSeconds: 0, pollMs: 1 });
    let site = await siteState.getSiteState(pool);
    assert.deepEqual([site.maintenance.state, site.maintenance.source, site.maintenance.message], ["on", "admin", "Back at 5"]);

    await maintenance.end(pool, null, { version: "sha-def" });
    site = await siteState.getSiteState(pool);
    assert.equal(site.maintenance.state, "on");
    assert.equal(site.version, "sha-def");

    await siteState.setMaintenance(pool, { state: "off", source: "admin" });
    site = await siteState.getSiteState(pool);
    assert.deepEqual(site.maintenance, { state: "off", source: null, message: null, started_at: null });
    assert.equal(siteState.gamesPaused(), false);
  });
});
