// /admin/analytics from our own data, which ad blockers can't hide: sign-ups and verified accounts,
// daily and weekly active players (market.user_active_days, written when a session is seen), first
// orders and fills, retention by sign-up day, sign-ups by referral and source tag, activity by game
// and market, and signed-out visitors from the site's own counter (visits.js). Days are New York
// days; `from` and `to` are included.

const { retentionDays } = require("./visits");

const TIME_ZONE = "America/New_York";
const MAX_RANGE_DAYS = 366;
const MAX_COHORTS = 60;

function rangeError() {
  return Object.assign(new Error("invalid_range"), { code: "invalid_range" });
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const shiftDay = (dateKey, days) => new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const n = (value) => Number(value) || 0;

/** The range checked, with `to` stopped at today, and the same length just before it. */
function parseRange(from, to, today) {
  if (!isDateKey(from) || !isDateKey(to) || from > to || from > today) throw rangeError();
  const end = to > today ? today : to;
  const length = daysBetween(from, end) + 1;
  if (length > MAX_RANGE_DAYS) throw rangeError();
  return { from, to: end, length, previous: { from: shiftDay(from, -length), to: shiftDay(from, -1) } };
}

// A New York day as a timestamptz range: [day 00:00, next day 00:00).
const START = (param) => `((${param})::date::timestamp AT TIME ZONE '${TIME_ZONE}')`;
const END = (param) => `(((${param})::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}')`;
const DAY = (column) => `((${column}) AT TIME ZONE '${TIME_ZONE}')::date`;

/** The headline numbers for one range. */
async function totals(db, from, to) {
  const { rows } = await db.query(
    `
    WITH signups AS (
      SELECT u.id, u.email_verified, u.signup_source FROM market.users u WHERE ${DAY("u.created_at")} BETWEEN $1::date AND $2::date
    ),
    first_orders AS (
      SELECT user_id, min(requested_at) AS at FROM market.trade_orders GROUP BY user_id
    ),
    first_fills AS (
      SELECT user_id, min(ts) AS at FROM market.trade_fills GROUP BY user_id
    ),
    visits AS (
      SELECT count(DISTINCT (day, visitor_hash)) AS visitors, COALESCE(sum(views), 0) AS pageviews
      FROM market.site_visits WHERE day BETWEEN $1::date AND $2::date
    )
    SELECT
      (SELECT count(*) FROM signups) AS signups,
      (SELECT count(*) FROM signups WHERE email_verified) AS verified,
      (SELECT count(*) FROM first_orders WHERE ${DAY("at")} BETWEEN $1::date AND $2::date) AS first_orders,
      (SELECT count(*) FROM first_fills WHERE ${DAY("at")} BETWEEN $1::date AND $2::date) AS first_fills,
      (SELECT count(DISTINCT user_id) FROM market.user_active_days WHERE day BETWEEN $1::date AND $2::date) AS active,
      (SELECT visitors FROM visits) AS visitors,
      (SELECT pageviews FROM visits) AS pageviews,
      (SELECT count(*) FROM market.referrals r JOIN signups s ON s.id = r.referee_id) AS referred,
      (SELECT count(*) FROM signups WHERE signup_source IS NOT NULL) AS tagged,
      (SELECT count(*) FROM signups s WHERE s.signup_source IS NULL AND NOT EXISTS (SELECT 1 FROM market.referrals r WHERE r.referee_id = s.id)) AS neither
  `,
    [from, to]
  );
  const row = rows[0];
  return {
    signups: n(row.signups),
    verified: n(row.verified),
    first_orders: n(row.first_orders),
    first_fills: n(row.first_fills),
    active: n(row.active),
    visitors: n(row.visitors),
    pageviews: n(row.pageviews),
    referred: n(row.referred),
    tagged: n(row.tagged),
    neither: n(row.neither),
  };
}

/** One row per day: sign-ups, active players that day and over the 7 days to it, visitors. */
async function series(db, from, to) {
  const { rows } = await db.query(
    `
    WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') AS d),
    first_orders AS (SELECT user_id, ${DAY("min(requested_at)")} AS day FROM market.trade_orders GROUP BY user_id)
    SELECT
      to_char(days.day, 'YYYY-MM-DD') AS at,
      (SELECT count(*) FROM market.users u WHERE ${DAY("u.created_at")} = days.day) AS signups,
      (SELECT count(*) FROM market.users u WHERE ${DAY("u.created_at")} = days.day AND u.email_verified) AS verified,
      (SELECT count(*) FROM market.user_active_days a WHERE a.day = days.day) AS active,
      (SELECT count(DISTINCT a.user_id) FROM market.user_active_days a WHERE a.day BETWEEN days.day - 6 AND days.day) AS weekly_active,
      (SELECT count(*) FROM first_orders o WHERE o.day = days.day) AS first_orders,
      (SELECT count(DISTINCT v.visitor_hash) FROM market.site_visits v WHERE v.day = days.day) AS visitors,
      (SELECT COALESCE(sum(v.views), 0) FROM market.site_visits v WHERE v.day = days.day) AS pageviews
    FROM days
    ORDER BY days.day
  `,
    [from, to]
  );
  return rows.map((row) => ({
    at: row.at,
    signups: n(row.signups),
    verified: n(row.verified),
    active: n(row.active),
    weekly_active: n(row.weekly_active),
    first_orders: n(row.first_orders),
    visitors: n(row.visitors),
    pageviews: n(row.pageviews),
  }));
}

/**
 * Retention by sign-up day (the newest MAX_COHORTS in the range): how many of that day's sign-ups
 * were back the next day, within 7 days and within 30, and in the last 7 days. age_days says how much
 * of each window has happened yet.
 */
async function retention(db, from, to, today) {
  const { rows } = await db.query(
    `
    WITH cohort AS (
      SELECT u.id, ${DAY("u.created_at")} AS day FROM market.users u WHERE ${DAY("u.created_at")} BETWEEN $1::date AND $2::date
    ),
    days AS (SELECT DISTINCT day FROM cohort ORDER BY day DESC LIMIT ${MAX_COHORTS})
    SELECT to_char(c.day, 'YYYY-MM-DD') AS day, ($3::date - c.day) AS age_days, count(*) AS signups,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM market.user_active_days a WHERE a.user_id = c.id AND a.day = c.day + 1)) AS day1,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM market.user_active_days a WHERE a.user_id = c.id AND a.day BETWEEN c.day + 1 AND c.day + 7)) AS week1,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM market.user_active_days a WHERE a.user_id = c.id AND a.day BETWEEN c.day + 1 AND c.day + 30)) AS month1,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM market.user_active_days a WHERE a.user_id = c.id AND a.day > $3::date - 7 AND a.day > c.day)) AS recent,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM market.trade_fills f WHERE f.user_id = c.id)) AS traded
    FROM cohort c JOIN days d ON d.day = c.day
    GROUP BY c.day
    ORDER BY c.day DESC
  `,
    [from, to, today]
  );
  return rows.map((row) => ({
    day: row.day,
    age_days: n(row.age_days),
    signups: n(row.signups),
    day1: n(row.day1),
    week1: n(row.week1),
    month1: n(row.month1),
    recent: n(row.recent),
    traded: n(row.traded),
  }));
}

/** Sign-ups in the range by plain source tag (?ref=v1-email), and by how they found a referral link. */
async function sources(db, from, to) {
  const { rows: tags } = await db.query(
    `
    SELECT u.signup_source AS label, count(*) AS signups, count(*) FILTER (WHERE u.email_verified) AS verified,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM market.trade_fills f WHERE f.user_id = u.id)) AS traded
    FROM market.users u
    WHERE ${DAY("u.created_at")} BETWEEN $1::date AND $2::date AND u.signup_source IS NOT NULL
    GROUP BY u.signup_source
    ORDER BY count(*) DESC, u.signup_source
    LIMIT 25
  `,
    [from, to]
  );
  // Signed-out arrivals by the same tags, so an ad that brings visitors and no sign-ups still shows.
  const { rows: arrivals } = await db.query(
    `SELECT source AS label, count(DISTINCT (day, visitor_hash)) AS visitors FROM market.site_visits
     WHERE day BETWEEN $1::date AND $2::date AND source IS NOT NULL GROUP BY source ORDER BY count(DISTINCT (day, visitor_hash)) DESC, source LIMIT 25`,
    [from, to]
  );
  const visitorsByTag = new Map(arrivals.map((row) => [row.label, n(row.visitors)]));
  const taggedSignups = new Set(tags.map((row) => row.label));
  const { rows: vias } = await db.query(
    `
    SELECT r.via AS label, count(*) AS signups,
           count(*) FILTER (WHERE r.status = 'paid') AS paid,
           count(*) FILTER (WHERE r.status = 'pending') AS pending,
           count(*) FILTER (WHERE r.status IN ('refused', 'expired')) AS not_paid,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM market.trade_fills f WHERE f.user_id = r.referee_id)) AS traded
    FROM market.referrals r
    JOIN market.users u ON u.id = r.referee_id
    WHERE ${DAY("u.created_at")} BETWEEN $1::date AND $2::date
    GROUP BY r.via
    ORDER BY count(*) DESC
  `,
    [from, to]
  );
  return {
    tags: [
      ...tags.map((row) => ({ label: row.label, visitors: visitorsByTag.get(row.label) ?? 0, signups: n(row.signups), verified: n(row.verified), traded: n(row.traded) })),
      ...arrivals.filter((row) => !taggedSignups.has(row.label)).map((row) => ({ label: row.label, visitors: n(row.visitors), signups: 0, verified: 0, traded: 0 })),
    ],
    referrals: vias.map((row) => ({ label: row.label, signups: n(row.signups), paid: n(row.paid), pending: n(row.pending), not_paid: n(row.not_paid), traded: n(row.traded) })),
  };
}

/** Referral outcomes for accounts made in the range: the top sharers, why some weren't paid, the latest. */
async function referralReport(db, from, to) {
  const inRange = `${DAY("e.created_at")} BETWEEN $1::date AND $2::date`;
  const { rows: top } = await db.query(
    `
    SELECT s.username, count(*) AS signups, count(*) FILTER (WHERE r.status = 'paid') AS paid,
           count(*) FILTER (WHERE r.referrer_paid_at IS NOT NULL) AS sharer_paid
    FROM market.referrals r JOIN market.users s ON s.id = r.referrer_id JOIN market.users e ON e.id = r.referee_id
    WHERE ${inRange}
    GROUP BY s.username ORDER BY count(*) DESC, s.username LIMIT 10
  `,
    [from, to]
  );
  const { rows: reasons } = await db.query(
    `
    SELECT side, reason AS label, count(*) AS count FROM (
      SELECT 'new player' AS side, COALESCE(r.reason, r.status) AS reason FROM market.referrals r JOIN market.users e ON e.id = r.referee_id
      WHERE ${inRange} AND r.status IN ('refused', 'expired')
      UNION ALL
      SELECT 'sharer', COALESCE(r.referrer_reason, r.referrer_status) FROM market.referrals r JOIN market.users e ON e.id = r.referee_id
      WHERE ${inRange} AND r.referrer_status IN ('waiting', 'refused')
    ) x
    GROUP BY side, reason ORDER BY count(*) DESC
  `,
    [from, to]
  );
  const { rows: paid } = await db.query(
    `
    SELECT COALESCE(sum(r.referee_cash) FILTER (WHERE ${DAY("r.referee_paid_at")} BETWEEN $1::date AND $2::date), 0)
             + COALESCE(sum(r.referrer_cash) FILTER (WHERE ${DAY("r.referrer_paid_at")} BETWEEN $1::date AND $2::date), 0) AS cash,
           COALESCE(sum(r.referee_credit) FILTER (WHERE ${DAY("r.referee_paid_at")} BETWEEN $1::date AND $2::date), 0)
             + COALESCE(sum(r.referrer_credit) FILTER (WHERE ${DAY("r.referrer_paid_at")} BETWEEN $1::date AND $2::date), 0) AS credit
    FROM market.referrals r
  `,
    [from, to]
  );
  const { rows: recent } = await db.query(
    `
    SELECT r.id, r.created_at, r.via, r.status, r.reason, r.referrer_status, r.referrer_reason, s.username AS referrer, e.username AS referee
    FROM market.referrals r JOIN market.users s ON s.id = r.referrer_id JOIN market.users e ON e.id = r.referee_id
    WHERE ${inRange}
    ORDER BY r.created_at DESC, r.id DESC LIMIT 25
  `,
    [from, to]
  );
  return {
    top: top.map((row) => ({ username: row.username, signups: n(row.signups), paid: n(row.paid), sharer_paid: n(row.sharer_paid) })),
    reasons: reasons.map((row) => ({ side: row.side, label: row.label, count: n(row.count) })),
    paid_out: { cash: n(paid[0].cash), credit: n(paid[0].credit) },
    recent: recent.map((row) => ({
      id: Number(row.id),
      at: row.created_at,
      via: row.via,
      referrer: row.referrer,
      referee: row.referee,
      status: row.status,
      reason: row.reason,
      sharer_status: row.referrer_status,
      sharer_reason: row.referrer_reason,
    })),
  };
}

// Things players do, each from its own table: [key, label, table, user column, time column, extra filter].
const ACTIVITIES = [
  ["stock_orders", "Stock orders", "market.trade_orders", "user_id", "requested_at", ""],
  ["stock_fills", "Stock fills", "market.trade_fills", "user_id", "ts", ""],
  ["blackjack", "Blackjack hands", "games.blackjack_bets", "user_id", "created_at", ""],
  ["card_pulls", "Card pulls", "games.card_pulls", "user_id", "created_at", ""],
  ["capsules", "Capsule pulls", "games.gacha_pulls", "user_id", "created_at", ""],
  ["pvp", "Duels and high-low seats", "games.pvp_match_players", "user_id", "joined_at", ""],
  ["predictions", "Prediction bets", "market.prediction_market_trades", "taker_user_id", "matched_at", "AND taker_user_id IS NOT NULL"],
  ["pool_bets", null, "market.prediction_pool_bets", "user_id", "created_at", ""],
  ["chat", "Chat messages", "chat.messages", "author_id", "created_at", ""],
  ["chat_archived", null, "chat.archived_messages", "author_id", "created_at", ""],
];

let presentTables = null;

async function tablesPresent(db) {
  if (presentTables) return presentTables;
  const names = ACTIVITIES.map((entry) => entry[2]);
  const { rows } = await db.query(`SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NOT NULL`, [names]);
  presentTables = new Set(rows.map((row) => row.name));
  return presentTables;
}

/** Events and distinct players per game and market over the range, plus the most traded stocks. */
async function activity(db, from, to) {
  const present = await tablesPresent(db);
  const parts = ACTIVITIES.filter((entry) => present.has(entry[2])).map(
    ([key, , table, userColumn, timeColumn, extra]) =>
      `SELECT '${key === "chat_archived" ? "chat" : key === "pool_bets" ? "predictions" : key}' AS key, ${userColumn} AS user_id FROM ${table} WHERE ${timeColumn} >= ${START("$1")} AND ${timeColumn} < ${END("$2")} ${extra}`
  );
  const { rows } = parts.length
    ? await db.query(`SELECT key, count(*) AS events, count(DISTINCT user_id) AS players FROM (${parts.join(" UNION ALL ")}) x GROUP BY key`, [from, to])
    : { rows: [] };
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const games = ACTIVITIES.filter((entry) => entry[1]).map(([key, label]) => ({
    key,
    label,
    events: n(byKey.get(key)?.events),
    players: n(byKey.get(key)?.players),
  }));
  const { rows: stocks } = await db.query(
    `
    SELECT a.symbol, a.display_name, count(*) AS fills, count(DISTINCT f.user_id) AS players, COALESCE(sum(f.quantity), 0) AS shares,
           count(*) FILTER (WHERE f.side = 'sell') AS sells
    FROM market.trade_fills f JOIN market.market_assets a ON a.id = f.asset_id
    WHERE f.ts >= ${START("$1")} AND f.ts < ${END("$2")}
    GROUP BY a.symbol, a.display_name
    ORDER BY count(*) DESC, a.symbol
    LIMIT 10
  `,
    [from, to]
  );
  return {
    games,
    stocks: stocks.map((row) => ({ symbol: row.symbol, name: row.display_name, fills: n(row.fills), players: n(row.players), shares: n(row.shares), sells: n(row.sells) })),
  };
}

/** The signed-out visitors' top pages and the sites that sent them. */
async function visitorLists(db, from, to) {
  const { rows: pages } = await db.query(
    `SELECT path AS label, sum(views) AS count, count(DISTINCT (day, visitor_hash)) AS visitors FROM market.site_visits
     WHERE day BETWEEN $1::date AND $2::date GROUP BY path ORDER BY sum(views) DESC, path LIMIT 15`,
    [from, to]
  );
  const { rows: referrers } = await db.query(
    `SELECT referrer_host AS label, count(DISTINCT (day, visitor_hash)) AS count FROM market.site_visits
     WHERE day BETWEEN $1::date AND $2::date AND referrer_host IS NOT NULL GROUP BY referrer_host ORDER BY count(DISTINCT (day, visitor_hash)) DESC, referrer_host LIMIT 15`,
    [from, to]
  );
  return {
    pages: pages.map((row) => ({ label: row.label, count: n(row.count), visitors: n(row.visitors) })),
    referrers: referrers.map((row) => ({ label: row.label, count: n(row.count) })),
  };
}

/** Right now: players active today and in the last 7 days, and today's signed-out visitors. */
async function now(db, today) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM market.user_active_days WHERE day = $1::date) AS today,
            (SELECT count(DISTINCT user_id) FROM market.user_active_days WHERE day > $1::date - 7) AS week,
            (SELECT count(DISTINCT user_id) FROM market.user_active_days WHERE day > $1::date - 30) AS month,
            (SELECT count(DISTINCT visitor_hash) FROM market.site_visits WHERE day = $1::date) AS visitors_today`,
    [today]
  );
  return { active_today: n(rows[0].today), active_7d: n(rows[0].week), active_30d: n(rows[0].month), visitors_today: n(rows[0].visitors_today) };
}

/** Everything the page shows for one range. `today` is the New York day (visits.dayKey). */
async function playerAnalytics(db, { from, to, today }) {
  const range = parseRange(from, to, today);
  const [current, previous, points, cohorts, bySource, referrals, activityReport, visitors, right] = await Promise.all([
    totals(db, range.from, range.to),
    totals(db, range.previous.from, range.previous.to),
    series(db, range.from, range.to),
    retention(db, range.from, range.to, today),
    sources(db, range.from, range.to),
    referralReport(db, range.from, range.to),
    activity(db, range.from, range.to),
    visitorLists(db, range.from, range.to),
    now(db, today),
  ]);
  return {
    from: range.from,
    to: range.to,
    today,
    time_zone: TIME_ZONE,
    totals: current,
    previous,
    now: right,
    series: points,
    retention: cohorts,
    sources: bySource,
    referrals,
    activity: activityReport,
    visitors,
    visits_kept_days: retentionDays(),
  };
}

module.exports = { MAX_RANGE_DAYS, parseRange, playerAnalytics };
