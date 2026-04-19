const crypto = require("node:crypto");
const gamesCatalog = require("./catalog");
const gamesWallet = require("./wallet");

const TICKER_TAP_DEFAULTS = {
  run_duration_seconds: 45,
  lane_count: 4,
  target_lifetime_ms: 900,
  spawn_interval_ms: 650,
  max_targets: 72,
  leaderboard_window_days: 7,
  leaderboard_limit: 20,
};

function invalidGameSession(code = "invalid_game_session") {
  const error = new Error(code);
  error.code = code;
  return error;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTickerTapConfig(game) {
  const config = game?.config_json || {};
  const runDurationSeconds = Math.max(10, Math.min(120, Number(config.run_duration_seconds || TICKER_TAP_DEFAULTS.run_duration_seconds)));
  const laneCount = Math.max(3, Math.min(6, Number(config.lane_count || TICKER_TAP_DEFAULTS.lane_count)));
  const targetLifetimeMs = Math.max(350, Math.min(1600, Number(config.target_lifetime_ms || TICKER_TAP_DEFAULTS.target_lifetime_ms)));
  const spawnIntervalMs = Math.max(250, Math.min(1500, Number(config.spawn_interval_ms || TICKER_TAP_DEFAULTS.spawn_interval_ms)));
  const maxTargets = Math.max(12, Math.min(200, Number(config.max_targets || TICKER_TAP_DEFAULTS.max_targets)));
  const leaderboardWindowDays = Math.max(1, Math.min(30, Number(config.leaderboard_window_days || TICKER_TAP_DEFAULTS.leaderboard_window_days)));
  const leaderboardLimit = Math.max(1, Math.min(100, Number(config.leaderboard_limit || TICKER_TAP_DEFAULTS.leaderboard_limit)));

  return {
    run_duration_seconds: runDurationSeconds,
    lane_count: laneCount,
    target_lifetime_ms: targetLifetimeMs,
    spawn_interval_ms: spawnIntervalMs,
    max_targets: maxTargets,
    leaderboard_window_days: leaderboardWindowDays,
    leaderboard_limit: leaderboardLimit,
  };
}

function buildTickerTapTimeline({ seed, runDurationSeconds, laneCount, spawnIntervalMs, maxTargets }) {
  const timeline = [];
  const hashBase = crypto.createHash("sha256").update(String(seed)).digest("hex");
  const maxSpawnCount = Math.min(maxTargets, Math.max(1, Math.floor((runDurationSeconds * 1000) / spawnIntervalMs)));

  for (let index = 0; index < maxSpawnCount; index += 1) {
    const startMs = index * spawnIntervalMs;
    if (startMs >= runDurationSeconds * 1000) break;
    const sliceStart = (index * 2) % hashBase.length;
    const hexSlice = `${hashBase.slice(sliceStart, sliceStart + 2)}${hashBase.slice((sliceStart + 16) % hashBase.length, ((sliceStart + 18) % hashBase.length) || undefined)}`;
    const lane = Number.parseInt(hexSlice.slice(0, 2), 16) % laneCount;
    timeline.push({
      index,
      lane,
      start_ms: startMs,
    });
  }

  return timeline;
}

function createTickerTapSessionConfig(game, seed) {
  const normalized = normalizeTickerTapConfig(game);
  return {
    ...normalized,
    seed_hint: crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 12),
    timeline: buildTickerTapTimeline({
      seed,
      runDurationSeconds: normalized.run_duration_seconds,
      laneCount: normalized.lane_count,
      spawnIntervalMs: normalized.spawn_interval_ms,
      maxTargets: normalized.max_targets,
    }),
  };
}

async function createGameSessionWithClient(client, {
  gameId,
  userId,
  entryFeeCash,
  seed,
  result,
}) {
  const { rows } = await client.query(
    `
    INSERT INTO games.game_sessions (
      game_id,
      user_id,
      status,
      entry_fee_cash,
      payout_cash,
      seed,
      result_json,
      started_at,
      created_at
    ) VALUES ($1,$2,'active',$3,0,$4,$5,now(),now())
    RETURNING id, created_at
  `,
    [gameId, userId, entryFeeCash, seed, JSON.stringify(result || {})]
  );
  return rows[0];
}

