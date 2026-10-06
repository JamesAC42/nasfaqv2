// IPOs: how a newly debuted talent becomes a stock (docs/market/ipo.md).
//
//   1. Announced. An admin picks detected talents (services/talentDetect.js) and a listing date.
//      Their channels go active, so the scraper collects their daily stats from now on, and their
//      stocks exist as 'prelaunch': on /market/ipo with their channel numbers, not tradable, never
//      holding up settlement. Debut-mode fair value (fundamentals.js) is computed daily but hidden.
//   2. Window open (48 h before the listing day's 09:00 settlement by default). The IPO price is the
//      debut fair value less the discount, the offering is a share of her starting max shares (from
//      the weekly bell curve), and players subscribe with Cash, held like a queued buy.
//   3. Listed. Just before that settlement (marketScheduler.js), subscriptions are filled at the IPO
//      price (pro rata if oversubscribed, at least 1 share each), unfilled cash goes back, the stock
//      turns 'active' and its first day opens at the IPO price (settlement.js).
//
// Event status: announced → open → listed, or cancelled (subscriptions refunded; the talents stay
// tracked as prelaunch and can join another IPO).

const notifications = require("./notifications");
const { ensureUserCashAccount } = require("./portfolioCash");
const { bootstrapAssetsWithClient } = require("./marketAdmin");
const weeklyEvaluation = require("./weeklyEvaluation");
const { publishMarketEvent } = require("./marketEvents");
const { invalidateMarketAssetsCache } = require("../marketCache");
const referenceImages = require("./referenceImages");

const DEFAULTS = {
  windowHours: 48,
  discountPct: 10, // [BBB] IPO price below debut fair value
  offeringPct: 40, // [BBB] of her starting max shares
  playerCapPct: 10, // [BBB] of the offering, per player
};
const SETTLEMENT_HOUR = Number.parseInt(String(process.env.MARKET_SETTLEMENT_HOUR ?? 9), 10) || 9;
const SETTLEMENT_MINUTE = Number.parseInt(String(process.env.MARKET_SETTLEMENT_MINUTE ?? 0), 10) || 0;
const TIME_ZONE = process.env.MARKET_SETTLEMENT_TIMEZONE || "America/New_York";
const DATA_TIME_ZONE = process.env.MARKET_DATA_TIMEZONE || process.env.SCRAPE_TIMEZONE || "America/New_York";
const LOCK_KEY = 9_204_020;
const SYMBOL_PATTERN = /^[A-Z]{2,5}$/;
const YOUTUBE_ID_PATTERN = /^UC[a-zA-Z0-9_-]{22}$/;

const schema = `
  CREATE TABLE IF NOT EXISTS market.ipo_events (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'announced',
    listing_date DATE NOT NULL,
    window_opens_at TIMESTAMPTZ NOT NULL,
    window_closes_at TIMESTAMPTZ NOT NULL,
    discount_pct NUMERIC NOT NULL DEFAULT 10,
    offering_pct NUMERIC NOT NULL DEFAULT 40,
    player_cap_pct NUMERIC NOT NULL DEFAULT 10,
    last_error TEXT NULL,
    created_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    opened_at TIMESTAMPTZ NULL,
    listed_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    CONSTRAINT ipo_events_status_check CHECK (status IN ('announced', 'open', 'listed', 'cancelled')),
    CONSTRAINT ipo_events_window_check CHECK (window_opens_at < window_closes_at)
  );
  CREATE TABLE IF NOT EXISTS market.ipo_listings (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES market.ipo_events(id) ON DELETE CASCADE,
    asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    debut_fair_value NUMERIC NULL,
    ipo_price NUMERIC NULL,
    starting_max_supply NUMERIC NULL,
    shares_offered NUMERIC NULL,
    shares_allocated NUMERIC NOT NULL DEFAULT 0,
    listed_on DATE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ipo_listings_status_check CHECK (status IN ('pending', 'listed', 'cancelled'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ipo_listings_one_live_per_asset_idx ON market.ipo_listings (asset_id) WHERE status <> 'cancelled';
  CREATE INDEX IF NOT EXISTS ipo_listings_event_idx ON market.ipo_listings (event_id);
  CREATE TABLE IF NOT EXISTS market.ipo_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    listing_id BIGINT NOT NULL REFERENCES market.ipo_listings(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    requested_shares NUMERIC NOT NULL,
    price NUMERIC NOT NULL,
    held_cash NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    allocated_shares NUMERIC NOT NULL DEFAULT 0,
    refunded_cash NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ipo_subscriptions_one_per_player UNIQUE (listing_id, user_id),
    CONSTRAINT ipo_subscriptions_status_check CHECK (status IN ('pending', 'allocated', 'cancelled', 'refunded')),
    CONSTRAINT ipo_subscriptions_amounts_check CHECK (requested_shares >= 0 AND held_cash >= 0 AND allocated_shares >= 0)
  );
  CREATE INDEX IF NOT EXISTS ipo_subscriptions_user_idx ON market.ipo_subscriptions (user_id);
`;

function codedError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** A number, or null when the column is NULL (Number(null) would be 0). */
const maybeNumber = (value) => (value === null || value === undefined ? null : toNumber(value, null));

const round2 = (value) => Math.round(value * 100) / 100;

// ── Time ─────────────────────────────────────────────────────────────────
function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return parts;
}

