const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const wire = require("../src/services/wire");
const players = require("../src/services/wire/players");

// Who the Wire may name (services/wire/players.js): UR pulls and card-exchange sales never name an
// unverified, suspended or site-wide chat-banned player, a later ban hides headlines already written,
// lifting it brings them back, and older headlines get the player's id from the backfill. Needs
// CHAT_TEST_DATABASE_URL (a local server) and makes its own database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const quiet = { log() {}, info() {}, warn() {}, error() {} };

test("wire players: the read check passes items that name nobody", () => {
  assert.match(players.visibleSql(), /^\(NOT \(meta \? 'user_id'\) OR /);
  const named = players.headlinePlayerSql("p.user_id");
  assert.match(named, /lu\.id = p\.user_id AND lu\.email_verified/, "a verified email");
  assert.match(named, /cb\.user_id = p\.user_id AND cb\.action_type = 'ban' AND cb\.channel_id IS NULL/, "site-wide bans only");
});

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
  return new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
}

async function migrate(pool) {
  const log = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.log, console.warn] = log;
  }
}

async function addUser(pool, name, { verified = true } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ($1, lower($1), lower($1) || '@example.test', $2, 'x', 'x', '{}') RETURNING id`,
    [name, verified]
  );
  return Number(rows[0].id);
}

test("the Wire names only players it may", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_wire_players_test");
  t.after(() => pool.end());
  await migrate(pool);

  const asset = {};
  for (const [symbol, name] of [["PEK", "Pekora"], ["MAR", "Marine"]]) {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ($1, $2)`, [`UC${symbol}`, name]);
    const { rows } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
       VALUES ($1, $2, $3, 'active', 10000, 0, 10000, 2000, 400) RETURNING id`,
      [`UC${symbol}`, symbol, name]
    );
    asset[symbol] = Number(rows[0].id);
  }
  /** A UR pull `minutesAgo` minutes back; returns its id. */
  const pull = async (userId, symbol, minutesAgo) => {
    const { rows } = await pool.query(
      `INSERT INTO games.card_pulls (user_id, batch_id, banner_key, pool_key, card_key, asset_id, rarity, stars_after, created_at)
       VALUES ($1, gen_random_uuid(), 'standard', 'standard', $2::text || '_ur', $3, 'UR', 1, now() - make_interval(mins => $4)) RETURNING id`,
      [userId, symbol.toLowerCase(), asset[symbol], minutesAgo]
    );
    return Number(rows[0].id);
  };
  const seller = await addUser(pool, "Seller");
  /** A UR sold on the exchange for `price`, `minutesAgo` minutes back; returns its id. */
  const sale = async (buyerId, symbol, price, minutesAgo) => {
    const { rows } = await pool.query(
      `INSERT INTO games.card_sales (card_key, asset_id, rarity, kind, price, seller_id, buyer_id, created_at)
       VALUES ($1::text || '_ur', $2, 'UR', 'fixed', $3, $4, $5, now() - make_interval(mins => $6)) RETURNING id`,
      [symbol.toLowerCase(), asset[symbol], price, seller, buyerId, minutesAgo]
    );
    return Number(rows[0].id);
  };
  const run = () => wire.runWire(pool, quiet, { only: ["gameMoments"] });
  const stored = async () => (await pool.query(`SELECT kind, dedupe_key, headline, blurb, meta FROM content.wire_items ORDER BY id`)).rows;
  const naming = (items, userId) => items.filter((item) => Number(item.meta.user_id) === userId);
  const read = () => wire.listWire(pool, { order: "time", limit: 200 });

  const honk = await addUser(pool, "honk");
  const hushed = await addUser(pool, "Hushed");
  const roomBanned = await addUser(pool, "Roomed");
  const served = await addUser(pool, "Served");
  const alt = await addUser(pool, "Alt", { verified: false });
  const benched = await addUser(pool, "Benched");
  const gagged = await addUser(pool, "Gagged");
  await pool.query(`UPDATE market.users SET suspended_at = now() - interval '1 hour', suspended_until = now() + interval '1 day' WHERE id = $1`, [benched]);
  await pool.query(`UPDATE market.users SET suspended_at = now() - interval '3 days', suspended_until = now() - interval '1 day' WHERE id = $1`, [served]);
  const { rows: channel } = await pool.query(`INSERT INTO chat.channels (scope_type, scope_key, display_name) VALUES ('meta', 'wire-players-test', 'Test room') RETURNING id`);
  await pool.query(
    `INSERT INTO chat.user_moderation_actions (user_id, channel_id, action_type, reason) VALUES ($1, NULL, 'ban', 'test'), ($2, NULL, 'mute', 'test'), ($3, $4, 'ban', 'test')`,
    [gagged, hushed, roomBanned, channel[0].id]
  );

  await t.test("pulls and sales skip unverified, suspended and chat-banned players", async () => {
    for (const userId of [honk, hushed, roomBanned, served, alt, benched, gagged]) {
      await pull(userId, "PEK", 60);
      await sale(userId, "MAR", 900, 50);
    }
    await sale(null, "PEK", 1200, 40); // the buyer's account is gone
    const summary = await run();
    assert.equal(summary.gameMoments.items, 4 * 2 + 1);

    const items = await stored();
    for (const userId of [honk, hushed, roomBanned, served]) {
      const kinds = naming(items, userId).map((item) => item.kind).sort();
      assert.deepEqual(kinds, ["exchange_sale", "ur_pull"], `user ${userId}: a mute, a room ban or a finished suspension doesn't stop it`);
    }
    for (const userId of [alt, benched, gagged]) assert.deepEqual(naming(items, userId), []);
    const text = items.map((item) => `${item.headline} ${item.blurb}`).join(" ");
    for (const name of ["Alt", "Benched", "Gagged"]) assert.ok(!text.includes(name), `${name} is named nowhere`);

    const [honkPull] = naming(items, honk).filter((item) => item.kind === "ur_pull");
    assert.equal(honkPull.headline, "honk pulls Pekora UR");
    const [honkSale] = naming(items, honk).filter((item) => item.kind === "exchange_sale");
    assert.equal(honkSale.blurb, "honk bought it on the card exchange.");
    const anonymous = items.find((item) => item.kind === "exchange_sale" && item.blurb.startsWith("A player"));
    assert.ok(anonymous, "a sale to a gone account still posts");
    assert.equal("user_id" in anonymous.meta, false, "and names nobody");

    assert.equal((await run()).gameMoments.items, 0, "each fact once");
  });

  await t.test("an unverified player can't be named until they verify", async () => {
    assert.deepEqual(naming(await read(), alt), []);
    await pool.query(`UPDATE market.users SET email_verified = true WHERE id = $1`, [alt]);
    assert.equal((await run()).gameMoments.items, 2, "posted once verified, inside the 48 hours");
    assert.equal(naming(await read(), alt).length, 2);

    // And at read time: a headline about an unverified player isn't shown, whoever wrote it.
    const fresh = await addUser(pool, "Fresh", { verified: false });
    await pool.query(
      `INSERT INTO content.wire_items (kind, dedupe_key, headline, importance, occurred_at, meta) VALUES ('ur_pull', 'test:fresh', 'Fresh pulls a UR', 1, now(), $1)`,
      [JSON.stringify({ rarity: "UR", user_id: fresh })]
    );
    assert.deepEqual(naming(await read(), fresh), []);
    assert.equal(naming((await stored()), fresh).length, 1, "it's stored, just not shown");
  });

  await t.test("a player banned or suspended later drops off the Wire; lifting it brings them back", async () => {
    const counts = await wire.countWire(pool, {});
    const shown = await read();
    assert.equal(naming(shown, honk).length, 2);
    assert.equal(counts.all, shown.length);
    assert.equal(counts.games, shown.filter((item) => ["exchange_sale", "ur_pull", "prediction_resolved"].includes(item.kind)).length);

    const gone = async () => {
      assert.deepEqual(naming(await read(), honk), [], "not on /wire");
      assert.deepEqual(naming(await wire.listWire(pool, { order: "rank", limit: 200 }), honk), [], "not on the front page");
      assert.deepEqual(naming(await wire.listWire(pool, { order: "time", limit: 200, group: "games" }), honk), [], "not under Games");
      assert.deepEqual(naming(await wire.listWire(pool, { order: "time", limit: 200, symbol: "PEK" }), honk), [], "not on the stock's page");
      const now = await wire.countWire(pool, {});
      assert.equal(now.all, counts.all - 2);
      assert.equal(now.games, counts.games - 2);
    };
    const back = async () => {
      assert.equal(naming(await read(), honk).length, 2);
      assert.equal(naming(await wire.listWire(pool, { order: "rank", limit: 200 }), honk).length, 2);
      assert.deepEqual(await wire.countWire(pool, {}), counts);
    };

    const { rows: ban } = await pool.query(`INSERT INTO chat.user_moderation_actions (user_id, action_type, reason, expires_at) VALUES ($1, 'ban', 'test', now() + interval '1 day') RETURNING id`, [honk]);
    await gone();
    await pool.query(`UPDATE chat.user_moderation_actions SET revoked_at = now() WHERE id = $1`, [ban[0].id]);
    await back();

    await pool.query(`INSERT INTO chat.user_moderation_actions (user_id, action_type, reason, expires_at) VALUES ($1, 'ban', 'test', now() - interval '1 minute')`, [honk]);
    await back(); // a ban that has run out

    await pool.query(`UPDATE market.users SET suspended_at = now(), suspended_until = NULL WHERE id = $1`, [honk]);
    await gone();
    await pool.query(`UPDATE market.users SET suspended_at = NULL WHERE id = $1`, [honk]);
    await back();

    // The ones banned before anything was written come back too, once it's lifted.
    await pool.query(`UPDATE chat.user_moderation_actions SET revoked_at = now() WHERE user_id = $1`, [gagged]);
    await run();
    assert.equal(naming(await read(), gagged).length, 2);
  });

  await t.test("the backfill gives older pulls and sales their player", async () => {
    // Written before items kept meta.user_id: the still-suspended player's pull and sale, a sale to a
    // gone account, and a test row whose key points nowhere.
    const pullId = await pull(benched, "MAR", 30);
    const saleId = await sale(benched, "PEK", 2000, 30);
    const goneSaleId = await sale(null, "MAR", 3000, 30);
    await pool.query(
      `INSERT INTO content.wire_items (kind, dedupe_key, headline, blurb, importance, occurred_at, meta) VALUES
         ('ur_pull', $1, 'Benched pulls Marine UR', NULL, 1, now(), '{"rarity":"UR"}'),
         ('exchange_sale', $2, 'Pekora UR sells for $2,000.00', 'Benched bought it on the card exchange.', 2, now(), '{"rarity":"UR"}'),
         ('exchange_sale', $3, 'Marine UR sells for $3,000.00', 'A player bought it on the card exchange.', 2, now(), '{"rarity":"UR"}'),
         ('ur_pull', 'test:nowhere', 'Someone pulls a UR', NULL, 1, now(), '{}')`,
      [`pull:${pullId}`, `sale:${saleId}`, `sale:${goneSaleId}`]
    );
    assert.equal(naming(await stored(), benched).length, 0);
    assert.equal((await read()).filter((item) => /Benched/.test(`${item.headline} ${item.blurb}`)).length, 2, "shown until they have an id");

    await migrate(pool);
    const items = await stored();
    assert.deepEqual(naming(items, benched).map((item) => item.dedupe_key).sort(), [`pull:${pullId}`, `sale:${saleId}`]);
    assert.equal("user_id" in items.find((item) => item.dedupe_key === `sale:${goneSaleId}`).meta, false);
    assert.equal("user_id" in items.find((item) => item.dedupe_key === "test:nowhere").meta, false);

    const shown = await read();
    assert.equal(shown.filter((item) => /Benched/.test(`${item.headline} ${item.blurb}`)).length, 0, "hidden while they're suspended");
    assert.ok(shown.some((item) => item.headline === "Marine UR sells for $3,000.00"), "names nobody: still shown");
    assert.ok(shown.some((item) => item.headline === "Someone pulls a UR"));
    await pool.query(`UPDATE market.users SET suspended_at = NULL WHERE id = $1`, [benched]);
    assert.equal(naming(await read(), benched).length, 2, "the backfilled two are back");
    await run();
    assert.equal(naming(await read(), benched).length, 2 + 2, "and the two from before, written now they're clear");
  });
});
