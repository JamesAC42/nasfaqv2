const { performance } = require("node:perf_hooks");
const { invalidateMarketAssetsCache } = require("../marketCache");
const { publishMarketStatusEvent } = require("./marketEvents");
const fundamentals = require("./fundamentals");
const marketAdjustments = require("./marketAdjustments");
const marketAdmin = require("./marketAdmin");
const marketState = require("./marketState");
const settlement = require("./settlement");
const { acquireSchedulerLock, computeNextScheduledAt, getCurrentDateKey, loadSchedulerConfig, releaseSchedulerLock } = require("./marketScheduler");

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

/** Market history starts here on a rebuild (YouTube data from before it still feeds the first days' momentum). */
const DEFAULT_HISTORY_FROM = "2026-01-01";

function historyFrom(requested) {
  const value = String(requested || process.env.MARKET_HISTORY_FROM || DEFAULT_HISTORY_FROM).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw codedError("invalid_history_from");
  return value;
}

/**
 * Drops the market's own history from before the cutoff: settled days, reports, runs, adjustment
 * sessions and their ticks, snapshots and the chart events they made. Players' trades are never
 * touched (after a --reset there are none anyway).
 */
async function clearHistoryBefore(pool, from) {
  const cleared = {};
  const run = async (label, sql) => {
    const exists = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [label]);
    if (!exists.rows[0]?.ok) return;
    cleared[label] = (await pool.query(sql, [from])).rowCount;
  };
  await run("market.asset_adjustment_intervals", `DELETE FROM market.asset_adjustment_intervals i USING market.adjustment_sessions s WHERE i.session_id = s.id AND s.market_date < $1::date`);
  await run("market.adjustment_sessions", `DELETE FROM market.adjustment_sessions WHERE market_date < $1::date`);
  await run("market.asset_daily_market_state", `DELETE FROM market.asset_daily_market_state WHERE market_date < $1::date`);
  await run("market.daily_market_reports", `DELETE FROM market.daily_market_reports WHERE market_date < $1::date`);
  await run("market.market_settlement_runs", `DELETE FROM market.market_settlement_runs WHERE market_date < $1::date`);
  // Assets point at their latest snapshot; unhook any that point before the cutoff first.
  await run(
    "market.market_assets",
    `UPDATE market.market_assets SET latest_snapshot_id = NULL, latest_snapshot_date = NULL WHERE latest_snapshot_date < $1::date`
  );
  await run("market.channel_daily_snapshots", `DELETE FROM market.channel_daily_snapshots WHERE snapshot_date < $1::date`);
  await run(
    "market.asset_price_events",
    `DELETE FROM market.asset_price_events WHERE event_type IN ('daily_reset', 'interval_adjustment') AND ts < ($1::date::timestamp AT TIME ZONE 'America/New_York')`
  );
  return cleared;
}

const dayCount = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Rebuilds the whole market history from the YouTube data: fundamentals for every day, then each
 * day settled with its adjustments replayed at their scheduled times (settlement alone opens each
 * day at the previous close, so without the replay prices never move). Takes a minute or more on a
 * year of data, so callers run it in the background. `onProgress({ phase, done, total, market_date })`.
 */
async function runFullRebuild({ pool, redis = null }, { activeOnly = true, fillMissingDates = true, version = 1, from: requestedFrom = null } = {}, onProgress = () => {}) {
  const lockClient = await pool.connect();
  let locked = false;
  let adjustmentsLocked = false;
  try {
    locked = await acquireSchedulerLock(lockClient);
    if (!locked) throw codedError("scheduler_running");
    // The replay leaves past intervals briefly "scheduled"; the live adjustment scheduler must not
    // pick them up and apply them at today's time. Holding its lock makes its ticks skip.
    adjustmentsLocked = await marketAdjustments.acquireAdjustmentSchedulerLock(lockClient);
    if (!adjustmentsLocked) throw codedError("scheduler_running");

    const dataRange = await marketAdmin.getHistoricalMarketDateRange(pool, { activeOnly });
    if (!dataRange.from || !dataRange.to) throw codedError("no_historical_data");
    // The market starts at the cutoff (default 2026-01-01), or when the data does if that's later.
    const cutoff = historyFrom(requestedFrom);
    const range = { from: dataRange.from > cutoff ? dataRange.from : cutoff, to: dataRange.to };
    const clearedBefore = await clearHistoryBefore(pool, range.from);
    const schedulerConfig = loadSchedulerConfig();
    const latestReadyDate = getCurrentDateKey(new Date(), schedulerConfig.timeZone);
    if (!latestReadyDate || latestReadyDate < range.from) throw codedError("no_ready_historical_data");
    const total = dayCount(range.from, latestReadyDate);

    await onProgress({ phase: "fundamentals", done: 0, total, market_date: range.from });
    const bootstrap = await marketAdmin.bootstrapAssets(pool, { activeOnly, syncExisting: true });
    const fundamentalsResult = await fundamentals.recalculateFundamentals(pool, {
      from: range.from,
      to: latestReadyDate,
      version,
      activeOnly,
      fillMissingDates,
    });

    const startedAt = new Date();
    let adjustmentsApplied = 0;
    let done = 0;
    await onProgress({ phase: "settling", done, total, market_date: range.from });
    const settlementResult = await settlement.settleMarketRange(pool, {
      from: range.from,
      to: latestReadyDate,
      force: true,
      redis: null, // one socket event per replayed day would flood connected clients
      afterDay: async (day) => {
        const replayStarted = performance.now();
        const replay = await marketAdjustments.replayAdjustmentsForDate(pool, { marketDate: day.market_date, until: startedAt });
        adjustmentsApplied += replay.applied_count;
        done += 1;
        await onProgress({ phase: "settling", done, total, market_date: day.market_date,
          timings_ms: { ...day.timings_ms, replay: Math.round(performance.now() - replayStarted) } });
      },
    });

    const latestSettled = settlementResult.settled_dates[settlementResult.settled_dates.length - 1]?.market_date || null;
    // A market an admin closed stays closed (close, rebuild, check, reopen).
    const before = await marketState.getMarketStatusWithClient(lockClient);
    const nextScheduledSettlementAt = computeNextScheduledAt(new Date(), schedulerConfig).toISOString();
    const status =
      before?.trading_status === "manual_closed"
        ? await marketState.setMarketManualClosed(lockClient, { message: before.trading_message, nextScheduledSettlementAt, lastSettlementMarketDate: latestSettled })
        : await marketState.setMarketOpen(lockClient, { nextScheduledSettlementAt, lastSettlementMarketDate: latestSettled, clearError: true });
    void publishMarketStatusEvent(redis, status);
    await invalidateMarketAssetsCache(redis);

    return {
      ok: true,
      range: { from: range.from, to: latestReadyDate },
      bootstrap,
      fundamentals: fundamentalsResult,
      settlement: settlementResult,
      adjustments_applied: adjustmentsApplied,
      cleared_before: clearedBefore,
    };
  } finally {
    if (adjustmentsLocked) await marketAdjustments.releaseAdjustmentSchedulerLock(lockClient);
    if (locked) await releaseSchedulerLock(lockClient).catch(() => {});
    lockClient.release();
  }
}

module.exports = { clearHistoryBefore, runFullRebuild };