async function getGameSessionWithClient(client, {
  sessionId,
  userId,
  gameKey = null,
  forUpdate = false,
}) {
  const safeSessionId = Number(sessionId);
  if (!Number.isInteger(safeSessionId) || safeSessionId <= 0) {
    throw invalidGameSession();
  }

  const conditions = ["gs.id = $1", "gs.user_id = $2"];
  const params = [safeSessionId, userId];
  if (gameKey) {
    conditions.push(`gc.key = $${params.length + 1}`);
    params.push(String(gameKey));
  }

  const { rows } = await client.query(
    `
    SELECT
      gs.id,
      gs.game_id,
      gs.user_id,
      gs.status,
      gs.entry_fee_cash,
      gs.payout_cash,
      gs.seed,
      gs.score,
      gs.result_json,
      gs.started_at,
      gs.completed_at,
      gs.created_at,
      gc.key AS game_key,
      gc.name AS game_name
    FROM games.game_sessions gs
    JOIN games.game_catalog gc
      ON gc.id = gs.game_id
    WHERE ${conditions.join(" AND ")}
    LIMIT 1
    ${forUpdate ? "FOR UPDATE" : ""}
  `,
    params
  );

  return rows[0] || null;
}

async function completeGameSessionWithClient(client, sessionId, {
  score,
  payoutCash = 0,
  result,
}) {
  await client.query(
    `
    UPDATE games.game_sessions
    SET
      status = 'completed',
      score = $2,
      payout_cash = $3,
      result_json = $4,
      completed_at = now()
    WHERE id = $1
  `,
    [sessionId, score, payoutCash, JSON.stringify(result || {})]
  );
}

function normalizeTickerTapSubmission(payload, config) {
  const hits = Number.parseInt(String(payload?.hits ?? 0), 10);
  const misses = Number.parseInt(String(payload?.misses ?? 0), 10);
  const maxStreak = Number.parseInt(String(payload?.max_streak ?? 0), 10);
  const durationMs = Number.parseInt(String(payload?.duration_ms ?? 0), 10);
  const taps = Number.parseInt(String(payload?.taps ?? hits + misses), 10);

  if (![hits, misses, maxStreak, durationMs, taps].every(Number.isInteger)) {
    throw invalidGameSession();
  }
  if (hits < 0 || misses < 0 || maxStreak < 0 || durationMs < 0 || taps < 0) {
    throw invalidGameSession();
  }
  if (hits > config.max_targets || misses > config.max_targets || taps > config.max_targets * 2) {
    throw invalidGameSession();
  }

  const durationFloor = 5_000;
  const durationCeiling = (config.run_duration_seconds * 1000) + 15_000;
  if (durationMs < durationFloor || durationMs > durationCeiling) {
    throw invalidGameSession();
  }

  return { hits, misses, maxStreak, durationMs, taps };
}

function computeTickerTapScore(submission, config) {
  const accuracy = submission.hits + submission.misses > 0
    ? submission.hits / (submission.hits + submission.misses)
    : 0;
  const efficiency = submission.hits + submission.misses > 0
    ? submission.hits / Math.max(submission.taps, submission.hits + submission.misses)
    : 0;
  const rawScore = (submission.hits * 100) + (submission.maxStreak * 25) - (submission.misses * 15) + Math.round(accuracy * 250) + Math.round(efficiency * 150);
  const scoreCap = (config.max_targets * 100) + (config.max_targets * 25) + 400;
  return Math.max(0, Math.min(scoreCap, rawScore));
}