/** A wall-clock time in a zone as a Date. */
function zonedTime(dateKey, hour, minute, timeZone = TIME_ZONE) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(desired);
  for (let i = 0; i < 4; i += 1) {
    const p = zonedParts(guess, timeZone);
    const diff = desired - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function todayKey(now = new Date(), timeZone = TIME_ZONE) {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function dateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** The window for a listing date: it closes at that day's settlement and opens `hours` before. */
function windowFor(listingDate, hours = DEFAULTS.windowHours) {
  const closes = zonedTime(listingDate, SETTLEMENT_HOUR, SETTLEMENT_MINUTE);
  return { opens: new Date(closes.getTime() - hours * 3_600_000), closes };
}

// ── Allocation ───────────────────────────────────────────────────────────
/**
 * Splits `offered` whole shares among subscriptions ({ id, requested, created_at }). Everyone is filled
 * when it fits; otherwise pro rata by request, at least 1 share each, leftover shares to the largest
 * remainders. If there are more subscribers than shares, the earliest get 1 each.
 */
function allocate(subscriptions, offered) {
  const subs = subscriptions.map((sub) => ({ ...sub, requested: Math.max(0, Math.floor(toNumber(sub.requested))) })).filter((sub) => sub.requested > 0);
  const result = new Map(subscriptions.map((sub) => [sub.id, 0]));
  const supply = Math.max(0, Math.floor(toNumber(offered)));
  const demand = subs.reduce((sum, sub) => sum + sub.requested, 0);
  if (!supply || !demand) return result;
  if (demand <= supply) {
    for (const sub of subs) result.set(sub.id, sub.requested);
    return result;
  }
  const byTime = [...subs].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  if (subs.length >= supply) {
    for (const sub of byTime.slice(0, supply)) result.set(sub.id, 1);
    return result;
  }
  const shares = subs.map((sub) => {
    const exact = (sub.requested * supply) / demand;
    return { sub, shares: Math.max(1, Math.floor(exact)), remainder: exact - Math.floor(exact) };
  });
  let total = shares.reduce((sum, entry) => sum + entry.shares, 0);
  // Floors of 1 can overshoot: take back from the biggest allocations first.
  while (total > supply) {
    const biggest = shares.filter((entry) => entry.shares > 1).sort((a, b) => b.shares - a.shares)[0];
    if (!biggest) break;
    biggest.shares -= 1;
    total -= 1;
  }
  // Rounding down leaves a few: largest remainders first, never past what was asked for.
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || byTime.indexOf(a.sub) - byTime.indexOf(b.sub));
  for (let i = 0; total < supply && order.length; i = (i + 1) % order.length) {
    const entry = order[i];
    if (entry.shares < entry.sub.requested) {
      entry.shares += 1;
      total += 1;
    } else if (order.every((candidate) => candidate.shares >= candidate.sub.requested)) {
      break;
    }
  }
  for (const entry of shares) result.set(entry.sub.id, entry.shares);
  return result;
}

/** Starting max shares from the weekly bell curve: her subscribers against the listed market's. */
async function startingMaxShares(client, youtubeChannelId) {
  const { rows } = await client.query(
    `
    WITH latest AS (
      SELECT DISTINCT ON (s.youtube_channel_id) s.youtube_channel_id, s.subscriber_count
      FROM yt.youtube_channel_daily_stats s
      WHERE s.subscriber_count > 0
      ORDER BY s.youtube_channel_id, s.time DESC
    )
    SELECT l.youtube_channel_id, l.subscriber_count, a.status
    FROM latest l
    JOIN market.market_assets a ON a.youtube_channel_id = l.youtube_channel_id
    WHERE a.status IN ('active', 'halted') OR l.youtube_channel_id = $1
  `,
    [youtubeChannelId]
  );
  const own = rows.find((row) => row.youtube_channel_id === youtubeChannelId);
  if (!own) return { maxShares: weeklyEvaluation.CONFIG.maxSharesMin, subscribers: null };
  const listed = rows.filter((row) => row.youtube_channel_id !== youtubeChannelId);
  const values = [...listed, own].map((row) => Math.log(toNumber(row.subscriber_count, 0)));
  const z = weeklyEvaluation.zScores(values)[values.length - 1];
  return { maxShares: weeklyEvaluation.maxSharesFor(z), subscribers: toNumber(own.subscriber_count, 0), z };
}

// ── Ledger and cash ──────────────────────────────────────────────────────
async function ledger(client, { userId, assetId, entryType, quantityDelta = 0, cashDelta = 0, subscriptionId }) {
  await client.query(
    `
    INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, credit_delta, reference_type, reference_id)
    VALUES ($1, $2, $3, $4, $5, 0, 'ipo_subscription', $6)
  `,
    [userId, assetId, entryType, quantityDelta, cashDelta, subscriptionId]
  );
}

/** Moves cash between spendable and held (+ holds, − releases), with a ledger line. */
async function moveHeld(client, { userId, assetId, subscriptionId, amount }) {
  if (!(Math.abs(amount) > 0)) return;
  await client.query(
    `UPDATE market.portfolio_cash_balances SET cash_balance = cash_balance - $2, held_cash = held_cash + $2, updated_at = now() WHERE user_id = $1`,
    [userId, amount]
  );
  await ledger(client, { userId, assetId, entryType: amount > 0 ? "ipo_cash_hold" : "ipo_cash_release", cashDelta: -amount, subscriptionId });
}

// ── Reads ────────────────────────────────────────────────────────────────
async function loadEvents(db, { statuses = null, eventId = null, lock = false } = {}) {
  const params = [];
  const where = [];
  if (statuses) {
    params.push(statuses);
    where.push(`status = ANY($${params.length}::text[])`);
  }
  if (eventId) {
    params.push(eventId);
    where.push(`id = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT * FROM market.ipo_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY listing_date DESC, id DESC ${lock ? "FOR UPDATE" : ""}`,
    params
  );
  return rows;
}

async function loadListings(db, eventIds, { lock = false } = {}) {
  if (!eventIds.length) return [];
  const { rows } = await db.query(
    `
    SELECT l.*, a.symbol, a.display_name, a.status AS asset_status, a.youtube_channel_id, a.current_fair_value, a.max_supply,
           a.circulating_supply, c.name_short, c.name_english, c.name_japanese, c.unit, c.icon, c.color, c.twitter_id,
           c.profile_id, c.birthday, c.youtube_channel_icon_url, c.channel_asset_icon_url, c.is_active
    FROM market.ipo_listings l
    JOIN market.market_assets a ON a.id = l.asset_id
    JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE l.event_id = ANY($1::bigint[])
    ORDER BY l.event_id, a.symbol
    ${lock ? "FOR UPDATE OF l, a" : ""}
  `,
    [eventIds]
  );
  return rows;
}

/** Daily channel numbers since tracking began (one row a day: the day's last scrape). */
async function loadChannelSeries(db, channelIds, { days = 60 } = {}) {
  if (!channelIds.length) return new Map();
  const { rows } = await db.query(
    `
    SELECT DISTINCT ON (s.youtube_channel_id, timezone($2, s.time)::date)
      s.youtube_channel_id, timezone($2, s.time)::date::text AS day, s.subscriber_count, s.view_count, s.video_count
    FROM yt.youtube_channel_daily_stats s
    WHERE s.youtube_channel_id = ANY($1::text[])
      AND s.time > now() - ($3 || ' days')::interval
    ORDER BY s.youtube_channel_id, timezone($2, s.time)::date, s.time DESC
  `,
    [channelIds, DATA_TIME_ZONE, String(days)]
  );
  const byChannel = new Map();
  for (const row of rows) {
    if (!byChannel.has(row.youtube_channel_id)) byChannel.set(row.youtube_channel_id, []);
    byChannel.get(row.youtube_channel_id).push({ day: row.day, subscribers: maybeNumber(row.subscriber_count), views: maybeNumber(row.view_count), videos: maybeNumber(row.video_count) });
  }
  return byChannel;
}

async function loadFairValueSeries(db, channelIds, { days = 60 } = {}) {
  if (!channelIds.length) return new Map();
  const { rows } = await db.query(
    `
    SELECT youtube_channel_id, snapshot_date::text AS day, fundamental_value_smoothed
    FROM market.channel_daily_snapshots
    WHERE youtube_channel_id = ANY($1::text[]) AND calculation_status = 'complete' AND snapshot_date > current_date - $2::int
    ORDER BY youtube_channel_id, snapshot_date
  `,
    [channelIds, days]
  );
  const byChannel = new Map();
  for (const row of rows) {
    if (!byChannel.has(row.youtube_channel_id)) byChannel.set(row.youtube_channel_id, []);
    byChannel.get(row.youtube_channel_id).push({ day: row.day, fair_value: round2(toNumber(row.fundamental_value_smoothed) / 100) });
  }
  return byChannel;
}

async function loadSubscriptionTotals(db, listingIds) {
  if (!listingIds.length) return new Map();
  const { rows } = await db.query(
    `
    SELECT listing_id, COUNT(*) FILTER (WHERE status IN ('pending', 'allocated'))::int AS subscribers,
           COALESCE(SUM(requested_shares) FILTER (WHERE status IN ('pending', 'allocated')), 0) AS requested
    FROM market.ipo_subscriptions
    WHERE listing_id = ANY($1::bigint[])
    GROUP BY listing_id
  `,
    [listingIds]
  );
  return new Map(rows.map((row) => [String(row.listing_id), { subscribers: row.subscribers, requested: toNumber(row.requested) }]));
}

function channelSummary(series) {
  if (!series?.length) return { days_tracked: 0, tracked_since: null, latest: null, week: null };
  const latest = series[series.length - 1];
  const weekAgo = series.find((row) => row.day >= shiftDay(latest.day, -7)) || series[0];
  const gainDays = Math.max(1, daysBetween(weekAgo.day, latest.day));
  return {
    days_tracked: series.length,
    tracked_since: series[0].day,
    latest,
    week: weekAgo === latest ? null : {
      days: gainDays,
      subscribers: latest.subscribers - weekAgo.subscribers,
      views: latest.views - weekAgo.views,
      videos: latest.videos - weekAgo.videos,
    },
  };
}

function shiftDay(key, days) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function eventView(event, now = new Date()) {
  return {
    id: Number(event.id),
    title: event.title,
    status: event.status,
    listing_date: dateKey(event.listing_date),
    window_opens_at: event.window_opens_at,
    window_closes_at: event.window_closes_at,
    window_open: event.status === "open" && now < new Date(event.window_closes_at),
    discount_pct: toNumber(event.discount_pct),
    offering_pct: toNumber(event.offering_pct),
    player_cap_pct: toNumber(event.player_cap_pct),
    opened_at: event.opened_at,
    listed_at: event.listed_at,
    cancelled_at: event.cancelled_at,
  };
}

function playerCap(listing, event) {
  const offered = toNumber(listing.shares_offered, 0);
  return offered > 0 ? Math.max(1, Math.floor((offered * toNumber(event.player_cap_pct)) / 100)) : null;
}

function talentView(listing, event, { series, totals, mine = null, admin = false, fairValues = null }) {
  const opened = event.status !== "announced";
  const view = {
    listing_id: Number(listing.id),
    symbol: listing.symbol,
    display_name: listing.display_name,
    name_short: listing.name_short,
    name_english: listing.name_english,
    name_japanese: listing.name_japanese,
    unit: listing.unit,
    icon: listing.icon,
    color: listing.color,
    twitter_id: listing.twitter_id,
    birthday: listing.birthday ? dateKey(listing.birthday).slice(5) : null,
    youtube_channel_id: listing.youtube_channel_id,
    youtube_channel_icon_url: listing.youtube_channel_icon_url || listing.channel_asset_icon_url || null,
    status: listing.status,
    channel: channelSummary(series),
    series: (series || []).slice(-45),
    ipo_price: opened ? maybeNumber(listing.ipo_price) : null,
    shares_offered: opened ? maybeNumber(listing.shares_offered) : null,
    starting_max_supply: opened ? maybeNumber(listing.starting_max_supply) : null,
    player_cap: opened ? playerCap(listing, event) : null,
    subscribed_shares: totals?.requested ?? 0,
    subscribers: totals?.subscribers ?? 0,
    shares_allocated: listing.status === "listed" ? toNumber(listing.shares_allocated) : null,
    mine,
  };
  if (admin) {
    view.asset_status = listing.asset_status;
    view.is_active = listing.is_active;
    view.current_fair_value = maybeNumber(listing.current_fair_value);
    view.debut_fair_value = maybeNumber(listing.debut_fair_value);
    view.fair_value_series = fairValues || [];
  }
  return view;
}

async function buildEvents(db, events, { userId = null, admin = false, now = new Date() } = {}) {
  const listings = await loadListings(db, events.map((event) => event.id));
  const channelIds = [...new Set(listings.map((listing) => listing.youtube_channel_id))];
  const [series, totals, fairValues] = await Promise.all([
    loadChannelSeries(db, channelIds),
    loadSubscriptionTotals(db, listings.map((listing) => listing.id)),
    admin ? loadFairValueSeries(db, channelIds) : Promise.resolve(new Map()),
  ]);
  let mine = new Map();
  if (userId && listings.length) {
    const { rows } = await db.query(
      `SELECT listing_id, requested_shares, price, held_cash, status, allocated_shares, refunded_cash, updated_at FROM market.ipo_subscriptions WHERE user_id = $1 AND listing_id = ANY($2::bigint[])`,
      [userId, listings.map((listing) => listing.id)]
    );
    mine = new Map(rows.map((row) => [String(row.listing_id), {
      requested_shares: toNumber(row.requested_shares),
      price: toNumber(row.price),
      held_cash: toNumber(row.held_cash),
      status: row.status,
      allocated_shares: toNumber(row.allocated_shares),
      refunded_cash: toNumber(row.refunded_cash),
      updated_at: row.updated_at,
    }]));
  }
  return events.map((event) => {
    const own = listings.filter((listing) => String(listing.event_id) === String(event.id) && (admin || listing.status !== "cancelled"));
    return {
      ...eventView(event, now),
      ...(admin ? { last_error: event.last_error, created_at: event.created_at } : {}),
      talents: own.map((listing) =>
        talentView(listing, event, {
          series: series.get(listing.youtube_channel_id),
          totals: totals.get(String(listing.id)),
          mine: mine.get(String(listing.id)) || null,
          admin,
          fairValues: fairValues.get(listing.youtube_channel_id),
        })
      ),
    };
  });
}

/** Public: upcoming and open IPOs, plus ones listed in the last week. */
async function getPublicIpos(pool, { userId = null, now = new Date() } = {}) {
  const { rows: events } = await pool.query(
    `
    SELECT * FROM market.ipo_events
    WHERE status IN ('announced', 'open') OR (status = 'listed' AND listed_at > now() - interval '7 days')
    ORDER BY listing_date ASC, id ASC
  `
  );
  return { events: await buildEvents(pool, events, { userId, now }), server_time: now.toISOString() };
}

/** Admin: every IPO with the data funnel, and prelaunch talents not in a live IPO. */
async function getAdminOverview(pool, { now = new Date() } = {}) {
  const events = await loadEvents(pool);
  const { rows: unassigned } = await pool.query(
    `
    SELECT a.id AS asset_id, a.symbol, a.display_name, a.youtube_channel_id, c.unit, c.color, c.is_active
    FROM market.market_assets a
    JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE a.status = 'prelaunch'
      AND NOT EXISTS (SELECT 1 FROM market.ipo_listings l WHERE l.asset_id = a.id AND l.status <> 'cancelled')
    ORDER BY a.symbol
  `
  );
  const series = await loadChannelSeries(pool, unassigned.map((row) => row.youtube_channel_id));
  const { rows: used } = await pool.query(`SELECT symbol FROM market.market_assets UNION SELECT symbol FROM yt.youtube_channels WHERE symbol IS NOT NULL`);
  return {
    events: await buildEvents(pool, events, { admin: true, now }),
    unassigned: unassigned.map((row) => ({ ...row, asset_id: Number(row.asset_id), channel: channelSummary(series.get(row.youtube_channel_id)) })),
    used_symbols: used.map((row) => row.symbol),
    defaults: { ...DEFAULTS, listing_date: suggestedListingDate(now) },
    settlement: { hour: SETTLEMENT_HOUR, minute: SETTLEMENT_MINUTE, time_zone: TIME_ZONE },
    server_time: now.toISOString(),
  };
}

/** Two weeks out, moved off the weekend (Saturday is the weekly evaluation). */
function suggestedListingDate(now = new Date()) {
  let key = shiftDay(todayKey(now), 14);
  while ([0, 6].includes(new Date(`${key}T12:00:00Z`).getUTCDay())) key = shiftDay(key, 1);
  return key;
}

// ── Admin writes ─────────────────────────────────────────────────────────
function parseEventSettings(body, current = {}) {
  const title = String(body.title ?? current.title ?? "").trim();
  if (!title || title.length > 120) throw codedError("invalid_title");
  const listingDate = String(body.listing_date ?? dateKey(current.listing_date) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listingDate) || Number.isNaN(Date.parse(`${listingDate}T00:00:00Z`))) throw codedError("invalid_listing_date");
  const number = (key, fallback, min, max, field) => {
    const raw = body[key] ?? fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) throw codedError("invalid_setting", { field });
    return n;
  };
  const windowHours = number("window_hours", current.window_hours ?? DEFAULTS.windowHours, 1, 24 * 14, "window_hours");
  return {
    title,
    listingDate,
    windowHours,
    discountPct: number("discount_pct", current.discount_pct ?? DEFAULTS.discountPct, 0, 50, "discount_pct"),
    offeringPct: number("offering_pct", current.offering_pct ?? DEFAULTS.offeringPct, 1, 100, "offering_pct"),
    playerCapPct: number("player_cap_pct", current.player_cap_pct ?? DEFAULTS.playerCapPct, 1, 100, "player_cap_pct"),
  };
}

