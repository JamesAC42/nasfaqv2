// The daily check-in: once a day a verified player claims Credit: 50, or 100 while they're on a trade
// streak (they traded yesterday). SETTINGS can also make it ramp with the streak's length; by default
// it doesn't (the owner, 2026-11-06: trading profits are thin, so the check-in stays small).
//
// The day is a New York day, the one market.user_active_days counts (auth.js): today, yesterday, the
// reset and checkin_day all turn over at 00:00 ET, across DST and whatever the pool's time zone (UTC,
// db.js). The streak is counted here from the player's fills in those same days, and writes nothing.
// It isn't market.user_trade_streaks: trade streak achievements keep their UTC days
// (achievements/streaks.js), so the two counts can differ by a day. A check-in pays for the streak
// through yesterday: trading today grows tomorrow's check-in, not today's, so claiming before or after
// the day's first trade pays the same. Missing a day of trading takes the next check-in back to the
// base. The unique key on (user_id, checkin_day) is what allows one claim per player per day. Claims
// made before the day moved to New York (2026-11) hold UTC days.

const economy = require("./economy");
const { buildStreakStateFromTradeDays } = require("./achievements/streaks");
const { TIME_ZONE } = require("./visits");

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const SETTINGS = Object.freeze({
  /** Credit for a check-in with no streak. */
  base: envNumber("CHECKIN_BASE_CREDIT", 50),
  /** Added for each day of the trade streak through yesterday. */
  perStreakDay: envNumber("CHECKIN_STREAK_DAY_CREDIT", 50),
  /** The most one check-in pays: with the defaults, any streak at all reaches it (no ramp). */
  max: envNumber("CHECKIN_MAX_CREDIT", 100),
});

/** The streak length at which the check-in stops growing (1 with the defaults). */
function maxStreakDays() {
  return SETTINGS.perStreakDay > 0 ? Math.max(0, Math.ceil((SETTINGS.max - SETTINGS.base) / SETTINGS.perStreakDay)) : 0;
}

/** Credit a check-in pays after `streakDays` days of trading in a row. */
function rewardFor(streakDays) {
  const days = Math.max(0, Math.floor(Number(streakDays) || 0));
  return Math.max(0, Math.min(SETTINGS.max, SETTINGS.base + SETTINGS.perStreakDay * days));
}

function checkinError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

/**
 * Where the trade streak stands on `today` (YYYY-MM-DD): `throughYesterday` is the run of days traded
 * ending yesterday (what today's check-in pays for), `tradedToday` whether today already counts, and
 * `current` the live streak (0 once a day is missed).
 */
function streakOn(streak, today, yesterday) {
  const days = Math.max(0, Number(streak?.current_streak_days || 0));
  const last = streak?.last_trade_day ?? null;
  const tradedToday = last === today;
  const throughYesterday = tradedToday ? Math.max(0, days - 1) : last === yesterday ? days : 0;
  return { current: tradedToday ? days : throughYesterday, throughYesterday, tradedToday, lastTradeDay: last };
}

/** The player's trade streak in New York days, from every fill before `until`. Reads only. */
async function tradeStreak(client, userId, until) {
  const { rows } = await client.query(
    `SELECT DISTINCT (ts AT TIME ZONE '${TIME_ZONE}')::date::text AS day
     FROM market.trade_fills
     WHERE user_id = $1 AND ts < $2
     ORDER BY day`,
    [userId, until]
  );
  return buildStreakStateFromTradeDays(rows.map((row) => row.day));
}

