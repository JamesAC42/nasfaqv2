// Ticker Tap v2 (docs/games/GAMES_DESIGN.md §6).
//
// The server builds the run's timeline from a seed. The client plays it and submits its tap log;
// the server replays the log against the timeline to score it, so a claimed score can't be forged.
// Entry fees feed a weekly pool: 90% goes to the week's top ten best runs (one per player).

const crypto = require("node:crypto");
const cards = require("./cards");
const gamesCatalog = require("./catalog");
const gamesWallet = require("./wallet");

const GAME_KEY = "ticker-tap";
const LANES = 5;
const RUN_MS = 45_000;
const MAX_TAPS = 600;
const MIN_REAL_MS = RUN_MS - 3_000; // a run can't be submitted faster than it takes to play
const PAYOUT_SPLIT = [30, 20, 12, 9, 7, 6, 5, 4, 4, 3]; // percent of the pool by rank
const POOL_SHARE_BPS_DEFAULT = 9000;
const WEEK_TZ = "America/New_York";

const POINTS = { up: 100, gold: 500, down: -150, miss: -25 };

function sessionError(code = "invalid_game_session") {
  const error = new Error(code);
  error.code = code;
  return error;
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;

// ── Timeline ───────────────────────────────────────────────────────────────
function seededRandom(seed) {
  let counter = 0;
  return () => {
    const hash = crypto.createHash("sha256").update(`${seed}:${counter++}`).digest();
    return hash.readUInt32BE(0) / 2 ** 32;
  };
}

/**
 * Targets ramp up through the run: spawns every 720 ms at the start down to 300 ms at the end,
 * living 1150 ms down to 620 ms. ~68% green (tap), ~28% red (avoid), ~4% gold (bonus).
 */
function buildTimeline(seed, symbols) {
  const rand = seededRandom(seed);
  const targets = [];
  let t = 900;
  let index = 0;
  while (t < RUN_MS - 400) {
    const progress = t / RUN_MS;
    const roll = rand();
    const kind = roll < 0.04 ? "gold" : roll < 0.32 ? "down" : "up";
    const life = Math.round(1150 - 530 * progress);
    let lane = Math.floor(rand() * LANES);
    // Never stack a new target on a lane that's still occupied.
    for (let tries = 0; tries < LANES && targets.some((target) => target.lane === lane && target.start_ms + target.life_ms > t); tries += 1) lane = (lane + 1) % LANES;
    targets.push({ index, lane, start_ms: t, life_ms: life, kind, symbol: symbols.length ? symbols[Math.floor(rand() * symbols.length)] : null });
    index += 1;
    const gap = 720 - 420 * progress;
    t += Math.round(gap * (0.75 + rand() * 0.5));
  }
  return targets;
}

function multiplierFor(combo) {
  return Math.min(3, 1 + Math.floor(combo / 5) * 0.5);
}

/** Replays a tap log against the timeline. Pure: the same inputs always score the same. */
function replay(timeline, taps) {
  const events = [
    ...taps.map((tap, order) => ({ t: tap.t, type: "tap", lane: tap.lane, order })),
    ...timeline.filter((target) => target.kind !== "down").map((target) => ({ t: target.start_ms + target.life_ms, type: "expire", target })),
  ].sort((a, b) => a.t - b.t || (a.type === "tap" ? -1 : 1));

  const hit = new Set();
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  const stats = { greens: 0, golds: 0, reds: 0, misses: 0, escaped: 0, taps: taps.length };
  for (const event of events) {
    if (event.type === "expire") {
      if (!hit.has(event.target.index)) {
        stats.escaped += 1;
        combo = 0;
      }
      continue;
    }
    const target = timeline
      .filter((candidate) => candidate.lane === event.lane && !hit.has(candidate.index) && candidate.start_ms <= event.t && event.t <= candidate.start_ms + candidate.life_ms)
      .sort((a, b) => a.start_ms - b.start_ms)[0];
    if (!target) {
      stats.misses += 1;
      score += POINTS.miss;
      combo = 0;
      continue;
    }
    hit.add(target.index);
    if (target.kind === "down") {
      stats.reds += 1;
      score += POINTS.down;
      combo = 0;
      continue;
    }
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    score += Math.round(POINTS[target.kind] * multiplierFor(combo - 1));
    if (target.kind === "gold") stats.golds += 1;
    else stats.greens += 1;
  }
  const good = stats.greens + stats.golds;
  const total = timeline.filter((target) => target.kind !== "down").length;
  return {
    score: Math.max(0, score),
    max_combo: maxCombo,
    accuracy: stats.taps ? good / stats.taps : 0,
    catch_rate: total ? good / total : 0,
    ...stats,
  };
}

function normalizeTaps(payload) {
  const raw = Array.isArray(payload?.taps) ? payload.taps : null;
  if (!raw || raw.length > MAX_TAPS) throw sessionError();
  const taps = raw.map((tap) => ({ lane: Number(tap?.lane), t: Number(tap?.t) }));
  for (const tap of taps) {
    if (!Number.isInteger(tap.lane) || tap.lane < 0 || tap.lane >= LANES) throw sessionError();
    if (!Number.isFinite(tap.t) || tap.t < 0 || tap.t > RUN_MS + 1_000) throw sessionError();
  }
  return taps.sort((a, b) => a.t - b.t);
}

// ── Weeks and the pool ─────────────────────────────────────────────────────
async function currentWeek(db) {
  const { rows } = await db.query(
    `
    SELECT
      to_char(date_trunc('week', now() AT TIME ZONE $1), 'YYYY-MM-DD') AS week_start,
      (date_trunc('week', now() AT TIME ZONE $1) AT TIME ZONE $1) AS starts_at,
      ((date_trunc('week', now() AT TIME ZONE $1) + interval '7 days') AT TIME ZONE $1) AS ends_at
  `,
    [WEEK_TZ]
  );
  return { week_start: rows[0].week_start, starts_at: rows[0].starts_at, ends_at: rows[0].ends_at };
}

async function weekPool(db, gameId, startsAt, endsAt, shareBps) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(entry_fee_cash), 0) AS fees, COUNT(*)::int AS runs FROM games.game_sessions WHERE game_id = $1 AND started_at >= $2 AND started_at < $3 AND status IN ('active', 'completed')`,
    [gameId, startsAt, endsAt]
  );
  return { fees: Number(rows[0].fees), runs: Number(rows[0].runs), pool: round2((Number(rows[0].fees) * shareBps) / 10_000) };
}

async function weekLeaders(db, gameId, startsAt, endsAt, limit = 10) {
  const { rows } = await db.query(
    `
    SELECT * FROM (
      SELECT DISTINCT ON (gs.user_id)
        gs.id, gs.user_id, u.username, u.profile_color, gs.score, gs.completed_at, gs.result_json
      FROM games.game_sessions gs
      JOIN market.users u ON u.id = gs.user_id
      WHERE gs.game_id = $1 AND gs.status = 'completed' AND gs.started_at >= $2 AND gs.started_at < $3 AND gs.score IS NOT NULL
      ORDER BY gs.user_id, gs.score DESC, gs.completed_at ASC
    ) best
    ORDER BY score DESC, completed_at ASC
    LIMIT $4
  `,
    [gameId, startsAt, endsAt, limit]
  );
  return rows.map((row, index) => ({
    rank: index + 1,
    session_id: Number(row.id),
    user_id: Number(row.user_id),
    username: row.username,
    profile_color: row.profile_color || null,
    score: Number(row.score),
    completed_at: row.completed_at,
    stats: row.result_json?.replay || null,
  }));
}

/** Pool split over however many winners there are (fewer than ten rescales the shares). */
function splitPool(pool, winners) {
  const shares = PAYOUT_SPLIT.slice(0, winners);
  const total = shares.reduce((sum, share) => sum + share, 0);
  return shares.map((share) => Math.floor((pool * share * 100) / total) / 100);
}

// ── Sessions ───────────────────────────────────────────────────────────────
async function createTickerTapSession(pool, { userId }) {
  const game = await gamesCatalog.getGameByKey(pool, GAME_KEY);
  if (!game) throw sessionError("game_not_found");
  const fee = Number(game.entry_fee_cash || 0);
  const talents = await cards.listTalents(pool);
  const seed = crypto.randomBytes(24).toString("base64url");
  const timeline = buildTimeline(seed, talents.map((talent) => talent.symbol));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      INSERT INTO games.game_sessions (game_id, user_id, status, entry_fee_cash, payout_cash, seed, result_json, started_at, created_at)
      VALUES ($1,$2,'active',$3,0,$4,$5,now(),now())
      RETURNING id, created_at
    `,
      [game.id, userId, fee, seed, JSON.stringify({ type: "ticker_tap_v2", phase: "active" })]
    );
    const session = rows[0];
    let cashBalance = null;
    if (fee > 0) {
      const debit = await gamesWallet.debitCashForGameWithClient(client, { userId, amount: fee, entryType: "game_entry_fee", referenceType: "game_session", referenceId: Number(session.id) });
      cashBalance = debit.cash_balance;
    }
    await client.query("COMMIT");
    return {
      game: gamesCatalog.toPublicGame(game),
      session: {
        id: Number(session.id),
        status: "active",
        entry_fee_cash: fee,
        started_at: session.created_at,
        config: { version: 2, lanes: LANES, run_ms: RUN_MS, points: POINTS, timeline },
      },
      wallet: { cash_balance_after: cashBalance },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function submitTickerTapSession(pool, { userId, sessionId, payload }) {
  const taps = normalizeTaps(payload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      SELECT gs.id, gs.status, gs.seed, gs.started_at, gs.game_id
      FROM games.game_sessions gs JOIN games.game_catalog gc ON gc.id = gs.game_id
      WHERE gs.id = $1 AND gs.user_id = $2 AND gc.key = $3
      FOR UPDATE OF gs
    `,
      [Number(sessionId), userId, GAME_KEY]
    );
    const session = rows[0];
    if (!session) throw sessionError("game_session_not_found");
    if (session.status !== "active") throw sessionError("game_session_not_active");
    const elapsed = Date.now() - new Date(session.started_at).getTime();
    if (elapsed < MIN_REAL_MS) throw sessionError("run_too_fast");

    const talents = await cards.listTalents(client);
    const timeline = buildTimeline(session.seed, talents.map((talent) => talent.symbol));
    const result = replay(timeline, taps);
    const { rows: best } = await client.query(
      `SELECT MAX(score) AS best FROM games.game_sessions WHERE user_id = $1 AND game_id = $2 AND status = 'completed'`,
      [userId, session.game_id]
    );
    const previousBest = best[0]?.best === null ? null : Number(best[0].best);
    await client.query(
      `UPDATE games.game_sessions SET status = 'completed', score = $2, completed_at = now(), result_json = $3 WHERE id = $1`,
      [session.id, result.score, JSON.stringify({ type: "ticker_tap_v2", phase: "completed", replay: result })]
    );
    await client.query("COMMIT");
    return {
      session: { id: Number(session.id), status: "completed", score: result.score, payout_cash: 0, completed_at: new Date().toISOString() },
      result: { replay: result, personal_best: previousBest === null || result.score > previousBest, previous_best: previousBest },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getTickerTapSession(pool, { userId, sessionId }) {
  const { rows } = await pool.query(
    `
    SELECT gs.* FROM games.game_sessions gs JOIN games.game_catalog gc ON gc.id = gs.game_id
    WHERE gs.id = $1 AND gs.user_id = $2 AND gc.key = $3
  `,
    [Number(sessionId), userId, GAME_KEY]
  );
  const session = rows[0];
  if (!session) throw sessionError("game_session_not_found");
  return {
    id: Number(session.id),
    status: session.status,
    score: session.score === null ? null : Number(session.score),
    entry_fee_cash: Number(session.entry_fee_cash || 0),
    payout_cash: Number(session.payout_cash || 0),
    started_at: session.started_at,
    completed_at: session.completed_at,
    result: session.result_json || {},
  };
}

/** This week's standings with projected payouts, the pool, your best, and last week's winners. */
async function listTickerTapLeaderboard(pool, { userId = null } = {}) {
  const game = await gamesCatalog.getGameByKey(pool, GAME_KEY);
  if (!game) return { game: null, leaderboard: [] };
  const shareBps = Number(game.config_json?.pool_share_bps ?? POOL_SHARE_BPS_DEFAULT);
  const week = await currentWeek(pool);
  const [poolInfo, leaders] = await Promise.all([weekPool(pool, game.id, week.starts_at, week.ends_at, shareBps), weekLeaders(pool, game.id, week.starts_at, week.ends_at, 25)]);
  const payouts = splitPool(poolInfo.pool, Math.min(PAYOUT_SPLIT.length, leaders.length));
  let mine = null;
  if (userId) {
    const own = await weekLeaders(pool, game.id, week.starts_at, week.ends_at, 1000);
    mine = own.find((row) => row.user_id === Number(userId)) || null;
  }
  const last = await pool.query(
    `
    SELECT p.rank, p.score, p.payout_cash, p.week_start, u.username, u.profile_color
    FROM games.weekly_prize_payouts p JOIN market.users u ON u.id = p.user_id
    WHERE p.game_key = $1 AND p.week_start = (SELECT MAX(week_start) FROM games.weekly_prize_settlements WHERE game_key = $1)
    ORDER BY p.rank
  `,
    [GAME_KEY]
  );
  return {
    game: gamesCatalog.toPublicGame(game),
    week: { ...week, runs: poolInfo.runs, fees: poolInfo.fees, pool: poolInfo.pool, share_bps: shareBps, split: PAYOUT_SPLIT },
    leaderboard: leaders.map((row, index) => ({ ...row, projected_payout: payouts[index] ?? 0 })),
    me: mine,
    last_week: last.rows.map((row) => ({ rank: Number(row.rank), score: Number(row.score), payout: Number(row.payout_cash), username: row.username, profile_color: row.profile_color, week_start: row.week_start })),
  };
}

// ── Weekly settlement ──────────────────────────────────────────────────────
async function settleFinishedWeeks(pool) {
  const game = await gamesCatalog.getGameByKey(pool, GAME_KEY);
  if (!game) return;
  const shareBps = Number(game.config_json?.pool_share_bps ?? POOL_SHARE_BPS_DEFAULT);
  // The last four finished weeks, oldest first, skipping any already settled.
  const { rows: weeks } = await pool.query(
    `
    SELECT to_char(w, 'YYYY-MM-DD') AS week_start, (w AT TIME ZONE $1) AS starts_at, ((w + interval '7 days') AT TIME ZONE $1) AS ends_at
    FROM generate_series(date_trunc('week', now() AT TIME ZONE $1) - interval '28 days', date_trunc('week', now() AT TIME ZONE $1) - interval '7 days', interval '7 days') AS w
    WHERE NOT EXISTS (SELECT 1 FROM games.weekly_prize_settlements s WHERE s.game_key = $2 AND s.week_start = w::date)
    ORDER BY w
  `,
    [WEEK_TZ, GAME_KEY]
  );
  for (const week of weeks) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const weekStart = week.week_start;
      const inserted = await client.query(
        `INSERT INTO games.weekly_prize_settlements (game_key, week_start, pool_cash, winners) VALUES ($1,$2,0,0) ON CONFLICT DO NOTHING RETURNING week_start`,
        [GAME_KEY, weekStart]
      );
      if (!inserted.rowCount) {
        await client.query("ROLLBACK");
        continue;
      }
      const poolInfo = await weekPool(client, game.id, week.starts_at, week.ends_at, shareBps);
      const leaders = await weekLeaders(client, game.id, week.starts_at, week.ends_at, PAYOUT_SPLIT.length);
      const payouts = splitPool(poolInfo.pool, leaders.length);
      const referenceId = Number(weekStart.replace(/-/g, ""));
      for (const [index, leader] of leaders.entries()) {
        const payout = payouts[index];
        if (payout > 0) {
          await gamesWallet.creditCashForGameWithClient(client, { userId: leader.user_id, amount: payout, entryType: "game_prize_payout", referenceType: "ticker_tap_week", referenceId });
          await client.query(`UPDATE games.game_sessions SET payout_cash = $2 WHERE id = $1`, [leader.session_id, payout]);
        }
        await client.query(
          `INSERT INTO games.weekly_prize_payouts (game_key, week_start, user_id, rank, score, payout_cash, pool_cash) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [GAME_KEY, weekStart, leader.user_id, leader.rank, leader.score, payout, poolInfo.pool]
        );
      }
      await client.query(`UPDATE games.weekly_prize_settlements SET pool_cash = $3, winners = $4 WHERE game_key = $1 AND week_start = $2`, [GAME_KEY, weekStart, poolInfo.pool, leaders.length]);
      await client.query("COMMIT");
      if (leaders.length) console.log(`games: settled Ticker Tap week ${weekStart}: $${poolInfo.pool} to ${leaders.length} player(s)`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("games: ticker tap weekly settlement failed", error);
    } finally {
      client.release();
    }
  }
}

function startWeeklySettlement(pool) {
  const run = () => settleFinishedWeeks(pool).catch((error) => console.error("games: weekly settlement", error));
  run();
  const timer = setInterval(run, 5 * 60_000);
  timer.unref?.();
}

module.exports = {
  LANES,
  RUN_MS,
  buildTimeline,
  createTickerTapSession,
  getTickerTapSession,
  listTickerTapLeaderboard,
  replay,
  settleFinishedWeeks,
  splitPool,
  startWeeklySettlement,
  submitTickerTapSession,
};
