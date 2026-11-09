// What a player may stake at blackjack. BBB and the owner, 2026-11-09: a table shouldn't be able to
// brick an account. At $10,000 a hand a new account's $110,000 can be gone in half an hour of play,
// and a quarter of the first 65 accounts were under $75,000 within a week. So, on top of spending
// Credit only (tables/blackjack.js):
//
// - A weekly cap, up or down: the player's result for the week stays within what their Credit turns
//   into Cash at a review (economy.js: 5% of it or $10,000, whichever is more). A bet can't take them
//   past it on a loss, counting stakes still out on other tables, and a bet is limited to what's left
//   on the way up too. A natural can land up to half a bet past the top; every other result stays
//   inside it. Doubling needs room for the doubled stake on both sides.
// - A number of hands a day.
// - No bets while net worth is under a floor. A hand already dealt plays out.
//
// The week runs from Saturday 00:00 New York, when the review runs (weeklyEvaluation.js), and a day
// from midnight New York. Hands count by when they were bet; refunded rounds don't count. Each number
// can be changed with its env var (the weekly cap follows the conversion settings).

const economy = require("../../economy");
const { getCurrentNetWorth } = require("../../netWorth");

const TIME_ZONE = "America/New_York";
const round2 = (value) => Math.round(Number(value) * 100) / 100;

function amount(value, fallback) {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function limitSettings(env = process.env) {
  return {
    handsPerDay: Math.floor(amount(env.BLACKJACK_HANDS_PER_DAY, 50)),
    minNetWorth: amount(env.BLACKJACK_MIN_NET_WORTH, 50000),
    weeklyRate: economy.SETTINGS.weeklyConversionRate,
    weeklyMinimum: economy.SETTINGS.weeklyConversionMinimum,
  };
}

/** The numbers anyone can read, for the lobby's fine print. */
function publicRules(settings = limitSettings()) {
  return {
    weekly_minimum: settings.weeklyMinimum,
    weekly_rate: settings.weeklyRate,
    hands_per_day: settings.handsPerDay,
    min_net_worth: settings.minNetWorth,
  };
}

/** The most a player's week can move: what their Credit turns into Cash at a review. */
function weeklyLimitFor(credit, settings = limitSettings()) {
  return Math.max(settings.weeklyMinimum, round2(Math.max(0, Number(credit) || 0) * settings.weeklyRate));
}

/**
 * Where a player stands, from what's been read. Pure, so the rules are tested on their own.
 * `weekNet` is this week's settled result, `openStakes` what's out on tables that haven't settled.
 * `blocked` says why they can't bet at all ("net_worth", "weekly_limit", "daily_limit"), else null.
 */
function planLimits({ credit, netWorth, weekNet, openStakes, handsToday }, settings = limitSettings()) {
  const weeklyLimit = weeklyLimitFor(credit, settings);
  const net = round2(weekNet);
  const open = round2(openStakes);
  const lossRoom = round2(weeklyLimit + net - open);
  const winRoom = round2(weeklyLimit - net);
  const room = Math.max(0, Math.min(lossRoom, winRoom));
  let blocked = null;
  if (Number(netWorth) < settings.minNetWorth) blocked = "net_worth";
  else if (room <= 0) blocked = "weekly_limit";
  else if (handsToday >= settings.handsPerDay) blocked = "daily_limit";
  return {
    blocked,
    weekly_limit: weeklyLimit,
    week_net: net,
    open_stakes: open,
    loss_room: lossRoom,
    win_room: winRoom,
    max_bet: blocked ? 0 : room,
    hands_today: handsToday,
    hands_per_day: settings.handsPerDay,
    net_worth: round2(netWorth),
    min_net_worth: settings.minNetWorth,
    credit: round2(credit),
  };
}

function limitError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

/** Throws why this wager can't be placed, if it can't. */
function assertCanBet(plan, wager) {
  if (plan.blocked === "net_worth") throw limitError("blackjack_net_worth_floor", { limit: plan.min_net_worth });
  if (plan.blocked === "weekly_limit") throw limitError("blackjack_weekly_limit", { limit: plan.weekly_limit });
  if (plan.blocked === "daily_limit") throw limitError("blackjack_daily_limit", { limit: plan.hands_per_day });
  if (wager > plan.max_bet) throw limitError("blackjack_bet_over_limit", { max_bet: plan.max_bet });
}

/** Whether a hand with this stake (already counted in `open_stakes`) can double. */
function canDouble(plan, stake) {
  return plan.loss_room >= stake && round2(plan.week_net + stake * 2) <= plan.weekly_limit;
}

const WINDOW_AND_TOTALS_SQL = `
  WITH local AS (
    SELECT (now() AT TIME ZONE '${TIME_ZONE}')::date AS today
  ), bounds AS (
    SELECT
      today::timestamp AT TIME ZONE '${TIME_ZONE}' AS day_start,
      (today + 1)::timestamp AT TIME ZONE '${TIME_ZONE}' AS day_end,
      -- date_trunc's weeks start on Monday, so shift two days to make them start on Saturday.
      (date_trunc('week', (today + 2)::timestamp) - interval '2 days') AT TIME ZONE '${TIME_ZONE}' AS week_start,
      (date_trunc('week', (today + 2)::timestamp) + interval '5 days') AT TIME ZONE '${TIME_ZONE}' AS week_end
    FROM local
  )
  SELECT
    bounds.day_end,
    bounds.week_end,
    COALESCE(SUM(b.payout_cash - b.bet_cash * CASE WHEN b.doubled THEN 2 ELSE 1 END) FILTER (WHERE r.status = 'settled'), 0) AS week_net,
    COALESCE(SUM(b.bet_cash * CASE WHEN b.doubled THEN 2 ELSE 1 END) FILTER (WHERE r.status IN ('betting', 'playing')), 0) AS open_stakes,
    COUNT(b.id) FILTER (WHERE r.status <> 'refunded' AND b.created_at >= bounds.day_start)::int AS hands_today
  FROM bounds
  LEFT JOIN games.blackjack_bets b ON b.user_id = $1 AND b.created_at >= bounds.week_start
  LEFT JOIN games.blackjack_rounds r ON r.id = b.round_id
  GROUP BY bounds.day_end, bounds.week_end
`;

/** The player's limits as they stand, for a bet in progress or for their screen. */
async function readPlan(db, userId, settings = limitSettings()) {
  const { rows } = await db.query(WINDOW_AND_TOTALS_SQL, [userId]);
  const worth = await getCurrentNetWorth(db, userId);
  const plan = planLimits(
    {
      credit: worth.credit_balance,
      netWorth: worth.total_equity,
      weekNet: Number(rows[0].week_net),
      openStakes: Number(rows[0].open_stakes),
      handsToday: Number(rows[0].hands_today),
    },
    settings
  );
  return { ...plan, week_resets_at: rows[0].week_end, day_resets_at: rows[0].day_end };
}

module.exports = { assertCanBet, canDouble, limitSettings, planLimits, publicRules, readPlan, weeklyLimitFor };
