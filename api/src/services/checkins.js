// The daily check-in: once a day a verified player claims Credit, and the longer their trade streak
// the more it pays (SETTINGS: 100, plus 25 a streak day, up to 300).
//
// The day is the one trade streaks count in (achievements/streaks.js reads fills as ts::date, and the
// pool runs in UTC, db.js), so CURRENT_DATE here and a streak day always turn over together, at 00:00
// UTC. A check-in pays for the streak through yesterday: trading today grows tomorrow's check-in, not
// today's, so claiming before or after the day's first trade pays the same. Missing a day of trading
// takes the next check-in back to the base. The unique key on (user_id, checkin_day) is what allows
// one claim per player per day.

const economy = require("./economy");
const { applyTradeFillsToStreakWithClient, normalizeDateKey } = require("./achievements/streaks");

/** A DATE column as YYYY-MM-DD. node-pg reads one as local midnight, so the local parts are the date. */
function dateKey(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return normalizeDateKey(value);
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const SETTINGS = Object.freeze({
  /** Credit for a check-in with no streak. */
  base: envNumber("CHECKIN_BASE_CREDIT", 100),
  /** Added for each day of the trade streak through yesterday. */
  perStreakDay: envNumber("CHECKIN_STREAK_DAY_CREDIT", 25),
  /** The most one check-in pays. */
  max: envNumber("CHECKIN_MAX_CREDIT", 300),
});

/** The streak length at which the check-in stops growing (8 with the defaults). */
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
  const last = dateKey(streak?.last_trade_day);
  const tradedToday = last === today;
  const throughYesterday = tradedToday ? Math.max(0, days - 1) : last === yesterday ? days : 0;
  return { current: tradedToday ? days : throughYesterday, throughYesterday, tradedToday, lastTradeDay: last };
}

/**
 * The player's trade streak brought up to date with their fills (the achievement queue does the same
 * after each batch, a moment later). Null for a player who has never traded, without writing a row.
 */
async function freshStreak(client, userId) {
  const { rows } = await client.query(`SELECT 1 FROM market.user_trade_streaks WHERE user_id = $1`, [userId]);
  if (!rows[0]) {
    const { rows: fills } = await client.query(`SELECT 1 FROM market.trade_fills WHERE user_id = $1 LIMIT 1`, [userId]);
    if (!fills[0]) return null;
  }
  return applyTradeFillsToStreakWithClient(client, userId);
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

async function readDay(client) {
  const { rows } = await client.query(
    `SELECT CURRENT_DATE::text AS today, (CURRENT_DATE - 1)::text AS yesterday, (CURRENT_DATE + 1)::timestamptz AS resets_at`
  );
  return rows[0];
}

async function readClaim(client, userId) {
  const { rows } = await client.query(
    `SELECT id, reward, streak_days, claimed_at FROM market.daily_checkins WHERE user_id = $1 AND checkin_day = CURRENT_DATE`,
    [userId]
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
async function getCheckin(pool, userId) {
  return inTransaction(pool, async (client) => {
    const verified = await verifiedUser(client, userId);
    const day = await readDay(client);
    const streak = streakOn(await freshStreak(client, userId), day.today, day.yesterday);
    const claim = await readClaim(client, userId);
    return describe({ verified, today: day.today, resetsAt: day.resets_at, streak, claim });
  });
}

/**
 * Claims today's check-in: the Credit, its ledger row and the claim, in one transaction. Throws
 * email_verification_required for an unverified account and already_checked_in (with today's claim)
 * when today's is taken, however many requests race for it.
 */
async function claimCheckin(pool, userId) {
  return inTransaction(pool, async (client) => {
    if (!(await verifiedUser(client, userId))) throw checkinError("email_verification_required");
    const day = await readDay(client);
    const streak = streakOn(await freshStreak(client, userId), day.today, day.yesterday);
    const reward = rewardFor(streak.throughYesterday);
    const { rows } = await client.query(
      `
      INSERT INTO market.daily_checkins (user_id, checkin_day, streak_days, reward)
      VALUES ($1, CURRENT_DATE, $2, $3)
      ON CONFLICT (user_id, checkin_day) DO NOTHING
      RETURNING id, reward, streak_days, claimed_at
    `,
      [userId, streak.throughYesterday, reward]
    );
    if (!rows[0]) {
      const claim = await readClaim(client, userId);
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
