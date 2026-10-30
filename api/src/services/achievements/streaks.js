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

/**
 * The streak after trading on `tradeDays` (in order, repeats allowed), starting from `existing` (a
 * user_trade_streaks row): one fill at a time, the same steps a fill used to take on its own. Null
 * when a day comes before the streak's last trade day (a fill counted out of order), which only a
 * rebuild from the whole history gets right.
 */
function advanceStreakState(existing, tradeDays) {
  let state = {
    current_streak_days: Number(existing.current_streak_days || 0),
    longest_streak_days: Number(existing.longest_streak_days || 0),
    last_trade_day: normalizeDateKey(existing.last_trade_day),
    streak_started_day: normalizeDateKey(existing.streak_started_day),
    longest_streak_started_day: normalizeDateKey(existing.longest_streak_started_day),
    longest_streak_ended_day: normalizeDateKey(existing.longest_streak_ended_day),
  };

  for (const day of tradeDays) {
    const tradeDay = normalizeDateKey(day);
    const lastTradeDay = state.last_trade_day;
    if (!tradeDay || (lastTradeDay && tradeDay < lastTradeDay)) {
      return null;
    }
    if (!lastTradeDay) {
      state = {
        current_streak_days: 1,
        longest_streak_days: Math.max(1, state.longest_streak_days),
        last_trade_day: tradeDay,
        streak_started_day: tradeDay,
        longest_streak_started_day: state.longest_streak_started_day || tradeDay,
        longest_streak_ended_day: state.longest_streak_ended_day || tradeDay,
      };
      continue;
    }
    if (tradeDay === lastTradeDay) {
      state = {
        ...state,
        streak_started_day: state.streak_started_day || lastTradeDay,
        longest_streak_started_day: state.longest_streak_started_day || state.streak_started_day || lastTradeDay,
        longest_streak_ended_day: state.longest_streak_ended_day || lastTradeDay,
      };
      continue;
    }

    let currentStreakDays = 1;
    let longestStreakDays = state.longest_streak_days;
    let streakStartedDay = tradeDay;
    let longestStreakStartedDay = state.longest_streak_started_day || state.streak_started_day || lastTradeDay;
    let longestStreakEndedDay = state.longest_streak_ended_day || lastTradeDay;

    if (tradeDay === shiftDateByDays(lastTradeDay, 1)) {
      currentStreakDays = state.current_streak_days + 1;
      streakStartedDay = state.streak_started_day || lastTradeDay;
    }

    if (currentStreakDays > longestStreakDays) {
      longestStreakDays = currentStreakDays;
      longestStreakStartedDay = streakStartedDay;
      longestStreakEndedDay = tradeDay;
    }

    state = {
      current_streak_days: currentStreakDays,
      longest_streak_days: longestStreakDays,
      last_trade_day: tradeDay,
      streak_started_day: streakStartedDay,
      longest_streak_started_day: longestStreakStartedDay,
      longest_streak_ended_day: longestStreakEndedDay,
    };
  }

  return state;
}

/**
 * Brings a player's streak up to date with their fills: one read of the streak row, one of the fills
 * from its last trade day on (or from `since`, when the earliest fill waiting to be counted filled,
 * if that's earlier), one write. Reading from the last trade day means a fill whose check never ran
 * (a restart mid-queue) is still counted by the next one; a day already counted changes nothing.
 * Fills are read by (user_id, ts): trade_fills has no index on id alone, so the old lookup of one
 * fill by id walked the player's whole history.
 */
async function applyTradeFillsToStreakWithClient(client, userId, { since = null } = {}) {
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
  const lastTradeDay = normalizeDateKey(existing?.last_trade_day);
  if (!existing || (!lastTradeDay && !since)) {
    return rebuildUserTradeStreakWithClient(client, userId);
  }

  // LEAST skips a NULL: no last trade day reads from `since`, no `since` from the last trade day.
  const { rows: fills } = await client.query(
    `
    SELECT tf.id, tf.ts::date AS trade_day
    FROM market.trade_fills tf
    WHERE tf.user_id = $1
      AND tf.ts >= LEAST($2::date::timestamptz, $3::timestamptz)
    ORDER BY tf.ts ASC, tf.id ASC
  `,
    [userId, lastTradeDay, since]
  );
  if (fills.length === 0) {
    return existing;
  }

  const state = advanceStreakState(existing, fills.map((fill) => fill.trade_day));
  if (!state) {
    return rebuildUserTradeStreakWithClient(client, userId);
  }
  return upsertTradeStreakState(client, userId, state, fills[fills.length - 1].id);
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
  advanceStreakState,
  applyTradeFillsToStreakWithClient,
  buildStreakStateFromTradeDays,
  getUserTradeStreak,
  normalizeDateKey,
  rebuildUserTradeStreak,
  rebuildUserTradeStreakWithClient,
};
