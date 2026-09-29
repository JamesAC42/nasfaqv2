const rebuildJobs = require("../services/rebuildJobs");
const express = require("express");
const { invalidateMarketAssetsCache } = require("../marketCache");
const { publishMarketStatusEvent } = require("../services/marketEvents");
const fundamentals = require("../services/fundamentals");
const marketAdjustments = require("../services/marketAdjustments");
const marketAdmin = require("../services/marketAdmin");
const marketRebuild = require("../services/marketRebuild");
const marketState = require("../services/marketState");
const settlement = require("../services/settlement");
const trading = require("../services/trading");
const weeklyEvaluation = require("../services/weeklyEvaluation");
const { requireAdmin } = require("../userContext");
const {
  acquireSchedulerLock,
  computeNextScheduledAt,
  loadSchedulerConfig,
  releaseSchedulerLock,
  runScheduledCycle,
} = require("../services/marketScheduler");

const router = express.Router();

// Every internal market route changes or exposes market state (open/close, settle, ticks, resets),
// so all of them are admin only. Nothing outside the API calls these; production also blocks
// /internal at the ingress (DEPLOYMENT.md §5), this is the route-level guard on top of that.
router.use((req, res, next) => {
  if (!req.ctx?.user) return res.status(401).json({ error: "unauthenticated" });
  if (!req.ctx.user.is_admin) return res.status(403).json({ error: "forbidden" });
  return next();
});

function optionalDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const trimmed = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function hasConfirmation(req, expected) {
  return String(req.body?.confirmation || "").trim() === expected;
}

router.get("/jobs", async (req, res, next) => {
  try {
    const jobs = await fundamentals.listFundamentalsJobs(req.ctx.pool);
    res.json(jobs);
  } catch (e) {
    next(e);
  }
});

router.get("/status", async (req, res, next) => {
  try {
    const status = await marketState.getMarketStatus(req.ctx.pool);
    res.json(status || {});
  } catch (e) {
    next(e);
  }
});

// Halting trading by hand. While closed: buys and sells are refused with the message, queued live
// orders wait (they fill in the first batch after reopening), the daily settlement waits (the
// scheduler catches up within a minute of reopening), and prices keep following fair value.
router.post("/close", async (req, res, next) => {
  const client = await req.ctx.pool.connect();
  let locked = false;
  try {
    requireAdmin(req);
    // Not in the middle of a settlement: it would reopen the market when it finishes.
    locked = await acquireSchedulerLock(client);
    if (!locked) return res.status(409).json({ error: "market_settling" });
    const current = await marketState.getMarketStatusWithClient(client);
    if (current?.trading_status === "settling") return res.status(409).json({ error: "market_settling" });
    const message = String(req.body?.message || "").trim().slice(0, 280) || "Trading is paused for maintenance. Back soon.";
    const schedulerConfig = loadSchedulerConfig();
    const status = await marketState.setMarketManualClosed(client, {
      message,
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
    });
    void publishMarketStatusEvent(req.ctx.redis, status);
    res.json({ ok: true, status });
  } catch (e) {
    next(e);
  } finally {
    if (locked) await releaseSchedulerLock(client);
    client.release();
  }
});

router.post("/open", async (req, res, next) => {
  const client = await req.ctx.pool.connect();
  try {
    requireAdmin(req);
    const current = await marketState.getMarketStatusWithClient(client);
    if (current && current.trading_status !== "manual_closed") return res.status(409).json({ error: "market_not_closed", status: current });
    const schedulerConfig = loadSchedulerConfig();
    const status = await marketState.setMarketOpen(client, {
      message: req.body?.message ? String(req.body.message).trim().slice(0, 280) || null : null,
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
    });
    void publishMarketStatusEvent(req.ctx.redis, status);
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json({ ok: true, status });
  } catch (e) {
    next(e);
  } finally {
    client.release();
  }
});

router.post("/run-daily-cycle", async (req, res, next) => {
  try {
    const schedulerConfig = loadSchedulerConfig();
    const result = await runScheduledCycle(req.ctx.pool, schedulerConfig, console, req.ctx.redis);
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json({ ok: true, result });
  } catch (e) {
    next(e);
  }
});