function hexColor(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) throw codedError("invalid_color");
  return text.toLowerCase();
}

/** Saves (or re-activates) a detected talent's channel so the scraper starts collecting her stats. */
async function upsertTrackedChannel(client, talent) {
  const youtubeChannelId = String(talent.youtube_channel_id || "").trim();
  if (!YOUTUBE_ID_PATTERN.test(youtubeChannelId)) throw codedError("invalid_youtube_channel_id", { field: youtubeChannelId });
  const nameShort = String(talent.name_short || "").trim();
  if (!nameShort) throw codedError("invalid_name", { field: youtubeChannelId });
  const symbol = String(talent.symbol || "").trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) throw codedError("invalid_symbol", { field: symbol || youtubeChannelId });
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(String(talent.birthday || "")) ? talent.birthday : null;
  const icon = String(talent.icon || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || null;
  const { rows: clash } = await client.query(
    `
    SELECT 'asset' AS kind FROM market.market_assets WHERE symbol = $1 AND youtube_channel_id <> $2
    UNION ALL
    SELECT 'channel' FROM yt.youtube_channels WHERE symbol = $1 AND youtube_channel_id <> $2
  `,
    [symbol, youtubeChannelId]
  );
  if (clash.length) throw codedError("symbol_taken", { field: symbol });
  const { rows } = await client.query(
    `
    INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, name_japanese, symbol, icon, color, twitter_id, profile_id, birthday, height, unit, is_active, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,now())
    ON CONFLICT (youtube_channel_id) DO UPDATE SET
      symbol = EXCLUDED.symbol,
      color = COALESCE(EXCLUDED.color, yt.youtube_channels.color),
      unit = COALESCE(EXCLUDED.unit, yt.youtube_channels.unit),
      icon = COALESCE(yt.youtube_channels.icon, EXCLUDED.icon),
      is_active = true,
      updated_at = now()
    RETURNING *
  `,
    [
      youtubeChannelId,
      nameShort,
      String(talent.name_english || "").trim() || null,
      String(talent.name_japanese || "").trim() || null,
      symbol,
      icon,
      hexColor(talent.color),
      String(talent.twitter_id || "").trim() || null,
      String(talent.profile_id || "").trim() || null,
      birthday,
      String(talent.height || "").trim() || null,
      String(talent.unit || "").trim() || null,
    ]
  );
  return rows[0];
}

