const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const ipo = require("../src/services/ipo");
const { getCachedBody } = require("../src/responseCache");

// Listing a crowded IPO (docs/market/ipo.md) on a freshly migrated database of its own: hundreds of
// players subscribed through the real hold path, oversubscribed on both talents, one of them with
// more subscribers than shares. Listing must fill exactly what allocate() says, refund the rest to the
// cent, leave the ledger summing to every balance, notify each subscriber once, and do it in a fixed
// number of statements however many players there are. Then the listing is reverted.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

const PLAYERS = 400;
const START_CASH = 10_000;
const round2 = (value) => Math.round(value * 100) / 100;
const cents = (value) => Math.round(Number(value) * 100);

/** The pool listEvent sees, counting every statement (inside the transaction and after it). */
function countingPool(pool) {
  const counts = { transaction: 0, outside: 0 };
  return {
    counts,
    query: (...args) => {
      counts.outside += 1;
      return pool.query(...args);
    },
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (...args) => {
          counts.transaction += 1;
          return client.query(...args);
        },
        release: (...args) => client.release(...args),
      };
    },
  };
}

test("listing a crowded, oversubscribed IPO in bulk", { skip: !databaseUrl, timeout: 300_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_ipo_bulk_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_ipo_bulk_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_ipo_bulk_test";
  const pool = new Pool({ connectionString: target.href, max: 4 });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const quiet = [console.warn, console.log];
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log] = quiet;
  }

  // Two talents in an open window: KYO offers 4,000 shares, SOP only 150.
  const talents = [
    { channel: "UCSjQDxud2HkAO2DVD3lwxmw", symbol: "KYO", name: "Kyoko", price: 6.37, fair: 7.08, maxShares: 10_000, offered: 4_000 },
    { channel: "UCROQtXcp2loQEmvpe5rhJzQ", symbol: "SOP", name: "Sopia", price: 7.11, fair: 7.9, maxShares: 10_000, offered: 150 },
  ];
  const { rows: events } = await pool.query(
    `INSERT INTO market.ipo_events (title, status, listing_date, window_opens_at, window_closes_at, opened_at)
     VALUES ('Crowded debut', 'open', '2099-01-05', now() - interval '1 day', now() + interval '1 day', now() - interval '1 day') RETURNING id`
  );
  const eventId = Number(events[0].id);
  for (const talent of talents) {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1,$2,$2,$3,true)`, [talent.channel, talent.name, talent.symbol]);
    const { rows } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw)
       VALUES ($1,$2,$3,'prelaunch',$4,0,$4,2000,400,$5,$5) RETURNING id`,
      [talent.channel, talent.symbol, talent.name, talent.maxShares, talent.fair]
    );
    talent.assetId = Number(rows[0].id);
    const { rows: listings } = await pool.query(
      `INSERT INTO market.ipo_listings (event_id, asset_id, debut_fair_value, ipo_price, starting_max_supply, shares_offered) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [eventId, talent.assetId, talent.fair, talent.price, talent.maxShares, talent.offered]
    );
    talent.listingId = Number(listings[0].id);
  }
  const [kyo, sop] = talents;

  const { rows: users } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     SELECT 'player' || i, 'player' || i, 'player' || i || '@example.test', true, 'x', 'x', '{}' FROM generate_series(1, $1) i ORDER BY i RETURNING id`,
    [PLAYERS]
  );
  const ids = users.map((row) => Number(row.id));
  await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance) SELECT unnest($1::bigint[]), $2`, [ids, START_CASH]);

  // Everyone asks for KYO (1 to 400 shares, the cap); 300 also ask for SOP. Some change their mind,
  // and a few withdraw.
  const kyoCap = Math.floor(kyo.offered * 0.1);
  for (const [i, userId] of ids.entries()) {
    await ipo.subscribe(pool, { userId, symbol: "KYO", shares: ((i * 7919) % kyoCap) + 1 });
    if (i < 300) await ipo.subscribe(pool, { userId, symbol: "SOP", shares: 2 + (i % 14) });
  }
  for (const userId of ids.filter((_, i) => i % 7 === 3)) await ipo.subscribe(pool, { userId, symbol: "KYO", shares: 5 });
  const withdrew = ids.filter((_, i) => i % 50 === 10);
  for (const userId of withdrew) await ipo.cancelSubscription(pool, { userId, symbol: "KYO" });

  const { rows: pending } = await pool.query(
    `SELECT id, listing_id, user_id, requested_shares, held_cash, created_at FROM market.ipo_subscriptions WHERE status = 'pending' ORDER BY created_at, id`
  );
  const expected = new Map();
  for (const talent of talents) {
    const subs = pending.filter((row) => Number(row.listing_id) === talent.listingId);
    const demand = subs.reduce((sum, row) => sum + Number(row.requested_shares), 0);
    assert.ok(demand > talent.offered, `${talent.symbol} is oversubscribed (${demand} for ${talent.offered})`);
    const shares = ipo.allocate(subs.map((row) => ({ id: String(row.id), requested: row.requested_shares, created_at: row.created_at.toISOString() })), talent.offered);
    for (const row of subs) expected.set(String(row.id), { allocated: shares.get(String(row.id)), held: Number(row.held_cash), talent, userId: Number(row.user_id), requested: Number(row.requested_shares), demand });
  }
  assert.equal(pending.filter((row) => Number(row.listing_id) === sop.listingId).length, 300, "more SOP subscribers than shares");

  const ledgerLines = async () =>
    Object.fromEntries(
      (await pool.query(`SELECT entry_type, count(*)::int AS n FROM market.ledger_entries WHERE entry_type IN ('ipo_cash_release', 'ipo_allocation') GROUP BY entry_type`)).rows.map((row) => [
        row.entry_type,
        row.n,
      ])
    );
  const linesBefore = await ledgerLines();
  const counted = countingPool(pool);
  const started = Date.now();
  const result = await ipo.listEvent(counted, eventId, { marketDate: "2099-01-05", force: true });
  const elapsed = Date.now() - started;
  t.diagnostic(`listing ${pending.length} subscriptions: ${counted.counts.transaction} statements in the transaction, ${counted.counts.outside} after it, ${elapsed} ms`);
  assert.ok(counted.counts.transaction <= 25, `the transaction runs a fixed number of statements (${counted.counts.transaction})`);
  assert.ok(counted.counts.outside <= 10, `notifications go out in bulk (${counted.counts.outside})`);

  // ── Totals ──
  for (const talent of talents) {
    const listed = result.listed.find((entry) => entry.symbol === talent.symbol);
    assert.equal(listed.allocated, talent.offered, `${talent.symbol}: the whole offering went out`);
    const { rows } = await pool.query(
      `SELECT a.status, a.circulating_supply, a.treasury_supply, a.current_mid_price, l.status AS listing_status, l.shares_allocated
       FROM market.market_assets a JOIN market.ipo_listings l ON l.asset_id = a.id WHERE a.id = $1`,
      [talent.assetId]
    );
    assert.equal(rows[0].status, "active");
    assert.equal(rows[0].listing_status, "listed");
    assert.equal(Number(rows[0].shares_allocated), talent.offered);
    assert.equal(Number(rows[0].circulating_supply), talent.offered);
    assert.equal(Number(rows[0].treasury_supply), talent.maxShares - talent.offered);
    assert.equal(Number(rows[0].current_mid_price), talent.price);
    const { rows: held } = await pool.query(`SELECT SUM(quantity) AS n FROM market.portfolio_holdings WHERE asset_id = $1`, [talent.assetId]);
    assert.equal(Number(held[0].n), talent.offered, `${talent.symbol}: holdings add up to the offering`);
  }
  assert.equal((await pool.query(`SELECT status FROM market.ipo_events WHERE id = $1`, [eventId])).rows[0].status, "listed");

  // ── Every subscription: what allocate() said, pro rata, at least one share each where there were enough ──
  const { rows: subsAfter } = await pool.query(`SELECT id, user_id, listing_id, status, allocated_shares, refunded_cash, held_cash FROM market.ipo_subscriptions`);
  const owed = new Map(ids.map((id) => [id, 0]));
  for (const row of subsAfter) {
    const want = expected.get(String(row.id));
    if (!want) {
      assert.equal(row.status, "cancelled", "withdrawn subscriptions are left alone");
      continue;
    }
    const allocated = Number(row.allocated_shares);
    assert.equal(allocated, want.allocated, `subscription ${row.id}`);
    assert.equal(Number(row.held_cash), 0);
    assert.equal(row.status, allocated > 0 ? "allocated" : "refunded");
    const cost = Math.min(want.held, round2(allocated * want.talent.price));
    assert.equal(cents(row.refunded_cash), cents(round2(want.held - cost)), `subscription ${row.id} refund`);
    owed.set(want.userId, owed.get(want.userId) + cost);
    if (want.talent === kyo) {
      assert.ok(allocated >= 1, "every KYO subscriber gets a share");
      assert.ok(allocated <= want.requested);
      const exact = (want.requested * kyo.offered) / want.demand;
      assert.ok(Math.abs(allocated - exact) < 2.5, `KYO pro rata: ${allocated} for ${want.requested} (exact ${exact.toFixed(2)})`);
    }
  }
  const sopShares = subsAfter.filter((row) => Number(row.listing_id) === sop.listingId).map((row) => Number(row.allocated_shares));
  assert.equal(sopShares.filter((n) => n === 1).length, 150, "SOP: the earliest 150 get one share each");
  assert.equal(sopShares.filter((n) => n === 0).length, 150, "SOP: the rest get all their cash back");

  // ── Wallets and the ledger ──
  const { rows: wallets } = await pool.query(
    `SELECT b.user_id, b.cash_balance, b.held_cash,
            COALESCE((SELECT SUM(cash_delta) FROM market.ledger_entries e WHERE e.user_id = b.user_id), 0) AS ledger_cash,
            COALESCE((SELECT SUM(cash_delta) FROM market.ledger_entries e WHERE e.user_id = b.user_id AND e.entry_type IN ('ipo_cash_release', 'ipo_allocation')), 0) AS listing_cash
     FROM market.portfolio_cash_balances b WHERE b.user_id = ANY($1::bigint[])`,
    [ids]
  );
  for (const wallet of wallets) {
    const userId = Number(wallet.user_id);
    assert.equal(Number(wallet.held_cash), 0, `user ${userId} has nothing held`);
    assert.equal(cents(wallet.cash_balance), cents(START_CASH - owed.get(userId)), `user ${userId} paid exactly for their shares`);
    assert.equal(cents(wallet.ledger_cash), cents(Number(wallet.cash_balance) - START_CASH), `user ${userId}: the ledger sums to the balance`);
  }
  const { rows: qty } = await pool.query(
    `SELECT h.user_id, h.asset_id, h.quantity, h.avg_cost_basis,
            (SELECT SUM(quantity_delta) FROM market.ledger_entries e WHERE e.user_id = h.user_id AND e.asset_id = h.asset_id) AS ledger_qty
     FROM market.portfolio_holdings h WHERE h.asset_id = ANY($1::bigint[])`,
    [talents.map((talent) => talent.assetId)]
  );
  for (const row of qty) {
    assert.equal(Number(row.quantity), Number(row.ledger_qty), "the ledger sums to each holding");
    const talent = talents.find((entry) => entry.assetId === Number(row.asset_id));
    assert.ok(Math.abs(Number(row.avg_cost_basis) - talent.price) < 0.01, "cost basis is the IPO price");
  }
  const linesAfter = await ledgerLines();
  assert.equal(linesAfter.ipo_cash_release - linesBefore.ipo_cash_release, expected.size, "listing writes one release line per subscription");
  assert.equal(linesAfter.ipo_allocation - (linesBefore.ipo_allocation ?? 0), [...expected.values()].filter((entry) => entry.allocated > 0).length, "and one allocation line per filled one");

  // ── One notification per subscription, in bulk ──
  const { rows: notes } = await pool.query(`SELECT count(*)::int AS n, count(DISTINCT user_id)::int AS players FROM market.notifications WHERE kind = 'ipo'`);
  assert.equal(notes[0].n, expected.size);
  assert.equal(notes[0].players, PLAYERS - withdrew.length + withdrew.filter((id) => ids.indexOf(id) < 300).length);

  // ── Reverting puts everyone back where they started ──
  const reverted = await ipo.revertListing(pool, eventId, { apply: true });
  assert.equal(reverted.applied, true);
  assert.equal(reverted.refunds.length, [...expected.values()].filter((entry) => entry.allocated > 0).length);
  const { rows: back } = await pool.query(`SELECT user_id, cash_balance, held_cash FROM market.portfolio_cash_balances WHERE user_id = ANY($1::bigint[])`, [ids]);
  for (const wallet of back) {
    assert.equal(cents(wallet.cash_balance), cents(START_CASH), `user ${wallet.user_id} has all their Cash back`);
    assert.equal(Number(wallet.held_cash), 0);
  }
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.portfolio_holdings WHERE asset_id = ANY($1::bigint[])`, [talents.map((talent) => talent.assetId)])).rows[0].n, 0);

  // ── Calling off a crowded IPO is bulk too ──
  const { rows: again } = await pool.query(
    `INSERT INTO market.ipo_events (title, status, listing_date, window_opens_at, window_closes_at, opened_at)
     VALUES ('Crowded debut, again', 'open', '2099-02-05', now() - interval '1 day', now() + interval '1 day', now() - interval '1 day') RETURNING id`
  );
  await pool.query(`INSERT INTO market.ipo_listings (event_id, asset_id, ipo_price, starting_max_supply, shares_offered) VALUES ($1,$2,$3,$4,$5)`, [
    again[0].id,
    kyo.assetId,
    kyo.price,
    kyo.maxShares,
    kyo.offered,
  ]);
  for (const [i, userId] of ids.slice(0, 120).entries()) await ipo.subscribe(pool, { userId, symbol: "KYO", shares: 1 + (i % 30) });
  const notesBefore = (await pool.query(`SELECT count(*)::int AS n FROM market.notifications`)).rows[0].n;
  const calling = countingPool(pool);
  const called = await ipo.cancelEvent(calling, Number(again[0].id));
  t.diagnostic(`calling off 120 subscriptions: ${calling.counts.transaction} statements in the transaction, ${calling.counts.outside} after it`);
  assert.equal(called.refunded, 120);
  assert.ok(calling.counts.transaction <= 15, `calling off runs a fixed number of statements (${calling.counts.transaction})`);
  const { rows: refunded } = await pool.query(
    `SELECT b.user_id, b.cash_balance, b.held_cash, COALESCE((SELECT SUM(cash_delta) FROM market.ledger_entries e WHERE e.user_id = b.user_id), 0) AS ledger_cash
     FROM market.portfolio_cash_balances b WHERE b.user_id = ANY($1::bigint[])`,
    [ids]
  );
  for (const wallet of refunded) {
    assert.equal(cents(wallet.cash_balance), cents(START_CASH), `user ${wallet.user_id} has their Cash back`);
    assert.equal(Number(wallet.held_cash), 0);
    assert.equal(cents(wallet.ledger_cash), 0, `user ${wallet.user_id}: the ledger nets to zero`);
  }
  assert.deepEqual((await pool.query(`SELECT DISTINCT s.status FROM market.ipo_subscriptions s JOIN market.ipo_listings l ON l.id = s.listing_id WHERE l.event_id = $1`, [again[0].id])).rows, [
    { status: "cancelled" },
  ]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.notifications`)).rows[0].n - notesBefore, 120, "one notification each");

  // ── Subscribing side by side: the listing is only share-locked, and one player's requests queue ──
  const { rows: third } = await pool.query(
    `INSERT INTO market.ipo_events (title, status, listing_date, window_opens_at, window_closes_at, opened_at)
     VALUES ('Rush', 'open', '2099-03-05', now() - interval '1 day', now() + interval '1 day', now() - interval '1 day') RETURNING id`
  );
  await pool.query(`INSERT INTO market.ipo_listings (event_id, asset_id, ipo_price, starting_max_supply, shares_offered) VALUES ($1,$2,$3,$4,$5)`, [
    third[0].id,
    sop.assetId,
    sop.price,
    sop.maxShares,
    sop.offered * 100,
  ]);
  // The public view is cached (a long memory here, so only an invalidation can refresh it).
  const cachedView = async () =>
    JSON.parse(await getCachedBody(null, ipo.PUBLIC_CACHE_KEY, { ttlSeconds: 60, memoMs: 60_000, load: () => ipo.getPublicIpos(pool) })).events.find((event) => event.title === "Rush");
  assert.equal((await cachedView()).talents[0].subscribers, 0);
  const wide = new Pool({ connectionString: target.href, max: 16 });
  try {
    const [eager, fickle, ...crowd] = ids.slice(0, 80);
    const outcomes = await Promise.allSettled([
      ...crowd.map((userId, i) => ipo.subscribe(wide, { userId, symbol: "SOP", shares: 1 + (i % 9) })),
      // A double-click, three times over, with different amounts.
      ...[4, 7, 2].map((shares) => ipo.subscribe(wide, { userId: eager, symbol: "SOP", shares })),
      // Subscribing and withdrawing at once.
      ipo.subscribe(wide, { userId: fickle, symbol: "SOP", shares: 5 }).then(() => ipo.subscribe(wide, { userId: fickle, symbol: "SOP", shares: 6 })),
      ipo.cancelSubscription(wide, { userId: fickle, symbol: "SOP" }).catch((error) => (error.code === "subscription_not_found" ? null : Promise.reject(error))),
    ]);
    const failed = outcomes.filter((outcome) => outcome.status === "rejected");
    assert.deepEqual(failed.map((outcome) => outcome.reason?.code || outcome.reason?.message), [], "nothing deadlocked or collided");
  } finally {
    await wide.end();
  }
  const { rows: rush } = await pool.query(
    `SELECT s.user_id, s.status, s.held_cash, s.requested_shares, b.cash_balance, b.held_cash AS wallet_held
     FROM market.ipo_subscriptions s JOIN market.ipo_listings l ON l.id = s.listing_id JOIN market.portfolio_cash_balances b ON b.user_id = s.user_id
     WHERE l.event_id = $1`,
    [third[0].id]
  );
  assert.equal(rush.length, 80, "one subscription per player");
  const live = rush.filter((row) => row.status === "pending");
  assert.equal((await cachedView()).talents[0].subscribers, live.length, "subscribing dropped the cached view");
  for (const row of rush) {
    const held = row.status === "pending" ? Number(row.held_cash) : 0;
    assert.equal(cents(row.wallet_held), cents(held), `user ${row.user_id}: the wallet holds what the subscription says`);
    assert.equal(cents(Number(row.cash_balance) + Number(row.wallet_held)), cents(START_CASH), `user ${row.user_id}: no cash lost or made`);
    if (row.status === "pending") assert.equal(cents(row.held_cash), cents(round2(Number(row.requested_shares) * sop.price)));
  }
});
