const predictionSettlement = require("./predictionSettlement");
const { publishPredictionMarketEvent } = require("./predictionMarketEvents");

const SCHEDULER_LOCK_KEY = 9_204_102;
const DEFAULT_INTERVAL_MS = 60_000;

function loadPredictionSchedulerConfig() {
  const parsedInterval = Number.parseInt(String(process.env.PREDICTION_MARKET_SCHEDULER_INTERVAL_MS || DEFAULT_INTERVAL_MS), 10);
  return {
    enabled: (process.env.PREDICTION_MARKET_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
    intervalMs: Number.isFinite(parsedInterval) && parsedInterval >= 10_000 ? parsedInterval : DEFAULT_INTERVAL_MS,
    batchLimit: 100,
  };
}

async function acquireSchedulerLock(client) {
  const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [SCHEDULER_LOCK_KEY]);
  return Boolean(rows[0]?.locked);
}

async function releaseSchedulerLock(client) {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEDULER_LOCK_KEY]);
  } catch {}
}

async function publishSchedulerMarkets(redis, action, markets) {
  for (const market of markets) {
    await publishPredictionMarketEvent(redis, {
      type: "prediction.market.updated",
      action,
      slug: market.slug,
      market_id: market.id,
      market,
    });
  }
}

async function runPredictionSchedulerCycle(pool, config = loadPredictionSchedulerConfig(), logger = console, redis = null) {
  const lockClient = await pool.connect();
  try {
    const locked = await acquireSchedulerLock(lockClient);
    if (!locked) {
      return { ok: true, skipped: "already_running" };
    }

    const now = new Date();
    const opened = await predictionSettlement.openDuePredictionMarkets(pool, {
      now,
      limit: config.batchLimit,
    });
    const closed = await predictionSettlement.closeDuePredictionMarkets(pool, {
      now,
      limit: config.batchLimit,
    });
    const resolving = await predictionSettlement.markDuePredictionMarketsResolving(pool, {
      now,
      limit: config.batchLimit,
    });

    await publishSchedulerMarkets(redis, "opened", opened);
    await publishSchedulerMarkets(redis, "closed", closed);
    await publishSchedulerMarkets(redis, "resolving", resolving);

    if (opened.length || closed.length || resolving.length) {
      logger.info?.("prediction scheduler cycle", {
        opened: opened.length,
        closed: closed.length,
        resolving: resolving.length,
      });
    }

    return {
      ok: true,
      opened_count: opened.length,
      closed_count: closed.length,
      resolving_count: resolving.length,
    };
  } catch (error) {
    logger.error?.("prediction scheduler cycle failed", error);
    throw error;
  } finally {
    await releaseSchedulerLock(lockClient);
    lockClient.release();
  }
}

function startPredictionScheduler(pool, logger = console, redis = null) {
  const config = loadPredictionSchedulerConfig();
  let running = false;

  async function tick() {
    if (!config.enabled || running) return;
    running = true;
    try {
      await runPredictionSchedulerCycle(pool, config, logger, redis);
    } catch {}
    running = false;
  }

  void tick();
  const interval = setInterval(tick, config.intervalMs);
  interval.unref?.();
  return interval;
}

module.exports = {
  loadPredictionSchedulerConfig,
  runPredictionSchedulerCycle,
  startPredictionScheduler,
};
