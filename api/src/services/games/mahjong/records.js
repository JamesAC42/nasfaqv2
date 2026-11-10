// Mahjong's database side: entry fees and prizes, the record of every game and hand (which is also
// the replay), the ladder, and the reads built on them (leaderboards, a player's record, highlights).
// The table manager (tables.js) decides what happens; this file writes it down and pays it out, each
// time in one transaction.

const gamesWallet = require("../wallet");
const { profilePictureUrlSql } = require("../../../profilePictures");
const { leaderboardPlayerSql } = require("../../moderation");
const { headlinePlayerSql } = require("../../wire/players");
const ratings = require("./ratings");
const { RANKED_AFTER_GAMES, SETTINGS, rankFor } = require("./settings");
const { yakuName } = require("./names");

const TIME_ZONE = "America/New_York";
const round2 = (value) => Math.round(Number(value) * 100) / 100;

async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Players ────────────────────────────────────────────────────────────────
const PLAYER_COLUMNS = `
  u.id, u.username, u.profile_color, u.email_verified, u.created_at,
  ${profilePictureUrlSql("small")} AS profile_picture_url,
  oa.symbol AS oshi`;
const PLAYER_JOINS = `
  LEFT JOIN market.profile_pictures pp ON pp.id = u.profile_picture_id
  LEFT JOIN market.market_assets oa ON oa.id = u.oshi_coin_asset_id`;

/** What a seat shows for a player: name, color, picture, their oshi and this season's rating. */
async function loadPlayer(db, userId) {
  const { rows } = await db.query(`SELECT ${PLAYER_COLUMNS} FROM market.users u ${PLAYER_JOINS} WHERE u.id = $1`, [userId]);
  if (!rows[0]) return null;
  const rating = await ratings.readRating(db, userId);
  return {
    user_id: Number(rows[0].id),
    username: rows[0].username,
    profile_color: rows[0].profile_color,
    profile_picture_url: rows[0].profile_picture_url || null,
    oshi: rows[0].oshi || null,
    rating: rating.rating,
    rated_games: rating.games,
    rank: rating.rank.key,
  };
}

/** Listed talents' tickers, for seating bots and players without an oshi. */
async function listTalentSymbols(db) {
  const { rows } = await db.query(`SELECT symbol FROM market.market_assets WHERE status IN ('active', 'halted') ORDER BY symbol`).catch(() => ({ rows: [] }));
  return rows.map((row) => row.symbol);
}

// ── Games ──────────────────────────────────────────────────────────────────
async function createGameRow(db, { kind, length, speed, fee = 0, rated = false, roomCode = null, hostUserId = null, tournament = null, settings = {} }) {
  const { rows } = await db.query(
    `INSERT INTO games.mahjong_games (kind, length, speed, entry_fee, rated, room_code, host_user_id, tournament_id, tournament_round, tournament_table, settings_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [kind, length, speed, fee, rated, roomCode, hostUserId, tournament?.id ?? null, tournament?.round ?? null, tournament?.table ?? null, JSON.stringify(settings)]
  );
  return Number(rows[0].id);
}

/** The first deal: the game is live, its seal and who sits where are on record. */
async function startGameRow(pool, gameId, { seedHash, seats }) {
  await inTransaction(pool, async (client) => {
    await client.query(`UPDATE games.mahjong_games SET status = 'playing', started_at = now(), seed_hash = $2, humans = $3 WHERE id = $1 AND status = 'waiting'`, [
      gameId,
      seedHash,
      seats.filter((seat) => seat.user_id).length,
    ]);
    await client.query(`DELETE FROM games.mahjong_game_players WHERE game_id = $1`, [gameId]);
    for (const [index, seat] of seats.entries()) {
      await client.query(`INSERT INTO games.mahjong_game_players (game_id, seat, user_id, bot_level, name, talent, fee) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        gameId,
        index,
        seat.user_id ?? null,
        seat.bot ?? null,
        seat.username,
        seat.talent ?? null,
        seat.fee ?? 0,
      ]);
    }
  });
}

/** The best win of a hand (most points to the winner), or null for a draw. */
function bestWin(result) {
  if (result.type !== "win") return null;
  return [...result.wins].sort((a, b) => b.gain - a.gain)[0];
}

