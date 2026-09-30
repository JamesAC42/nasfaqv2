const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const exchange = require("../src/services/games/exchange");

// Capsule items on the exchange, end to end on a freshly migrated database (its own): listing and
// escrow (with unequipping), buying, auctions, trades, what can't be traded, the 24-hour hold, the
// one-of-each rule, the freeze, prices that ignore repeat pairs, and the admin review's patterns.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("capsule items on the exchange", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_items_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_items_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_items_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
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

  // ── Players and prizes ──
  const user = async (name, { daysOld = 30 } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, created_at)
       VALUES ($1, lower($1), lower($1) || '@example.test', true, 'x', 'x', '{}', now() - make_interval(days => $2)) RETURNING id`,
      [name, daysOld]
    );
    const id = Number(rows[0].id);
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance) VALUES ($1, 10000) ON CONFLICT (user_id) DO UPDATE SET cash_balance = 10000`, [id]);
    return id;
  };
  const cash = async (id) => Number((await pool.query(`SELECT cash_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [id])).rows[0].cash_balance);
  const prize = (key, rarity, { tradable = true, type = "hat" } = {}) =>
    pool.query(
      `INSERT INTO games.gacha_prize_items (game_key, cosmetic_key, display_name, cosmetic_type, rarity, slot_key, image_key, filename, tradable)
       VALUES ('capsule-gacha', $1, $2, $3, $4, $3, 'gacha-prizes/' || $1 || '.png', $1 || '.png', $5)`,
      [key, `Prize ${key}`, type, rarity, tradable]
    );
  const grant = async (userId, key, rarity, source = "gacha", granted = "now()") => {
    const { rows } = await pool.query(
      `INSERT INTO games.user_cosmetics (user_id, cosmetic_key, cosmetic_type, rarity, source_type, source_reference_id, metadata_json, granted_at)
       VALUES ($1, $2, 'hat', $3, $4, 7, '{"display_name":"kept"}', ${granted}) RETURNING id, granted_at`,
      [userId, key, rarity, source]
    );
    return rows[0];
  };
  const owns = async (userId, key) => (await pool.query(`SELECT source_type, granted_at, source_reference_id FROM games.user_cosmetics WHERE user_id = $1 AND cosmetic_key = $2`, [userId, key])).rows;

  const alice = await user("alice");
  const bob = await user("bob");
  const carol = await user("carol");
  await prize("crown", "rare");
  await prize("cap", "common");
  await prize("pin", "epic");
  await prize("event", "legendary", { tradable: false });
  await prize("setframe", "rare");
  await exchange.refreshItemCatalog(pool, { force: true });

  // ── What can't be traded ──
  const aliceCrown = await grant(alice, "crown", "rare", "gacha", "now() - interval '40 days'");
  await grant(alice, "event", "legendary");
  await grant(alice, "setframe", "rare", "set_reward");
  await pool.query(`INSERT INTO games.user_equipped_cosmetics (user_id, slot_key, user_cosmetic_id) VALUES ($1, 'hat', $2)`, [alice, aliceCrown.id]);
  const statuses = Object.fromEntries((await exchange.myItems(pool, { userId: alice })).items.map((item) => [item.key, item]));
  assert.deepEqual([statuses.crown.tradable, statuses.event.reason, statuses.setframe.reason], [true, "untradable", "not_from_capsule"]);
  const list = (userId, key, extra = {}) => exchange.createListing(pool, { userId, cosmeticKey: key, kind: "fixed", price: 100, ...extra });
  await assert.rejects(list(alice, "event"), { code: "item_not_tradable" });
  await assert.rejects(list(alice, "setframe"), { code: "item_not_tradable" });
  await assert.rejects(list(alice, "pin"), { code: "item_not_owned" });

  // ── List (escrow, unequips), then buy ──
  const { listing } = await list(alice, "crown");
  assert.equal(listing.item_type, "cosmetic");
  assert.deepEqual([listing.item.key, listing.item.name, listing.item.rarity, listing.card], ["crown", "Prize crown", "rare", null]);
  assert.deepEqual(await owns(alice, "crown"), []);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM games.user_equipped_cosmetics WHERE user_id = $1`, [alice])).rows[0].n, 0);
  assert.equal((await exchange.browseItems(pool, {})).listings.length, 1);
  assert.equal((await exchange.browseListings(pool, {})).listings.length, 0); // the card market doesn't see it
  await assert.rejects(exchange.buyListing(pool, { userId: alice, listingId: listing.id }), { code: "own_listing" });
  const bought = await exchange.buyListing(pool, { userId: bob, listingId: listing.id });
  assert.deepEqual([bought.price, bought.fee, bought.proceeds], [100, 5, 95]);
  assert.deepEqual([await cash(alice), await cash(bob)], [10095, 9900]);
  const [bobCrown] = await owns(bob, "crown");
  assert.equal(bobCrown.source_type, "exchange");
  const sale = (await pool.query(`SELECT item_type, cosmetic_key, card_key, rarity, price FROM games.card_sales`)).rows[0];
  assert.deepEqual({ ...sale, price: Number(sale.price) }, { item_type: "cosmetic", cosmetic_key: "crown", card_key: null, rarity: "rare", price: 100 });
  const bell = (await pool.query(`SELECT title, body, href FROM market.notifications WHERE user_id = $1 ORDER BY id`, [bob])).rows;
  assert.deepEqual(bell.map((row) => row.href), ["/games/item-locker"]);
  assert.match(bell[0].body, /Prize crown for \$100/);

  // ── The 24-hour hold, and one of each ──
  await assert.rejects(list(bob, "crown"), (error) => error.code === "item_on_hold" && Date.parse(error.available_at) > Date.now() + 23 * 3_600_000);
  assert.equal((await exchange.myItems(pool, { userId: bob })).items.find((item) => item.key === "crown").reason, "on_hold");
  await grant(carol, "crown", "rare");
  const carolListing = (await list(carol, "crown", { price: 120 })).listing;
  await assert.rejects(exchange.buyListing(pool, { userId: bob, listingId: carolListing.id }), { code: "item_already_owned" });

  // ── Cancelling puts the row back exactly (no hold) ──
  const carolBefore = (await pool.query(`SELECT granted_at FROM games.user_cosmetics WHERE user_id = $1 AND cosmetic_key = 'crown'`, [carol])).rows;
  assert.equal(carolBefore.length, 0);
  await exchange.cancelListing(pool, { userId: carol, listingId: carolListing.id });
  const [carolBack] = await owns(carol, "crown");
  assert.deepEqual([carolBack.source_type, Number(carolBack.source_reference_id)], ["gacha", 7]);
  const relisted = (await list(carol, "crown", { kind: "auction", price: undefined, startPrice: 50, durationHours: 1 })).listing;

  // ── An auction: alice (who sold hers) wins it ──
  await assert.rejects(exchange.placeBid(pool, { userId: bob, listingId: relisted.id, amount: 60 }), { code: "item_already_owned" });
  await exchange.placeBid(pool, { userId: alice, listingId: relisted.id, amount: 60 });
  await pool.query(`UPDATE games.card_listings SET ends_at = now() - interval '1 second' WHERE id = $1`, [relisted.id]);
  assert.equal(await exchange.settleDueListings(pool), 1);
  assert.equal((await owns(alice, "crown"))[0].source_type, "exchange");
  assert.deepEqual(await owns(carol, "crown"), []);

  // ── An unsold listing goes back too ──
  await grant(carol, "cap", "common", "gacha", "now() - interval '3 days'");
  const capListing = (await list(carol, "cap")).listing;
  await pool.query(`UPDATE games.card_listings SET ends_at = now() - interval '1 second' WHERE id = $1`, [capListing.id]);
  await exchange.settleDueListings(pool);
  assert.equal((await owns(carol, "cap"))[0].source_type, "gacha");

  // ── Trades: items both ways, declines put the item back, accepts start the hold ──
  await grant(bob, "pin", "epic");
  // Nobody can be offered an item they already have (alice holds a crown now).
  await assert.rejects(exchange.proposeTrade(pool, { userId: bob, toUsername: "alice", give: { cosmetics: ["crown"] }, ask: { cash: 1 } }), { code: "item_already_owned" });
  const offer = (await exchange.proposeTrade(pool, { userId: carol, toUsername: "bob", give: { cosmetics: ["cap"] }, ask: { cash: 40 } })).trade;
  assert.deepEqual(offer.give.items.map((item) => item.key), ["cap"]);
  assert.deepEqual(await owns(carol, "cap"), []);
  await exchange.respondToTrade(pool, { userId: bob, tradeId: offer.id, action: "decline" });
  assert.equal((await owns(carol, "cap"))[0].source_type, "gacha");
  const swap = (await exchange.proposeTrade(pool, { userId: carol, toUsername: "bob", give: { cosmetics: ["cap"] }, ask: { cosmetics: ["pin"] } })).trade;
  await exchange.respondToTrade(pool, { userId: bob, tradeId: swap.id, action: "accept" });
  assert.equal((await owns(carol, "pin"))[0].source_type, "exchange");
  assert.equal((await owns(bob, "cap"))[0].source_type, "exchange");
  assert.deepEqual([await owns(carol, "cap"), await owns(bob, "pin")], [[], []]);
  await assert.rejects(
    exchange.proposeTrade(pool, { userId: carol, toUsername: "bob", give: { cosmetics: ["pin"] }, ask: { cash: 1 } }),
    { code: "item_on_hold" }
  );

  // After the hold, it can go again.
  await pool.query(`UPDATE games.user_cosmetics SET granted_at = now() - interval '25 hours' WHERE user_id = $1 AND cosmetic_key = 'crown'`, [bob]);
  const bobListing = (await list(bob, "crown", { price: 150 })).listing;
  assert.equal(bobListing.item.key, "crown");

  // ── Freeze ──
  await pool.query(`UPDATE market.users SET exchange_frozen_at = now() WHERE id = $1`, [bob]);
  await assert.rejects(list(bob, "cap"), { code: "exchange_frozen" });
  await assert.rejects(exchange.buyListing(pool, { userId: bob, listingId: bobListing.id }), { code: "exchange_frozen" });
  await pool.query(`UPDATE market.users SET exchange_frozen_at = NULL WHERE id = $1`, [bob]);

  // ── Prices: the same two accounts again don't count ──
  await pool.query(`
    INSERT INTO games.card_sales (item_type, cosmetic_key, rarity, kind, price, fee, seller_id, buyer_id, created_at) VALUES
      ('cosmetic', 'pin', 'epic', 'fixed', 200, 10, ${alice}, ${carol}, now() - interval '3 hours'),
      ('cosmetic', 'pin', 'epic', 'fixed', 9000, 450, ${carol}, ${alice}, now() - interval '2 hours'),
      ('cosmetic', 'pin', 'epic', 'fixed', 9500, 475, ${alice}, ${carol}, now() - interval '1 hour')
  `);
  const book = await exchange.itemPriceBook(pool);
  assert.deepEqual([book.pin.last, book.pin.avg7d], [200, 200]);
  const detail = await exchange.itemDetail(pool, { cosmeticKey: "pin", viewerId: carol });
  assert.equal(detail.history.length, 3); // every sale shows in the history
  assert.equal(detail.stats.last, 200);
  assert.equal(detail.mine.reason, "on_hold");

  // ── Admin review: the pair that keeps trading, and one player dealing with several new accounts ──
  const fresh = [await user("new1", { daysOld: 5 }), await user("new2", { daysOld: 5 }), await user("new3", { daysOld: 5 })];
  for (const [index, id] of fresh.entries()) {
    const key = `gift${index}`;
    await prize(key, "common");
    await exchange.refreshItemCatalog(pool, { force: true });
    await grant(id, key, "common");
    const gift = (await list(id, key, { price: 10 })).listing;
    await exchange.buyListing(pool, { userId: carol, listingId: gift.id });
  }
  // A new account letting an epic go for $5 (it's worth about $200).
  await pool.query(`INSERT INTO games.card_sales (item_type, cosmetic_key, rarity, kind, price, fee, seller_id, buyer_id) VALUES ('cosmetic', 'pin', 'epic', 'fixed', 5, 0.25, ${fresh[0]}, ${carol})`);
  // The first legendary ever sold, between new accounts: no established price, so it's judged by the
  // rarity's sales so far (its own) rather than flagged as worth nothing.
  await prize("relic", "legendary");
  await exchange.refreshItemCatalog(pool, { force: true });
  await pool.query(`INSERT INTO games.card_sales (item_type, cosmetic_key, rarity, kind, price, fee, seller_id, buyer_id) VALUES ('cosmetic', 'relic', 'legendary', 'fixed', 500, 25, ${fresh[1]}, ${fresh[2]})`);
  const review = await exchange.reviewFlags(pool, { days: 14 });
  const pair = review.pairs.find((entry) => [entry.a.username, entry.b.username].sort().join() === "alice,carol");
  assert.ok(pair && pair.transfers >= 3);
  const funnel = review.funnels.find((entry) => entry.hub.username === "carol");
  assert.ok(funnel);
  assert.deepEqual(funnel.accounts.map((account) => account.username).sort(), ["new1", "new2", "new3"]);
  assert.ok(review.flags.some((flag) => flag.type === "sale" && /Prize pin \(epic item\)/.test(flag.summary)));
  assert.ok(!review.flags.some((flag) => /legendary item/.test(flag.summary)));
  assert.ok(review.flags.every((flag) => flag.type !== "sale" || flag.worth > 0));
});
