// The card exchange: a public market (buy-now listings and auctions) and direct trades between
// players. See docs/games/GAMES_DESIGN.md §Card exchange.
//
// Rules that keep it honest:
// - One copy moves at a time. Stars follow copies (stars = copies held, max 5): selling a
//   duplicate drops a star; a received copy adds one but never pays duplicate shards.
// - Starter-pack copies are bound (games.user_cards.bound_copies) and can't leave the account.
// - Anything offered is in escrow: a listed copy leaves the collection until it sells or comes
//   back; a bid holds the bidder's cash (refunded the moment they're outbid); a trade offer holds
//   the proposer's side until it's accepted, declined, countered, cancelled or expires.
// - Trading needs a verified email and an account a few days old, with caps on active listings,
//   open offers and new listings/offers per day. An admin can freeze a player out of it.
// - Market sales pay a 5% fee (a cash sink). Direct trades are free.
//
// Capsule items (cosmetics) go through the same listings, auctions and trades (item_type =
// 'cosmetic'), with their own rules:
// - Only items pulled from the capsule can change hands (and ones bought or traded for, which were
//   pulled once). Set rewards and grants stay put, and an admin can mark a prize untradable.
// - A player holds one of each item, so nobody can buy or be given one they already have.
// - An item you receive is held for 24 hours before you can list or trade it on: that slows alts
//   passing things along, and a stolen account's items can't be moved out at once.
// - The escrowed row is kept whole (cosmetic_json) and put back exactly as it was if it doesn't sell.

const cards = require("./cards");
const cardGacha = require("./cardGacha");
const gachaPrizeCatalog = require("./gachaPrizeCatalog");
const gamesWallet = require("./wallet");
const hub = require("./tables/hub");
const notifications = require("../notifications");

const FEE_RATE = 0.05;
const MAX_PRICE = 1_000_000;
const AUCTION_HOURS = [1, 12, 24, 48];
const FIXED_LISTING_DAYS = 7;
const SNIPE_WINDOW_MS = 2 * 60_000; // a bid in the last 2 minutes pushes the end out to 2 minutes
const TRADE_HOURS = 48;
const MAX_ACTIVE_LISTINGS = 25;
const MAX_OPEN_OFFERS = 10;
const MAX_TRADE_CARD_KINDS = 10;
const MAX_TRADE_COPIES = 20;
const MAX_TRADE_SHARDS = 10_000_000;
const DAILY_ACTIONS = Number(process.env.EXCHANGE_DAILY_ACTIONS || 40);
const MIN_ACCOUNT_AGE_HOURS = Number(process.env.EXCHANGE_MIN_ACCOUNT_AGE_HOURS ?? 72);
const TAPE_SIZE = 40;
const SCHEDULER_LOCK_KEY = 9_204_077;
const ITEM_RARITIES = ["common", "rare", "epic", "legendary"];
const MAX_TRADE_ITEMS = 10;
// Where a tradable item came from: a capsule pull, or the exchange (it was pulled once).
const TRADABLE_SOURCES = ["gacha", "exchange"];
const RECEIVED_HOLD_HOURS = Number(process.env.EXCHANGE_RECEIVED_HOLD_HOURS ?? 24);
const CAPSULE = gachaPrizeCatalog.GACHA_GAME_KEY;

function exchangeError(code, extra = {}) {
  return Object.assign(new Error(code), { code }, extra);
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const num = (value) => (value === null || value === undefined ? null : Number(value));
const feeOf = (price) => round2(price * FEE_RATE);
/** The next bid must beat the current one by 5% (at least $1). */
const minIncrement = (current) => Math.max(1, round2(current * 0.05));

function parsePrice(value, { field = "price" } = {}) {
  const parsed = round2(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_PRICE) throw exchangeError("invalid_price", { field });
  return parsed;
}

// ── Talents and card presentation ─────────────────────────────────────────
async function talentLookup(db) {
  await refreshItemCatalog(db);
  const talents = await cards.listTalents(db);
  return cards.talentMap(talents);
}

// ── Capsule items ─────────────────────────────────────────────────────────
// The prize catalog's names and pictures, for showing items (a minute stale at most). Whether an
// item can be traded is always read fresh, inside the transaction that moves it.
let itemCatalog = new Map();
let itemCatalogAt = 0;

async function refreshItemCatalog(db, { force = false } = {}) {
  if (!force && Date.now() - itemCatalogAt < 60_000) return itemCatalog;
  const { rows } = await db.query(
    `SELECT cosmetic_key, display_name, cosmetic_type, rarity, slot_key, image_key, tradable FROM games.gacha_prize_items WHERE game_key = $1 AND NOT is_deleted`,
    [CAPSULE]
  );
  itemCatalog = new Map(rows.map((row) => [row.cosmetic_key, row]));
  itemCatalogAt = Date.now();
  return itemCatalog;
}

const validItemKey = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,79}$/.test(value);

/** An item as the exchange shows it: the catalog's name and picture, else what the escrowed row kept. */
function itemView(cosmeticKey, snapshot = null) {
  const entry = itemCatalog.get(cosmeticKey);
  const meta = snapshot?.metadata || {};
  const imageKey = entry?.image_key || meta.image_key || "";
  return {
    key: cosmeticKey,
    name: entry?.display_name || meta.display_name || cosmeticKey,
    type: entry?.cosmetic_type || snapshot?.cosmetic_type || null,
    rarity: entry?.rarity || snapshot?.rarity || "common",
    slot_key: entry?.slot_key || meta.slot_key || null,
    image_url: imageKey ? gachaPrizeCatalog.imageUrlForKey(imageKey) : meta.image_url || null,
  };
}

/**
 * Takes one of a player's tradable copies of an item out of their locker (unequipping it) and
 * returns the row as it was, for escrow. Throws item_not_owned / item_not_tradable / item_on_hold.
 */
async function takeCosmeticWithClient(client, { userId, cosmeticKey }) {
  const { rows } = await client.query(
    `
    SELECT uc.id, uc.cosmetic_key, uc.cosmetic_type, uc.rarity, uc.source_type, uc.source_reference_id, uc.metadata_json,
      uc.granted_at, p.tradable,
      (uc.source_type = 'exchange' AND uc.granted_at > now() - make_interval(hours => $3::int)) AS on_hold,
      uc.granted_at + make_interval(hours => $3::int) AS hold_ends
    FROM games.user_cosmetics uc
    LEFT JOIN games.gacha_prize_items p ON p.game_key = $4 AND p.cosmetic_key = uc.cosmetic_key AND NOT p.is_deleted
    WHERE uc.user_id = $1 AND uc.cosmetic_key = $2
    ORDER BY uc.granted_at ASC
    FOR UPDATE OF uc
  `,
    [userId, cosmeticKey, RECEIVED_HOLD_HOURS, CAPSULE]
  );
  if (!rows.length) throw exchangeError("item_not_owned", { cosmetic_key: cosmeticKey });
  const tradable = rows.filter((row) => TRADABLE_SOURCES.includes(row.source_type) && row.tradable === true && ITEM_RARITIES.includes(row.rarity));
  if (!tradable.length) throw exchangeError("item_not_tradable", { cosmetic_key: cosmeticKey });
  const ready = tradable.find((row) => !row.on_hold);
  if (!ready) {
    const availableAt = tradable.map((row) => new Date(row.hold_ends).getTime()).sort((a, b) => a - b)[0];
    throw exchangeError("item_on_hold", { cosmetic_key: cosmeticKey, available_at: new Date(availableAt).toISOString() });
  }
  // Equipped? The slot row goes with it (ON DELETE CASCADE).
  await client.query(`DELETE FROM games.user_cosmetics WHERE id = $1`, [ready.id]);
  return {
    cosmetic_key: ready.cosmetic_key,
    cosmetic_type: ready.cosmetic_type,
    rarity: ready.rarity,
    source_type: ready.source_type,
    source_reference_id: ready.source_reference_id === null ? null : Number(ready.source_reference_id),
    metadata: ready.metadata_json || {},
    granted_at: new Date(ready.granted_at).toISOString(),
  };
}

/**
 * Puts an escrowed item in a locker: "returned" restores the seller's row exactly (no hold);
 * "received" is a new owner's, from the exchange, and starts the 24-hour hold.
 */
