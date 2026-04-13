const { listDefinitions } = require("./definitions");
const {
  applyTradeFillToStreakWithClient,
  getUserTradeStreak,
  rebuildUserTradeStreakWithClient,
} = require("./streaks");
const { ensureUserCashAccount } = require("../portfolioCash");

async function syncDefinitions(pool) {
  const definitions = listDefinitions();
  if (definitions.length === 0) return [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const definition of definitions) {
      await client.query(
        `
        INSERT INTO market.achievement_definitions (
          key,
          version,
          category,
          name,
          description,
          badge_icon,
          badge_color,
          reward_cash,
          is_active,
          is_backfill_enabled,
          trigger_events,
          rule_json,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,$9,$10,now())
        ON CONFLICT (key)
        DO UPDATE SET
          version = EXCLUDED.version,
          category = EXCLUDED.category,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          badge_icon = EXCLUDED.badge_icon,
          badge_color = EXCLUDED.badge_color,
          reward_cash = EXCLUDED.reward_cash,
          trigger_events = EXCLUDED.trigger_events,
          rule_json = EXCLUDED.rule_json,
          updated_at = now()
      `,
        [
          definition.key,
          definition.version,
          definition.category,
          definition.name,
          definition.description,
          definition.badge_icon,
          definition.badge_color,
          definition.reward_cash,
          definition.trigger_events,
          JSON.stringify(definition.rule_json || {}),
        ]
      );
    }
    await client.query("COMMIT");
    return definitions;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createEvaluationRun(client, { runType, triggerEventType, triggerEventId = null, targetUserId = null, metadata = {} }) {
  const { rows } = await client.query(
    `
    INSERT INTO market.achievement_evaluation_runs (
      run_type,
      trigger_event_type,
      trigger_event_id,
      target_user_id,
      status,
      metadata_json
    ) VALUES ($1,$2,$3,$4,'started',$5)
    RETURNING id
  `,
    [runType, triggerEventType, triggerEventId, targetUserId, JSON.stringify(metadata || {})]
  );
  return rows[0]?.id || null;
}

async function finishEvaluationRun(client, runId, { status, errorText = null }) {
  if (!runId) return;
  await client.query(
    `
    UPDATE market.achievement_evaluation_runs
    SET
      status = $2,
      completed_at = now(),
      error_text = $3
    WHERE id = $1
  `,
    [runId, status, errorText]
  );
}

async function loadAchievementFacts(client, userId) {
  const [tradeResult, streakResult] = await Promise.all([
    client.query(
      `
      SELECT
        COUNT(*)::int AS trade_count,
        COUNT(*) FILTER (WHERE side = 'buy')::int AS buy_count,
        COUNT(*) FILTER (WHERE side = 'sell')::int AS sell_count,
        COUNT(DISTINCT asset_id)::int AS distinct_assets_traded,
        COUNT(DISTINCT ts::date)::int AS trade_days_count,
        MIN(ts) AS first_trade_at,
        COALESCE(MAX(gross_cash), 0) AS largest_trade_cash
      FROM market.trade_fills
      WHERE user_id = $1
    `,
      [userId]
    ),
    client.query(
      `
      SELECT
        current_streak_days,
        longest_streak_days,
        last_trade_day
      FROM market.user_trade_streaks
      WHERE user_id = $1
      LIMIT 1
    `,
      [userId]
    ),
  ]);

  const tradeRow = tradeResult.rows[0] || {};
  const streakRow = streakResult.rows[0] || {};

  return {
    trade_count: Number(tradeRow.trade_count || 0),
    buy_count: Number(tradeRow.buy_count || 0),
    sell_count: Number(tradeRow.sell_count || 0),
    distinct_assets_traded: Number(tradeRow.distinct_assets_traded || 0),
    trade_days_count: Number(tradeRow.trade_days_count || 0),
    first_trade_at: tradeRow.first_trade_at || null,
    largest_trade_cash: Number(tradeRow.largest_trade_cash || 0),
    current_streak_days: Number(streakRow.current_streak_days || 0),
    longest_streak_days: Number(streakRow.longest_streak_days || 0),
    last_trade_day: streakRow.last_trade_day || null,
  };
}

async function listTriggeredDefinitions(client, triggerEventType) {
  const definitionByKey = new Map(listDefinitions().map((definition) => [definition.key, definition]));
  const { rows } = await client.query(
    `
    SELECT
      id,
      key,
      version,
      category,
      name,
      description,
      badge_icon,
      badge_color,
      reward_cash,
      trigger_events,
      rule_json
    FROM market.achievement_definitions
    WHERE is_active = true
      AND ($1 = ANY(trigger_events))
    ORDER BY id ASC
  `,
    [triggerEventType]
  );

  return rows
    .map((row) => {
      const codeDefinition = definitionByKey.get(row.key);
      if (!codeDefinition) return null;
      return {
        ...row,
        evaluate: codeDefinition.evaluate,
      };
    })
    .filter(Boolean);
}

async function listEarnedAchievementKeys(client, userId) {
  const { rows } = await client.query(
    `
    SELECT achievement_key, achievement_version
    FROM market.user_achievements
    WHERE user_id = $1
  `,
    [userId]
  );
  return new Set(rows.map((row) => `${row.achievement_key}:${row.achievement_version}`));
}

async function awardAchievement(client, {
  userId,
  definition,
  sourceEventType,
  sourceEventId = null,
  evaluationRunId = null,
  progress = {},
}) {
  const cashAccount = await ensureUserCashAccount(client, userId);
  const { rows } = await client.query(
    `
    INSERT INTO market.user_achievements (
      user_id,
      achievement_definition_id,
      achievement_key,
      achievement_version,
      earned_at,
      reward_cash,
      source_event_type,
      source_event_id,
      evaluation_run_id,
      progress_json
    ) VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9)
    ON CONFLICT (user_id, achievement_key, achievement_version) DO NOTHING
    RETURNING id, reward_cash
  `,
    [
      userId,
      definition.id,
      definition.key,
      definition.version,
      definition.reward_cash,
      sourceEventType,
      sourceEventId,
      evaluationRunId,
      JSON.stringify(progress || {}),
    ]
  );
  const award = rows[0] || null;
  if (!award) {
    return null;
  }

  const rewardCash = Number(award.reward_cash || 0);
  if (rewardCash > 0) {
    await client.query(
      `
      UPDATE market.portfolio_cash_balances
      SET cash_balance = cash_balance + $2, updated_at = now()
      WHERE user_id = $1
    `,
      [userId, rewardCash]
    );
    await client.query(
      `
      INSERT INTO market.ledger_entries (
        user_id,
        asset_id,
        entry_type,
        quantity_delta,
        cash_delta,
        reference_type,
        reference_id
      ) VALUES ($1, NULL, 'achievement_reward', 0, $2, 'user_achievement', $3)
    `,
      [userId, rewardCash, award.id]
    );
  }

  return {
    id: award.id,
    reward_cash: rewardCash,
    previous_cash_balance: Number(cashAccount.cash_balance || 0),
  };
}

async function evaluateUserAchievementsWithClient(client, {
  userId,
  triggerEventType,
  triggerEventId = null,
  evaluationRunId = null,
}) {
  const definitions = await listTriggeredDefinitions(client, triggerEventType);
  if (definitions.length === 0) {
    return { awarded: [] };
  }

  const earnedKeys = await listEarnedAchievementKeys(client, userId);
  const facts = await loadAchievementFacts(client, userId);
  const awarded = [];

  for (const definition of definitions) {
    const earnedKey = `${definition.key}:${definition.version}`;
    if (earnedKeys.has(earnedKey)) {
      continue;
    }

    const result = await Promise.resolve(
      definition.evaluate({
        client,
        userId,
        triggerEventType,
        triggerEventId,
        facts,
        definition,
      })
    );
    if (!result?.earned) {
      continue;
    }

    const award = await awardAchievement(client, {
      userId,
      definition,
      sourceEventType: triggerEventType,
      sourceEventId: triggerEventId,
      evaluationRunId,
      progress: result.progress || {},
    });
    if (!award) {
      continue;
    }

    awarded.push({
      key: definition.key,
      version: definition.version,
      reward_cash: award.reward_cash,
    });
    earnedKeys.add(earnedKey);
  }

  return { awarded, facts };
}

async function handleTradeFill(pool, { userId, fillId }) {
  const client = await pool.connect();
  let evaluationRunId = null;
  try {
    await client.query("BEGIN");
    evaluationRunId = await createEvaluationRun(client, {
      runType: "event",
      triggerEventType: "trade_fill",
      triggerEventId: fillId,
      targetUserId: userId,
    });
    await applyTradeFillToStreakWithClient(client, userId, fillId);
    const result = await evaluateUserAchievementsWithClient(client, {
      userId,
      triggerEventType: "trade_fill",
      triggerEventId: fillId,
      evaluationRunId,
    });
    await finishEvaluationRun(client, evaluationRunId, { status: "completed" });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (evaluationRunId) {
      try {
        await finishEvaluationRun(client, evaluationRunId, {
          status: "failed",
          errorText: String(error?.message || error),
        });
      } catch {}
    }
    throw error;
  } finally {
    client.release();
  }
}

async function backfillAchievements(pool, { userIds = null, batchSize = 100 } = {}) {
  const ids = Array.isArray(userIds) && userIds.length > 0
    ? userIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : null;

  if (ids && ids.length === 0) {
    return { processed_users: 0, awarded_count: 0 };
  }

  let processedUsers = 0;
  let awardedCount = 0;
  let offset = 0;

  while (true) {
    const params = [];
    let where = "";
    if (ids) {
      params.push(ids);
      where = `WHERE id = ANY($${params.length}::bigint[])`;
    }
    params.push(batchSize, offset);

    const { rows } = await pool.query(
      `
      SELECT id
      FROM market.users
      ${where}
      ORDER BY id ASC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
      params
    );

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const client = await pool.connect();
      let evaluationRunId = null;
      try {
        await client.query("BEGIN");
        evaluationRunId = await createEvaluationRun(client, {
          runType: "backfill",
          triggerEventType: "backfill",
          targetUserId: row.id,
        });
        await rebuildUserTradeStreakWithClient(client, row.id);
        const result = await evaluateUserAchievementsWithClient(client, {
          userId: row.id,
          triggerEventType: "backfill",
          evaluationRunId,
        });
        awardedCount += result.awarded.length;
        processedUsers += 1;
        await finishEvaluationRun(client, evaluationRunId, { status: "completed" });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        if (evaluationRunId) {
          try {
            await finishEvaluationRun(client, evaluationRunId, {
              status: "failed",
              errorText: String(error?.message || error),
            });
          } catch {}
        }
        throw error;
      } finally {
        client.release();
      }
    }

    offset += rows.length;
  }

  return {
    processed_users: processedUsers,
    awarded_count: awardedCount,
  };
}

async function listUserAchievements(pool, userId, { limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const { rows } = await pool.query(
    `
    SELECT
      ua.id,
      ua.achievement_key AS key,
      ua.achievement_version AS version,
      ua.earned_at,
      ua.reward_cash,
      ua.progress_json,
      ad.category,
      ad.name,
      ad.description,
      ad.badge_icon,
      ad.badge_color
    FROM market.user_achievements ua
    JOIN market.achievement_definitions ad
      ON ad.id = ua.achievement_definition_id
    WHERE ua.user_id = $1
    ORDER BY ua.earned_at DESC, ua.id DESC
    LIMIT $2
  `,
    [userId, safeLimit]
  );
  return rows;
}

module.exports = {
  backfillAchievements,
  getUserTradeStreak,
  handleTradeFill,
  listUserAchievements,
  syncDefinitions,
};
