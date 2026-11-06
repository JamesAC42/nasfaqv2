// Today's dealers: one talent per blackjack table, changing at midnight ET, the same for everyone.
// Picked from the listed talents by a hash of the ET date and the symbol, so it needs no storage, a
// restart doesn't change it, and the share card can work out who dealt any past hand. No talent
// deals at two tables on the same day.

const crypto = require("node:crypto");

const TIME_ZONE = "America/New_York";
const BLACKJACK_TABLES = ["low", "mid", "high"];
const TALENTS_TTL_MS = 10 * 60_000;

let cache = { at: 0, talents: null };

/** Optional allowlist (BLACKJACK_DEALER_POOL=PEK,KYR,...), e.g. only talents whose dealer art has shipped. */
function poolFilter() {
  const list = String(process.env.BLACKJACK_DEALER_POOL || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

/** "2026-11-05" for the ET calendar day of `when`. */
function etDate(when = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
}

/** Milliseconds until the next midnight ET (DST changes happen at 2am, so the clock here is right). */
function msUntilNextEtDay(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((part) => [part.type, Number(part.value)])
  );
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return ((23 - hour) * 3600 + (59 - parts.minute) * 60 + (60 - parts.second)) * 1000 - now.getMilliseconds();
}

const rank = (date, symbol) => crypto.createHash("sha1").update(`dealer|${date}|${symbol}`).digest().readUInt32BE(0);

/** The dealers for one ET date from a talent list ({symbol, name, color}), one per table, all different. */
function pickDealers(date, talents, tables = BLACKJACK_TABLES) {
  const pool = [...new Map(talents.filter((t) => t && t.symbol).map((t) => [String(t.symbol).toUpperCase(), t])).values()];
  const ordered = pool
    .map((talent) => ({ talent, score: rank(date, String(talent.symbol).toUpperCase()) }))
    .sort((a, b) => a.score - b.score || String(a.talent.symbol).localeCompare(String(b.talent.symbol)));
  return tables.map((table, index) => {
    const talent = ordered.length ? ordered[index % ordered.length].talent : null;
    return { table, symbol: talent ? String(talent.symbol).toUpperCase() : null, name: talent?.name ?? null, color: talent?.color ?? null };
  });
}

/** Listed talents (the card pool's rule: active or halted), cached for 10 minutes. */
async function listedTalents(pool) {
  if (cache.talents && Date.now() - cache.at < TALENTS_TTL_MS) return cache.talents;
  const { rows } = await pool.query(`
    SELECT a.symbol, a.display_name AS name, c.color
    FROM market.market_assets a
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE a.status IN ('active', 'halted')
    ORDER BY a.symbol
  `);
  const allow = poolFilter();
  const talents = allow ? rows.filter((row) => allow.has(String(row.symbol).toUpperCase())) : rows;
  // An allowlist that matches nobody falls back to everyone rather than leaving the tables empty.
  cache = { at: Date.now(), talents: talents.length ? talents : rows };
  return cache.talents;
}

/** Today's blackjack dealers (or another ET date's), with when they change. */
async function blackjackDealers(pool, { date = null, now = new Date() } = {}) {
  const day = date || etDate(now);
  const dealers = pickDealers(day, await listedTalents(pool));
  return { date: day, changes_in_ms: date ? null : msUntilNextEtDay(now), dealers };
}

/** Who dealt at this table on the ET day of `when`. */
async function dealerAt(pool, tableKey, when) {
  const { dealers } = await blackjackDealers(pool, { date: etDate(when ? new Date(when) : new Date()) });
  return dealers.find((entry) => entry.table === tableKey) || null;
}

function resetCache() {
  cache = { at: 0, talents: null };
}

module.exports = { BLACKJACK_TABLES, blackjackDealers, dealerAt, etDate, msUntilNextEtDay, pickDealers, resetCache };