async function createTickerTapSession(pool, { userId }) {
  const game = await gamesCatalog.getGameByKey(pool, "ticker-tap");
  if (!game) {
    const error = new Error("game_not_found");
    error.code = "game_not_found";
    throw error;
  }
  if (game.game_type !== "single_player") {
    throw invalidGameSession();
  }

  const config = normalizeTickerTapConfig(game);
  const seed = crypto.randomBytes(24).toString("base64url");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const session = await createGameSessionWithClient(client, {
      gameId: game.id,
      userId,
      entryFeeCash: Number(game.entry_fee_cash || 0),
      seed,
      result: {
        type: "ticker_tap",
        phase: "created",
        config: createTickerTapSessionConfig(game, seed),
      },
    });

    const debit = await gamesWallet.debitCashForGameWithClient(client, {
      userId,
      amount: Number(game.entry_fee_cash || 0),
      entryType: "game_entry_fee",
      referenceType: "game_session",
      referenceId: Number(session.id),
    });

    const sessionConfig = createTickerTapSessionConfig(game, seed);
    await client.query("COMMIT");

    return {
      game: gamesCatalog.toPublicGame(game),
      session: {
        id: Number(session.id),
        status: "active",
        entry_fee_cash: Number(game.entry_fee_cash || 0),
        started_at: session.created_at,
        config: sessionConfig,
      },
      wallet: {
        cash_balance_after: debit.cash_balance,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function submitTickerTapSession(pool, {
  userId,
  sessionId,
  payload,
}) {
  const game = await gamesCatalog.getGameByKey(pool, "ticker-tap");
  if (!game) {
    const error = new Error("game_not_found");
    error.code = "game_not_found";
    throw error;
  }

  const config = normalizeTickerTapConfig(game);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const session = await getGameSessionWithClient(client, {
      sessionId,
      userId,
      gameKey: "ticker-tap",
      forUpdate: true,
    });
    if (!session) {
      const error = new Error("game_session_not_found");
      error.code = "game_session_not_found";
      throw error;
    }
    if (session.status !== "active") {
      const error = new Error("game_session_not_active");
      error.code = "game_session_not_active";
      throw error;
    }

    const submission = normalizeTickerTapSubmission(payload, config);
    const score = computeTickerTapScore(submission, config);
    const result = {
      type: "ticker_tap",
      phase: "completed",
      config: createTickerTapSessionConfig(game, session.seed),
      submission: {
        hits: submission.hits,
        misses: submission.misses,
        max_streak: submission.maxStreak,
        duration_ms: submission.durationMs,
        taps: submission.taps,
        accuracy: submission.hits + submission.misses > 0 ? submission.hits / (submission.hits + submission.misses) : 0,
      },
      score,
    };

    await completeGameSessionWithClient(client, Number(session.id), {
      score,
      payoutCash: 0,
      result,
    });

    await client.query("COMMIT");

    return {
      session: {
        id: Number(session.id),
        status: "completed",
        score,
        payout_cash: 0,
        completed_at: new Date().toISOString(),
      },
      result,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getTickerTapSession(pool, {
  userId,
  sessionId,
}) {
  const client = await pool.connect();
  try {
    const session = await getGameSessionWithClient(client, {
      sessionId,
      userId,
      gameKey: "ticker-tap",
      forUpdate: false,
    });
    if (!session) {
      const error = new Error("game_session_not_found");
      error.code = "game_session_not_found";
      throw error;
    }
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
  } finally {
    client.release();
  }
}

async function listTickerTapLeaderboard(pool) {
  const game = await gamesCatalog.getGameByKey(pool, "ticker-tap");
  if (!game) {
    return { game: null, leaderboard: [] };
  }

  const config = normalizeTickerTapConfig(game);
  const { rows } = await pool.query(
    `
    SELECT
      gs.id,
      gs.user_id,
      u.username,
      u.profile_color,
      gs.score,
      gs.completed_at,
      gs.result_json
    FROM games.game_sessions gs
    JOIN market.users u
      ON u.id = gs.user_id
    WHERE gs.game_id = $1
      AND gs.status = 'completed'
      AND gs.completed_at >= now() - ($2 || ' days')::interval
    ORDER BY gs.score DESC NULLS LAST, gs.completed_at ASC, gs.id ASC
    LIMIT $3
  `,
    [game.id, String(config.leaderboard_window_days), config.leaderboard_limit]
  );

  return {
    game: gamesCatalog.toPublicGame(game),
    leaderboard: rows.map((row, index) => ({
      rank: index + 1,
      session_id: Number(row.id),
      user_id: Number(row.user_id),
      username: row.username,
      profile_color: row.profile_color || null,
      score: Number(toNumber(row.score) || 0),
      completed_at: row.completed_at,
      stats: {
        hits: Number(row.result_json?.submission?.hits || 0),
        misses: Number(row.result_json?.submission?.misses || 0),
        max_streak: Number(row.result_json?.submission?.max_streak || 0),
        duration_ms: Number(row.result_json?.submission?.duration_ms || 0),
      },
    })),
  };
}

module.exports = {
  createTickerTapSession,
  getTickerTapSession,
  listTickerTapLeaderboard,
  submitTickerTapSession,
};
