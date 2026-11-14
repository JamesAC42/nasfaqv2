// The ladder (docs/games/MAHJONG_DESIGN.md §3, "Rating").
//
// A rated game moves each player's rating by how they placed against each of the other three:
// beating someone rated above you gains more than beating someone below, and losing to someone
// below costs more. Bots sit in the sum with fixed ratings that never move, so a player gains from
// bot tables only while rated near the bots.
//
// Seasons are calendar months in New York time. A player's first rated game of a season starts them
// halfway between 1,500 and where they finished the last season they played.

const { SETTINGS, rankFor } = require("./settings");

const TIME_ZONE = "America/New_York";

/** "2026-11" for the month `date` falls in, New York time. */
function seasonOf(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}`;
}

const isSeason = (value) => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** The chance a player rated `mine` places above one rated `theirs`. */
const expected = (mine, theirs) => 1 / (1 + 10 ** ((theirs - mine) / 400));

/**
 * Rating changes for one game. `players` is four of { rating, games, place, fixed } (fixed: a bot,
 * whose rating stays put). Returns the four changes, rounded to two places.
 */
function rateGame(players, { k = SETTINGS.ratingK, settledGames = SETTINGS.ratingSettledGames } = {}) {
  return players.map((player, index) => {
    if (player.fixed) return 0;
    let delta = 0;
    players.forEach((other, at) => {
      if (at === index) return;
      delta += (player.place < other.place ? 1 : 0) - expected(player.rating, other.rating);
    });
    const weight = player.games >= settledGames ? k / 2 : k;
    return Math.round((weight * delta * 100) / 3) / 100;
  });
}

/** Where a new season starts a player who finished the last one on `previous`. */
const carryOver = (previous) => Math.round((SETTINGS.ratingStart + (Number(previous) - SETTINGS.ratingStart) / 2) * 100) / 100;

/**
 * Each of these players' rating row for the season, locked, created if it's their first game of it.
 * Returns a Map of user id to { rating, games }.
 */
async function lockSeasonRatings(client, userIds, season) {
  const ids = [...new Set(userIds.map(Number))].sort((a, b) => a - b);
  const out = new Map();
  for (const userId of ids) {
    let { rows } = await client.query(`SELECT rating, games FROM games.mahjong_ratings WHERE user_id = $1 AND season = $2 FOR UPDATE`, [userId, season]);
    if (!rows[0]) {
      const previous = await client.query(`SELECT rating FROM games.mahjong_ratings WHERE user_id = $1 AND season < $2 ORDER BY season DESC LIMIT 1`, [userId, season]);
      const start = previous.rows[0] ? carryOver(previous.rows[0].rating) : SETTINGS.ratingStart;
      ({ rows } = await client.query(
        `INSERT INTO games.mahjong_ratings (user_id, season, rating, peak) VALUES ($1, $2, $3, $3)
         ON CONFLICT (user_id, season) DO UPDATE SET updated_at = now()
         RETURNING rating, games`,
        [userId, season, start]
      ));
    }
    out.set(userId, { rating: Number(rows[0].rating), games: Number(rows[0].games) });
  }
  return out;
}

/** A player's rating and rank this season without creating anything (1,500 and unranked if they haven't played). */
async function readRating(db, userId, season = seasonOf()) {
  const { rows } = await db.query(`SELECT rating, games FROM games.mahjong_ratings WHERE user_id = $1 AND season = $2`, [userId, season]);
  const rating = rows[0] ? Number(rows[0].rating) : SETTINGS.ratingStart;
  const games = rows[0] ? Number(rows[0].games) : 0;
  return { season, rating, games, rank: rankFor(rating, games) };
}

module.exports = { carryOver, expected, isSeason, lockSeasonRatings, rateGame, readRating, seasonOf };