/** What the check-in card shows, from the streak, the day and today's claim (null if none). */
function describe({ verified, today, resetsAt, streak, claim }) {
  const reward = claim ? Number(claim.reward) : rewardFor(streak.throughYesterday);
  // Tomorrow's check-in pays for the streak through today: locked in once the player has traded today.
  const tomorrowIfTrade = rewardFor(streak.tradedToday ? streak.current : streak.throughYesterday + 1);
  return {
    eligible: Boolean(verified),
    day: today,
    resets_at: resetsAt,
    claimed: claim ? { reward: Number(claim.reward), streak_days: Number(claim.streak_days), claimed_at: claim.claimed_at } : null,
    reward,
    streak: {
      current: streak.current,
      through_yesterday: claim ? Number(claim.streak_days) : streak.throughYesterday,
      traded_today: streak.tradedToday,
      last_trade_day: streak.lastTradeDay,
    },
    tomorrow: {
      if_trade: tomorrowIfTrade,
      // Only while today's trade is still to come: skipping it breaks the streak.
      if_skip: streak.tradedToday ? null : rewardFor(0),
    },
    schedule: { base: SETTINGS.base, per_streak_day: SETTINGS.perStreakDay, max: SETTINGS.max, max_streak_days: maxStreakDays() },
  };
}

/** The New York day at `now` (the database's clock unless a test sets it) and the midnight that ends it. */
async function readDay(client, now) {
  const { rows } = await client.query(
    `SELECT today::text AS today, (today - 1)::text AS yesterday, (today + 1)::timestamp AT TIME ZONE '${TIME_ZONE}' AS resets_at
     FROM (SELECT (COALESCE($1::timestamptz, now()) AT TIME ZONE '${TIME_ZONE}')::date AS today) AS day`,
    [now]
  );
  return rows[0];
}

async function readClaim(client, userId, today) {
  const { rows } = await client.query(
    `SELECT id, reward, streak_days, claimed_at FROM market.daily_checkins WHERE user_id = $1 AND checkin_day = $2::date`,
    [userId, today]
  );
  return rows[0] || null;
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function verifiedUser(client, userId) {
  const { rows } = await client.query(`SELECT email_verified FROM market.users WHERE id = $1`, [userId]);
  if (!rows[0]) throw checkinError("unauthenticated");
  return Boolean(rows[0].email_verified);
}

/** Today's check-in for one player: claimed or not, what it pays, and what tomorrow's would. */
async function getCheckin(pool, userId, { now = null } = {}) {
  return inTransaction(pool, async (client) => {
    const verified = await verifiedUser(client, userId);
    const day = await readDay(client, now);
    const streak = streakOn(await tradeStreak(client, userId, day.resets_at), day.today, day.yesterday);
    const claim = await readClaim(client, userId, day.today);
    return describe({ verified, today: day.today, resetsAt: day.resets_at, streak, claim });
  });
}

/**
 * Claims today's check-in: the Credit, its ledger row and the claim, in one transaction. Throws
 * email_verification_required for an unverified account and already_checked_in (with today's claim)
 * when today's is taken, however many requests race for it.
 */
async function claimCheckin(pool, userId, { now = null } = {}) {
  return inTransaction(pool, async (client) => {
    if (!(await verifiedUser(client, userId))) throw checkinError("email_verification_required");
    const day = await readDay(client, now);
    const streak = streakOn(await tradeStreak(client, userId, day.resets_at), day.today, day.yesterday);
    const reward = rewardFor(streak.throughYesterday);
    const { rows } = await client.query(
      `
      INSERT INTO market.daily_checkins (user_id, checkin_day, streak_days, reward)
      VALUES ($1, $2::date, $3, $4)
      ON CONFLICT (user_id, checkin_day) DO NOTHING
      RETURNING id, reward, streak_days, claimed_at
    `,
      [userId, day.today, streak.throughYesterday, reward]
    );
    if (!rows[0]) {
      const claim = await readClaim(client, userId, day.today);
      throw checkinError("already_checked_in", { checkin: describe({ verified: true, today: day.today, resetsAt: day.resets_at, streak, claim }) });
    }
    const paid = await economy.pay(client, userId, reward, { to: "credit", entryType: "daily_checkin", referenceType: "daily_checkin", referenceId: Number(rows[0].id) });
    return {
      ...describe({ verified: true, today: day.today, resetsAt: day.resets_at, streak, claim: rows[0] }),
      credit_balance: paid.after.credit,
    };
  });
}

module.exports = { SETTINGS, claimCheckin, getCheckin, maxStreakDays, rewardFor, streakOn };