async function saveHand(db, gameId, summary, seatUsers) {
  const win = bestWin(summary.result);
  await db.query(
    `INSERT INTO games.mahjong_hands (game_id, hand_index, wind, number, honba, dealer, result_type, reason, winner_seat, winner_user_id, loser_seat,
       han, fu, yakuman, points, limit_name, yaku, start_scores, result_json, log_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (game_id, hand_index) DO NOTHING`,
    [
      gameId,
      summary.index,
      summary.wind,
      summary.number,
      summary.honba,
      summary.dealer,
      summary.result.type,
      summary.result.type === "draw" ? summary.result.reason : null,
      win ? win.seat : null,
      win ? (seatUsers[win.seat] ?? null) : null,
      win ? win.from : null,
      win ? win.han : null,
      win ? win.fu : null,
      win ? win.yakuman : 0,
      win ? win.gain : null,
      win ? win.limit : null,
      win ? win.yaku.map((entry) => entry.key) : [],
      summary.start_scores,
      JSON.stringify(summary.result),
      JSON.stringify(summary.log),
    ]
  );
}

/** What one seat did over a game's hands, for the season record. */
function seatStats(hands, seat) {
  const stats = { hands: hands.length, wins: 0, tsumo: 0, deal_ins: 0, riichi: 0, calls: 0, yakuman: 0, best_points: 0, best_hand_index: null };
  for (const hand of hands) {
    if (hand.log.some((event) => event.t === "riichi" && event.s === seat)) stats.riichi += 1;
    if (hand.log.some((event) => (event.t === "chi" || event.t === "pon" || event.t === "minkan") && event.s === seat)) stats.calls += 1;
    if (hand.result.type !== "win") continue;
    for (const win of hand.result.wins) {
      if (win.from === seat) stats.deal_ins += 1;
      if (win.seat !== seat) continue;
      stats.wins += 1;
      if (win.tsumo) stats.tsumo += 1;
      if (win.yakuman) stats.yakuman += 1;
      if (win.gain > stats.best_points) {
        stats.best_points = win.gain;
        stats.best_hand_index = hand.index;
      }
    }
  }
  return stats;
}

/**
 * Closes a finished game: ratings for a rated one, prizes for a paid one, everyone's line in the
 * record, the seed, and spectators' picks. Once only: a game that isn't `playing` is left alone
 * and null comes back. `prizes` is what first to fourth are paid, or null.
 */
