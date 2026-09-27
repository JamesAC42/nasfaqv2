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

const dayCount = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Rebuilds the whole market history from the YouTube data: fundamentals for every day, then each
 * day settled with its adjustments replayed at their scheduled times (settlement alone opens each
 * day at the previous close, so without the replay prices never move). Takes a minute or more on a
 * year of data, so callers run it in the background. `onProgress({ phase, done, total, market_date })`.
 */
async function runFullRebuild({ pool, redis = null }, { activeOnly = true, fillMissingDates = true, version = 1 } = {}, onProgress = () => {}) {
  const lockClient = await pool.connect();
  let locked = false;
  try {
    locked = await acquireSchedulerLock(lockClient);
    if (!locked) throw codedError("scheduler_running");

    const range = await marketAdmin.getHistoricalMarketDateRange(pool, { activeOnly });
    if (!range.from || !range.to) throw codedError("no_historical_data");
    const schedulerConfig = loadSchedulerConfig();
    const latestReadyDate = getCurrentDateKey(new Date(), schedulerConfig.timeZone);
    if (!latestReadyDate || latestReadyDate < range.from) throw codedError("no_ready_historical_data");
    const total = dayCount(range.from, latestReadyDate);

    onProgress({ phase: "fundamentals", done: 0, total, market_date: range.from });
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
    onProgress({ phase: "settling", done, total, market_date: range.from });
    const settlementResult = await settlement.settleMarketRange(pool, {
      from: range.from,
      to: latestReadyDate,
      force: true,
      redis: null, // one socket event per replayed day would flood connected clients
      afterDay: async (day) => {
        const replay = await marketAdjustments.replayAdjustmentsForDate(pool, { marketDate: day.market_date, until: startedAt });
        adjustmentsApplied += replay.applied_count;
        done += 1;
        onProgress({ phase: "settling", done, total, market_date: day.market_date });
      },
    });

    const latestSettled = settlementResult.settled_dates[settlementResult.settled_dates.length - 1]?.market_date || null;
    const status = await marketState.setMarketOpen(lockClient, {
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
      lastSettlementMarketDate: latestSettled,
      clearError: true,
    });
    void publishMarketStatusEvent(redis, status);
    await invalidateMarketAssetsCache(redis);

    return {
      ok: true,
      range: { from: range.from, to: latestReadyDate },
      bootstrap,
      fundamentals: fundamentalsResult,
      settlement: settlementResult,
      adjustments_applied: adjustmentsApplied,
    };
  } finally {
    if (locked) await releaseSchedulerLock(lockClient).catch(() => {});
    lockClient.release();
  }
}

module.exports = { runFullRebuild };