router.post("/bootstrap-assets", async (req, res, next) => {
  try {
    const activeOnly = req.body?.active_only === undefined ? true : Boolean(req.body.active_only);
    const syncExisting = req.body?.sync_existing === undefined ? true : Boolean(req.body.sync_existing);

    const result = await marketAdmin.bootstrapAssets(req.ctx.pool, {
      activeOnly,
      syncExisting,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);

    res.json({ ok: true, result });
  } catch (e) {
    next(e);
  }
});

router.get("/invariants", async (req, res, next) => {
  try {
    const result = await marketAdmin.checkInvariants(req.ctx.pool);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/reset", async (req, res, next) => {
  try {
    requireAdmin(req);
    if (!hasConfirmation(req, "reset")) return res.status(400).json({ error: "invalid_confirmation" });
    const result = await marketAdmin.resetMarketState(req.ctx.pool);
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// The weekly evaluation by hand (normally Saturday 00:00 ET on its own). Body: { eval_date?, dry_run? }.
// Each date runs once; a finished one is never re-run (it would pay twice).
router.post("/weekly-evaluation/run", async (req, res, next) => {
  try {
    const dryRun = Boolean(req.body?.dry_run);
    const evalDate =
      req.body?.eval_date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.eval_date)
        ? req.body.eval_date
        : dryRun
          ? await weeklyEvaluation.pendingEvaluationDate(req.ctx.pool)
          : weeklyEvaluation.evaluationDateFor();
    const result = await weeklyEvaluation.runWeeklyEvaluation(req.ctx.pool, { evalDate, dryRun, redis: req.ctx.redis });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// An evaluation right now, for playtests: dividends, fees, max shares and buybacks without waiting
// for Saturday. It runs under today's New York date, so it still runs once (a second press the same
// day is refused, and the Saturday run is a different date). Body: { dry_run?, confirmation: "evaluate" }.
router.post("/weekly-evaluation/run-now", async (req, res, next) => {
  try {
    const dryRun = Boolean(req.body?.dry_run);
    if (!dryRun && !hasConfirmation(req, "evaluate")) return res.status(400).json({ error: "invalid_confirmation" });
    const evalDate = weeklyEvaluation.todayInNewYork();
    const result = await weeklyEvaluation.runWeeklyEvaluation(req.ctx.pool, { evalDate, dryRun, onDemand: true, redis: req.ctx.redis });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/settle/:date", async (req, res, next) => {
  const client = await req.ctx.pool.connect();
  try {
    const marketDate = optionalDate(req.params.date);
    if (!marketDate) return res.status(400).json({ error: "invalid_market_date" });

    const force = Boolean(req.body?.force);
    const result = await settlement.settleMarketDay(req.ctx.pool, { marketDate, force, redis: req.ctx.redis });
    const adjustmentSession = await marketAdjustments.ensureAdjustmentSession(req.ctx.pool, {
      marketDate: result.market_date,
      force: Boolean(req.body?.force_adjustments),
    });
    const schedulerConfig = loadSchedulerConfig();
    const status = await marketState.setMarketOpen(client, {
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
      lastSettlementMarketDate: result.market_date,
      clearError: true,
    });
    void publishMarketStatusEvent(req.ctx.redis, status);
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json({ ...result, adjustment_session: adjustmentSession });
  } catch (e) {
    if (e?.code === "settlement_already_completed") {
      return res.status(409).json({ error: "settlement_already_completed" });
    }
    if (e?.code === "missing_completed_snapshot") {
      return res.status(409).json({ error: "missing_completed_snapshot" });
    }
    if (e?.code === "invalid_fair_value") {
      return res.status(409).json({ error: "invalid_fair_value" });
    }
    next(e);
  } finally {
    client.release();
  }
});

router.post("/settle-range", async (req, res, next) => {
  const client = await req.ctx.pool.connect();
  try {
    const from = optionalDate(req.body?.from);
    const to = optionalDate(req.body?.to);
    if (!from) return res.status(400).json({ error: "invalid_from_date" });
    if (!to) return res.status(400).json({ error: "invalid_to_date" });

    const force = Boolean(req.body?.force);
    const result = await settlement.settleMarketRange(req.ctx.pool, { from, to, force, redis: req.ctx.redis });
    const latestSettled = result.settled_dates[result.settled_dates.length - 1]?.market_date || null;
    const adjustmentSession = latestSettled
      ? await marketAdjustments.ensureAdjustmentSession(req.ctx.pool, {
          marketDate: latestSettled,
          force: Boolean(req.body?.force_adjustments),
        })
      : null;
    const schedulerConfig = loadSchedulerConfig();
    const status = await marketState.setMarketOpen(client, {
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
      lastSettlementMarketDate: latestSettled,
      clearError: true,
    });
    void publishMarketStatusEvent(req.ctx.redis, status);
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json({ ...result, adjustment_session: adjustmentSession });
  } catch (e) {
    if (e?.code === "settlement_already_completed") {
      return res.status(409).json({ error: "settlement_already_completed" });
    }
    if (e?.code === "missing_completed_snapshot") {
      return res.status(409).json({ error: "missing_completed_snapshot" });
    }
    if (e?.code === "invalid_fair_value") {
      return res.status(409).json({ error: "invalid_fair_value" });
    }
    next(e);
  } finally {
    client.release();
  }
});

router.post("/adjustments/generate/:date", async (req, res, next) => {
  try {
    const marketDate = optionalDate(req.params.date);
    if (!marketDate) return res.status(400).json({ error: "invalid_market_date" });

    const result = await marketAdjustments.ensureAdjustmentSession(req.ctx.pool, {
      marketDate,
      force: Boolean(req.body?.force),
    });
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json({ ok: true, result });
  } catch (e) {
    next(e);
  }
});

router.post("/adjustments/apply-due", async (req, res, next) => {
  try {
    const limit = Number.parseInt(String(req.body?.limit || "250"), 10);
    const result = await marketAdjustments.applyDueAdjustments(req.ctx.pool, {
      limit: Number.isFinite(limit) ? Math.min(1000, Math.max(1, limit)) : 250,
      redis: req.ctx.redis,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/live-orders/apply-due", async (req, res, next) => {
  try {
    const limit = Number.parseInt(String(req.body?.limit || "100"), 10);
    const result = await trading.processDueLiveOrders(req.ctx.pool, {
      limit: Number.isFinite(limit) ? Math.min(1000, Math.max(1, limit)) : 100,
      redis: req.ctx.redis,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// All API replicas read the same job; its session lock fences concurrent rebuilds.
router.get("/rebuild-full", async (req, res, next) => {
  try {
    const id = req.query.id || null;
    if (id && (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return res.status(400).json({ error: "invalid_job_id" });
    res.set("Cache-Control", "no-store");
    res.json({ job: await rebuildJobs.getJob(req.ctx.pool, id) });
  } catch (error) { next(error); }
});

router.post("/rebuild-full", async (req, res, next) => {
  try {
    requireAdmin(req);
    if (!hasConfirmation(req, "rebuild")) return res.status(400).json({ error: "invalid_confirmation" });
    const activeOnly = req.body?.active_only === undefined ? true : Boolean(req.body.active_only);
    const fillMissingDates = req.body?.fill_missing_dates === undefined ? true : Boolean(req.body.fill_missing_dates);
    const version = Number.parseInt(String(req.body?.version ?? "1"), 10);
    if (!Number.isFinite(version) || version < 1) return res.status(400).json({ error: "invalid_version" });
    const options = { activeOnly, fillMissingDates, version, from: typeof req.body?.from === "string" ? req.body.from : null };
    const { pool, redis } = req.ctx;
    const job = await rebuildJobs.startJob(pool, async onProgress => {
      const result = await marketRebuild.runFullRebuild({ pool, redis }, options, onProgress);
      return {
        range: result.range,
        fundamentals: { snapshots_processed: result.fundamentals?.snapshots_processed ?? null, failed_snapshots: result.fundamentals?.failed_snapshots ?? null },
        settlement: { settled_count: result.settlement.settled_count, skipped_dates: result.settlement.skipped_dates.slice(0, 20) },
        adjustments_applied: result.adjustments_applied,
      };
    });
    res.status(202).json({ job });
  } catch (error) {
    if (error.code === "rebuild_running") return res.status(409).json({ error: error.code, job: error.job });
    next(error);
  }
});

router.post("/recalculate-fundamentals", async (req, res, next) => {
  try {
    const from = optionalDate(req.body?.from);
    const to = optionalDate(req.body?.to);
    const version = Number.parseInt(String(req.body?.version ?? "1"), 10);
    const channelId = req.body?.channel_id ? String(req.body.channel_id).trim() : null;
    const activeOnly = Boolean(req.body?.active_only);
    const fillMissingDates = req.body?.fill_missing_dates === undefined ? true : Boolean(req.body.fill_missing_dates);

    if (req.body?.from && !from) return res.status(400).json({ error: "invalid_from_date" });
    if (req.body?.to && !to) return res.status(400).json({ error: "invalid_to_date" });
    if (!Number.isFinite(version) || version < 1) return res.status(400).json({ error: "invalid_version" });

    const result = await fundamentals.recalculateFundamentals(req.ctx.pool, {
      from,
      to,
      version,
      channelId,
      activeOnly,
      fillMissingDates,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);

    res.json({ ok: true, result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