async function finishGame(pool, { gameId, seed, rated, prizes, standings, seats, hands }) {
  return inTransaction(pool, async (client) => {
    const { rows: current } = await client.query(`SELECT status FROM games.mahjong_games WHERE id = $1 FOR UPDATE`, [gameId]);
    if (current[0]?.status !== "playing") return null;
    const season = ratings.seasonOf();
    const humans = seats.map((seat) => seat.user_id).filter(Boolean);
    const before = rated && humans.length ? await ratings.lockSeasonRatings(client, humans, season) : new Map();
    const placeOf = new Map(standings.map((entry) => [entry.seat, entry]));
    const rated4 = seats.map((seat, index) => ({
      place: placeOf.get(index).place,
      fixed: !seat.user_id,
      rating: seat.user_id ? (before.get(seat.user_id)?.rating ?? SETTINGS.ratingStart) : (SETTINGS.botRatings[seat.bot] ?? SETTINGS.botRatings.normal),
      games: seat.user_id ? (before.get(seat.user_id)?.games ?? 0) : 0,
    }));
    const deltas = rated ? ratings.rateGame(rated4) : [0, 0, 0, 0];

    const lines = [];
    for (const [index, seat] of seats.entries()) {
      const standing = placeOf.get(index);
      const line = { seat: index, user_id: seat.user_id ?? null, place: standing.place, points: standing.points, score: standing.score, rating_before: null, rating_after: null, payout: 0 };
      if (seat.user_id && rated) {
        const stats = seatStats(hands, index);
        line.rating_before = rated4[index].rating;
        line.rating_after = round2(rated4[index].rating + deltas[index]);
        const placeColumn = ["firsts", "seconds", "thirds", "fourths"][standing.place - 1];
        await client.query(
          `UPDATE games.mahjong_ratings SET rating = $3, peak = GREATEST(peak, $3), games = games + 1, ${placeColumn} = ${placeColumn} + 1,
             total_score = total_score + $4, hands = hands + $5, wins = wins + $6, tsumo = tsumo + $7, deal_ins = deal_ins + $8, riichi = riichi + $9,
             calls = calls + $10, yakuman = yakuman + $11,
             best_game_id = CASE WHEN $12 > best_points THEN $13 ELSE best_game_id END,
             best_hand_index = CASE WHEN $12 > best_points THEN $14 ELSE best_hand_index END,
             best_points = GREATEST(best_points, $12), updated_at = now()
           WHERE user_id = $1 AND season = $2`,
          [seat.user_id, season, line.rating_after, standing.score, stats.hands, stats.wins, stats.tsumo, stats.deal_ins, stats.riichi, stats.calls, stats.yakuman, stats.best_points, gameId, stats.best_hand_index]
        );
      }
      if (seat.user_id && prizes) {
        line.payout = round2(prizes[standing.place - 1] ?? 0);
        if (line.payout > 0) {
          await gamesWallet.creditCashForGameWithClient(client, { userId: seat.user_id, amount: line.payout, entryType: "mahjong_prize_payout", referenceType: "mahjong_game", referenceId: gameId });
        }
        await client.query(`UPDATE games.mahjong_entries SET status = 'settled', payout = $3, settled_at = now() WHERE game_id = $1 AND user_id = $2 AND status = 'open'`, [gameId, seat.user_id, line.payout]);
      }
      await client.query(`UPDATE games.mahjong_game_players SET place = $3, points = $4, score = $5, rating_before = $6, rating_after = $7, payout = $8 WHERE game_id = $1 AND seat = $2`, [
        gameId,
        index,
        line.place,
        line.points,
        line.score,
        line.rating_before,
        line.rating_after,
        line.payout,
      ]);
      lines.push(line);
    }
    // A paid game whose prizes aren't being paid (it shouldn't happen) hands the fees back.
    if (!prizes) await refundOpenEntries(client, { gameId });
    await client.query(`UPDATE games.mahjong_games SET status = 'completed', completed_at = now(), seed = $2, result_json = $3 WHERE id = $1`, [gameId, seed, JSON.stringify({ standings, lines })]);
    const winner = standings[0].seat;
    await client.query(`UPDATE games.mahjong_picks SET correct = (seat = $2) WHERE game_id = $1`, [gameId, winner]);
    return { season, lines };
  });
}

// ── Entry fees ─────────────────────────────────────────────────────────────
const refOf = ({ gameId, tournamentId }) => (gameId ? { type: "mahjong_game", id: gameId } : { type: "mahjong_tournament", id: tournamentId });

/** Takes an entry fee (Credit, under every side-mode rule) and writes the entry the caps count. */
async function payEntry(client, { userId, gameId = null, tournamentId = null, fee, maxNet }) {
  const ref = refOf({ gameId, tournamentId });
  await gamesWallet.debitCashForGameWithClient(client, { userId, amount: fee, from: "credit", entryType: "mahjong_entry_fee", referenceType: ref.type, referenceId: ref.id });
  await client.query(`INSERT INTO games.mahjong_entries (user_id, game_id, tournament_id, fee, max_net) VALUES ($1,$2,$3,$4,$5)`, [userId, gameId, tournamentId, fee, maxNet]);
}

/** Hands back every open entry for a game or a tournament (or one player's), once. Returns how many. */
async function refundOpenEntries(client, { gameId = null, tournamentId = null, userId = null }) {
  const ref = refOf({ gameId, tournamentId });
  const { rows } = await client.query(
    `SELECT id, user_id, fee FROM games.mahjong_entries
     WHERE status = 'open' AND ${gameId ? "game_id" : "tournament_id"} = $1 AND ($2::bigint IS NULL OR user_id = $2)
     ORDER BY id FOR UPDATE`,
    [ref.id, userId]
  );
  for (const row of rows) {
    await gamesWallet.refundCashForGameWithClient(client, { userId: Number(row.user_id), amount: Number(row.fee), referenceType: ref.type, referenceId: ref.id });
    await client.query(`UPDATE games.mahjong_entries SET status = 'refunded', settled_at = now() WHERE id = $1`, [row.id]);
  }
  return rows.length;
}

