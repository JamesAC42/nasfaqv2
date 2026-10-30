const { listDefinitions } = require("./definitions");
const {
  applyTradeFillsToStreakWithClient,
  getUserTradeStreak,
  rebuildUserTradeStreakWithClient,
} = require("./streaks");
const { ensureUserCashAccount } = require("../portfolioCash");
const economy = require("../economy");
const notifications = require("../notifications");

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
    triggeredDefinitions.clear();
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

/**
 * What the definitions judge a player on. `trades: false` skips the aggregate over their whole fill
 * history (its fields read as zero); `streak` is their streak row when the caller already has it.
 */
async function loadAchievementFacts(client, userId, { trades = true, streak = null } = {}) {
  const [tradeResult, streakResult] = await Promise.all([
    trades
      ? client.query(
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
      )
      : { rows: [] },
    streak
      ? { rows: [streak] }
      : client.query(
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

// The active definitions per trigger, read once a minute rather than on every check: they change only
// when the code does (syncDefinitions at startup).
const DEFINITIONS_TTL_MS = 60_000;
const triggeredDefinitions = new Map(); // triggerEventType -> { at, definitions }

async function listTriggeredDefinitions(client, triggerEventType) {
  const cached = triggeredDefinitions.get(triggerEventType);
  if (cached && Date.now() - cached.at < DEFINITIONS_TTL_MS) return cached.definitions;
  const definitions = await readTriggeredDefinitions(client, triggerEventType);
  triggeredDefinitions.set(triggerEventType, { at: Date.now(), definitions });
  return definitions;
}

async function readTriggeredDefinitions(client, triggerEventType) {
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
        facts: codeDefinition.facts || null,
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

  // The reward lands in Credit or Cash by economy.SETTINGS.achievementRewards.
  const rewardCash = Number(award.reward_cash || 0);
  if (rewardCash > 0) {
    await economy.pay(client, userId, rewardCash, {
      to: economy.SETTINGS.achievementRewards,
      entryType: "achievement_reward",
      referenceType: "user_achievement",
      referenceId: award.id,
    });
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
  streak = null,
}) {
  const definitions = await listTriggeredDefinitions(client, triggerEventType);
  if (definitions.length === 0) {
    return { awarded: [] };
  }

  const earnedKeys = await listEarnedAchievementKeys(client, userId);
  // The trade facts aggregate the player's whole trade history, so load them only while something
  // that reads them is still to earn (after a hundred trades or so, only the streaks are left).
  const unearned = definitions.filter((definition) => !earnedKeys.has(`${definition.key}:${definition.version}`));
  if (unearned.length === 0) {
    return { awarded: [] };
  }
  const facts = await loadAchievementFacts(client, userId, {
    trades: unearned.some((definition) => definition.facts !== "streak"),
    streak,
  });
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
      name: definition.name,
      description: definition.description,
      reward_cash: award.reward_cash,
    });
    earnedKeys.add(earnedKey);
  }

  return { awarded, facts };
}

/**
 * One player's streak and achievement check after some fills (`fillIds`, oldest first; `since`, when
 * the oldest of them filled), in one transaction. Awards are thresholds on running totals, so one
 * check after several fills awards whatever a check after each of them would have.
 */
async function handleTradeFills(pool, { userId, fillIds, since = null }) {
  const lastFillId = fillIds.length ? fillIds[fillIds.length - 1] : null;
  const client = await pool.connect();
  let evaluationRunId = null;
  try {
    await client.query("BEGIN");
    evaluationRunId = await createEvaluationRun(client, {
      runType: "event",
      triggerEventType: "trade_fill",
      triggerEventId: lastFillId,
      targetUserId: userId,
      metadata: fillIds.length > 1 ? { fill_ids: fillIds } : {},
    });
    const streak = await applyTradeFillsToStreakWithClient(client, userId, { since });
    const result = await evaluateUserAchievementsWithClient(client, {
      userId,
      triggerEventType: "trade_fill",
      triggerEventId: lastFillId,
      evaluationRunId,
      streak,
    });
    await finishEvaluationRun(client, evaluationRunId, { status: "completed" });
    const noted = [];
    for (const award of result.awarded || []) {
      const reward = Number(award.reward_cash) > 0 ? ` +${notifications.money(award.reward_cash)} added to your cash.` : "";
      noted.push(
        await notifications.notify(
          client,
          userId,
          { kind: "achievement", title: `Achievement: ${award.name || award.key}`, body: `${award.description || ""}${reward}`.trim(), href: "/profile", data: { key: award.key } },
          { publish: false }
        )
      );
    }
    await client.query("COMMIT");
    notifications.publish(noted);
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

// Checks after fills wait here, by player, instead of each fill starting its own transaction the
// moment it committed with nothing waiting on it: a busy live-order batch used to stack a hundred of
// those on the scheduler pod's pool alongside the orders. ACHIEVEMENT_WORKER_CONCURRENCY workers
// (1 or 2, default 2) each check one player at a time, with every fill they have waiting. The batch
// holds the queue while it runs (holdTradeFills), so each player is checked once, after it. A
// failed check (a pool timeout, a deadlock) is tried again; checks read from the streak's last trade
// day, so one that still never runs is caught up by the player's next fill.
const fillQueue = {
  waiting: new Map(), // userId -> { pool, fillIds: Set, since, attempt }
  checking: new Set(),
  holds: 0,
  retrying: 0,
  idleWaiters: [],
  concurrency: Math.min(2, Math.max(1, Math.floor(Number(process.env.ACHIEVEMENT_WORKER_CONCURRENCY) || 2))),
  attempts: 3,
  retryDelayMs: 5_000,
};

function earlierOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) <= new Date(b) ? a : b;
}

function addToFillQueue(pool, userId, fillIds, since, attempt) {
  const entry = fillQueue.waiting.get(userId) || { pool, fillIds: new Set(), since: null, attempt: 0 };
  for (const fillId of fillIds) entry.fillIds.add(fillId);
  entry.since = earlierOf(entry.since, since);
  entry.attempt = Math.max(entry.attempt, attempt);
  fillQueue.waiting.set(userId, entry);
  pumpFillQueue();
}

/** After a fill commits: queue its owner's streak and achievement check. Never throws. */
function queueTradeFill(pool, { userId, fillId, filledAt = null }) {
  const id = Number(userId);
  if (!(id > 0)) return;
  addToFillQueue(pool, id, fillId ? [Number(fillId)] : [], filledAt ? new Date(filledAt) : null, 0);
}

/** Pauses the checks (a live-order batch, so it has the pool to itself); call the result to resume. */
function holdTradeFills() {
  fillQueue.holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fillQueue.holds -= 1;
    pumpFillQueue();
  };
}

