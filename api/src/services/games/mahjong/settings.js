// Every number mahjong's tables, money and ladder run on, each with why it is what it is and an
// environment variable to change it (docs/games/MAHJONG_DESIGN.md §2-§5). Nothing here was tuned
// on live play: they are opening values for the owner and BBB to move.

const economy = require("../../economy");

function number(name, fallback, { min = 0, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = raw.split(",").map((part) => Number(part.trim()));
  return parsed.length && parsed.every((value) => Number.isFinite(value) && value >= 0) ? parsed : fallback;
}

const SETTINGS = Object.freeze({
  // ── Money ────────────────────────────────────────────────────────────────
  /**
   * Entry fees for stakes tables, in Credit. The median player holds about $91,000 Credit and can
   * move $10,000 a week at mahjong (the cap below), so the top table is a quarter of a week's room:
   * four straight last places at it close the week.
   */
  stakesTiers: Object.freeze(list("MAHJONG_STAKES_TIERS", [200, 1000, 2500])),
  /**
   * What first to fourth take at a stakes table, as multiples of the fee. They add up to 3.6 of the
   * 4 fees in: the other 10% leaves circulation, twice the duel's 5% because a mahjong game is four
   * players and half an hour. Second place about breaks even, so playing not to come last is worth it.
   */
  stakesPrizes: Object.freeze(list("MAHJONG_STAKES_PRIZES", [2.0, 1.1, 0.5, 0])),
  /** The cut taken from a paid tournament's fees before prizes, in hundredths of a percent. */
  tournamentRakeBps: number("MAHJONG_TOURNAMENT_RAKE_BPS", 1000, { max: 5000 }),
  /** How a tournament's prize pool splits over the final table, first to fourth. */
  tournamentPrizeShares: Object.freeze(list("MAHJONG_TOURNAMENT_PRIZE_SHARES", [0.5, 0.25, 0.15, 0.1])),
  /**
   * Paid games (stakes tables and tournament entries) a player may start in a day. A game takes 20
   * to 45 minutes, so this is an evening of play; the weekly cap is what really bounds the money.
   */
  paidGamesPerDay: Math.floor(number("MAHJONG_PAID_GAMES_PER_DAY", 6)),
  // The weekly cap is blackjack's: what a player's Credit converts to Cash at a review, so winnings
  // can't reach the stock market faster than the conversion lets Credit through anyway.
  weeklyRate: economy.SETTINGS.weeklyConversionRate,
  weeklyMinimum: economy.SETTINGS.weeklyConversionMinimum,
  minNetWorth: economy.SETTINGS.sideModeMinNetWorth,

  // ── Tables ───────────────────────────────────────────────────────────────
  /** Seconds a quick-match table waits for players before bots take the empty seats. */
  botFillSeconds: number("MAHJONG_BOT_FILL_SECONDS", 45, { min: 5 }),
  /** Seconds a stakes table waits once it is full before the first hand, so anyone can still stand up. */
  stakesStartSeconds: number("MAHJONG_STAKES_START_SECONDS", 10, { min: 3 }),
  /** Minutes an open table or room lives with nobody starting it. */
  openTableMinutes: number("MAHJONG_OPEN_TABLE_MINUTES", 30, { min: 1 }),
  /** Seconds between a tournament's rounds. */
  tournamentBreakSeconds: number("MAHJONG_TOURNAMENT_BREAK_SECONDS", 45, { min: 5 }),
  /** Practice tables for signed-out visitors: how many may be open at once, and how many one address may start in ten minutes. */
  guestTables: Math.floor(number("MAHJONG_GUEST_TABLES", 20)),
  guestTablesPerIp: Math.floor(number("MAHJONG_GUEST_TABLES_PER_IP", 6)),
  /** How long a finished table stays in memory for the people still looking at it. */
  doneLingerMinutes: number("MAHJONG_DONE_LINGER_MINUTES", 10, { min: 1 }),

  // ── Ladder ───────────────────────────────────────────────────────────────
  ratingStart: 1500,
  /** How far one game can move a rating; halved once a player has played `ratingSettledGames`. */
  ratingK: number("MAHJONG_RATING_K", 32, { min: 1 }),
  ratingSettledGames: 30,
  /**
   * Bots have ratings that never move. A player gains from beating a bot only while rated near it, so
   * bot tables teach and place new players but can't carry anyone up the ladder.
   */
  botRatings: Object.freeze({ easy: 1300, normal: 1450, hard: 1550, auto: 1200 }),
});

/** The move clocks: seconds per move, and the bank a seat can dip into over one hand. */
const SPEEDS = Object.freeze({
  standard: Object.freeze({ turn: 7, bank: 20 }),
  relaxed: Object.freeze({ turn: 20, bank: 40 }),
  // The tutorial and practice against bots: nobody is waiting on you.
  untimed: Object.freeze({ turn: 180, bank: 0 }),
});

const RANKS = Object.freeze([
  { key: "bagholder", name: "Bagholder", min: 0 },
  { key: "day-trader", name: "Day trader", min: 1400 },
  { key: "floor-trader", name: "Floor trader", min: 1475 },
  { key: "broker", name: "Broker", min: 1550 },
  { key: "fund-manager", name: "Fund manager", min: 1625 },
  { key: "whale", name: "Whale", min: 1700 },
  { key: "market-maker", name: "Market maker", min: 1800 },
]);

/** Games a player needs this season before they have a rank and a place on the ladder. */
const RANKED_AFTER_GAMES = 3;

function rankFor(rating, games) {
  if (games < RANKED_AFTER_GAMES) return { key: "unranked", name: "Unranked", min: null };
  let rank = RANKS[0];
  for (const candidate of RANKS) if (rating >= candidate.min) rank = candidate;
  return rank;
}

/** What a stakes table pays each place, and what's left over. */
function stakesPrizeTable(fee) {
  const prizes = SETTINGS.stakesPrizes.map((multiple) => Math.round(fee * multiple * 100) / 100);
  const pot = fee * 4;
  return { fee, pot, prizes, cut: Math.round((pot - prizes.reduce((sum, prize) => sum + prize, 0)) * 100) / 100, top_net: Math.round((prizes[0] - fee) * 100) / 100 };
}

/** A paid tournament's prizes: fees less the cut, split over the final table. */
function tournamentPrizeTable(fee, seats) {
  const pot = fee * seats;
  const pool = Math.round(pot * (1 - SETTINGS.tournamentRakeBps / 10_000) * 100) / 100;
  const prizes = SETTINGS.tournamentPrizeShares.map((share) => Math.round(pool * share * 100) / 100);
  return { fee, pot, pool, prizes, cut: Math.round((pot - prizes.reduce((sum, prize) => sum + prize, 0)) * 100) / 100, top_net: Math.round((prizes[0] - fee) * 100) / 100 };
}

/** The numbers a lobby prints. */
function publicRules() {
  return {
    stakes: SETTINGS.stakesTiers.map(stakesPrizeTable),
    paid_games_per_day: SETTINGS.paidGamesPerDay,
    weekly_rate: SETTINGS.weeklyRate,
    weekly_minimum: SETTINGS.weeklyMinimum,
    min_net_worth: SETTINGS.minNetWorth,
    bot_fill_seconds: SETTINGS.botFillSeconds,
    speeds: SPEEDS,
    ranks: RANKS,
    ranked_after_games: RANKED_AFTER_GAMES,
    bot_ratings: SETTINGS.botRatings,
    tournament_rake_bps: SETTINGS.tournamentRakeBps,
    tournament_prize_shares: SETTINGS.tournamentPrizeShares,
  };
}

module.exports = { RANKED_AFTER_GAMES, RANKS, SETTINGS, SPEEDS, publicRules, rankFor, stakesPrizeTable, tournamentPrizeTable };
