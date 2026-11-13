// What the Wire calls, not who may bet: these players' balances don't matter, so no net worth floor.
process.env.ECONOMY_SIDE_MODE_MIN_NET_WORTH = "0";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const features = require("../src/features");
const activity = require("../src/services/activity");
const markets = require("../src/services/predictions/markets");
const pools = require("../src/services/predictions/pools");
const wire = require("../src/services/wire");

// Which resolved markets the Wire calls (services/wire/index.js, gameMoments). Every Wire item is
// public, so a pool waits for the prediction-pools flag to be on for everyone, and an unlisted or
// private market never gets a headline. Needs CHAT_TEST_DATABASE_URL (a local server) and makes its own
// database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const quiet = { log() {}, info() {}, warn() {}, error() {} };

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

test("the Wire's calls: public markets, and pools only once they're on for everyone", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_wire_predictions_test");
  const restore = features.override({ "prediction-pools": "staff" });
  t.after(async () => {
    restore();
    await pool.end();
  });
  const { rows: users } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('Bookie', 'bookie', 'bookie@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  const creator = Number(users[0].id);

  /** A market resolved a minute ago, with one outcome that won. */
  const resolved = async (slug, { pricing = "lmsr", visibility = "public", autoTemplate = null, hoursAgo = 0 } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.prediction_markets
         (slug, title, rules_text, resolution_source_text, status, trading_status, visibility, creator_user_id, opens_at, closes_at, resolved_at, pricing, auto_template)
       VALUES ($1, $2, 'Rules', 'Source', 'resolved', 'resolved', $3, $4, now() - interval '3 days', now() - interval '1 day', now() - make_interval(hours => $5) - interval '1 minute', $6, $7)
       RETURNING id`,
      [slug, `Title of ${slug}`, visibility, creator, hoursAgo, pricing, autoTemplate]
    );
    const { rows: outcome } = await pool.query(`INSERT INTO market.prediction_market_outcomes (market_id, outcome_code, label, sort_order) VALUES ($1, 'yes', 'Yes', 0) RETURNING id`, [rows[0].id]);
    await pool.query(`UPDATE market.prediction_markets SET winning_outcome_id = $2 WHERE id = $1`, [rows[0].id, outcome[0].id]);
    return Number(rows[0].id);
  };
  const called = async () => (await pool.query(`SELECT dedupe_key, headline, blurb, link_url FROM content.wire_items WHERE kind = 'prediction_resolved' ORDER BY id`)).rows;
  const slugs = (items) => items.map((item) => item.link_url.replace(/^\/predictions\/(pools\/)?/, "")).sort();

  await resolved("public-market");
  await resolved("test-pool", { pricing: "pool" });
  await resolved("unlisted-market", { visibility: "unlisted" });
  await resolved("private-market", { visibility: "private" });
  await resolved("unlisted-pool", { pricing: "pool", visibility: "unlisted" });
  await resolved("tick-market", { autoTemplate: "tick-direction" });
  await resolved("auto-pool", { pricing: "pool", autoTemplate: "top-gainer-pool" });
  await resolved("old-market", { hoursAgo: 49 });

  await t.test("at staff, a resolved pool writes nothing, and neither does an unlisted or private market", async () => {
    await wire.runWire(pool, quiet);
    const items = await called();
    assert.deepEqual(slugs(items), ["public-market"]);
    assert.equal(items[0].headline, "Called: Title of public-market");
    assert.equal(items[0].blurb, "Resolved “Yes”.");
  });

  await t.test("off, the same", async () => {
    const off = features.override({ "prediction-pools": "off" });
    try {
      await wire.runWire(pool, quiet);
      assert.deepEqual(slugs(await called()), ["public-market"]);
    } finally {
      off();
    }
  });

  let bookiePool = null;
  await t.test("a pool really resolved by its bookie stays off the Wire at staff", async () => {
    const actor = { id: creator, is_admin: true, is_bookie: true, email_verified: true };
    bookiePool = await pools.createPool(pool, actor, {
      title: "Does the bookie's pool stay quiet?",
      closes_at: new Date(Date.now() + 3_600_000).toISOString(),
      options: ["Yes", "No"],
    });
    const { rows: bettors } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin)
       VALUES ('Bettor', 'bettor', 'bettor@example.test', true, 'x', 'x', '{}', true) RETURNING id`
    );
    const bettor = { id: Number(bettors[0].id), is_admin: true };
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 0, 5000)`, [bettor.id]);
    await pools.placeBet(pool, bettor, { slug: bookiePool.slug, outcomeCode: "o1", amount: 1000 });
    await pools.resolvePool(pool, actor, bookiePool.id, { outcome: "o1", sourceUrl: "https://example.test/source" });
    const { rows } = await pool.query(`SELECT status, pricing FROM market.prediction_markets WHERE id = $1`, [bookiePool.id]);
    assert.deepEqual(rows[0], { status: "resolved", pricing: "pool" });
    await wire.runWire(pool, quiet);
    assert.deepEqual(slugs(await called()), ["public-market"]);

    // The other public reads of the same tables don't carry it either: pool bets have their own tables.
    const reads = {
      tape: await markets.listTape(pool, { limit: 50 }),
      forecasters: await markets.getLeaderboard(pool, { limit: 50 }),
      activity: await activity.getActivity(pool),
      floor: await markets.listMarkets(pool, { tab: "resolved", viewer: null }),
    };
    for (const [name, value] of Object.entries(reads)) assert.ok(!JSON.stringify(value).includes("bookie's pool"), `${name} doesn't name it`);
    assert.equal(reads.activity.totals.prediction_bets, 0);
    assert.ok(!reads.floor.items.some((item) => item.pricing === "pool"), "no pool on the floor for players");
    assert.ok(reads.floor.items.some((item) => item.slug === "public-market"), "the floor read did find markets");
  });

  await t.test("on for everyone, public pools are called; the rest still aren't", async () => {
    const on = features.override({ "prediction-pools": "on" });
    try {
      await wire.runWire(pool, quiet);
      assert.deepEqual(slugs(await called()), [bookiePool.slug, "public-market", "test-pool"].sort());
      const links = (await called()).map((item) => item.link_url);
      assert.ok(links.includes("/predictions/pools/test-pool"), "a pool's headline links to its pool page");
      assert.ok(links.includes("/predictions/public-market"), "a market's headline links to its market page");
      await wire.runWire(pool, quiet);
      assert.equal((await called()).length, 3, "each call once");
    } finally {
      on();
    }
  });
});