function fillQueueIdle() {
  return fillQueue.waiting.size === 0 && fillQueue.checking.size === 0 && fillQueue.retrying === 0;
}

/** Resolves once every queued check has run (or given up): for shutdown and tests. */
function tradeFillsIdle() {
  if (fillQueueIdle()) return Promise.resolve();
  return new Promise((resolve) => fillQueue.idleWaiters.push(resolve));
}

function pumpFillQueue() {
  while (fillQueue.holds === 0 && fillQueue.checking.size < fillQueue.concurrency) {
    let next = null;
    for (const userId of fillQueue.waiting.keys()) {
      if (!fillQueue.checking.has(userId)) {
        next = userId;
        break;
      }
    }
    if (next === null) break;
    const entry = fillQueue.waiting.get(next);
    fillQueue.waiting.delete(next);
    fillQueue.checking.add(next);
    void runQueuedCheck(next, entry);
  }
  if (fillQueueIdle()) {
    for (const resolve of fillQueue.idleWaiters.splice(0)) resolve();
  }
}

async function runQueuedCheck(userId, entry) {
  const fillIds = [...entry.fillIds].sort((a, b) => a - b);
  try {
    await handleTradeFills(entry.pool, { userId, fillIds, since: entry.since });
  } catch (error) {
    const attempt = entry.attempt + 1;
    if (attempt < fillQueue.attempts) {
      fillQueue.retrying += 1;
      const timer = setTimeout(() => {
        fillQueue.retrying -= 1;
        addToFillQueue(entry.pool, userId, fillIds, entry.since, attempt);
      }, fillQueue.retryDelayMs);
      timer.unref?.();
    } else {
      // eslint-disable-next-line no-console
      console.error("achievement evaluation failed:", String(error?.message || error));
    }
  } finally {
    fillQueue.checking.delete(userId);
    pumpFillQueue();
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
        const streak = await rebuildUserTradeStreakWithClient(client, row.id);
        const result = await evaluateUserAchievementsWithClient(client, {
          userId: row.id,
          triggerEventType: "backfill",
          evaluationRunId,
          streak,
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
  handleTradeFills,
  holdTradeFills,
  listUserAchievements,
  queueTradeFill,
  syncDefinitions,
  tradeFillsIdle,
  _test: { fillQueue },
};
