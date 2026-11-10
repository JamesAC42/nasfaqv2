// What a player may pay to play mahjong (docs/games/MAHJONG_DESIGN.md §5). On top of what every side
// mode checks when it spends (Credit only, the net worth floor, nothing while in the red):
//
// - A weekly cap, up or down, the same size as blackjack's and separate from it: the week's result
//   from mahjong stays within what the player's Credit turns into Cash at a review (5% of it or
//   $10,000, whichever is more). Sitting down needs room for the fee on the way down, counting fees
//   already out, and room for first prize on the way up, counting the prizes those could still win.
//   So no result can land outside the cap and nothing ever has to be clawed back.
// - A number of paid games a day.
// - The account rules for anything that moves money between players (games/accountRules.js).
// - Nobody sits at a paid table with an account that has shared a network address with theirs.
//
// The week runs from Saturday 00:00 New York, when the review runs; a day from midnight New York.
// Entries count by when they were paid; refunded ones don't count.

const { getCurrentNetWorth } = require("../../netWorth");
const { assertCanStake } = require("../accountRules");
const ipHash = require("../../ipHash");
const { SETTINGS } = require("./settings");

const TIME_ZONE = "America/New_York";
const round2 = (value) => Math.round(Number(value) * 100) / 100;

function limitError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

const weeklyLimitFor = (credit, settings = SETTINGS) => Math.max(settings.weeklyMinimum, round2(Math.max(0, Number(credit) || 0) * settings.weeklyRate));

/**
 * Where a player stands, from what's been read. Pure, so the rules are tested on their own.
 * `weekNet` is this week's settled result; `openFees` and `openMaxNet` are what unsettled entries
 * have paid and could still win. `blocked` says why no paid game is open to them, else null.
 */
function planLimits({ credit, netWorth, weekNet, openFees, openMaxNet, gamesToday }, settings = SETTINGS) {
  const weeklyLimit = weeklyLimitFor(credit, settings);
  const net = round2(weekNet);
  const lossRoom = round2(weeklyLimit + net - openFees);
  const winRoom = round2(weeklyLimit - net - openMaxNet);
  let blocked = null;
  if (Number(netWorth) < settings.minNetWorth) blocked = "net_worth";
  else if (Number(credit) < 0) blocked = "in_the_red";
  else if (lossRoom <= 0 || winRoom <= 0) blocked = "weekly_limit";
  else if (gamesToday >= settings.paidGamesPerDay) blocked = "daily_limit";
  return {
    blocked,
    weekly_limit: weeklyLimit,
    week_net: net,
    open_fees: round2(openFees),
    loss_room: lossRoom,
    win_room: winRoom,
    games_today: gamesToday,
    games_per_day: settings.paidGamesPerDay,
    net_worth: round2(netWorth),
    min_net_worth: settings.minNetWorth,
    credit: round2(credit),
  };
}

/** Throws why this entry can't be paid, if it can't. `topNet` is first prize less the fee. */
function assertCanEnter(plan, { fee, topNet }) {
  if (plan.blocked === "net_worth") throw limitError("net_worth_floor", { limit: plan.min_net_worth });
  if (plan.blocked === "in_the_red") throw limitError("in_the_red", { owed: -plan.credit });
  if (plan.blocked === "daily_limit") throw limitError("mahjong_daily_limit", { limit: plan.games_per_day });
  if (plan.blocked === "weekly_limit" || fee > plan.loss_room || topNet > plan.win_room) {
    throw limitError("mahjong_weekly_limit", { limit: plan.weekly_limit, loss_room: Math.max(0, plan.loss_room), win_room: Math.max(0, plan.win_room) });
  }
}

const TOTALS_SQL = `
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
    COALESCE(SUM(e.payout - e.fee) FILTER (WHERE e.status = 'settled' AND e.created_at >= bounds.week_start), 0) AS week_net,
    COALESCE(SUM(e.fee) FILTER (WHERE e.status = 'open'), 0) AS open_fees,
    COALESCE(SUM(e.max_net) FILTER (WHERE e.status = 'open'), 0) AS open_max_net,
    COUNT(e.id) FILTER (WHERE e.status <> 'refunded' AND e.created_at >= bounds.day_start)::int AS games_today
  FROM bounds
  LEFT JOIN games.mahjong_entries e ON e.user_id = $1 AND (e.status = 'open' OR e.created_at >= bounds.week_start)
  GROUP BY bounds.day_end, bounds.week_end
`;

/** The player's limits as they stand, for an entry in progress or for their screen. */
async function readPlan(db, userId, settings = SETTINGS) {
  const { rows } = await db.query(TOTALS_SQL, [userId]);
  const worth = await getCurrentNetWorth(db, userId);
  const plan = planLimits(
    {
      credit: worth.credit_balance,
      netWorth: worth.total_equity,
      weekNet: Number(rows[0].week_net),
      openFees: Number(rows[0].open_fees),
      openMaxNet: Number(rows[0].open_max_net),
      gamesToday: Number(rows[0].games_today),
    },
    settings
  );
  return { ...plan, week_resets_at: rows[0].week_end, day_resets_at: rows[0].day_end };
}

/**
 * Throws mahjong_same_network when `userId` has shared a network address (at sign-up or in any
 * session) with one of `others`. Without an IP salt nothing is stored and nothing can match.
 */
async function assertNoSharedNetwork(db, userId, others) {
  const ids = others.map(Number).filter((id) => id && id !== Number(userId));
  if (!ids.length) return;
  const shared = await ipHash.sharedIpAccounts(db, [userId]);
  const linked = new Set((shared.get(Number(userId)) || []).map((account) => account.id));
  if (ids.some((id) => linked.has(id))) throw limitError("mahjong_same_network");
}

/** The account rules a paid seat needs: verified, and as old as staking Credit on a duel requires. */
async function assertPaidAccount(db, userId) {
  try {
    await assertCanStake(db, userId);
  } catch (error) {
    if (error?.code === "pvp_account_too_new") throw limitError("mahjong_account_too_new", { available_at: error.available_at });
    throw error;
  }
}

module.exports = { assertCanEnter, assertNoSharedNetwork, assertPaidAccount, planLimits, readPlan, weeklyLimitFor };
