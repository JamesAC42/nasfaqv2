// Oshi moves on the Wire: a player changing or dropping their oshi (market.user_oshi_changes,
// services/oshi.js) becomes a short headline, so players can see who's loyal and who's hopping.
// First picks aren't news (every new player makes one) and never show.
//
// Only facts that are already public go in:
//   - the username and the oshi before and after (on every profile, and as the mark by their name);
//   - how many times they've switched in the last SWITCH_WINDOW_DAYS (each switch changed that mark);
//   - whether they bought the new oshi's stock in the BUY_WINDOW_HOURS before (their profile's
//     Recent fills list every fill). The headline says only that they bought: no share counts,
//     amounts, holdings or balances.
//
// Players the site keeps out of the spotlight get no headline: unverified emails (the leaderboards'
// bar, so an alt can't fill the feed), suspensions (moderation.js) and site-wide chat bans, the
// rule every Wire headline that names a player follows (players.js). The Wire's reads check it
// again, so a headline disappears if its player is suspended or banned later. A player who keeps
// switching gets at most PER_PLAYER_DAY headlines in any 24 hours.
//
// Generated for everyone; only viewers with the oshi-wire flag are sent them (routes/overview.js).

const crypto = require("node:crypto");
const { headlinePlayerSql } = require("./players");

const KIND = "oshi_change";
const LOOKBACK_HOURS = 48;
const SWITCH_WINDOW_DAYS = 30;
const BUY_WINDOW_HOURS = 72;
/** Buys of the new oshi worth at least this much in BUY_WINDOW_HOURS count as buying in. */
const BUY_IN_CASH = 1000;
const PER_PLAYER_DAY = 3;

const pick = (seed, options) => options[parseInt(crypto.createHash("sha1").update(String(seed)).digest("hex").slice(0, 8), 16) % options.length];
const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
};
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");

/** For the Wire's reads: true for every item except an oshi move whose player may no longer be named (players.visibleSql covers it too). */
const visibleSql = () => `(kind <> '${KIND}' OR ${headlinePlayerSql("(meta->>'user_id')::bigint")})`;

/**
 * The headline and blurb for one move: { id, kind: 'change' | 'clear', username, before, after }
 * ({ symbol, name } or null), switches (this one and the others in SWITCH_WINDOW_DAYS) and boughtIn.
 * Null when there's nothing to say (a stock that's gone).
 */
function oshiHeadline(move) {
  const { id, kind, username, before, after } = move;
  const switches = Number(move.switches) || 1;
  const values = { user: username, before: before?.name, after: after?.name, sym: after?.symbol };
  const again = switches >= 2;
  const boughtIn = Boolean(move.boughtIn && after);

  let headline;
  let plain;
  let saysBuy = false;
  if (kind === "clear") {
    if (!before) return null;
    headline = again
      ? pick(id, ["{user} drops {before} too", "Another breakup: {user} and {before}", "{user} goes oshi-less, leaving {before}"])
      : pick(id, ["{user} drops {before} as their oshi", "{user} has no oshi anymore: {before} is out", "{user} and {before} part ways"]);
    plain = "No oshi mark by their name for now.";
  } else if (kind === "change") {
    if (!after) return null;
    if (!before) {
      // Picking again after going without one.
      headline = again ? pick(id, ["{user} picks yet another oshi: {after}", "{user} is back with an oshi, {after}, for now"]) : pick(id, ["{user} picks a new oshi: {after}", "{user} has an oshi again: {after}"]);
    } else if (again) {
      headline = pick(id, ["{user} switches oshi again, now {after}", "{user} hops again, from {before} to {after}", "Oshi hopping: {user} swaps {before} for {after}"]);
    } else if (boughtIn) {
      headline = pick(id, ["{user} loads up on {sym}, then makes {after} their oshi", "{user} buys {sym}, then switches oshi to {after}"]);
      saysBuy = true;
    } else {
      headline = pick(id, ["{user} left {before} for {after}", "{user} switches oshi: {before} out, {after} in", "{user} swaps {before} for {after}"]);
    }
    plain = `The ${after.name} mark follows their name now.`;
  } else {
    return null;
  }

  const notes = [];
  if (again) notes.push(`Their ${ordinal(switches)} oshi switch in ${SWITCH_WINDOW_DAYS} days`);
  if (boughtIn && !saysBuy) notes.push(`${again ? "and they" : "They"} bought ${after.symbol} in the ${BUY_WINDOW_HOURS / 24} days before`);
  return { headline: fill(headline, values), blurb: notes.length ? `${notes.join(", ")}.` : plain };
}

