const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const marketAdmin = require("../src/services/marketAdmin");

// The full reset on a freshly migrated database (its own): a dry run counts and changes nothing; the
// reset clears what players own and earned, leaves accounts, friends, IPO events and a paused market
// as they were, and with { community: true } clears chat and comments too.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("a full reset before launch", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_reset_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_reset_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_reset_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const quiet = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }

  const addUser = async (username) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, bio)
       VALUES ($1, lower($1), $1 || '@example.test', true, 'x', 'x', '{}', 'hi') RETURNING id`,
      [username]
    );
    return Number(rows[0].id);
  };
  const alice = await addUser("alice");
  const bob = await addUser("bob");
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 123456, 5), ($2, 7, 5)`, [alice, bob]);
  await pool.query(`INSERT INTO market.user_friendships (requester_id, addressee_id, status, accepted_at) VALUES ($1, $2, 'accepted', now())`, [alice, bob]);
  await pool.query(`INSERT INTO market.notifications (user_id, kind, title) VALUES ($1, 'dividend', 'Paid'), ($2, 'ipo', 'Postponed')`, [alice, bob]);

  const { rows: assetRows } = await pool.query(`
    WITH channel AS (INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCreset', 'Reset') RETURNING youtube_channel_id)
    INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_mid_price)
    SELECT youtube_channel_id, 'RST', 'Reset', 'active', 3000, 40, 2960, 1000, 400, 55 FROM channel
    RETURNING id
  `);
  const asset = Number(assetRows[0].id);
  await pool.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 40, 50)`, [alice, asset]);
  const { rows: events } = await pool.query(
    `INSERT INTO market.ipo_events (title, status, listing_date, window_opens_at, window_closes_at) VALUES ('Debut', 'announced', '2099-01-05', '2099-01-01', '2099-01-04') RETURNING id`
  );
  const { rows: listings } = await pool.query(`INSERT INTO market.ipo_listings (event_id, asset_id) VALUES ($1, $2) RETURNING id`, [events[0].id, asset]);
  await pool.query(`INSERT INTO market.ipo_subscriptions (listing_id, user_id, requested_shares, price, status) VALUES ($1, $2, 10, 5, 'refunded')`, [listings[0].id, bob]);

  const { rows: channels } = await pool.query(`INSERT INTO chat.channels (scope_type, scope_key, display_name, posting_policy) VALUES ('market', 'global', 'Market Chat', 'authenticated') RETURNING id`);
  await pool.query(`INSERT INTO chat.messages (channel_id, author_id, body) VALUES ($1, $2, 'gm')`, [channels[0].id, alice]);
  const { rows: articles } = await pool.query(`INSERT INTO content.articles (slug, title, author_id) VALUES ('reset-test', 'Reset test', $1) RETURNING id`, [alice]);
  const article = articles[0].id;
  await pool.query(`INSERT INTO content.article_comments (article_id, author_id, body) VALUES ($1, $2, 'first')`, [article, bob]);
  await pool.query(`INSERT INTO content.article_likes (article_id, user_id) VALUES ($1, $2)`, [article, bob]);
  await pool.query(`UPDATE content.articles SET likes = 1 WHERE id = $1`, [article]);
  await pool.query(`INSERT INTO content.asset_comments (asset_id, author_id, body) VALUES ($1, $2, 'to the moon')`, [asset, alice]);

  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status, trading_message) VALUES ('primary', 'manual_closed', 'Resetting') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'manual_closed', trading_message = 'Resetting'`);

  const count = async (table) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

  await t.test("a dry run counts what would go and changes nothing", async () => {
    const preview = await marketAdmin.resetMarketState(pool, { allowed: true, community: true, dryRun: true });
    assert.equal(preview.dry_run, true);
    assert.equal(preview.cleared["market.portfolio_holdings"], 1);
    assert.equal(preview.cleared["market.notifications"], 2);
    assert.equal(preview.cleared["market.ipo_subscriptions"], 1);
    assert.equal(preview.cleared["chat.messages"], 1);
    assert.equal(preview.cleared["content.article_comments"], 1);
    assert.equal(await count("market.portfolio_holdings"), 1);
    assert.equal(await count("chat.messages"), 1);
    const { rows } = await pool.query(`SELECT cash_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [alice]);
    assert.equal(Number(rows[0].cash_balance), 123456);
  });

  await t.test("without community, chat and comments stay", async () => {
    const reset = await marketAdmin.resetMarketState(pool, { allowed: true, dryRun: true });
    assert.equal(reset.cleared["chat.messages"], undefined);
    assert.equal(reset.cleared["content.article_comments"], undefined);
    assert.equal(reset.cleared["market.notifications"], 2);
  });

  await t.test("the reset clears play and keeps people", async () => {
    const reset = await marketAdmin.resetMarketState(pool, { allowed: true, community: true });
    assert.equal(reset.dry_run, false);
    for (const table of ["market.portfolio_holdings", "market.notifications", "market.ipo_subscriptions", "chat.messages", "content.article_comments", "content.article_likes", "content.asset_comments"]) {
      assert.equal(await count(table), 0, table);
    }
    // Accounts, profiles, friends, the IPO and its listing, the chat room and the article stay.
    const { rows: users } = await pool.query(`SELECT username, bio FROM market.users ORDER BY id`);
    assert.deepEqual(users, [{ username: "alice", bio: "hi" }, { username: "bob", bio: "hi" }]);
    assert.equal(await count("market.user_friendships"), 1);
    assert.equal(await count("market.ipo_events"), 1);
    assert.equal(await count("market.ipo_listings"), 1);
    assert.equal(await count("chat.channels"), 1);
    const { rows: art } = await pool.query(`SELECT likes, saves FROM content.articles WHERE id = $1`, [article]);
    assert.deepEqual(art[0], { likes: 0, saves: 0 });
    // Everyone starts again with the starter money, and the stock is back to a fresh listing.
    const { rows: cash } = await pool.query(`SELECT cash_balance, credit_balance FROM market.portfolio_cash_balances ORDER BY user_id`);
    assert.deepEqual(cash.map((row) => [Number(row.cash_balance), Number(row.credit_balance)]), [[reset.starter_cash, reset.starter_credit], [reset.starter_cash, reset.starter_credit]]);
    const { rows: stock } = await pool.query(`SELECT circulating_supply, current_mid_price FROM market.market_assets WHERE id = $1`, [asset]);
    assert.deepEqual([Number(stock[0].circulating_supply), stock[0].current_mid_price], [0, null]);
    // An admin's pause holds until they reopen.
    const { rows: state } = await pool.query(`SELECT trading_status, trading_message FROM market.market_runtime_state`);
    assert.deepEqual(state[0], { trading_status: "manual_closed", trading_message: "Resetting" });
  });

  await t.test("an open market stays open", async () => {
    await pool.query(`UPDATE market.market_runtime_state SET trading_status = 'open', trading_message = NULL`);
    await marketAdmin.resetMarketState(pool, { allowed: true });
    const { rows } = await pool.query(`SELECT trading_status FROM market.market_runtime_state`);
    assert.equal(rows[0].trading_status, "open");
  });
});