/**
 * Creates an IPO: new talents (from the detector, with the admin's ticker/colour/unit) are saved as
 * tracked channels and prelaunch stocks; `asset_ids` adds talents already tracked as prelaunch.
 * Reference pictures upload afterwards (best effort; skipped without S3 credentials).
 */
async function createEvent(pool, body, { adminUserId = null, now = new Date() } = {}) {
  const settings = parseEventSettings(body || {});
  if (settings.listingDate <= todayKey(now)) throw codedError("listing_date_past");
  const window = windowFor(settings.listingDate, settings.windowHours);
  const talents = Array.isArray(body?.talents) ? body.talents : [];
  const assetIds = (Array.isArray(body?.asset_ids) ? body.asset_ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!talents.length && !assetIds.length) throw codedError("no_talents");
  if (talents.length + assetIds.length > 20) throw codedError("too_many_talents");

  const client = await pool.connect();
  const saved = [];
  let eventId;
  try {
    await client.query("BEGIN");
    for (const talent of talents) saved.push({ channel: await upsertTrackedChannel(client, talent), referenceImageUrl: talent.reference_image_url || null });
    // Creates their stocks as prelaunch (what the 09:00 run would do tomorrow), so the IPO can point at them.
    await bootstrapAssetsWithClient(client, { activeOnly: true, syncExisting: false });
    const channelIds = saved.map((entry) => entry.channel.youtube_channel_id);
    const { rows: assets } = await client.query(
      `
      SELECT id, symbol, status FROM market.market_assets
      WHERE youtube_channel_id = ANY($1::text[]) OR id = ANY($2::bigint[])
      FOR UPDATE
    `,
      [channelIds, assetIds]
    );
    if (assets.length !== channelIds.length + assetIds.length) throw codedError("talent_not_found");
    const notPrelaunch = assets.find((asset) => asset.status !== "prelaunch");
    if (notPrelaunch) throw codedError("already_listed", { field: notPrelaunch.symbol });
    const { rows: busy } = await client.query(
      `SELECT a.symbol FROM market.ipo_listings l JOIN market.market_assets a ON a.id = l.asset_id WHERE l.asset_id = ANY($1::bigint[]) AND l.status <> 'cancelled'`,
      [assets.map((asset) => asset.id)]
    );
    if (busy.length) throw codedError("already_in_ipo", { field: busy[0].symbol });
    const { rows: events } = await client.query(
      `
      INSERT INTO market.ipo_events (title, listing_date, window_opens_at, window_closes_at, discount_pct, offering_pct, player_cap_pct, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
    `,
      [settings.title, settings.listingDate, window.opens, window.closes, settings.discountPct, settings.offeringPct, settings.playerCapPct, adminUserId]
    );
    eventId = Number(events[0].id);
    for (const asset of assets) {
      await client.query(`INSERT INTO market.ipo_listings (event_id, asset_id) VALUES ($1, $2)`, [eventId, asset.id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") throw codedError("symbol_taken");
    throw error;
  } finally {
    client.release();
  }

  const images = [];
  for (const entry of saved) {
    try {
      const uploaded = referenceImages.getS3Client() ? await referenceImages.maybeUploadReferenceImage(entry.channel, entry.referenceImageUrl) : null;
      images.push({ symbol: entry.channel.symbol, uploaded: Boolean(uploaded), url: uploaded?.url || entry.referenceImageUrl });
    } catch (error) {
      images.push({ symbol: entry.channel.symbol, uploaded: false, error: String(error?.message || error) });
    }
  }
  return { event_id: eventId, reference_images: images };
}

async function updateEvent(pool, eventId, body) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [event] = await loadEvents(client, { eventId, lock: true });
    if (!event) throw codedError("ipo_not_found");
    if (event.status !== "announced") throw codedError("ipo_not_editable");
    const currentHours = (new Date(event.window_closes_at) - new Date(event.window_opens_at)) / 3_600_000;
    const settings = parseEventSettings(body || {}, { ...event, window_hours: currentHours });
    if (settings.listingDate <= todayKey()) throw codedError("listing_date_past");
    const window = windowFor(settings.listingDate, settings.windowHours);
    await client.query(
      `
      UPDATE market.ipo_events
      SET title = $2, listing_date = $3, window_opens_at = $4, window_closes_at = $5, discount_pct = $6, offering_pct = $7,
          player_cap_pct = $8, last_error = NULL, updated_at = now()
      WHERE id = $1
    `,
      [eventId, settings.title, settings.listingDate, window.opens, window.closes, settings.discountPct, settings.offeringPct, settings.playerCapPct]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Removes a talent from an IPO that hasn't opened (she stays tracked as prelaunch). */
async function removeListing(pool, eventId, listingId) {
  const { rowCount } = await pool.query(
    `
    UPDATE market.ipo_listings l SET status = 'cancelled'
    FROM market.ipo_events e
    WHERE l.id = $2 AND l.event_id = $1 AND e.id = l.event_id AND e.status = 'announced' AND l.status = 'pending'
  `,
    [eventId, listingId]
  );
  if (!rowCount) throw codedError("ipo_not_editable");
}

/**
 * Opens the window: fixes each talent's IPO price (debut fair value less the discount), her starting
 * max shares and the offering. Refused (and recorded on the event) while a talent has no fair value.
 */
async function openWindow(pool, eventId, { now = new Date(), redis = null, force = false } = {}) {
  const client = await pool.connect();
  let event;
  try {
    await client.query("BEGIN");
    [event] = await loadEvents(client, { eventId, lock: true });
    if (!event) throw codedError("ipo_not_found");
    if (event.status !== "announced") throw codedError("ipo_not_announced");
    if (!force && new Date(event.window_opens_at) > now) throw codedError("ipo_window_not_due");
    if (now >= new Date(event.window_closes_at)) throw codedError("ipo_window_passed");
    const listings = (await loadListings(client, [event.id], { lock: true })).filter((listing) => listing.status === "pending");
    if (!listings.length) throw codedError("no_talents");
    const missing = listings.filter((listing) => !(toNumber(listing.current_fair_value, 0) > 0));
    if (missing.length) throw codedError("no_fair_value", { field: missing.map((listing) => listing.symbol).join(", ") });
    for (const listing of listings) {
      const fairValue = toNumber(listing.current_fair_value);
      const price = Math.max(0.01, round2(fairValue * (1 - toNumber(event.discount_pct) / 100)));
      const { maxShares } = await startingMaxShares(client, listing.youtube_channel_id);
      const offered = Math.max(1, Math.floor((maxShares * toNumber(event.offering_pct)) / 100));
      await client.query(
        `UPDATE market.ipo_listings SET debut_fair_value = $2, ipo_price = $3, starting_max_supply = $4, shares_offered = $5 WHERE id = $1`,
        [listing.id, fairValue, price, maxShares, offered]
      );
      await client.query(
        `UPDATE market.market_assets SET max_supply = $2, treasury_supply = GREATEST($2 - circulating_supply, 0), updated_at = now() WHERE id = $1`,
        [listing.asset_id, maxShares]
      );
    }
    await client.query(
      `UPDATE market.ipo_events SET status = 'open', opened_at = $2, window_opens_at = LEAST(window_opens_at, $2), last_error = NULL, updated_at = now() WHERE id = $1`,
      [event.id, now]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (event && error?.code) {
      await pool.query(`UPDATE market.ipo_events SET last_error = $2, updated_at = now() WHERE id = $1`, [eventId, `${error.code}${error.field ? `: ${error.field}` : ""}`]).catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
  void publishMarketEvent(redis, { type: "market.ipo_update", event_id: Number(eventId), status: "open", at: now.toISOString() });
  return { event_id: Number(eventId), status: "open" };
}

/** Cancels an IPO that hasn't listed: every subscription's cash comes back. */
async function cancelEvent(pool, eventId, { redis = null } = {}) {
  const client = await pool.connect();
  const toNotify = [];
  try {
    await client.query("BEGIN");
    const [event] = await loadEvents(client, { eventId, lock: true });
    if (!event) throw codedError("ipo_not_found");
    if (!["announced", "open"].includes(event.status)) throw codedError("ipo_not_cancellable");
    const { rows: subs } = await client.query(
      `
      SELECT s.*, l.asset_id, a.symbol FROM market.ipo_subscriptions s
      JOIN market.ipo_listings l ON l.id = s.listing_id
      JOIN market.market_assets a ON a.id = l.asset_id
      WHERE l.event_id = $1 AND s.status = 'pending'
      ORDER BY s.user_id
      FOR UPDATE OF s
    `,
      [event.id]
    );
    for (const sub of subs) {
      await ensureUserCashAccount(client, sub.user_id);
      await moveHeld(client, { userId: sub.user_id, assetId: sub.asset_id, subscriptionId: sub.id, amount: -toNumber(sub.held_cash) });
      await client.query(`UPDATE market.ipo_subscriptions SET status = 'cancelled', refunded_cash = held_cash, held_cash = 0, updated_at = now() WHERE id = $1`, [sub.id]);
      toNotify.push(sub);
    }
    await client.query(`UPDATE market.ipo_listings SET status = 'cancelled' WHERE event_id = $1 AND status = 'pending'`, [event.id]);
    await client.query(`UPDATE market.ipo_events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`, [event.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  for (const sub of toNotify) {
    await notifications
      .notify(pool, sub.user_id, { kind: "ipo", title: `The ${sub.symbol} IPO was called off`, body: `Your ${notifications.money(sub.held_cash)} is back in your Cash.`, href: "/market/ipo" })
      .catch(() => {});
  }
  void publishMarketEvent(redis, { type: "market.ipo_update", event_id: Number(eventId), status: "cancelled", at: new Date().toISOString() });
  return { event_id: Number(eventId), status: "cancelled", refunded: toNotify.length };
}

// ── Players ──────────────────────────────────────────────────────────────
async function lockListingForPlayer(client, symbol) {
  const { rows } = await client.query(
    `
    SELECT l.*, a.symbol, e.status AS event_status, e.window_closes_at, e.player_cap_pct, e.id AS event_id
    FROM market.ipo_listings l
    JOIN market.market_assets a ON a.id = l.asset_id
    JOIN market.ipo_events e ON e.id = l.event_id
    WHERE a.symbol = $1 AND l.status = 'pending'
    FOR UPDATE OF l
  `,
    [symbol]
  );
  const listing = rows[0];
  if (!listing) throw codedError("ipo_not_found");
  if (listing.event_status !== "open" || new Date() >= new Date(listing.window_closes_at)) throw codedError("ipo_window_closed");
  return listing;
}

/**
 * Subscribes for `shares` of a talent in an open IPO (or changes the request): the cost is held from
 * Cash now and settles at listing. Changing it moves only the difference.
 */
async function subscribe(pool, { userId, symbol, shares }) {
  const requested = Number(shares);
  if (!Number.isInteger(requested) || requested < 1) throw codedError("invalid_quantity");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const listing = await lockListingForPlayer(client, String(symbol || "").toUpperCase());
    const cap = playerCap(listing, { player_cap_pct: listing.player_cap_pct });
    if (cap && requested > cap) throw codedError("over_player_cap", { limit: cap });
    const account = await ensureUserCashAccount(client, userId);
    const { rows: existing } = await client.query(`SELECT * FROM market.ipo_subscriptions WHERE listing_id = $1 AND user_id = $2 FOR UPDATE`, [listing.id, userId]);
    const price = toNumber(listing.ipo_price);
    const held = existing[0]?.status === "pending" ? toNumber(existing[0].held_cash) : 0;
    const cost = round2(requested * price);
    const delta = round2(cost - held);
    if (delta > toNumber(account.cash_balance) + 1e-9) throw codedError("insufficient_cash");
    let subscriptionId;
    if (existing[0]) {
      subscriptionId = existing[0].id;
      await client.query(
        `UPDATE market.ipo_subscriptions SET requested_shares = $2, price = $3, held_cash = $4, status = 'pending', refunded_cash = 0, updated_at = now() WHERE id = $1`,
        [subscriptionId, requested, price, cost]
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO market.ipo_subscriptions (listing_id, user_id, requested_shares, price, held_cash) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [listing.id, userId, requested, price, cost]
      );
      subscriptionId = rows[0].id;
    }
    await moveHeld(client, { userId, assetId: listing.asset_id, subscriptionId, amount: delta });
    await client.query("COMMIT");
    return { symbol: listing.symbol, requested_shares: requested, price, held_cash: cost, cash_balance: round2(toNumber(account.cash_balance) - delta) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function cancelSubscription(pool, { userId, symbol }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const listing = await lockListingForPlayer(client, String(symbol || "").toUpperCase());
    const { rows } = await client.query(`SELECT * FROM market.ipo_subscriptions WHERE listing_id = $1 AND user_id = $2 AND status = 'pending' FOR UPDATE`, [listing.id, userId]);
    const sub = rows[0];
    if (!sub) throw codedError("subscription_not_found");
    await ensureUserCashAccount(client, userId);
    await moveHeld(client, { userId, assetId: listing.asset_id, subscriptionId: sub.id, amount: -toNumber(sub.held_cash) });
    await client.query(`UPDATE market.ipo_subscriptions SET status = 'cancelled', refunded_cash = held_cash, held_cash = 0, updated_at = now() WHERE id = $1`, [sub.id]);
    await client.query("COMMIT");
    return { symbol: listing.symbol, released_cash: toNumber(sub.held_cash) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ── Listing ──────────────────────────────────────────────────────────────
/**
 * Lists an open IPO: fills subscriptions at the IPO price, refunds the rest, and turns the stocks
 * active, opening at the IPO price. `marketDate` is her first market day. Unless `force`, waits while a
 * talent has no completed snapshot for that day (settlement would refuse the day without one).
 */
async function listEvent(pool, eventId, { marketDate = todayKey(), force = false, redis = null } = {}) {
  const client = await pool.connect();
  const notices = [];
  let listed = [];
  try {
    await client.query("BEGIN");
    const [event] = await loadEvents(client, { eventId, lock: true });
    if (!event) throw codedError("ipo_not_found");
    if (event.status !== "open") throw codedError("ipo_not_open");
    const listings = (await loadListings(client, [event.id], { lock: true })).filter((listing) => listing.status === "pending");
    if (!force) {
      const { rows: ready } = await client.query(
        `SELECT youtube_channel_id FROM market.channel_daily_snapshots WHERE youtube_channel_id = ANY($1::text[]) AND snapshot_date = $2 AND calculation_status = 'complete'`,
        [listings.map((listing) => listing.youtube_channel_id), marketDate]
      );
      const have = new Set(ready.map((row) => row.youtube_channel_id));
      const waiting = listings.filter((listing) => !have.has(listing.youtube_channel_id));
      if (waiting.length) throw codedError("waiting_for_stats", { field: `${waiting.map((listing) => listing.symbol).join(", ")} on ${marketDate}` });
    }
    for (const listing of listings) {
      const price = toNumber(listing.ipo_price);
      const { rows: subs } = await client.query(
        `SELECT * FROM market.ipo_subscriptions WHERE listing_id = $1 AND status = 'pending' ORDER BY created_at, id FOR UPDATE`,
        [listing.id]
      );
      const shares = allocate(subs.map((sub) => ({ id: String(sub.id), requested: sub.requested_shares, created_at: sub.created_at?.toISOString?.() ?? sub.created_at })), listing.shares_offered);
      let allocatedTotal = 0;
      for (const sub of subs) {
        const userId = sub.user_id;
        const allocated = shares.get(String(sub.id)) || 0;
        const held = toNumber(sub.held_cash);
        const cost = Math.min(held, round2(allocated * price));
        const refund = round2(held - cost);
        await ensureUserCashAccount(client, userId);
        // The whole hold comes off held cash: the cost leaves, the rest goes back to spendable Cash.
        await client.query(
          `UPDATE market.portfolio_cash_balances SET held_cash = GREATEST(held_cash - $2, 0), cash_balance = cash_balance + $3, updated_at = now() WHERE user_id = $1`,
          [userId, held, refund]
        );
        await ledger(client, { userId, assetId: listing.asset_id, entryType: "ipo_cash_release", cashDelta: held, subscriptionId: sub.id });
        if (allocated > 0) {
          const { rows: holding } = await client.query(`SELECT quantity, avg_cost_basis FROM market.portfolio_holdings WHERE user_id = $1 AND asset_id = $2 FOR UPDATE`, [userId, listing.asset_id]);
          const oldQty = toNumber(holding[0]?.quantity, 0);
          const newQty = oldQty + allocated;
          const avg = (oldQty * toNumber(holding[0]?.avg_cost_basis, 0) + cost) / newQty;
          await client.query(
            `
            INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis, updated_at) VALUES ($1,$2,$3,$4,now())
            ON CONFLICT (user_id, asset_id) DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost_basis = EXCLUDED.avg_cost_basis, updated_at = now()
          `,
            [userId, listing.asset_id, newQty, avg]
          );
          await ledger(client, { userId, assetId: listing.asset_id, entryType: "ipo_allocation", quantityDelta: allocated, cashDelta: -cost, subscriptionId: sub.id });
          allocatedTotal += allocated;
        }
        await client.query(
          `UPDATE market.ipo_subscriptions SET status = $2, allocated_shares = $3, refunded_cash = $4, held_cash = 0, updated_at = now() WHERE id = $1`,
          [sub.id, allocated > 0 ? "allocated" : "refunded", allocated, refund]
        );
        notices.push({ userId, symbol: listing.symbol, requested: toNumber(sub.requested_shares), allocated, price, refund });
      }
      // Shares players now hold leave the broker; she opens at the IPO price with fair value pulling
      // from there (transient offset ln(price/fair), decaying like any order impact).
      const fairValue = Math.max(toNumber(listing.current_fair_value, 0), 0.000001);
      await client.query(
        `
        UPDATE market.market_assets
        SET status = 'active',
            circulating_supply = circulating_supply + $2::numeric,
            treasury_supply = GREATEST(max_supply - (circulating_supply + $2::numeric), 0),
            current_mid_price = $3::numeric,
            current_bid_price = $3::numeric * (1 - spread_bps / 20000.0),
            current_ask_price = $3::numeric * (1 + spread_bps / 20000.0),
            current_premium_pct = ($3::numeric - $4::numeric) / $4::numeric,
            current_persistent_offset = 0,
            current_transient_offset = LN($3::numeric / $4::numeric),
            offsets_updated_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
        [listing.asset_id, allocatedTotal, price, fairValue]
      );
      await client.query(`UPDATE market.ipo_listings SET status = 'listed', shares_allocated = $2, listed_on = $3 WHERE id = $1`, [listing.id, allocatedTotal, marketDate]);
      listed.push({ symbol: listing.symbol, price, allocated: allocatedTotal, offered: toNumber(listing.shares_offered), subscribers: subs.length });
    }
    await client.query(`UPDATE market.ipo_events SET status = 'listed', listed_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`, [event.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code) {
      await pool.query(`UPDATE market.ipo_events SET last_error = $2, updated_at = now() WHERE id = $1`, [eventId, `${error.code}${error.field ? `: ${error.field}` : ""}`]).catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
  for (const notice of notices) {
    const title = notice.allocated > 0 ? `You got ${notice.allocated.toLocaleString("en-US")} ${notice.symbol} at the IPO` : `No ${notice.symbol} shares this time`;
    const body =
      notice.allocated > 0
        ? `${notice.allocated} of the ${notice.requested} you asked for, at ${notifications.money(notice.price)} each.${notice.refund > 0 ? ` ${notifications.money(notice.refund)} is back in your Cash.` : ""} ${notice.symbol} trades from today.`
        : `The IPO was oversubscribed; ${notifications.money(notice.refund)} is back in your Cash.`;
    await notifications.notify(pool, notice.userId, { kind: "ipo", title, body, href: `/stocks/${notice.symbol}` }).catch(() => {});
  }
  await invalidateMarketAssetsCache(redis).catch(() => {});
  void publishMarketEvent(redis, { type: "market.ipo_update", event_id: Number(eventId), status: "listed", at: new Date().toISOString() });
  return { event_id: Number(eventId), market_date: marketDate, listed };
}

// ── Schedules ────────────────────────────────────────────────────────────
/** Opens windows that are due. Failures (no fair value yet) are recorded on the event and retried. */
async function openDueWindows(pool, { now = new Date(), redis = null, logger = console } = {}) {
  const { rows } = await pool.query(`SELECT id FROM market.ipo_events WHERE status = 'announced' AND window_opens_at <= $1 AND window_closes_at > $1`, [now]);
  const opened = [];
  for (const row of rows) {
    try {
      opened.push(await openWindow(pool, row.id, { now, redis }));
    } catch (error) {
      logger.warn?.(`ipo ${row.id}: window not opened (${error?.code || error?.message})`);
    }
  }
  return opened;
}

/**
 * Called by the 09:00 cycle before settlement: lists open IPOs whose listing day has come, so the
 * settlement of `marketDate` treats them as active and opens them at the IPO price. If the cycle is
 * catching up several days and the listing day isn't the first, she waits for the next cycle.
 */
async function listDueEvents(pool, { marketDate, redis = null, logger = console } = {}) {
  const { rows } = await pool.query(`SELECT id FROM market.ipo_events WHERE status = 'open' AND listing_date <= $1::date ORDER BY id`, [marketDate]);
  const results = [];
  for (const row of rows) {
    try {
      results.push(await listEvent(pool, row.id, { marketDate, redis }));
    } catch (error) {
      logger.warn?.(`ipo ${row.id}: not listed on ${marketDate} (${error?.code || error?.message}${error?.field ? `: ${error.field}` : ""})`);
    }
  }
  return results;
}

function startIpoScheduler(pool, logger = console, redis = null, { intervalMs = 60_000 } = {}) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
      if (!rows[0]?.locked) return;
      try {
        await openDueWindows(pool, { redis, logger });
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
      }
    } catch (error) {
      logger.error?.("ipo scheduler failed", error);
    } finally {
      client?.release();
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const first = setTimeout(() => void tick(), 15_000);
  first.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  schema,
  DEFAULTS,
  allocate,
  windowFor,
  getPublicIpos,
  getAdminOverview,
  createEvent,
  updateEvent,
  removeListing,
  openWindow,
  cancelEvent,
  subscribe,
  cancelSubscription,
  listEvent,
  openDueWindows,
  listDueEvents,
  startIpoScheduler,
  _test: { zonedTime, todayKey, suggestedListingDate, channelSummary },
};