async function giveCosmeticWithClient(client, { userId, snapshot, mode, referenceId = null }) {
  if (mode === "returned") {
    await client.query(
      `
      INSERT INTO games.user_cosmetics (user_id, cosmetic_key, cosmetic_type, rarity, source_type, source_reference_id, metadata_json, granted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
      [userId, snapshot.cosmetic_key, snapshot.cosmetic_type, snapshot.rarity, snapshot.source_type, snapshot.source_reference_id, JSON.stringify(snapshot.metadata || {}), snapshot.granted_at]
    );
    return;
  }
  await client.query(
    `
    INSERT INTO games.user_cosmetics (user_id, cosmetic_key, cosmetic_type, rarity, source_type, source_reference_id, metadata_json)
    VALUES ($1,$2,$3,$4,'exchange',$5,$6)
  `,
    [userId, snapshot.cosmetic_key, snapshot.cosmetic_type, snapshot.rarity, referenceId, JSON.stringify(snapshot.metadata || {})]
  );
}

/** A player can't take an item they already have: in their locker, on the market, or offered in a trade. */
async function assertCanReceiveItem(client, userId, cosmeticKey) {
  const { rows } = await client.query(
    `
    SELECT EXISTS (SELECT 1 FROM games.user_cosmetics WHERE user_id = $1 AND cosmetic_key = $2)
      OR EXISTS (SELECT 1 FROM games.card_listings WHERE seller_id = $1 AND item_type = 'cosmetic' AND cosmetic_key = $2 AND status = 'active')
      OR EXISTS (
        SELECT 1 FROM games.card_trades
        WHERE from_user_id = $1 AND status = 'pending' AND give_json->'cosmetics' @> jsonb_build_array(jsonb_build_object('cosmetic_key', $2::text))
      ) AS has
  `,
    [userId, cosmeticKey]
  );
  if (rows[0].has) throw exchangeError("item_already_owned", { cosmetic_key: cosmeticKey });
}

function cardView(talents, cardKey, extra = {}) {
  const parsed = cards.parseCardKey(cardKey);
  if (!parsed) return null;
  const talent = talents.get(parsed.symbol) || { symbol: parsed.symbol, name: parsed.symbol, unit: null, icon: null, color: null };
  return cards.publicCard(talent, parsed.rarity, extra);
}

// ── Live feeds ────────────────────────────────────────────────────────────
// Public tape on the games socket (`exchange`) plus each player's own `me` feed. Events are
// queued during a transaction and sent after it commits.
const tape = [];
let tapeSeq = 0;

hub.registerSnapshotProvider((channel) => (channel === "exchange" ? { type: "tape", events: tape, server_time: Date.now() } : null));

function createOutbox() {
  const items = [];
  return {
    public(event) {
      items.push({ kind: "public", event });
    },
    user(userId, alert) {
      if (userId) items.push({ kind: "user", userId: Number(userId), alert });
    },
    userItems() {
      return items.filter((item) => item.kind === "user");
    },
    /** A bell-only notification (no toast), e.g. "a card you want was listed". */
    notice(userId, notification) {
      if (userId) items.push({ kind: "notice", userId: Number(userId), notification });
    },
    notices() {
      return items.filter((item) => item.kind === "notice");
    },
    flush() {
      for (const item of items) {
        if (item.kind === "public") {
          const event = { ...item.event, seq: ++tapeSeq, at: new Date().toISOString() };
          tape.unshift(event);
          tape.length = Math.min(tape.length, TAPE_SIZE);
          hub.publish("exchange", { type: "event", event, server_time: Date.now() });
        } else {
          hub.publishToUser(item.userId, { type: "exchange_alert", alert: { ...item.alert, at: new Date().toISOString() }, server_time: Date.now() });
        }
      }
      items.length = 0;
    },
  };
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  const outbox = createOutbox();
  try {
    await client.query("BEGIN");
    const result = await work(client, outbox);
    // The bell keeps them too, for players who weren't looking (or were offline).
    const noted = await notifications.recordExchangeAlerts(client, outbox.userItems());
    for (const item of outbox.notices()) noted.push(await notifications.notify(client, item.userId, item.notification, { publish: false }));
    await client.query("COMMIT");
    outbox.flush();
    notifications.publish(noted);
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Moving copies ─────────────────────────────────────────────────────────
/** Takes `qty` tradeable copies out of a player's collection (stars follow copies). */
async function takeCopiesWithClient(client, { userId, cardKey, qty = 1 }) {
  const { rows } = await client.query(
    `
    SELECT uc.id, uc.asset_id, uc.rarity, uc.stars, uc.copies, uc.bound_copies, a.symbol
    FROM games.user_cards uc
    JOIN market.market_assets a ON a.id = uc.asset_id
    WHERE uc.user_id = $1 AND uc.card_key = $2
    FOR UPDATE OF uc
  `,
    [userId, cardKey]
  );
  const row = rows[0];
  if (!row) throw exchangeError("card_not_owned", { card_key: cardKey });
  const tradeable = Number(row.copies) - Number(row.bound_copies);
  if (tradeable < qty) throw exchangeError(Number(row.bound_copies) > 0 && tradeable <= 0 ? "card_bound" : "card_not_tradeable", { card_key: cardKey, tradeable });
  const next = Number(row.copies) - qty;
  if (next === 0) {
    await client.query(`DELETE FROM games.user_cards WHERE id = $1`, [row.id]);
    await client.query(`DELETE FROM games.user_card_showcase WHERE user_id = $1 AND card_key = $2`, [userId, cardKey]);
    // Reactions come from owning any of her cards: the avatar goes with the last one.
    await client.query(
      `
      UPDATE market.users u SET profile_reaction = NULL
      WHERE u.id = $1
        AND u.profile_reaction LIKE $2 || '/%'
        AND NOT EXISTS (SELECT 1 FROM games.user_cards uc WHERE uc.user_id = u.id AND uc.asset_id = $3)
    `,
      [userId, row.symbol, row.asset_id]
    );
  } else {
    await client.query(`UPDATE games.user_cards SET copies = $2::int, stars = LEAST(stars::int, $2::int) WHERE id = $1`, [row.id, next]);
  }
  return { asset_id: Number(row.asset_id), rarity: row.rarity, symbol: row.symbol };
}

/** Adds copies (no duplicate shards: that would let trading mint shards). */
async function giveCopiesWithClient(client, { userId, cardKey, qty = 1 }) {
  const parsed = cards.parseCardKey(cardKey);
  const { rows } = await client.query(`SELECT id FROM market.market_assets WHERE symbol = $1`, [parsed.symbol]);
  if (!rows[0]) throw exchangeError("invalid_card");
  const talent = { symbol: parsed.symbol, asset_id: Number(rows[0].id) };
  let last = null;
  for (let index = 0; index < qty; index += 1) {
    last = await cardGacha.grantCardWithClient(client, { userId, talent, rarity: parsed.rarity, source: "exchange", awardShards: false });
  }
  return last;
}

// ── Eligibility and caps ──────────────────────────────────────────────────
async function eligibility(db, userId) {
  const { rows } = await db.query(`SELECT created_at, email_verified, exchange_frozen_at FROM market.users WHERE id = $1`, [userId]);
  if (!rows[0]) return { eligible: false, reason: "unauthenticated", available_at: null };
  if (rows[0].exchange_frozen_at) return { eligible: false, reason: "exchange_frozen", available_at: null };
  if (!rows[0].email_verified) return { eligible: false, reason: "email_verification_required", available_at: null };
  const availableAt = new Date(new Date(rows[0].created_at).getTime() + MIN_ACCOUNT_AGE_HOURS * 3_600_000);
  if (availableAt > new Date()) return { eligible: false, reason: "exchange_account_too_new", available_at: availableAt.toISOString() };
  return { eligible: true, reason: null, available_at: null };
}

async function assertEligible(db, userId) {
  const status = await eligibility(db, userId);
  if (!status.eligible) throw exchangeError(status.reason, { available_at: status.available_at });
}

async function usage(db, userId) {
  const { rows } = await db.query(
    `
    SELECT
      (SELECT count(*)::int FROM games.card_listings WHERE seller_id = $1 AND status = 'active') AS active_listings,
      (SELECT count(*)::int FROM games.card_trades WHERE from_user_id = $1 AND status = 'pending') AS open_offers,
      (SELECT count(*)::int FROM games.card_listings WHERE seller_id = $1 AND created_at > now() - interval '24 hours')
        + (SELECT count(*)::int FROM games.card_trades WHERE from_user_id = $1 AND created_at > now() - interval '24 hours') AS daily_actions
  `,
    [userId]
  );
  return {
    active_listings: rows[0].active_listings,
    max_active_listings: MAX_ACTIVE_LISTINGS,
    open_offers: rows[0].open_offers,
    max_open_offers: MAX_OPEN_OFFERS,
    daily_actions: rows[0].daily_actions,
    max_daily_actions: DAILY_ACTIONS,
  };
}

async function assertDailyCap(db, userId) {
  const used = await usage(db, userId);
  if (used.daily_actions >= DAILY_ACTIONS) throw exchangeError("exchange_daily_limit", { limit: DAILY_ACTIONS });
  return used;
}

// ── Listings ──────────────────────────────────────────────────────────────
const LISTING_SELECT = `
  SELECT l.*, s.username AS seller_username, b.username AS bidder_username, buyer.username AS buyer_username
  FROM games.card_listings l
  JOIN market.users s ON s.id = l.seller_id
  LEFT JOIN market.users b ON b.id = l.current_bidder_id
  LEFT JOIN market.users buyer ON buyer.id = l.buyer_id
`;

const isItemRow = (row) => row.item_type === "cosmetic";

function listingView(talents, row, viewerId = null) {
  const current = num(row.current_bid);
  const start = num(row.start_price);
  const buyNow = num(row.price);
  const isAuction = row.kind === "auction";
  const minBid = isAuction ? (current === null ? start : round2(current + minIncrement(current))) : null;
  const viewer = viewerId ? Number(viewerId) : null;
  const isItem = isItemRow(row);
  return {
    id: Number(row.id),
    item_type: isItem ? "cosmetic" : "card",
    card: isItem ? null : cardView(talents, row.card_key),
    card_key: row.card_key,
    item: isItem ? itemView(row.cosmetic_key, row.cosmetic_json) : null,
    cosmetic_key: row.cosmetic_key ?? null,
    kind: row.kind,
    status: row.status,
    seller: { id: Number(row.seller_id), username: row.seller_username },
    price: buyNow,
    start_price: start,
    current_bid: current,
    bid_count: Number(row.bid_count),
    leader: row.current_bidder_id ? { id: Number(row.current_bidder_id), username: row.bidder_username } : null,
    min_bid: minBid,
    // A buy-now price on an auction stays available until the bidding reaches it.
    buy_now: buyNow !== null && (!isAuction || current === null || current < buyNow) ? buyNow : null,
    ask: isAuction ? current ?? start : buyNow,
    extensions: Number(row.extensions),
    created_at: row.created_at,
    ends_at: row.ends_at,
    closed_at: row.closed_at,
    sale_price: num(row.sale_price),
    fee: num(row.fee),
    buyer: row.buyer_id ? { id: Number(row.buyer_id), username: row.buyer_username } : null,
    is_mine: viewer !== null && Number(row.seller_id) === viewer,
    is_leading: viewer !== null && Number(row.current_bidder_id) === viewer,
  };
}

async function loadListing(db, listingId, { lock = false } = {}) {
  const { rows } = await db.query(`${LISTING_SELECT} WHERE l.id = $1 ${lock ? "FOR UPDATE OF l" : ""}`, [listingId]);
  return rows[0] || null;
}

/** Lists one card copy (`cardKey`) or one capsule item (`cosmeticKey`): buy-now, or an auction. */
async function createListing(pool, { userId, cardKey = null, cosmeticKey = null, kind, price, startPrice, buyNow, durationHours }) {
  const isItem = cosmeticKey !== null && cosmeticKey !== undefined && cosmeticKey !== "";
  const parsed = isItem ? null : cards.parseCardKey(cardKey);
  if (isItem ? !validItemKey(cosmeticKey) : !parsed) throw exchangeError(isItem ? "invalid_item" : "invalid_card");
  if (kind !== "fixed" && kind !== "auction") throw exchangeError("invalid_listing");
  let fixedPrice = null;
  let start = null;
  let endsAt;
  if (kind === "fixed") {
    fixedPrice = parsePrice(price);
    endsAt = new Date(Date.now() + FIXED_LISTING_DAYS * 86_400_000);
  } else {
    start = parsePrice(startPrice, { field: "start_price" });
    if (buyNow !== null && buyNow !== undefined && buyNow !== "") {
      fixedPrice = parsePrice(buyNow, { field: "buy_now" });
      if (fixedPrice <= start) throw exchangeError("invalid_price", { field: "buy_now" });
    }
    const hours = Number(durationHours);
    if (!AUCTION_HOURS.includes(hours)) throw exchangeError("invalid_duration");
    endsAt = new Date(Date.now() + hours * 3_600_000);
  }

  await assertEligible(pool, userId);
  const used = await assertDailyCap(pool, userId);
  if (used.active_listings >= MAX_ACTIVE_LISTINGS) throw exchangeError("exchange_listing_limit", { limit: MAX_ACTIVE_LISTINGS });
  const talents = await talentLookup(pool);

  return withTransaction(pool, async (client, outbox) => {
    let listingId;
    if (isItem) {
      const snapshot = await takeCosmeticWithClient(client, { userId, cosmeticKey });
      const { rows } = await client.query(
        `
        INSERT INTO games.card_listings (seller_id, item_type, cosmetic_key, cosmetic_json, rarity, kind, price, start_price, ends_at)
        VALUES ($1,'cosmetic',$2,$3,$4,$5,$6,$7,$8)
        RETURNING id
      `,
        [userId, cosmeticKey, JSON.stringify(snapshot), snapshot.rarity, kind, fixedPrice, start, endsAt]
      );
      listingId = rows[0].id;
    } else {
      const taken = await takeCopiesWithClient(client, { userId, cardKey, qty: 1 });
      const { rows } = await client.query(
        `
        INSERT INTO games.card_listings (seller_id, card_key, asset_id, rarity, kind, price, start_price, ends_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id
      `,
        [userId, cardKey, taken.asset_id, parsed.rarity, kind, fixedPrice, start, endsAt]
      );
      listingId = rows[0].id;
    }
    const listing = listingView(talents, await loadListing(client, listingId), userId);
    outbox.public({ type: "listed", listing: { ...listing, is_mine: false } });
    if (isItem) return { listing };
    // Everyone who wants this card hears about it (the seller doesn't).
    const { rows: wishers } = await client.query(`SELECT user_id FROM games.card_wishlist WHERE card_key = $1 AND user_id <> $2 LIMIT 500`, [cardKey, userId]);
    const card = cardView(talents, cardKey);
    const priceText =
      kind === "fixed"
        ? `Buy it now for ${notifications.money(fixedPrice)}.`
        : `Auction from ${notifications.money(start)}${fixedPrice ? `, or ${notifications.money(fixedPrice)} to buy now` : ""}.`;
    for (const wisher of wishers) {
      outbox.notice(wisher.user_id, {
        kind: "wishlist",
        title: `On your wishlist: ${card ? `${card.name} ${card.rarity}` : "a card"} was listed`,
        body: priceText,
        href: `/games/exchange/card/${parsed.symbol}/${parsed.rarity}`,
        data: { card_key: cardKey, listing_id: listing.id },
      });
    }
    return { listing };
  });
}

async function cancelListing(pool, { userId, listingId }) {
  const talents = await talentLookup(pool);
  return withTransaction(pool, async (client, outbox) => {
    const row = await loadListing(client, listingId, { lock: true });
    if (!row) throw exchangeError("listing_not_found");
    if (Number(row.seller_id) !== Number(userId)) throw exchangeError("forbidden");
    if (row.status !== "active") throw exchangeError("listing_closed");
    if (row.kind === "auction" && Number(row.bid_count) > 0) throw exchangeError("auction_has_bids");
    await client.query(`UPDATE games.card_listings SET status = 'cancelled', closed_at = now() WHERE id = $1`, [row.id]);
    await returnListedItemWithClient(client, row);
    outbox.public({ type: "delisted", listing_id: Number(row.id), card_key: row.card_key, cosmetic_key: row.cosmetic_key ?? null });
    return { listing: listingView(talents, await loadListing(client, row.id), userId) };
  });
}

/** A listing that didn't sell: the card copy or the item back to its seller, as it was. */
async function returnListedItemWithClient(client, row) {
  if (isItemRow(row)) await giveCosmeticWithClient(client, { userId: row.seller_id, snapshot: row.cosmetic_json, mode: "returned" });
  else await giveCopiesWithClient(client, { userId: row.seller_id, cardKey: row.card_key });
}

/** What a listing is selling, for events and alerts: { card } or { item }. */
function listedThing(talents, row) {
  return isItemRow(row) ? { card: null, item: itemView(row.cosmetic_key, row.cosmetic_json) } : { card: cardView(talents, row.card_key), item: null };
}

/** Completes a sale inside a transaction: card or item to the buyer, proceeds (less the fee) to the seller. */
async function completeSaleWithClient(client, outbox, talents, row, { buyerId, price, kind }) {
  const fee = feeOf(price);
  const proceeds = round2(price - fee);
  if (proceeds > 0) {
    await gamesWallet.creditCashForGameWithClient(client, {
      userId: row.seller_id,
      amount: proceeds,
      entryType: "exchange_sale",
      referenceType: "card_listing",
      referenceId: row.id,
    });
  }
  if (isItemRow(row)) await giveCosmeticWithClient(client, { userId: buyerId, snapshot: row.cosmetic_json, mode: "received", referenceId: row.id });
  else await giveCopiesWithClient(client, { userId: buyerId, cardKey: row.card_key });
  await client.query(
    `UPDATE games.card_listings SET status = 'sold', closed_at = now(), buyer_id = $2, sale_price = $3, fee = $4 WHERE id = $1`,
    [row.id, buyerId, price, fee]
  );
  await client.query(
    `
    INSERT INTO games.card_sales (listing_id, item_type, card_key, cosmetic_key, asset_id, rarity, kind, price, fee, seller_id, buyer_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `,
    [row.id, isItemRow(row) ? "cosmetic" : "card", row.card_key, row.cosmetic_key ?? null, row.asset_id, row.rarity, kind, price, fee, row.seller_id, buyerId]
  );
  const { rows: buyerRows } = await client.query(`SELECT username FROM market.users WHERE id = $1`, [buyerId]);
  const { card, item } = listedThing(talents, row);
  const buyer = { id: Number(buyerId), username: buyerRows[0]?.username ?? "someone" };
  const seller = { id: Number(row.seller_id), username: row.seller_username };
  outbox.public({ type: "sale", listing_id: Number(row.id), card, item, card_key: row.card_key, cosmetic_key: row.cosmetic_key ?? null, price, kind, buyer, seller });
  outbox.user(row.seller_id, { kind: "sold", listing_id: Number(row.id), card, item, price, proceeds, fee, buyer });
  outbox.user(buyerId, { kind: kind === "auction" ? "won" : "bought", listing_id: Number(row.id), card, item, price, seller });
  return { price, fee, proceeds };
}

async function refundLeaderWithClient(client, outbox, talents, row, { reason, newAmount = null, newLeader = null }) {
  if (!row.current_bidder_id || num(row.current_bid) === null) return;
  await gamesWallet.creditCashForGameWithClient(client, {
    userId: row.current_bidder_id,
    amount: num(row.current_bid),
    entryType: "exchange_bid_refund",
    referenceType: "card_listing",
    referenceId: row.id,
  });
  await client.query(`UPDATE games.card_bids SET status = $2 WHERE listing_id = $1 AND status = 'leading'`, [row.id, reason === "outbid" ? "outbid" : "refunded"]);
  if (newLeader && Number(newLeader) === Number(row.current_bidder_id)) return; // raising your own bid
  outbox.user(row.current_bidder_id, {
    kind: reason === "outbid" ? "outbid" : "auction_lost",
    listing_id: Number(row.id),
    ...listedThing(talents, row),
    your_bid: num(row.current_bid),
    amount: newAmount,
    ends_at: row.ends_at,
  });
}

async function buyListing(pool, { userId, listingId }) {
  await assertEligible(pool, userId);
  const talents = await talentLookup(pool);
  return withTransaction(pool, async (client, outbox) => {
    const row = await loadListing(client, listingId, { lock: true });
    if (!row) throw exchangeError("listing_not_found");
    if (row.status !== "active" || new Date(row.ends_at) <= new Date()) throw exchangeError("listing_closed");
    if (Number(row.seller_id) === Number(userId)) throw exchangeError("own_listing");
    const view = listingView(talents, row, userId);
    if (view.buy_now === null) throw exchangeError("buy_now_unavailable");
    if (isItemRow(row)) await assertCanReceiveItem(client, userId, row.cosmetic_key);
    const price = view.buy_now;
    await gamesWallet.debitCashForGameWithClient(client, {
      userId,
      amount: price,
      entryType: "exchange_purchase",
      referenceType: "card_listing",
      referenceId: row.id,
    });
    if (row.kind === "auction") await refundLeaderWithClient(client, outbox, talents, row, { reason: "bought_out" });
    const sale = await completeSaleWithClient(client, outbox, talents, row, { buyerId: userId, price, kind: row.kind === "auction" ? "buy_now" : "fixed" });
    return { listing: listingView(talents, await loadListing(client, row.id), userId), ...sale };
  });
}

async function placeBid(pool, { userId, listingId, amount }) {
  await assertEligible(pool, userId);
  const talents = await talentLookup(pool);
  const bid = parsePrice(amount, { field: "amount" });
  return withTransaction(pool, async (client, outbox) => {
    const row = await loadListing(client, listingId, { lock: true });
    if (!row) throw exchangeError("listing_not_found");
    if (row.kind !== "auction") throw exchangeError("not_an_auction");
    if (row.status !== "active" || new Date(row.ends_at) <= new Date()) throw exchangeError("listing_closed");
    if (Number(row.seller_id) === Number(userId)) throw exchangeError("own_listing");
    const view = listingView(talents, row, userId);
    if (bid < view.min_bid) throw exchangeError("bid_too_low", { min_bid: view.min_bid });
    if (isItemRow(row)) await assertCanReceiveItem(client, userId, row.cosmetic_key);

    // A bid at or over the buy-now price just buys it at that price.
    if (view.buy_now !== null && bid >= view.buy_now) {
      await gamesWallet.debitCashForGameWithClient(client, { userId, amount: view.buy_now, entryType: "exchange_purchase", referenceType: "card_listing", referenceId: row.id });
      await refundLeaderWithClient(client, outbox, talents, row, { reason: "bought_out" });
      const sale = await completeSaleWithClient(client, outbox, talents, row, { buyerId: userId, price: view.buy_now, kind: "buy_now" });
      return { listing: listingView(talents, await loadListing(client, row.id), userId), bought: true, ...sale };
    }

    // Hold the new bid before releasing the old one (a player raising their own bid gets theirs back).
    await gamesWallet.debitCashForGameWithClient(client, { userId, amount: bid, entryType: "exchange_bid_hold", referenceType: "card_listing", referenceId: row.id });
    await refundLeaderWithClient(client, outbox, talents, row, { reason: "outbid", newAmount: bid, newLeader: userId });
    await client.query(`INSERT INTO games.card_bids (listing_id, bidder_id, amount) VALUES ($1,$2,$3)`, [row.id, userId, bid]);

    // No sniping: a late bid pushes the end out.
    const remaining = new Date(row.ends_at).getTime() - Date.now();
    const extended = remaining < SNIPE_WINDOW_MS;
    await client.query(
      `
      UPDATE games.card_listings
      SET current_bid = $2, current_bidder_id = $3, bid_count = bid_count + 1,
          ends_at = CASE WHEN $4 THEN now() + ($5 || ' milliseconds')::interval ELSE ends_at END,
          extensions = extensions + CASE WHEN $4 THEN 1 ELSE 0 END
      WHERE id = $1
    `,
      [row.id, bid, userId, extended, String(SNIPE_WINDOW_MS)]
    );
    const listing = listingView(talents, await loadListing(client, row.id), userId);
    outbox.public({ type: "bid", listing: { ...listing, is_mine: false, is_leading: false }, amount: bid, bidder: listing.leader, extended });
    if (!(row.current_bidder_id && Number(row.current_bidder_id) === Number(userId))) {
      outbox.user(row.seller_id, { kind: "bid_received", listing_id: listing.id, card: listing.card, item: listing.item, amount: bid, bidder: listing.leader, ends_at: listing.ends_at });
    }
    return { listing, extended };
  });
}

/** Closes listings whose time is up: auctions with bids sell, everything else goes back. */
async function settleDueListings(pool, { limit = 50 } = {}) {
  const talents = await talentLookup(pool);
  let settled = 0;
  for (;;) {
    const done = await withTransaction(pool, async (client, outbox) => {
      const { rows } = await client.query(
        `
        ${LISTING_SELECT}
        WHERE l.id = (
          SELECT id FROM games.card_listings
          WHERE status = 'active' AND ends_at <= now()
          ORDER BY ends_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
      `
      );
      const row = rows[0];
      if (!row) return false;
      if (row.kind === "auction" && row.current_bidder_id) {
        await client.query(`UPDATE games.card_bids SET status = 'won' WHERE listing_id = $1 AND status = 'leading'`, [row.id]);
        await completeSaleWithClient(client, outbox, talents, row, { buyerId: row.current_bidder_id, price: num(row.current_bid), kind: "auction" });
      } else {
        await client.query(`UPDATE games.card_listings SET status = 'expired', closed_at = now() WHERE id = $1`, [row.id]);
        await returnListedItemWithClient(client, row);
        outbox.public({ type: "delisted", listing_id: Number(row.id), card_key: row.card_key, cosmetic_key: row.cosmetic_key ?? null });
        outbox.user(row.seller_id, { kind: "expired", listing_id: Number(row.id), ...listedThing(talents, row) });
      }
      return true;
    });
    if (!done) break;
    settled += 1;
    if (settled >= limit) break;
  }
  return settled;
}

// ── Direct trades ─────────────────────────────────────────────────────────
function normalizeSide(raw) {
  const side = raw && typeof raw === "object" ? raw : {};
  const merged = new Map();
  for (const entry of Array.isArray(side.cards) ? side.cards : []) {
    const key = String(entry?.card_key ?? "");
    if (!cards.parseCardKey(key)) throw exchangeError("invalid_trade", { field: "cards" });
    const qty = Number(entry?.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1) throw exchangeError("invalid_trade", { field: "qty" });
    merged.set(key, (merged.get(key) || 0) + qty);
  }
  if (merged.size > MAX_TRADE_CARD_KINDS) throw exchangeError("invalid_trade", { field: "cards" });
  if ([...merged.values()].reduce((sum, qty) => sum + qty, 0) > MAX_TRADE_COPIES) throw exchangeError("invalid_trade", { field: "qty" });
  const cash = side.cash ? round2(side.cash) : 0;
  if (!Number.isFinite(cash) || cash < 0 || cash > MAX_PRICE * 10) throw exchangeError("invalid_trade", { field: "cash" });
  const shards = side.shards ? Number(side.shards) : 0;
  if (!Number.isInteger(shards) || shards < 0 || shards > MAX_TRADE_SHARDS) throw exchangeError("invalid_trade", { field: "shards" });
  // Capsule items by key (a player holds one of each). Anything else sent along is ignored.
  const items = [...new Set((Array.isArray(side.cosmetics) ? side.cosmetics : []).map((entry) => (typeof entry === "string" ? entry : entry?.cosmetic_key)))];
  if (items.some((key) => !validItemKey(key))) throw exchangeError("invalid_trade", { field: "cosmetics" });
  if (items.length > MAX_TRADE_ITEMS) throw exchangeError("invalid_trade", { field: "cosmetics" });
  return { cards: [...merged.entries()].map(([card_key, qty]) => ({ card_key, qty })), cosmetics: items.map((cosmetic_key) => ({ cosmetic_key })), cash, shards };
}

const sideItems = (side) => (Array.isArray(side?.cosmetics) ? side.cosmetics : []);
const sideEmpty = (side) => !side.cards.length && !sideItems(side).length && !side.cash && !side.shards;

/**
 * Moves a side out of `userId`'s account (into escrow, or straight to the other player). Returns
 * the side with each item's row as it was, so it can go back exactly or on to its new owner.
 */
async function takeSideWithClient(client, userId, side, { entryType, reason, tradeId }) {
  for (const entry of side.cards) await takeCopiesWithClient(client, { userId, cardKey: entry.card_key, qty: entry.qty });
  const cosmetics = [];
  for (const entry of sideItems(side)) cosmetics.push({ cosmetic_key: entry.cosmetic_key, snapshot: await takeCosmeticWithClient(client, { userId, cosmeticKey: entry.cosmetic_key }) });
  if (side.cash > 0) {
    await gamesWallet.debitCashForGameWithClient(client, { userId, amount: side.cash, entryType, referenceType: "card_trade", referenceId: tradeId });
  }
  if (side.shards > 0) await cardGacha.changeShardsWithClient(client, userId, -side.shards, reason, "card_trade", tradeId);
  return { ...side, cosmetics };
}

/** Hands a side to `userId`: items "received" (a new owner, held 24 hours) or "returned" (as they were). */
async function giveSideWithClient(client, userId, side, { entryType, reason, tradeId, mode }) {
  for (const entry of side.cards) await giveCopiesWithClient(client, { userId, cardKey: entry.card_key, qty: entry.qty });
  for (const entry of sideItems(side)) await giveCosmeticWithClient(client, { userId, snapshot: entry.snapshot, mode, referenceId: tradeId });
  if (side.cash > 0) {
    await gamesWallet.creditCashForGameWithClient(client, { userId, amount: side.cash, entryType, referenceType: "card_trade", referenceId: tradeId });
  }
  if (side.shards > 0) await cardGacha.changeShardsWithClient(client, userId, side.shards, reason, "card_trade", tradeId);
}

/** Neither player may end up with an item they already have. */
async function assertSidesReceivable(client, { giverId, takerId, give, ask }) {
  for (const entry of sideItems(give)) await assertCanReceiveItem(client, takerId, entry.cosmetic_key);
  for (const entry of sideItems(ask)) await assertCanReceiveItem(client, giverId, entry.cosmetic_key);
}

const TRADE_SELECT = `
  SELECT t.*, f.username AS from_username, f.profile_color AS from_color, tu.username AS to_username, tu.profile_color AS to_color
  FROM games.card_trades t
  JOIN market.users f ON f.id = t.from_user_id
  JOIN market.users tu ON tu.id = t.to_user_id
`;

function sideView(talents, side) {
  return {
    cards: (side?.cards ?? []).map((entry) => ({ ...cardView(talents, entry.card_key), qty: entry.qty })),
    items: sideItems(side).map((entry) => itemView(entry.cosmetic_key, entry.snapshot)),
    cash: Number(side?.cash ?? 0),
    shards: Number(side?.shards ?? 0),
  };
}

function tradeView(talents, row, viewerId) {
  const viewer = Number(viewerId);
  return {
    id: Number(row.id),
    status: row.status,
    from: { id: Number(row.from_user_id), username: row.from_username, profile_color: row.from_color },
    to: { id: Number(row.to_user_id), username: row.to_username, profile_color: row.to_color },
    give: sideView(talents, row.give_json),
    ask: sideView(talents, row.ask_json),
    message: row.message,
    counter_of: row.counter_of ? Number(row.counter_of) : null,
    created_at: row.created_at,
    expires_at: row.expires_at,
    responded_at: row.responded_at,
    direction: Number(row.from_user_id) === viewer ? "outgoing" : "incoming",
  };
}

async function loadTrade(db, tradeId, { lock = false } = {}) {
  const { rows } = await db.query(`${TRADE_SELECT} WHERE t.id = $1 ${lock ? "FOR UPDATE OF t" : ""}`, [tradeId]);
  return rows[0] || null;
}

async function proposeTrade(pool, { userId, toUsername, give, ask, message, counterOf = null }) {
  const giveSide = normalizeSide(give);
  const askSide = normalizeSide(ask);
  if (sideEmpty(giveSide) || sideEmpty(askSide)) throw exchangeError("trade_one_sided");
  const asked = new Set(askSide.cosmetics.map((entry) => entry.cosmetic_key));
  if (giveSide.cosmetics.some((entry) => asked.has(entry.cosmetic_key))) throw exchangeError("invalid_trade", { field: "cosmetics" });
  const note = message ? String(message).trim().slice(0, 200) || null : null;

  await assertEligible(pool, userId);
  const used = await assertDailyCap(pool, userId);
  if (used.open_offers >= MAX_OPEN_OFFERS) throw exchangeError("exchange_offer_limit", { limit: MAX_OPEN_OFFERS });
  const talents = await talentLookup(pool);

  return withTransaction(pool, async (client, outbox) => {
    let toUserId;
    let countered = null;
    if (counterOf) {
      countered = await loadTrade(client, counterOf, { lock: true });
      if (!countered || countered.status !== "pending" || Number(countered.to_user_id) !== Number(userId)) throw exchangeError("trade_not_found");
      toUserId = Number(countered.from_user_id);
    } else {
      const { rows } = await client.query(`SELECT id FROM market.users WHERE username_normalized = lower($1)`, [String(toUsername || "")]);
      if (!rows[0]) throw exchangeError("trade_partner_not_found");
      toUserId = Number(rows[0].id);
    }
    if (toUserId === Number(userId)) throw exchangeError("trade_with_self");

    // A counter closes the original first: its side goes back to whoever offered it.
    if (countered) {
      await giveSideWithClient(client, countered.from_user_id, countered.give_json, { entryType: "exchange_trade_refund", reason: "trade_refund", tradeId: countered.id, mode: "returned" });
      await client.query(`UPDATE games.card_trades SET status = 'countered', responded_at = now() WHERE id = $1`, [countered.id]);
    }
    await assertSidesReceivable(client, { giverId: Number(userId), takerId: toUserId, give: giveSide, ask: askSide });

    const { rows } = await client.query(
      `
      INSERT INTO games.card_trades (from_user_id, to_user_id, give_json, ask_json, message, counter_of, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' hours')::interval)
      RETURNING id
    `,
      [userId, toUserId, JSON.stringify(giveSide), JSON.stringify(askSide), note, countered ? countered.id : null, String(TRADE_HOURS)]
    );
    const tradeId = Number(rows[0].id);
    const escrowed = await takeSideWithClient(client, userId, giveSide, { entryType: "exchange_trade_escrow", reason: "trade_escrow", tradeId });
    // The offered items' rows ride with the offer, to hand over or put back exactly.
    if (escrowed.cosmetics.length) await client.query(`UPDATE games.card_trades SET give_json = $2 WHERE id = $1`, [tradeId, JSON.stringify(escrowed)]);
    const trade = tradeView(talents, await loadTrade(client, tradeId), userId);
    outbox.user(toUserId, { kind: countered ? "trade_countered" : "trade_offer", trade: { ...trade, direction: "incoming" } });
    return { trade };
  });
}

async function respondToTrade(pool, { userId, tradeId, action }) {
  if (!["accept", "decline", "cancel"].includes(action)) throw exchangeError("invalid_trade");
  if (action === "accept") await assertEligible(pool, userId);
  const talents = await talentLookup(pool);
  return withTransaction(pool, async (client, outbox) => {
    const row = await loadTrade(client, tradeId, { lock: true });
    if (!row) throw exchangeError("trade_not_found");
    const isRecipient = Number(row.to_user_id) === Number(userId);
    const isProposer = Number(row.from_user_id) === Number(userId);
    if (action === "cancel" ? !isProposer : !isRecipient) throw exchangeError("trade_not_found");
    if (row.status !== "pending") throw exchangeError("trade_closed", { status: row.status });
    if (action === "accept" && new Date(row.expires_at) <= new Date()) throw exchangeError("trade_closed", { status: "expired" });

    if (action === "accept") {
      // The accepting player hands over the ask; each side then receives the other's.
      await assertSidesReceivable(client, { giverId: Number(row.from_user_id), takerId: Number(userId), give: row.give_json, ask: row.ask_json });
      const handed = await takeSideWithClient(client, userId, row.ask_json, { entryType: "exchange_trade_settle", reason: "trade", tradeId: row.id });
      await giveSideWithClient(client, row.from_user_id, handed, { entryType: "exchange_trade_settle", reason: "trade", tradeId: row.id, mode: "received" });
      await giveSideWithClient(client, userId, row.give_json, { entryType: "exchange_trade_settle", reason: "trade", tradeId: row.id, mode: "received" });
      await client.query(`UPDATE games.card_trades SET status = 'accepted', responded_at = now() WHERE id = $1`, [row.id]);
    } else {
      await giveSideWithClient(client, row.from_user_id, row.give_json, { entryType: "exchange_trade_refund", reason: "trade_refund", tradeId: row.id, mode: "returned" });
      await client.query(`UPDATE games.card_trades SET status = $2, responded_at = now() WHERE id = $1`, [row.id, action === "decline" ? "declined" : "cancelled"]);
    }
    const trade = tradeView(talents, await loadTrade(client, row.id), userId);
    const other = action === "cancel" ? row.to_user_id : row.from_user_id;
    outbox.user(other, { kind: `trade_${action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled"}`, trade: tradeView(talents, await loadTrade(client, row.id), other) });
    if (action === "accept") {
      outbox.public({ type: "trade", from: trade.from.username, to: trade.to.username, cards: trade.give.cards.length + trade.ask.cards.length, items: trade.give.items.length + trade.ask.items.length });
    }
    return { trade };
  });
}

async function expireDueTrades(pool, { limit = 50 } = {}) {
  const talents = await talentLookup(pool);
  let expired = 0;
  for (;;) {
    const done = await withTransaction(pool, async (client, outbox) => {
      const { rows } = await client.query(
        `
        ${TRADE_SELECT}
        WHERE t.id = (
          SELECT id FROM games.card_trades WHERE status = 'pending' AND expires_at <= now()
          ORDER BY expires_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
        )
      `
      );
      const row = rows[0];
      if (!row) return false;
      await giveSideWithClient(client, row.from_user_id, row.give_json, { entryType: "exchange_trade_refund", reason: "trade_refund", tradeId: row.id, mode: "returned" });
      await client.query(`UPDATE games.card_trades SET status = 'expired', responded_at = now() WHERE id = $1`, [row.id]);
      outbox.user(row.from_user_id, { kind: "trade_expired", trade: tradeView(talents, { ...row, status: "expired" }, row.from_user_id) });
      return true;
    });
    if (!done) break;
    expired += 1;
    if (expired >= limit) break;
  }
  return expired;
}

async function listTrades(pool, { userId }) {
  const talents = await talentLookup(pool);
  const { rows } = await pool.query(
    `
    ${TRADE_SELECT}
    WHERE (t.from_user_id = $1 OR t.to_user_id = $1)
      AND (t.status = 'pending' OR t.responded_at > now() - interval '30 days')
    ORDER BY (t.status = 'pending') DESC, COALESCE(t.responded_at, t.created_at) DESC
    LIMIT 80
  `,
    [userId]
  );
  const trades = rows.map((row) => tradeView(talents, row, userId));
  return {
    incoming: trades.filter((trade) => trade.status === "pending" && trade.direction === "incoming"),
    outgoing: trades.filter((trade) => trade.status === "pending" && trade.direction === "outgoing"),
    history: trades.filter((trade) => trade.status !== "pending").slice(0, 30),
  };
}

/** A player's tradeable cards (for building a trade with them). */
async function tradeableCards(pool, { username }) {
  const { rows: users } = await pool.query(`SELECT id, username, profile_color FROM market.users WHERE username_normalized = lower($1)`, [String(username || "")]);
  if (!users[0]) throw exchangeError("trade_partner_not_found");
  const talents = await talentLookup(pool);
  const { rows } = await pool.query(
    `
    SELECT card_key, stars, copies, bound_copies
    FROM games.user_cards
    WHERE user_id = $1 AND copies > bound_copies
    ORDER BY array_position(ARRAY['UR','SSR','SR','R','C'], rarity), card_key
  `,
    [users[0].id]
  );
  return {
    user: { id: Number(users[0].id), username: users[0].username, profile_color: users[0].profile_color },
    cards: rows
      .map((row) => ({ ...cardView(talents, row.card_key, { stars: Number(row.stars) }), stars: Number(row.stars), copies: Number(row.copies), tradeable: Number(row.copies) - Number(row.bound_copies) }))
      .filter((card) => card.symbol),
    items: (await itemStatuses(pool, users[0].id)).filter((item) => item.tradable),
  };
}

/**
 * Every capsule item a player has, and whether it can go on the exchange now: `tradable`, or
 * `reason` = not_from_capsule / untradable / on_hold (with `available_at`). One entry per item
 * (the tradable copy when there is one).
 */
async function itemStatuses(db, userId) {
  await refreshItemCatalog(db);
  const { rows } = await db.query(
    `
    SELECT uc.id, uc.cosmetic_key, uc.cosmetic_type, uc.rarity, uc.source_type, uc.metadata_json, uc.granted_at,
      COALESCE(p.tradable, false) AS catalog_tradable,
      (uc.source_type = 'exchange' AND uc.granted_at > now() - make_interval(hours => $2::int)) AS on_hold,
      uc.granted_at + make_interval(hours => $2::int) AS hold_ends
    FROM games.user_cosmetics uc
    LEFT JOIN games.gacha_prize_items p ON p.game_key = $3 AND p.cosmetic_key = uc.cosmetic_key AND NOT p.is_deleted
    WHERE uc.user_id = $1
    ORDER BY uc.cosmetic_key, uc.granted_at ASC
  `,
    [userId, RECEIVED_HOLD_HOURS, CAPSULE]
  );
  const best = new Map();
  const rank = (entry) => (entry.tradable ? 0 : entry.reason === "on_hold" ? 1 : 2);
  for (const row of rows) {
    const fromCapsule = TRADABLE_SOURCES.includes(row.source_type);
    const reason = !fromCapsule ? "not_from_capsule" : !row.catalog_tradable || !ITEM_RARITIES.includes(row.rarity) ? "untradable" : row.on_hold ? "on_hold" : null;
    const entry = {
      ...itemView(row.cosmetic_key, { metadata: row.metadata_json, cosmetic_type: row.cosmetic_type, rarity: row.rarity }),
      user_cosmetic_id: Number(row.id),
      tradable: reason === null,
      reason,
      available_at: reason === "on_hold" ? new Date(row.hold_ends).toISOString() : null,
    };
    const current = best.get(row.cosmetic_key);
    if (!current || rank(entry) < rank(current)) best.set(row.cosmetic_key, entry);
  }
  return [...best.values()];
}

/** Your items and what each can do on the exchange (the locker's Sell buttons). */
async function myItems(pool, { userId }) {
  const [items, status] = await Promise.all([itemStatuses(pool, userId), eligibility(pool, userId)]);
  return { items, eligibility: status, hold_hours: RECEIVED_HOLD_HOURS };
}

// ── Reading the market ────────────────────────────────────────────────────
const SORTS = {
  ending: "l.ends_at ASC",
  newest: "l.created_at DESC",
  price_asc: "COALESCE(l.current_bid, l.start_price, l.price) ASC, l.id DESC",
  price_desc: "COALESCE(l.current_bid, l.start_price, l.price) DESC, l.id DESC",
  bids: "l.bid_count DESC, l.ends_at ASC",
};

async function browseListings(pool, { viewerId = null, rarity = null, kind = null, symbol = null, unit = null, q = null, sort = "ending", page = 1, limit = 36 } = {}) {
  const talents = await talentLookup(pool);
  const where = ["l.item_type = 'card'", "l.status = 'active'", "l.ends_at > now()"];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const rarities = String(rarity || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(cards.isRarity);
  if (rarities.length) where.push(`l.rarity = ANY(${add(rarities)}::text[])`);
  if (kind === "fixed" || kind === "auction") where.push(`l.kind = ${add(kind)}`);
  if (symbol) where.push(`a.symbol = ${add(String(symbol).toUpperCase())}`);
  if (unit) where.push(`c.unit = ${add(String(unit))}`);
  if (q) where.push(`(a.symbol ILIKE ${add(`%${String(q).trim()}%`)} OR a.display_name ILIKE $${params.length})`);
  const order = SORTS[sort] || SORTS.ending;
  const safeLimit = Math.min(60, Math.max(1, Number(limit) || 36));
  const offset = (Math.max(1, Number(page) || 1) - 1) * safeLimit;
  const base = `
    FROM games.card_listings l
    JOIN market.users s ON s.id = l.seller_id
    LEFT JOIN market.users b ON b.id = l.current_bidder_id
    LEFT JOIN market.users buyer ON buyer.id = l.buyer_id
    JOIN market.market_assets a ON a.id = l.asset_id
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE ${where.join(" AND ")}
  `;
  const [{ rows }, count] = await Promise.all([
    pool.query(
      `SELECT l.*, s.username AS seller_username, b.username AS bidder_username, buyer.username AS buyer_username ${base} ORDER BY ${order} LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(`SELECT count(*)::int AS n ${base}`, params),
  ]);
  return { listings: rows.map((row) => listingView(talents, row, viewerId)), total: count.rows[0].n, page: Math.max(1, Number(page) || 1), limit: safeLimit };
}

/** Reference prices for every card with market data: floor (cheapest buy-now), last sale, 7-day average. */
async function priceBook(pool) {
  const { rows } = await pool.query(`
    WITH floors AS (
      SELECT card_key, min(price) AS floor, count(*)::int AS listed
      FROM games.card_listings
      WHERE item_type = 'card' AND status = 'active' AND ends_at > now() AND price IS NOT NULL
        AND (kind = 'fixed' OR current_bid IS NULL OR current_bid < price)
      GROUP BY card_key
    ),
    last_sales AS (
      SELECT DISTINCT ON (card_key) card_key, price AS last, created_at AS last_at
      FROM games.card_sales
      WHERE item_type = 'card' AND created_at > now() - interval '90 days'
      ORDER BY card_key, created_at DESC
    ),
    week AS (
      SELECT card_key, avg(price) AS avg7d, count(*)::int AS sales7d
      FROM games.card_sales WHERE item_type = 'card' AND created_at > now() - interval '7 days'
      GROUP BY card_key
    )
    SELECT COALESCE(f.card_key, ls.card_key) AS card_key, f.floor, f.listed, ls.last, ls.last_at, w.avg7d, w.sales7d
    FROM floors f
    FULL OUTER JOIN last_sales ls ON ls.card_key = f.card_key
    LEFT JOIN week w ON w.card_key = COALESCE(f.card_key, ls.card_key)
  `);
  const prices = {};
  for (const row of rows) {
    const floor = num(row.floor);
    const last = num(row.last);
    const avg = row.avg7d === null ? null : round2(row.avg7d);
    prices[row.card_key] = {
      floor,
      listed: row.listed ?? 0,
      last,
      last_at: row.last_at,
      avg7d: avg,
      sales7d: row.sales7d ?? 0,
      // What the card is "worth" for trade meters and collection value.
      value: last ?? avg ?? floor,
    };
  }
  return prices;
}

async function overview(pool, { viewerId = null } = {}) {
  const talents = await talentLookup(pool);
  const [floors, ending, hot, sales, stats, big] = await Promise.all([
    pool.query(`
      SELECT r.rarity,
        (SELECT min(price) FROM games.card_listings WHERE status = 'active' AND ends_at > now() AND rarity = r.rarity AND price IS NOT NULL
           AND (kind = 'fixed' OR current_bid IS NULL OR current_bid < price)) AS floor,
        (SELECT count(*)::int FROM games.card_listings WHERE status = 'active' AND ends_at > now() AND rarity = r.rarity) AS listed,
        (SELECT avg(price) FROM games.card_sales WHERE rarity = r.rarity AND created_at > now() - interval '7 days') AS avg7d,
        (SELECT count(*)::int FROM games.card_sales WHERE rarity = r.rarity AND created_at > now() - interval '7 days') AS sales7d,
        (SELECT price FROM games.card_sales WHERE rarity = r.rarity ORDER BY created_at DESC LIMIT 1) AS last
      FROM unnest(ARRAY['C','R','SR','SSR','UR']) AS r(rarity)
    `),
    pool.query(`${LISTING_SELECT} WHERE l.status = 'active' AND l.kind = 'auction' AND l.ends_at > now() ORDER BY l.ends_at ASC LIMIT 8`),
    pool.query(`${LISTING_SELECT} WHERE l.status = 'active' AND l.kind = 'auction' AND l.ends_at > now() AND l.bid_count > 0 ORDER BY l.bid_count DESC, l.ends_at ASC LIMIT 6`),
    pool.query(`
      SELECT s.*, sel.username AS seller_username, buy.username AS buyer_username
      FROM games.card_sales s
      LEFT JOIN market.users sel ON sel.id = s.seller_id
      LEFT JOIN market.users buy ON buy.id = s.buyer_id
      ORDER BY s.created_at DESC LIMIT 20
    `),
    pool.query(`
      SELECT
        (SELECT COALESCE(sum(price), 0) FROM games.card_sales WHERE created_at > now() - interval '24 hours') AS volume_24h,
        (SELECT count(*)::int FROM games.card_sales WHERE created_at > now() - interval '24 hours') AS sales_24h,
        (SELECT count(*)::int FROM games.card_listings WHERE status = 'active' AND ends_at > now() AND kind = 'fixed') AS buy_now,
        (SELECT count(*)::int FROM games.card_listings WHERE status = 'active' AND ends_at > now() AND kind = 'auction') AS auctions,
        (SELECT count(*)::int FROM games.card_trades WHERE status = 'accepted' AND responded_at > now() - interval '24 hours') AS trades_24h
    `),
    pool.query(`
      SELECT s.*, sel.username AS seller_username, buy.username AS buyer_username
      FROM games.card_sales s
      LEFT JOIN market.users sel ON sel.id = s.seller_id
      LEFT JOIN market.users buy ON buy.id = s.buyer_id
      WHERE s.created_at > now() - interval '7 days'
      ORDER BY s.price DESC LIMIT 5
    `),
  ]);
  const saleView = (row) => ({
    id: Number(row.id),
    listing_id: row.listing_id ? Number(row.listing_id) : null,
    item_type: isItemRow(row) ? "cosmetic" : "card",
    card: isItemRow(row) ? null : cardView(talents, row.card_key),
    card_key: row.card_key,
    item: isItemRow(row) ? itemView(row.cosmetic_key) : null,
    cosmetic_key: row.cosmetic_key ?? null,
    kind: row.kind,
    price: num(row.price),
    seller: row.seller_username ? { username: row.seller_username } : null,
    buyer: row.buyer_username ? { username: row.buyer_username } : null,
    at: row.created_at,
  });
  return {
    floors: floors.rows.map((row) => ({
      rarity: row.rarity,
      floor: num(row.floor),
      listed: row.listed,
      avg7d: row.avg7d === null ? null : round2(row.avg7d),
      sales7d: row.sales7d,
      last: num(row.last),
    })),
    ending_soon: ending.rows.map((row) => listingView(talents, row, viewerId)),
    hot: hot.rows.map((row) => listingView(talents, row, viewerId)),
    recent_sales: sales.rows.map(saleView),
    biggest_sales: big.rows.map(saleView),
    stats: {
      volume_24h: round2(stats.rows[0].volume_24h),
      sales_24h: stats.rows[0].sales_24h,
      buy_now: stats.rows[0].buy_now,
      auctions: stats.rows[0].auctions,
      trades_24h: stats.rows[0].trades_24h,
    },
    tape,
    rules: {
      fee_rate: FEE_RATE,
      auction_hours: AUCTION_HOURS,
      fixed_listing_days: FIXED_LISTING_DAYS,
      snipe_window_seconds: SNIPE_WINDOW_MS / 1000,
      trade_hours: TRADE_HOURS,
      min_account_age_hours: MIN_ACCOUNT_AGE_HOURS,
    },
  };
}

async function cardDetail(pool, { cardKey, viewerId = null }) {
  const parsed = cards.parseCardKey(cardKey);
  if (!parsed) throw exchangeError("invalid_card");
  const talents = await talentLookup(pool);
  if (!talents.has(parsed.symbol)) throw exchangeError("invalid_card");
  const [sales, listings, circulation, mine] = await Promise.all([
    pool.query(
      `
      SELECT s.id, s.price, s.kind, s.created_at, sel.username AS seller_username, buy.username AS buyer_username
      FROM games.card_sales s
      LEFT JOIN market.users sel ON sel.id = s.seller_id
      LEFT JOIN market.users buy ON buy.id = s.buyer_id
      WHERE s.card_key = $1 AND s.created_at > now() - interval '180 days'
      ORDER BY s.created_at ASC
      LIMIT 400
    `,
      [cardKey]
    ),
    pool.query(`${LISTING_SELECT} WHERE l.card_key = $1 AND l.status = 'active' AND l.ends_at > now() ORDER BY COALESCE(l.price, l.current_bid, l.start_price) ASC LIMIT 40`, [cardKey]),
    pool.query(
      `SELECT count(*)::int AS owners, COALESCE(sum(copies), 0)::int AS copies FROM games.user_cards WHERE card_key = $1`,
      [cardKey]
    ),
    viewerId
      ? pool.query(`SELECT stars, copies, bound_copies FROM games.user_cards WHERE user_id = $1 AND card_key = $2`, [viewerId, cardKey])
      : Promise.resolve({ rows: [] }),
  ]);
  const history = sales.rows.map((row) => ({ price: num(row.price), kind: row.kind, at: row.created_at, seller: row.seller_username, buyer: row.buyer_username }));
  const recent = history.filter((sale) => Date.parse(sale.at) > Date.now() - 30 * 86_400_000).map((sale) => sale.price);
  const active = listings.rows.map((row) => listingView(talents, row, viewerId));
  const buyNowPrices = active.map((listing) => listing.buy_now).filter((value) => value !== null);
  const own = mine.rows[0];
  const [{ rows: wantRows }, { rows: wantedBy }] = await Promise.all([
    viewerId ? pool.query(`SELECT 1 FROM games.card_wishlist WHERE user_id = $1 AND card_key = $2`, [viewerId, cardKey]) : Promise.resolve({ rows: [] }),
    pool.query(`SELECT count(*)::int AS n FROM games.card_wishlist WHERE card_key = $1`, [cardKey]),
  ]);
  return {
    card: cardView(talents, cardKey),
    wanted: wantRows.length > 0,
    wanted_by: wantedBy[0]?.n ?? 0,
    card_key: cardKey,
    history,
    listings: active,
    stats: {
      last: history.length ? history[history.length - 1].price : null,
      floor: buyNowPrices.length ? Math.min(...buyNowPrices) : null,
      high30d: recent.length ? Math.max(...recent) : null,
      low30d: recent.length ? Math.min(...recent) : null,
      sales30d: recent.length,
      owners: circulation.rows[0].owners,
      in_circulation: circulation.rows[0].copies + active.length,
      in_escrow: active.length,
    },
    mine: own ? { stars: Number(own.stars), copies: Number(own.copies), tradeable: Number(own.copies) - Number(own.bound_copies) } : null,
  };
}

// ── The capsule item market ───────────────────────────────────────────────
/** Active item listings (filters: rarity list, cosmetic type, name search), with each rarity's floor. */
async function browseItems(pool, { viewerId = null, rarity = null, type = null, q = null, sort = "ending", page = 1, limit = 36 } = {}) {
  const talents = await talentLookup(pool);
  const where = ["l.item_type = 'cosmetic'", "l.status = 'active'", "l.ends_at > now()"];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const rarities = String(rarity || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => ITEM_RARITIES.includes(value));
  if (rarities.length) where.push(`l.rarity = ANY(${add(rarities)}::text[])`);
  if (type) where.push(`COALESCE(p.cosmetic_type, l.cosmetic_json->>'cosmetic_type') = ${add(String(type))}`);
  if (q) where.push(`COALESCE(p.display_name, l.cosmetic_json->'metadata'->>'display_name', l.cosmetic_key) ILIKE ${add(`%${String(q).trim()}%`)}`);
  const order = SORTS[sort] || SORTS.ending;
  const safeLimit = Math.min(60, Math.max(1, Number(limit) || 36));
  const offset = (Math.max(1, Number(page) || 1) - 1) * safeLimit;
  const base = `
    FROM games.card_listings l
    JOIN market.users s ON s.id = l.seller_id
    LEFT JOIN market.users b ON b.id = l.current_bidder_id
    LEFT JOIN market.users buyer ON buyer.id = l.buyer_id
    LEFT JOIN games.gacha_prize_items p ON p.game_key = ${add(CAPSULE)} AND p.cosmetic_key = l.cosmetic_key AND NOT p.is_deleted
    WHERE ${where.join(" AND ")}
  `;
  const [{ rows }, count, floors] = await Promise.all([
    pool.query(
      `SELECT l.*, s.username AS seller_username, b.username AS bidder_username, buyer.username AS buyer_username ${base} ORDER BY ${order} LIMIT ${safeLimit} OFFSET ${offset}`,
      params
    ),
    pool.query(`SELECT count(*)::int AS n ${base}`, params),
    pool.query(`
      SELECT r.rarity,
        (SELECT min(price) FROM games.card_listings WHERE item_type = 'cosmetic' AND status = 'active' AND ends_at > now() AND rarity = r.rarity AND price IS NOT NULL
           AND (kind = 'fixed' OR current_bid IS NULL OR current_bid < price)) AS floor,
        (SELECT count(*)::int FROM games.card_listings WHERE item_type = 'cosmetic' AND status = 'active' AND ends_at > now() AND rarity = r.rarity) AS listed
      FROM unnest(ARRAY['common','rare','epic','legendary']) AS r(rarity)
    `),
  ]);
  return {
    listings: rows.map((row) => listingView(talents, row, viewerId)),
    total: count.rows[0].n,
    page: Math.max(1, Number(page) || 1),
    limit: safeLimit,
    floors: floors.rows.map((row) => ({ rarity: row.rarity, floor: num(row.floor), listed: row.listed })),
    hold_hours: RECEIVED_HOLD_HOURS,
  };
}

// Item sales that set prices: the first between any two players for an item in the window counts;
// the same two accounts selling it back and forth again don't move the price.
const COUNTED_ITEM_SALES = `
  SELECT DISTINCT ON (cosmetic_key, LEAST(seller_id, buyer_id), GREATEST(seller_id, buyer_id)) cosmetic_key, rarity, price, created_at, seller_id, buyer_id
  FROM games.card_sales
  WHERE item_type = 'cosmetic' AND created_at > now() - interval '90 days' AND seller_id IS NOT NULL AND buyer_id IS NOT NULL
  ORDER BY cosmetic_key, LEAST(seller_id, buyer_id), GREATEST(seller_id, buyer_id), created_at ASC
`;

/** Reference prices per item: floor (cheapest buy-now), last counted sale, 7-day average. */
async function itemPriceBook(pool) {
  const { rows } = await pool.query(`
    WITH counted AS (${COUNTED_ITEM_SALES}),
    floors AS (
      SELECT cosmetic_key, min(price) AS floor, count(*)::int AS listed
      FROM games.card_listings
      WHERE item_type = 'cosmetic' AND status = 'active' AND ends_at > now() AND price IS NOT NULL
        AND (kind = 'fixed' OR current_bid IS NULL OR current_bid < price)
      GROUP BY cosmetic_key
    ),
    last_sales AS (SELECT DISTINCT ON (cosmetic_key) cosmetic_key, price AS last, created_at AS last_at FROM counted ORDER BY cosmetic_key, created_at DESC),
    week AS (SELECT cosmetic_key, avg(price) AS avg7d, count(*)::int AS sales7d FROM counted WHERE created_at > now() - interval '7 days' GROUP BY cosmetic_key)
    SELECT COALESCE(f.cosmetic_key, ls.cosmetic_key) AS cosmetic_key, f.floor, f.listed, ls.last, ls.last_at, w.avg7d, w.sales7d
    FROM floors f
    FULL OUTER JOIN last_sales ls ON ls.cosmetic_key = f.cosmetic_key
    LEFT JOIN week w ON w.cosmetic_key = COALESCE(f.cosmetic_key, ls.cosmetic_key)
  `);
  const prices = {};
  for (const row of rows) {
    const floor = num(row.floor);
    const last = num(row.last);
    const avg = row.avg7d === null ? null : round2(row.avg7d);
    prices[row.cosmetic_key] = { floor, listed: row.listed ?? 0, last, last_at: row.last_at, avg7d: avg, sales7d: row.sales7d ?? 0, value: last ?? avg ?? floor };
  }
  return prices;
}

/** One item's market: every sale, what's up now, how many players own it, and where you stand. */
async function itemDetail(pool, { cosmeticKey, viewerId = null }) {
  if (!validItemKey(cosmeticKey)) throw exchangeError("invalid_item");
  const talents = await talentLookup(pool);
  if (!itemCatalog.has(cosmeticKey)) throw exchangeError("invalid_item");
  const [sales, listings, owners, prices] = await Promise.all([
    pool.query(
      `
      SELECT s.price, s.kind, s.created_at, sel.username AS seller_username, buy.username AS buyer_username
      FROM games.card_sales s
      LEFT JOIN market.users sel ON sel.id = s.seller_id
      LEFT JOIN market.users buy ON buy.id = s.buyer_id
      WHERE s.item_type = 'cosmetic' AND s.cosmetic_key = $1 AND s.created_at > now() - interval '180 days'
      ORDER BY s.created_at ASC
      LIMIT 400
    `,
      [cosmeticKey]
    ),
    pool.query(`${LISTING_SELECT} WHERE l.item_type = 'cosmetic' AND l.cosmetic_key = $1 AND l.status = 'active' AND l.ends_at > now() ORDER BY COALESCE(l.price, l.current_bid, l.start_price) ASC LIMIT 40`, [cosmeticKey]),
    pool.query(`SELECT count(DISTINCT user_id)::int AS owners FROM games.user_cosmetics WHERE cosmetic_key = $1`, [cosmeticKey]),
    itemPriceBook(pool),
  ]);
  const active = listings.rows.map((row) => listingView(talents, row, viewerId));
  const buyNowPrices = active.map((listing) => listing.buy_now).filter((value) => value !== null);
  const price = prices[cosmeticKey] || null;
  const mine = viewerId ? (await itemStatuses(pool, viewerId)).find((item) => item.key === cosmeticKey) ?? null : null;
  return {
    item: { ...itemView(cosmeticKey), tradable: itemCatalog.get(cosmeticKey)?.tradable !== false },
    history: sales.rows.map((row) => ({ price: num(row.price), kind: row.kind, at: row.created_at, seller: row.seller_username, buyer: row.buyer_username })),
    listings: active,
    stats: {
      last: price?.last ?? null,
      avg7d: price?.avg7d ?? null,
      floor: buyNowPrices.length ? Math.min(...buyNowPrices) : null,
      owners: owners.rows[0].owners,
      in_escrow: active.length,
    },
    mine: mine ? { tradable: mine.tradable, reason: mine.reason, available_at: mine.available_at } : null,
  };
}

// ── Admin: transfers worth a second look ─────────────────────────────────
// Value moving between accounts for far less (or more) than it's worth, where at least one side is
// a new account: the shape of alt accounts feeding a main. Card values come from the price book;
// cards nobody has priced yet use the median sale for their rarity.
// Capsule items are valued the same way from their own price book. Two more patterns, whatever the
// prices: a pair of accounts that keep trading with each other, and one account dealing with
// several new ones (a funnel).
const TRANSFERS = `
  SELECT seller_id AS a, buyer_id AS b, created_at AS at FROM games.card_sales
  WHERE created_at > now() - make_interval(days => $1) AND seller_id IS NOT NULL AND buyer_id IS NOT NULL
  UNION ALL
  SELECT from_user_id, to_user_id, responded_at FROM games.card_trades
  WHERE status = 'accepted' AND responded_at > now() - make_interval(days => $1)
`;

async function reviewFlags(pool, { days = 14, newAccountDays = 14, ratio = 3, minValue = 25, pairMin = 3, funnelMin = 3 } = {}) {
  const talents = await talentLookup(pool);
  const [prices, { rows: rarityRows }, { rows: itemRarityRows }, { rows: sales }, { rows: trades }, { rows: pairRows }, { rows: funnelRows }] = await Promise.all([
    priceBook(pool),
    pool.query(`SELECT rarity, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median FROM games.card_sales WHERE item_type = 'card' AND created_at > now() - interval '60 days' GROUP BY rarity`),
    // An item's worth, for judging a sale: the median of counted sales between accounts that weren't
    // new at the time (so an alt's own sales can't set the price it's judged by), per item and per rarity.
    pool.query(
      `
      SELECT GROUPING(c.cosmetic_key) AS by_rarity, c.cosmetic_key, c.rarity, percentile_cont(0.5) WITHIN GROUP (ORDER BY c.price) AS median
      FROM (${COUNTED_ITEM_SALES}) c
      JOIN market.users s ON s.id = c.seller_id
      JOIN market.users b ON b.id = c.buyer_id
      WHERE c.created_at > now() - interval '60 days'
        AND s.created_at <= c.created_at - make_interval(days => $1) AND b.created_at <= c.created_at - make_interval(days => $1)
      GROUP BY GROUPING SETS ((c.cosmetic_key, c.rarity), (c.rarity))
    `,
      [newAccountDays]
    ),
    pool.query(
      `
      SELECT s.id, s.item_type, s.card_key, s.cosmetic_key, s.rarity, s.price, s.kind, s.created_at,
        sel.id AS seller_id, sel.username AS seller, sel.created_at AS seller_joined,
        buy.id AS buyer_id, buy.username AS buyer, buy.created_at AS buyer_joined
      FROM games.card_sales s
      JOIN market.users sel ON sel.id = s.seller_id
      JOIN market.users buy ON buy.id = s.buyer_id
      WHERE s.created_at > now() - make_interval(days => $1)
        AND (sel.created_at > s.created_at - make_interval(days => $2) OR buy.created_at > s.created_at - make_interval(days => $2))
      ORDER BY s.created_at DESC
      LIMIT 500
    `,
      [days, newAccountDays]
    ),
    pool.query(
      `
      SELECT t.id, t.give_json, t.ask_json, t.responded_at AS at,
        f.id AS from_id, f.username AS from_user, f.created_at AS from_joined,
        u.id AS to_id, u.username AS to_user, u.created_at AS to_joined
      FROM games.card_trades t
      JOIN market.users f ON f.id = t.from_user_id
      JOIN market.users u ON u.id = t.to_user_id
      WHERE t.status = 'accepted' AND t.responded_at > now() - make_interval(days => $1)
        AND (f.created_at > t.responded_at - make_interval(days => $2) OR u.created_at > t.responded_at - make_interval(days => $2))
      ORDER BY t.responded_at DESC
      LIMIT 500
    `,
      [days, newAccountDays]
    ),
    pool.query(
      `
      WITH t AS (${TRANSFERS})
      SELECT LEAST(t.a, t.b) AS x, GREATEST(t.a, t.b) AS y, count(*)::int AS n, max(t.at) AS last_at,
        ux.username AS x_name, ux.created_at AS x_joined, uy.username AS y_name, uy.created_at AS y_joined
      FROM t
      JOIN market.users ux ON ux.id = LEAST(t.a, t.b)
      JOIN market.users uy ON uy.id = GREATEST(t.a, t.b)
      GROUP BY 1, 2, ux.username, ux.created_at, uy.username, uy.created_at
      HAVING count(*) >= $2
      ORDER BY n DESC, last_at DESC
      LIMIT 50
    `,
      [days, pairMin]
    ),
    pool.query(
      `
      WITH t AS (${TRANSFERS}),
      edges AS (SELECT a AS hub, b AS other, at FROM t UNION ALL SELECT b, a, at FROM t)
      SELECT e.hub, h.username AS hub_name, h.created_at AS hub_joined,
        count(DISTINCT e.other)::int AS n, count(*)::int AS transfers, max(e.at) AS last_at,
        json_agg(DISTINCT jsonb_build_object('id', o.id, 'username', o.username, 'joined', o.created_at)) AS accounts
      FROM edges e
      JOIN market.users o ON o.id = e.other
      JOIN market.users h ON h.id = e.hub
      WHERE o.created_at > e.at - make_interval(days => $2)
      GROUP BY e.hub, h.username, h.created_at
      HAVING count(DISTINCT e.other) >= $3
      ORDER BY n DESC, last_at DESC
      LIMIT 50
    `,
      [days, newAccountDays, funnelMin]
    ),
  ]);
  const rarityMedian = new Map(rarityRows.map((row) => [row.rarity, num(row.median)]));
  const itemRarityMedian = new Map(itemRarityRows.filter((row) => Number(row.by_rarity) === 1).map((row) => [row.rarity, num(row.median)]));
  const itemKeyMedian = new Map(itemRarityRows.filter((row) => Number(row.by_rarity) === 0).map((row) => [row.cosmetic_key, num(row.median)]));
  const valueOf = (cardKey) => {
    const known = prices[cardKey]?.value;
    if (known !== null && known !== undefined) return known;
    return rarityMedian.get(cards.parseCardKey(cardKey)?.rarity) ?? 0;
  };
  const itemValueOf = (cosmeticKey, rarity = null) => {
    const known = itemKeyMedian.get(cosmeticKey);
    if (known !== null && known !== undefined) return known;
    return itemRarityMedian.get(rarity || itemCatalog.get(cosmeticKey)?.rarity) ?? 0;
  };
  const ageDays = (joined, at) => Math.max(0, Math.floor((Date.parse(at) - Date.parse(joined)) / 86_400_000));
  const flags = [];
  for (const sale of sales) {
    const price = num(sale.price);
    const isItem = sale.item_type === "cosmetic";
    const worth = round2(isItem ? itemValueOf(sale.cosmetic_key, sale.rarity) : valueOf(sale.card_key));
    const what = isItem ? `${itemView(sale.cosmetic_key).name} (${sale.rarity} item)` : `${cardView(talents, sale.card_key)?.name ?? sale.card_key} ${sale.rarity}`;
    if (worth < minValue && price < minValue) continue;
    const off = worth > 0 && price > 0 ? Math.max(worth / price, price / worth) : Infinity;
    if (off < ratio) continue;
    flags.push({
      type: "sale",
      id: Number(sale.id),
      at: sale.created_at,
      from: { id: Number(sale.seller_id), username: sale.seller, age_days: ageDays(sale.seller_joined, sale.created_at) },
      to: { id: Number(sale.buyer_id), username: sale.buyer, age_days: ageDays(sale.buyer_joined, sale.created_at) },
      summary: `${what} sold for ${round2(price).toFixed(2)} (worth about ${worth.toFixed(2)})`,
      paid: round2(price),
      worth,
      ratio: Number.isFinite(off) ? round2(off) : null,
      // Who came out ahead: cheap sales favour the buyer, dear ones the seller.
      favours: price < worth ? "to" : "from",
    });
  }
  const sideValue = (side) => {
    const s = side && typeof side === "object" ? side : {};
    const cardsValue = (Array.isArray(s.cards) ? s.cards : []).reduce((sum, entry) => sum + valueOf(entry.card_key) * Number(entry.qty || 1), 0);
    const items = sideItems(s);
    const itemsValue = items.reduce((sum, entry) => sum + itemValueOf(entry.cosmetic_key, entry.snapshot?.rarity), 0);
    return {
      value: round2(cardsValue + itemsValue + Number(s.cash || 0)),
      shards: Number(s.shards || 0),
      cards: (s.cards || []).reduce((sum, entry) => sum + Number(entry.qty || 1), 0),
      items: items.length,
    };
  };
  const things = (side) =>
    [`${side.cards} card${side.cards === 1 ? "" : "s"}`, side.items ? `${side.items} item${side.items === 1 ? "" : "s"}` : null, side.shards ? `${side.shards} shards` : null].filter(Boolean).join(" + ");
  for (const trade of trades) {
    const give = sideValue(trade.give_json);
    const ask = sideValue(trade.ask_json);
    const high = Math.max(give.value, ask.value);
    const low = Math.min(give.value, ask.value);
    if (high < minValue) continue;
    const off = low > 0 ? high / low : Infinity;
    if (off < ratio) continue;
    flags.push({
      type: "trade",
      id: Number(trade.id),
      at: trade.at,
      from: { id: Number(trade.from_id), username: trade.from_user, age_days: ageDays(trade.from_joined, trade.at) },
      to: { id: Number(trade.to_id), username: trade.to_user, age_days: ageDays(trade.to_joined, trade.at) },
      summary: `${trade.from_user} gave ${things(give)} worth ~${give.value.toFixed(2)} for ${things(ask)} worth ~${ask.value.toFixed(2)}`,
      paid: ask.value,
      worth: give.value,
      ratio: Number.isFinite(off) ? round2(off) : null,
      favours: give.value > ask.value ? "to" : "from",
    });
  }
  // Pairs that keep doing it.
  const pairCount = new Map();
  for (const flag of flags) {
    const pair = [flag.from.id, flag.to.id].sort((a, b) => a - b).join(":");
    pairCount.set(pair, (pairCount.get(pair) || 0) + 1);
  }
  for (const flag of flags) flag.pair_flags = pairCount.get([flag.from.id, flag.to.id].sort((a, b) => a - b).join(":"));
  flags.sort((a, b) => (b.pair_flags - a.pair_flags) || ((b.ratio ?? 999) - (a.ratio ?? 999)) || Date.parse(b.at) - Date.parse(a.at));
  const nowIso = new Date().toISOString();
  const pairs = pairRows.map((row) => ({
    a: { id: Number(row.x), username: row.x_name, age_days: ageDays(row.x_joined, nowIso) },
    b: { id: Number(row.y), username: row.y_name, age_days: ageDays(row.y_joined, nowIso) },
    transfers: row.n,
    last_at: row.last_at,
  }));
  const funnels = funnelRows.map((row) => ({
    hub: { id: Number(row.hub), username: row.hub_name, age_days: ageDays(row.hub_joined, nowIso) },
    accounts: (row.accounts || [])
      .map((account) => ({ id: Number(account.id), username: account.username, age_days: ageDays(account.joined, nowIso) }))
      .sort((x, y) => x.age_days - y.age_days),
    transfers: row.transfers,
    last_at: row.last_at,
  }));
  return { window_days: days, new_account_days: newAccountDays, ratio, pair_min: pairMin, funnel_min: funnelMin, flags: flags.slice(0, 200), pairs, funnels };
}

const MAX_WISHES = 60;

async function addWish(pool, { userId, cardKey }) {
  const parsed = cards.parseCardKey(cardKey);
  if (!parsed) throw exchangeError("invalid_card");
  const talents = await talentLookup(pool);
  if (!talents.has(parsed.symbol)) throw exchangeError("invalid_card");
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM games.card_wishlist WHERE user_id = $1`, [userId]);
  if (rows[0].n >= MAX_WISHES) throw exchangeError("exchange_wishlist_full", { limit: MAX_WISHES });
  await pool.query(`INSERT INTO games.card_wishlist (user_id, card_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, cardKey]);
  return { card_key: cardKey, wanted: true };
}

async function removeWish(pool, { userId, cardKey }) {
  await pool.query(`DELETE FROM games.card_wishlist WHERE user_id = $1 AND card_key = $2`, [userId, cardKey]);
  return { card_key: cardKey, wanted: false };
}

/** Your wishlist with each card's cheapest buy-now and how many are up. */
async function listWishes(pool, talents, userId) {
  const { rows } = await pool.query(
    `
    SELECT w.card_key, w.created_at,
      (SELECT min(l.price) FROM games.card_listings l WHERE l.card_key = w.card_key AND l.status = 'active' AND l.ends_at > now() AND l.price IS NOT NULL) AS floor,
      (SELECT count(*)::int FROM games.card_listings l WHERE l.card_key = w.card_key AND l.status = 'active' AND l.ends_at > now()) AS listed,
      EXISTS (SELECT 1 FROM games.user_cards uc WHERE uc.user_id = w.user_id AND uc.card_key = w.card_key) AS owned
    FROM games.card_wishlist w
    WHERE w.user_id = $1
    ORDER BY w.created_at DESC
  `,
    [userId]
  );
  return rows.map((row) => ({ card_key: row.card_key, card: cardView(talents, row.card_key), floor: num(row.floor), listed: row.listed, owned: row.owned, added_at: row.created_at }));
}

async function myDesk(pool, { userId }) {
  const talents = await talentLookup(pool);
  const [active, closed, bidding, won, status, used, trades] = await Promise.all([
    pool.query(`${LISTING_SELECT} WHERE l.seller_id = $1 AND l.status = 'active' ORDER BY l.ends_at ASC`, [userId]),
    pool.query(`${LISTING_SELECT} WHERE l.seller_id = $1 AND l.status <> 'active' ORDER BY l.closed_at DESC NULLS LAST LIMIT 20`, [userId]),
    pool.query(
      `
      ${LISTING_SELECT}
      WHERE l.status = 'active' AND l.kind = 'auction'
        AND EXISTS (SELECT 1 FROM games.card_bids cb WHERE cb.listing_id = l.id AND cb.bidder_id = $1)
      ORDER BY l.ends_at ASC
    `,
      [userId]
    ),
    pool.query(`${LISTING_SELECT} WHERE l.buyer_id = $1 AND l.status = 'sold' ORDER BY l.closed_at DESC LIMIT 20`, [userId]),
    eligibility(pool, userId),
    usage(pool, userId),
    pool.query(`SELECT count(*)::int AS n FROM games.card_trades WHERE to_user_id = $1 AND status = 'pending'`, [userId]),
  ]);
  const { rows: myBids } = await pool.query(
    `SELECT listing_id, max(amount) AS top FROM games.card_bids WHERE bidder_id = $1 GROUP BY listing_id`,
    [userId]
  );
  const topBid = new Map(myBids.map((row) => [Number(row.listing_id), num(row.top)]));
  const wishlist = await listWishes(pool, talents, userId);
  return {
    wishlist,
    eligibility: status,
    limits: used,
    incoming_offers: trades.rows[0].n,
    listings: active.rows.map((row) => listingView(talents, row, userId)),
    closed: closed.rows.map((row) => listingView(talents, row, userId)),
    bids: bidding.rows.map((row) => ({ ...listingView(talents, row, userId), my_top_bid: topBid.get(Number(row.id)) ?? null })),
    won: won.rows.map((row) => listingView(talents, row, userId)),
  };
}

// ── Scheduler ─────────────────────────────────────────────────────────────
function startExchangeScheduler(pool, logger = console, { intervalMs = 5_000 } = {}) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    let lockClient;
    try {
      lockClient = await pool.connect();
      const { rows } = await lockClient.query("SELECT pg_try_advisory_lock($1) AS locked", [SCHEDULER_LOCK_KEY]);
      if (!rows[0]?.locked) return;
      try {
        const sold = await settleDueListings(pool);
        const expired = await expireDueTrades(pool);
        if (sold || expired) logger.info?.("card exchange settled", { listings: sold, trades: expired });
      } finally {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [SCHEDULER_LOCK_KEY]).catch(() => {});
      }
    } catch (error) {
      logger.error?.("card exchange scheduler failed", error);
    } finally {
      lockClient?.release();
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}

module.exports = {
  AUCTION_HOURS,
  RECEIVED_HOLD_HOURS,
  addWish,
  browseItems,
  itemDetail,
  itemPriceBook,
  itemStatuses,
  myItems,
  refreshItemCatalog,
  takeCosmeticWithClient,
  removeWish,
  reviewFlags,
  FEE_RATE,
  SNIPE_WINDOW_MS,
  browseListings,
  buyListing,
  cancelListing,
  cardDetail,
  createListing,
  eligibility,
  expireDueTrades,
  listTrades,
  minIncrement,
  myDesk,
  normalizeSide,
  overview,
  placeBid,
  priceBook,
  proposeTrade,
  respondToTrade,
  settleDueListings,
  startExchangeScheduler,
  takeCopiesWithClient,
  tradeableCards,
};