/** The Wire's item for a move (null when it isn't news), from a row of readMoves. */
function oshiItem(row) {
  const before = row.before_symbol ? { symbol: row.before_symbol, name: row.before_name } : null;
  const after = row.after_symbol ? { symbol: row.after_symbol, name: row.after_name } : null;
  const switches = Number(row.switches) || 1;
  const boughtIn = Number(row.bought_cash) >= BUY_IN_CASH;
  const words = oshiHeadline({ id: Number(row.id), kind: row.kind, username: row.username, before, after, switches, boughtIn });
  if (!words) return null;
  return {
    kind: KIND,
    dedupe_key: `oshi:${row.id}`,
    headline: words.headline,
    blurb: words.blurb,
    symbols: [after?.symbol, before?.symbol].filter(Boolean),
    link_url: `/profile/${encodeURIComponent(row.username)}`,
    // The lowest there is: under every market, stream and game headline of the same age.
    importance: 0,
    occurred_at: row.changed_at,
    meta: { user_id: Number(row.user_id), move: row.kind, before: before?.symbol ?? null, after: after?.symbol ?? null, switches, bought_in: boughtIn },
  };
}

/** Changes and clears in the last LOOKBACK_HOURS by players who may be named, oldest first, minus a flood. */
async function readMoves(pool) {
  const { rows } = await pool.query(
    `
    SELECT c.id, c.kind, c.changed_at, c.user_id, u.username,
           b.symbol AS before_symbol, b.display_name AS before_name,
           a.symbol AS after_symbol, a.display_name AS after_name,
           (SELECT COUNT(*)::int FROM market.user_oshi_changes p
             WHERE p.user_id = c.user_id AND p.kind IN ('change', 'clear')
               AND p.changed_at > c.changed_at - interval '24 hours' AND (p.changed_at, p.id) < (c.changed_at, c.id)) AS day_before,
           (SELECT COUNT(*)::int FROM market.user_oshi_changes p
             WHERE p.user_id = c.user_id AND p.kind IN ('change', 'clear')
               AND p.changed_at > c.changed_at - make_interval(days => $2) AND (p.changed_at, p.id) <= (c.changed_at, c.id)) AS switches,
           (SELECT COALESCE(SUM(f.gross_cash), 0) FROM market.trade_fills f
             WHERE f.user_id = c.user_id AND f.asset_id = c.asset_id_after AND f.side = 'buy'
               AND f.ts > c.changed_at - make_interval(hours => $3) AND f.ts <= c.changed_at) AS bought_cash
    FROM market.user_oshi_changes c
    JOIN market.users u ON u.id = c.user_id
    LEFT JOIN market.market_assets b ON b.id = c.asset_id_before
    LEFT JOIN market.market_assets a ON a.id = c.asset_id_after
    WHERE c.kind IN ('change', 'clear')
      AND c.changed_at > now() - make_interval(hours => $1)
      AND ${headlinePlayerSql("c.user_id")}
    ORDER BY c.changed_at, c.id
  `,
    [LOOKBACK_HOURS, SWITCH_WINDOW_DAYS, BUY_WINDOW_HOURS]
  );
  return rows.filter((row) => Number(row.day_before) < PER_PLAYER_DAY);
}

/** The generator (services/wire GENERATORS): posts each new move once (`upsert` is the Wire's). */
async function oshiMoves(pool, upsert) {
  let added = 0;
  for (const row of await readMoves(pool)) {
    const item = oshiItem(row);
    if (item) added += await upsert(pool, item);
  }
  return { items: added };
}

module.exports = { BUY_IN_CASH, KIND, PER_PLAYER_DAY, SWITCH_WINDOW_DAYS, oshiHeadline, oshiItem, oshiMoves, ordinal, visibleSql };
