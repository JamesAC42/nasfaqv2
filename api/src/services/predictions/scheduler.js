// Predictions v2 scheduler (docs/predictions/PREDICTIONS_DESIGN.md §4–6). Every cycle, under an
// advisory lock so only one API process runs it: open and close markets on schedule, settle
// undisputed proposals whose window ended, resolve and open auto markets, and sweep limit orders.

const auto = require("./auto");
const events = require("./events");
const resolution = require("./resolution");
const trading = require("./trading");

const LOCK_KEY = 9_204_103;
const DEFAULT_INTERVAL_MS = 30_000;

async function runCycle(pool, redis = null, logger = console) {
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
    if (!rows[0]?.ok) return { skipped: true };
    const steps = {};
    const step = async (name, fn) => {
      try {
        steps[name] = await fn();
      } catch (error) {
        steps[name] = [];
        logger.error?.(`prediction scheduler: ${name} failed`, error?.message || error);
      }
      return steps[name];
    };
    await events.publishMarkets(redis, "opened", await step("opened", () => resolution.openDueMarkets(pool)));
    await events.publishMarkets(redis, "closed", await step("closed", () => resolution.closeDueMarkets(pool)));
    await events.publishMarkets(redis, "resolved", await step("finalized", () => resolution.finalizeDueProposals(pool)));
    await events.publishMarkets(redis, "resolved", await step("auto_resolved", () => auto.resolveAutoMarkets(pool)));
    const generated = await step("auto", () => auto.runAutoTemplates(pool));
    if (generated && Object.values(generated).some((result) => result?.created)) await events.publishMarkets(redis, "created", [{ slug: null, id: null }]);
    await events.publishTrades(redis, await step("swept", () => trading.sweepAllMarkets(pool)));
    return steps;
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    lock.release();
  }
}

function startPredictionsScheduler(pool, logger = console, redis = null) {
  if ((process.env.PREDICTION_MARKET_SCHEDULER_ENABLED || "true").toLowerCase() === "false") return null;
  const interval = Math.max(10_000, Number(process.env.PREDICTION_MARKET_SCHEDULER_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runCycle(pool, redis, logger);
    } catch (error) {
      logger.error?.("prediction scheduler cycle failed", error?.message || error);
    } finally {
      running = false;
    }
  };
  // Hand legacy order-book markets over to the market maker before the first cycle.
  resolution
    .retireLegacyOrderBook(pool)
    .then((count) => count && logger.log?.(`predictions: moved ${count} legacy market(s) to the market maker`))
    .catch((error) => logger.error?.("predictions: legacy hand-off failed", error?.message || error))
    .finally(() => void tick());
  const timer = setInterval(tick, interval);
  timer.unref?.();
  return timer;
}

module.exports = { runCycle, startPredictionsScheduler };