/** Ends a game that never finished (nobody started it, a restart, an empty table) and refunds its fees. */
async function cancelGame(pool, gameId, reason) {
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT status FROM games.mahjong_games WHERE id = $1 FOR UPDATE`, [gameId]);
    if (rows[0]?.status !== "waiting" && rows[0]?.status !== "playing") return false;
    await refundOpenEntries(client, { gameId });
    await client.query(`UPDATE games.mahjong_games SET status = 'cancelled', completed_at = now(), result_json = result_json || $2::jsonb WHERE id = $1`, [gameId, JSON.stringify({ cancelled: reason })]);
    return true;
  });
}

/** At startup: tables live in memory, so anything unfinished is cancelled and refunded. */
async function cancelUnfinishedGames(pool) {
  const { rows } = await pool.query(`SELECT id FROM games.mahjong_games WHERE status IN ('waiting', 'playing')`);
  for (const row of rows) await cancelGame(pool, Number(row.id), "server_restart");
  return rows.length;
}

// ── Picks ──────────────────────────────────────────────────────────────────
async function savePick(db, { userId, gameId = null, tournamentId = null, seat = null, pickedUserId = null, pickedName }) {
  const target = gameId ? "(game_id, user_id) WHERE game_id IS NOT NULL" : "(tournament_id, user_id) WHERE tournament_id IS NOT NULL";
  await db.query(
    `INSERT INTO games.mahjong_picks (user_id, game_id, tournament_id, seat, picked_user_id, picked_name) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT ${target} DO UPDATE SET seat = EXCLUDED.seat, picked_user_id = EXCLUDED.picked_user_id, picked_name = EXCLUDED.picked_name, created_at = now()`,
    [userId, gameId, tournamentId, seat, pickedUserId, pickedName]
  );
}

async function readPick(db, { userId, gameId = null, tournamentId = null }) {
  const { rows } = await db.query(`SELECT seat, picked_user_id, picked_name, correct FROM games.mahjong_picks WHERE user_id = $1 AND ${gameId ? "game_id" : "tournament_id"} = $2`, [userId, gameId ?? tournamentId]);
  return rows[0] ? { seat: rows[0].seat, user_id: rows[0].picked_user_id ? Number(rows[0].picked_user_id) : null, name: rows[0].picked_name, correct: rows[0].correct } : null;
}

// ── Reading the record ─────────────────────────────────────────────────────
const gameRow = (row) => ({
  id: Number(row.id),
  kind: row.kind,
  status: row.status,
  length: row.length,
  speed: row.speed,
  entry_fee: Number(row.entry_fee),
  rated: row.rated,
  humans: Number(row.humans),
  tournament_id: row.tournament_id ? Number(row.tournament_id) : null,
  tournament_round: row.tournament_round,
  tournament_name: row.tournament_name ?? null,
  seed_hash: row.seed_hash,
  seed: row.status === "completed" ? row.seed : null,
  started_at: row.started_at,
  completed_at: row.completed_at,
});

const PLAYERS_SQL = `
  SELECT p.game_id, p.seat, p.user_id, p.bot_level, p.name, p.talent, p.place, p.points, p.score, p.rating_before, p.rating_after, p.payout,
         u.username, u.profile_color, ${profilePictureUrlSql("small")} AS profile_picture_url
  FROM games.mahjong_game_players p
  LEFT JOIN market.users u ON u.id = p.user_id
  LEFT JOIN market.profile_pictures pp ON pp.id = u.profile_picture_id
  WHERE p.game_id = ANY($1::bigint[])
  ORDER BY p.game_id, p.seat`;

const playerRow = (row) => ({
  seat: Number(row.seat),
  user_id: row.user_id ? Number(row.user_id) : null,
  username: row.username ?? row.name,
  profile_color: row.profile_color ?? null,
  profile_picture_url: row.profile_picture_url ?? null,
  bot: row.bot_level,
  talent: row.talent,
  place: row.place,
  points: row.points,
  score: row.score === null ? null : Number(row.score),
  rating_before: row.rating_before === null ? null : Number(row.rating_before),
  rating_after: row.rating_after === null ? null : Number(row.rating_after),
  payout: Number(row.payout),
});

async function playersOf(db, gameIds) {
  const out = new Map(gameIds.map((id) => [id, []]));
  if (!gameIds.length) return out;
  const { rows } = await db.query(PLAYERS_SQL, [gameIds]);
  for (const row of rows) out.get(Number(row.game_id))?.push(playerRow(row));
  return out;
}

const handRow = (row, withLog) => ({
  index: Number(row.hand_index),
  wind: Number(row.wind),
  number: Number(row.number),
  honba: Number(row.honba),
  dealer: Number(row.dealer),
  start_scores: row.start_scores,
  result: row.result_json,
  ...(withLog ? { log: row.log_json } : {}),
});

/**
 * A game's record. A game that is over comes with every hand's log and the seed: the replay. One
 * still in play comes with the hands' results only, which were public as they happened.
 */
async function getGame(db, gameId, { withLogs = true } = {}) {
  const { rows } = await db.query(
    `SELECT g.*, t.name AS tournament_name FROM games.mahjong_games g LEFT JOIN games.mahjong_tournaments t ON t.id = g.tournament_id WHERE g.id = $1`,
    [gameId]
  );
  if (!rows[0] || rows[0].status === "waiting") return null;
  const game = gameRow(rows[0]);
  const players = (await playersOf(db, [game.id])).get(game.id);
  const open = game.status === "completed" && withLogs;
  const hands = await db.query(
    `SELECT hand_index, wind, number, honba, dealer, start_scores, result_json${open ? ", log_json" : ""} FROM games.mahjong_hands WHERE game_id = $1 ORDER BY hand_index`,
    [gameId]
  );
  return { game, players, hands: hands.rows.map((row) => handRow(row, open)), result: rows[0].result_json };
}

/** Finished games, newest first: everyone's, or one player's. */
async function recentGames(db, { userId = null, limit = 12 } = {}) {
  const { rows } = await db.query(
    `SELECT g.*, t.name AS tournament_name FROM games.mahjong_games g
     LEFT JOIN games.mahjong_tournaments t ON t.id = g.tournament_id
     WHERE g.status = 'completed' AND ($1::bigint IS NULL OR EXISTS (SELECT 1 FROM games.mahjong_game_players p WHERE p.game_id = g.id AND p.user_id = $1))
     ORDER BY g.completed_at DESC LIMIT $2`,
    [userId, Math.min(50, Math.max(1, Number(limit) || 12))]
  );
  const games = rows.map(gameRow);
  const players = await playersOf(db, games.map((game) => game.id));
  return games.map((game) => ({ ...game, seed: undefined, players: players.get(game.id) }));
}

const ratingRow = (row) => {
  const rating = Number(row.rating);
  const games = Number(row.games);
  return {
    season: row.season,
    rating,
    peak: Number(row.peak),
    rank: rankFor(rating, games).key,
    games,
    places: [Number(row.firsts), Number(row.seconds), Number(row.thirds), Number(row.fourths)],
    total_score: Number(row.total_score),
    hands: Number(row.hands),
    wins: Number(row.wins),
    tsumo: Number(row.tsumo),
    deal_ins: Number(row.deal_ins),
    riichi: Number(row.riichi),
    calls: Number(row.calls),
    yakuman: Number(row.yakuman),
    best_points: Number(row.best_points),
    best_game_id: row.best_game_id ? Number(row.best_game_id) : null,
    best_hand_index: row.best_hand_index,
  };
};

/** The season's ladder: players with enough games, best rating first. Only players a leaderboard may show. */
async function ladder(db, { season = ratings.seasonOf(), limit = 50 } = {}) {
  const { rows } = await db.query(
    `SELECT r.*, ${PLAYER_COLUMNS}
     FROM games.mahjong_ratings r
     JOIN market.users u ON u.id = r.user_id ${PLAYER_JOINS}
     WHERE r.season = $1 AND r.games >= $2 AND ${leaderboardPlayerSql("r.user_id")}
     ORDER BY r.rating DESC, r.games DESC, r.user_id
     LIMIT $3`,
    [season, RANKED_AFTER_GAMES, Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  return rows.map((row, index) => ({
    place: index + 1,
    user_id: Number(row.id),
    username: row.username,
    profile_color: row.profile_color,
    profile_picture_url: row.profile_picture_url || null,
    oshi: row.oshi || null,
    ...ratingRow(row),
  }));
}

/** The season's ladder by oshi: each talent's ranked players, averaged. Nothing here touches her stock. */
async function oshiStandings(db, { season = ratings.seasonOf() } = {}) {
  const { rows } = await db.query(
    `SELECT oa.symbol, COUNT(*)::int AS players, ROUND(AVG(r.rating), 1) AS rating, SUM(r.firsts)::int AS firsts, SUM(r.games)::int AS games, SUM(r.yakuman)::int AS yakuman
     FROM games.mahjong_ratings r
     JOIN market.users u ON u.id = r.user_id
     JOIN market.market_assets oa ON oa.id = u.oshi_coin_asset_id
     WHERE r.season = $1 AND r.games >= $2 AND ${leaderboardPlayerSql("r.user_id")}
     GROUP BY oa.symbol
     ORDER BY AVG(r.rating) DESC, COUNT(*) DESC, oa.symbol
     LIMIT 30`,
    [season, RANKED_AFTER_GAMES]
  );
  return rows.map((row) => ({ symbol: row.symbol, players: row.players, rating: Number(row.rating), firsts: row.firsts, games: row.games, yakuman: row.yakuman }));
}

const BIG_HAND_COLUMNS = `
  h.game_id, h.hand_index, h.wind, h.number, h.han, h.fu, h.yakuman, h.points, h.limit_name, h.yaku, h.created_at, h.result_json,
  g.kind, g.humans, u.id AS user_id, u.username, u.profile_color, p.talent`;
const BIG_HAND_FROM = `
  FROM games.mahjong_hands h
  JOIN games.mahjong_games g ON g.id = h.game_id AND g.status = 'completed'
  JOIN market.users u ON u.id = h.winner_user_id
  LEFT JOIN games.mahjong_game_players p ON p.game_id = h.game_id AND p.seat = h.winner_seat`;

const bigHandRow = (row) => {
  const win = (row.result_json?.wins ?? []).find((entry) => entry.seat !== undefined && entry.gain === row.points) ?? row.result_json?.wins?.[0] ?? null;
  return {
    game_id: Number(row.game_id),
    hand_index: Number(row.hand_index),
    wind: Number(row.wind),
    number: Number(row.number),
    han: row.han,
    fu: row.fu,
    yakuman: Number(row.yakuman),
    points: row.points,
    limit: row.limit_name,
    yaku: row.yaku,
    at: row.created_at,
    kind: row.kind,
    user_id: Number(row.user_id),
    username: row.username,
    profile_color: row.profile_color,
    talent: row.talent,
    win: win ? { hand: win.hand, melds: win.melds, tile: win.tile, tsumo: win.tsumo, yaku: win.yaku, dora: win.dora } : null,
  };
};

/**
 * The hand of the day (the biggest win today, New York time, at a table with at least two players),
 * the season's biggest hands and every yakuman on record. Wins against a table of bots aren't shown
 * off here: three bots can be farmed for a big hand.
 */
async function highlights(db, { season = ratings.seasonOf() } = {}) {
  const shown = `g.humans >= 2 AND ${leaderboardPlayerSql("h.winner_user_id")}`;
  const today = await db.query(
    `SELECT ${BIG_HAND_COLUMNS} ${BIG_HAND_FROM}
     WHERE ${shown} AND h.created_at >= ((now() AT TIME ZONE '${TIME_ZONE}')::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     ORDER BY h.points DESC, h.created_at LIMIT 1`
  );
  const big = await db.query(
    `SELECT ${BIG_HAND_COLUMNS} ${BIG_HAND_FROM}
     WHERE ${shown} AND to_char(h.created_at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM') = $1
     ORDER BY h.points DESC, h.created_at LIMIT 10`,
    [season]
  );
  const yakuman = await db.query(`SELECT ${BIG_HAND_COLUMNS} ${BIG_HAND_FROM} WHERE ${shown} AND h.yakuman > 0 ORDER BY h.created_at DESC LIMIT 20`);
  return { hand_of_the_day: today.rows[0] ? bigHandRow(today.rows[0]) : null, biggest: big.rows.map(bigHandRow), yakuman: yakuman.rows.map(bigHandRow) };
}

/** Spectators' picks: who has called the most winners (at least five calls settled). */
async function pickLeaders(db, { limit = 20 } = {}) {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.profile_color, COUNT(*) FILTER (WHERE k.correct)::int AS correct, COUNT(*)::int AS total
     FROM games.mahjong_picks k JOIN market.users u ON u.id = k.user_id
     WHERE k.correct IS NOT NULL AND ${leaderboardPlayerSql("k.user_id")}
     GROUP BY u.id HAVING COUNT(*) >= 5
     ORDER BY COUNT(*) FILTER (WHERE k.correct) DESC, COUNT(*) ASC, u.id LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({ user_id: Number(row.id), username: row.username, profile_color: row.profile_color, correct: row.correct, total: row.total }));
}

/** One player's mahjong record: this season, every season, tournaments won, picks, recent games. */
async function playerRecord(db, username) {
  const { rows: users } = await db.query(`SELECT ${PLAYER_COLUMNS} FROM market.users u ${PLAYER_JOINS} WHERE u.username_normalized = $1`, [String(username || "").trim().toLowerCase()]);
  const user = users[0];
  if (!user) return null;
  const userId = Number(user.id);
  const season = ratings.seasonOf();
  const { rows: seasons } = await db.query(`SELECT * FROM games.mahjong_ratings WHERE user_id = $1 ORDER BY season DESC`, [userId]);
  const current = seasons.find((row) => row.season === season);
  const totals = seasons.reduce(
    (sum, row) => {
      for (const key of ["games", "firsts", "seconds", "thirds", "fourths", "hands", "wins", "tsumo", "deal_ins", "riichi", "calls", "yakuman"]) sum[key] += Number(row[key]);
      sum.best_points = Math.max(sum.best_points, Number(row.best_points));
      sum.peak = Math.max(sum.peak, Number(row.peak));
      return sum;
    },
    { games: 0, firsts: 0, seconds: 0, thirds: 0, fourths: 0, hands: 0, wins: 0, tsumo: 0, deal_ins: 0, riichi: 0, calls: 0, yakuman: 0, best_points: 0, peak: 0 }
  );
  const { rows: titles } = await db.query(
    `SELECT t.id, t.name, t.completed_at FROM games.mahjong_tournament_players p JOIN games.mahjong_tournaments t ON t.id = p.tournament_id
     WHERE p.user_id = $1 AND p.place = 1 AND t.status = 'completed' ORDER BY t.completed_at DESC LIMIT 20`,
    [userId]
  );
  const { rows: picks } = await db.query(`SELECT COUNT(*) FILTER (WHERE correct)::int AS correct, COUNT(*) FILTER (WHERE correct IS NOT NULL)::int AS total FROM games.mahjong_picks WHERE user_id = $1`, [userId]);
  const rating = current ? Number(current.rating) : SETTINGS.ratingStart;
  const games = current ? Number(current.games) : 0;
  return {
    user: { user_id: userId, username: user.username, profile_color: user.profile_color, profile_picture_url: user.profile_picture_url || null, oshi: user.oshi || null },
    season,
    rating,
    rank: rankFor(rating, games).key,
    current: current ? ratingRow(current) : null,
    seasons: seasons.map(ratingRow),
    totals,
    tournaments_won: titles.map((row) => ({ id: Number(row.id), name: row.name, at: row.completed_at })),
    picks: picks[0],
    recent: await recentGames(db, { userId, limit: 10 }),
  };
}

/**
 * For staff: pairs of players who sat at paid tables together in the last `days` days, how often,
 * and what each came out with at those tables. Two accounts that always sit together with one
 * always ahead is the pattern to look at.
 */
async function pairReport(db, { days = 30, limit = 50 } = {}) {
  const { rows } = await db.query(
    `WITH paid AS (
       SELECT p.game_id, p.user_id, p.place, p.payout - p.fee AS net
       FROM games.mahjong_game_players p JOIN games.mahjong_games g ON g.id = p.game_id
       WHERE g.status = 'completed' AND g.entry_fee > 0 AND p.user_id IS NOT NULL AND g.completed_at > now() - make_interval(days => $1)
     )
     SELECT a.user_id AS a_id, ua.username AS a_name, b.user_id AS b_id, ub.username AS b_name, COUNT(*)::int AS games,
            SUM(a.net) AS a_net, SUM(b.net) AS b_net, COUNT(*) FILTER (WHERE a.place < b.place)::int AS a_above
     FROM paid a JOIN paid b ON b.game_id = a.game_id AND b.user_id > a.user_id
     JOIN market.users ua ON ua.id = a.user_id JOIN market.users ub ON ub.id = b.user_id
     GROUP BY a.user_id, ua.username, b.user_id, ub.username
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC, ABS(SUM(a.net) - SUM(b.net)) DESC
     LIMIT $2`,
    [Math.min(365, Math.max(1, Number(days) || 30)), Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  return rows.map((row) => ({
    a: { user_id: Number(row.a_id), username: row.a_name, net: Number(row.a_net) },
    b: { user_id: Number(row.b_id), username: row.b_name, net: Number(row.b_net) },
    games: row.games,
    a_above: row.a_above,
  }));
}

// ── The Wire ───────────────────────────────────────────────────────────────
/**
 * A headline for the front page's Wire. Templates only, about a player and a hand or a tournament:
 * nothing is ever said for or about a talent. The player has to be someone the Wire may name.
 */
async function postWire(db, { kind, dedupeKey, headline, blurb = null, userId, link, importance = 3, meta = {} }) {
  await db.query(
    `INSERT INTO content.wire_items (kind, dedupe_key, headline, blurb, symbols, image_url, link_url, importance, occurred_at, meta)
     SELECT $1, $2, $3, $4, '{}', NULL, $5, $6, now(), $7::jsonb
     WHERE ${headlinePlayerSql("$8::bigint")}
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [kind, dedupeKey, headline, blurb, link, importance, JSON.stringify({ ...meta, user_id: userId }), userId]
  );
}

/** A yakuman at a table with at least two players makes the Wire. */
async function wireYakuman(db, { gameId, handIndex, userId, username, yaku, kind }) {
  const names = yaku.map((entry) => yakuName(entry.key)).join(" and ");
  await postWire(db, {
    kind: "mahjong_yakuman",
    dedupeKey: `mahjong:yakuman:${gameId}:${handIndex}`,
    headline: `${username} hits a yakuman at the mahjong table`,
    blurb: `${names}, the biggest hand in the game${kind === "tournament" ? ", in a tournament" : ""}.`,
    userId,
    link: `/games/mahjong/replay/${gameId}?hand=${handIndex}`,
    importance: 4,
    meta: { game_id: gameId, hand_index: handIndex, yaku: yaku.map((entry) => entry.key) },
  });
}

async function wireTournament(db, { tournamentId, name, userId, username, seats }) {
  await postWire(db, {
    kind: "mahjong_tournament",
    dedupeKey: `mahjong:tournament:${tournamentId}`,
    headline: `${username} wins the ${name}`,
    blurb: `First of ${seats} at the mahjong tables.`,
    userId,
    link: `/games/mahjong/tournaments/${tournamentId}`,
    importance: 4,
    meta: { tournament_id: tournamentId },
  });
}

module.exports = {
  bestWin,
  cancelGame,
  cancelUnfinishedGames,
  createGameRow,
  finishGame,
  getGame,
  highlights,
  inTransaction,
  ladder,
  listTalentSymbols,
  loadPlayer,
  oshiStandings,
  pairReport,
  payEntry,
  pickLeaders,
  playerRecord,
  readPick,
  recentGames,
  refundOpenEntries,
  saveHand,
  savePick,
  seatStats,
  startGameRow,
  wireTournament,
  wireYakuman,
};
