function normalizeDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function shiftDateByDays(dateKey, days) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return null;

  const date = new Date(`${normalized}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildStreakStateFromTradeDays(tradeDays) {
  const normalizedTradeDays = Array.isArray(tradeDays)
    ? tradeDays.map((tradeDay) => normalizeDateKey(tradeDay)).filter(Boolean)
    : [];

  if (normalizedTradeDays.length === 0) {
    return {
      current_streak_days: 0,
      longest_streak_days: 0,
      last_trade_day: null,
      streak_started_day: null,
      longest_streak_started_day: null,
      longest_streak_ended_day: null,
    };
  }

  let currentStart = normalizedTradeDays[0];
  let currentLength = 1;
  let bestStart = normalizedTradeDays[0];
  let bestEnd = normalizedTradeDays[0];
  let bestLength = 1;

  for (let index = 1; index < normalizedTradeDays.length; index += 1) {
    const tradeDay = normalizedTradeDays[index];
    const previousTradeDay = normalizedTradeDays[index - 1];

    if (tradeDay === previousTradeDay) {
      continue;
    }

    if (tradeDay === shiftDateByDays(previousTradeDay, 1)) {
      currentLength += 1;
    } else {
      if (currentLength > bestLength) {
        bestLength = currentLength;
        bestStart = currentStart;
        bestEnd = previousTradeDay;
      }
      currentStart = tradeDay;
      currentLength = 1;
    }
  }

  const lastTradeDay = normalizedTradeDays[normalizedTradeDays.length - 1];
  if (currentLength > bestLength) {
    bestLength = currentLength;
    bestStart = currentStart;
    bestEnd = lastTradeDay;
  }

  return {
    current_streak_days: currentLength,
    longest_streak_days: bestLength,
    last_trade_day: lastTradeDay,
    streak_started_day: currentStart,
    longest_streak_started_day: bestStart,
    longest_streak_ended_day: bestEnd,
  };
}

async function upsertTradeStreakState(client, userId, state, lastTradeFillId = null) {
  const { rows } = await client.query(
    `
    INSERT INTO market.user_trade_streaks (
      user_id,
      current_streak_days,
      longest_streak_days,
      last_trade_day,
      last_trade_fill_id,
      streak_started_day,
      longest_streak_started_day,
      longest_streak_ended_day,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
    ON CONFLICT (user_id)
    DO UPDATE SET
      current_streak_days = EXCLUDED.current_streak_days,
      longest_streak_days = EXCLUDED.longest_streak_days,
      last_trade_day = EXCLUDED.last_trade_day,
      last_trade_fill_id = EXCLUDED.last_trade_fill_id,
      streak_started_day = EXCLUDED.streak_started_day,
      longest_streak_started_day = EXCLUDED.longest_streak_started_day,
      longest_streak_ended_day = EXCLUDED.longest_streak_ended_day,
      updated_at = now()
    RETURNING
      user_id,
      current_streak_days,
      longest_streak_days,
      last_trade_day,
      last_trade_fill_id,
      streak_started_day,
      longest_streak_started_day,
      longest_streak_ended_day,
      updated_at
  `,
    [
      userId,
      state.current_streak_days,
      state.longest_streak_days,
      state.last_trade_day,
      lastTradeFillId,
      state.streak_started_day,
      state.longest_streak_started_day,
      state.longest_streak_ended_day,
    ]
  );

  return rows[0] || null;
}

async function rebuildUserTradeStreakWithClient(client, userId) {
  const { rows } = await client.query(
    `
    SELECT DISTINCT tf.ts::date AS trade_day
    FROM market.trade_fills tf
    WHERE tf.user_id = $1
    ORDER BY trade_day ASC
  `,
    [userId]
  );
  const tradeDays = rows.map((row) => normalizeDateKey(row.trade_day)).filter(Boolean);
  const state = buildStreakStateFromTradeDays(tradeDays);

  const lastFillResult = await client.query(
    `
    SELECT tf.id
    FROM market.trade_fills tf
    WHERE tf.user_id = $1
    ORDER BY tf.ts DESC, tf.id DESC
    LIMIT 1
  `,
    [userId]
  );
  const lastTradeFillId = lastFillResult.rows[0]?.id || null;

  return upsertTradeStreakState(client, userId, state, lastTradeFillId);
}

async function applyTradeFillToStreakWithClient(client, userId, fillId) {
  const fillResult = await client.query(
    `
    SELECT id, ts::date AS trade_day
    FROM market.trade_fills
    WHERE id = $1
      AND user_id = $2
    LIMIT 1
  `,
    [fillId, userId]
  );
  const fill = fillResult.rows[0] || null;
  if (!fill) {
    return rebuildUserTradeStreakWithClient(client, userId);
  }

  const streakResult = await client.query(
    `
    SELECT
      user_id,
      current_streak_days,
      longest_streak_days,
      last_trade_day,
      last_trade_fill_id,
      streak_started_day,
      longest_streak_started_day,
      longest_streak_ended_day
    FROM market.user_trade_streaks
    WHERE user_id = $1
    FOR UPDATE
  `,
    [userId]
  );
  const existing = streakResult.rows[0] || null;
  if (!existing) {
    return rebuildUserTradeStreakWithClient(client, userId);
  }

  const tradeDay = normalizeDateKey(fill.trade_day);
  const lastTradeDay = normalizeDateKey(existing.last_trade_day);
  if (!tradeDay) {
    return rebuildUserTradeStreakWithClient(client, userId);
  }
  if (!lastTradeDay) {
    return upsertTradeStreakState(client, userId, {
      current_streak_days: 1,
      longest_streak_days: Math.max(1, Number(existing.longest_streak_days || 0)),
      last_trade_day: tradeDay,
      streak_started_day: tradeDay,
      longest_streak_started_day: existing.longest_streak_started_day || tradeDay,
      longest_streak_ended_day: existing.longest_streak_ended_day || tradeDay,
    }, fill.id);
  }

  if (tradeDay === lastTradeDay) {
    return upsertTradeStreakState(client, userId, {
      current_streak_days: Number(existing.current_streak_days || 0),
      longest_streak_days: Number(existing.longest_streak_days || 0),
      last_trade_day: lastTradeDay,
      streak_started_day: normalizeDateKey(existing.streak_started_day) || lastTradeDay,
      longest_streak_started_day: normalizeDateKey(existing.longest_streak_started_day) || normalizeDateKey(existing.streak_started_day) || lastTradeDay,
      longest_streak_ended_day: normalizeDateKey(existing.longest_streak_ended_day) || lastTradeDay,
    }, fill.id);
  }

  let currentStreakDays = 1;
  let longestStreakDays = Number(existing.longest_streak_days || 0);
  let streakStartedDay = tradeDay;
  let longestStreakStartedDay = normalizeDateKey(existing.longest_streak_started_day) || normalizeDateKey(existing.streak_started_day) || lastTradeDay;
  let longestStreakEndedDay = normalizeDateKey(existing.longest_streak_ended_day) || lastTradeDay;

  if (tradeDay === shiftDateByDays(lastTradeDay, 1)) {
    currentStreakDays = Number(existing.current_streak_days || 0) + 1;
    streakStartedDay = normalizeDateKey(existing.streak_started_day) || lastTradeDay;
  }

  if (currentStreakDays > longestStreakDays) {
    longestStreakDays = currentStreakDays;
    longestStreakStartedDay = streakStartedDay;
    longestStreakEndedDay = tradeDay;
  }

  return upsertTradeStreakState(client, userId, {
    current_streak_days: currentStreakDays,
    longest_streak_days: longestStreakDays,
    last_trade_day: tradeDay,
    streak_started_day: streakStartedDay,
    longest_streak_started_day: longestStreakStartedDay,
    longest_streak_ended_day: longestStreakEndedDay,
  }, fill.id);
}

async function rebuildUserTradeStreak(pool, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await rebuildUserTradeStreakWithClient(client, userId);
    await client.query("COMMIT");
    return state;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getUserTradeStreak(pool, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      user_id,
      current_streak_days,
      longest_streak_days,
      last_trade_day,
      last_trade_fill_id,
      streak_started_day,
      longest_streak_started_day,
      longest_streak_ended_day,
      updated_at
    FROM market.user_trade_streaks
    WHERE user_id = $1
    LIMIT 1
  `,
    [userId]
  );

  if (rows[0]) {
    return rows[0];
  }

  const tradeCheck = await pool.query(
    `
    SELECT 1
    FROM market.trade_fills
    WHERE user_id = $1
    LIMIT 1
  `,
    [userId]
  );
  if (!tradeCheck.rows[0]) {
    return {
      user_id: userId,
      current_streak_days: 0,
      longest_streak_days: 0,
      last_trade_day: null,
      last_trade_fill_id: null,
      streak_started_day: null,
      longest_streak_started_day: null,
      longest_streak_ended_day: null,
      updated_at: null,
    };
  }

  return rebuildUserTradeStreak(pool, userId);
}

module.exports = {
  applyTradeFillToStreakWithClient,
  buildStreakStateFromTradeDays,
  getUserTradeStreak,
  normalizeDateKey,
  rebuildUserTradeStreak,
  rebuildUserTradeStreakWithClient,
};
