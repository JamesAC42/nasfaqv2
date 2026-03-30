const express = require("express");
const { invalidateMarketAssetsCache } = require("../marketCache");
const fundamentals = require("../services/fundamentals");
const marketAdmin = require("../services/marketAdmin");
const marketState = require("../services/marketState");
const settlement = require("../services/settlement");
const {
  acquireSchedulerLock,
  computeNextScheduledAt,
  getCurrentDateKey,
  loadSchedulerConfig,
  releaseSchedulerLock,
  runScheduledCycle,
} = require("../services/marketScheduler");

const router = express.Router();

function optionalDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const trimmed = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
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

router.post("/close", async (req, res, next) => {
  const client = await req.ctx.pool.connect();
  try {
    const schedulerConfig = loadSchedulerConfig();
    const status = await marketState.setMarketManualClosed(client, {
      message: req.body?.message ? String(req.body.message) : "Market manually closed for maintenance.",
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
    });
    res.json({ ok: true, status });
  } catch (e) {
    next(e);
  } finally {
    client.release();
  }
});

router.post("/open", async (req, res, next) => {
  const client = await req.ctx.pool.connect();
  try {
    const schedulerConfig = loadSchedulerConfig();
    const status = await marketState.setMarketOpen(client, {
      message: req.body?.message ? String(req.body.message) : "Market reopened.",
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
    });
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
    const result = await runScheduledCycle(req.ctx.pool, schedulerConfig, console);
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
    const result = await marketAdmin.resetMarketState(req.ctx.pool);
    await invalidateMarketAssetsCache(req.ctx.redis);
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
    const result = await settlement.settleMarketDay(req.ctx.pool, { marketDate, force });
    const schedulerConfig = loadSchedulerConfig();
    await marketState.setMarketOpen(client, {
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
      lastSettlementMarketDate: result.market_date,
      clearError: true,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json(result);
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
    const result = await settlement.settleMarketRange(req.ctx.pool, { from, to, force });
    const latestSettled = result.settled_dates[result.settled_dates.length - 1]?.market_date || null;
    const schedulerConfig = loadSchedulerConfig();
    await marketState.setMarketOpen(client, {
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
      lastSettlementMarketDate: latestSettled,
      clearError: true,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json(result);
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

router.post("/rebuild-full", async (req, res, next) => {
  const lockClient = await req.ctx.pool.connect();
  try {
    const locked = await acquireSchedulerLock(lockClient);
    if (!locked) {
      return res.status(409).json({ error: "scheduler_running" });
    }

    const activeOnly = req.body?.active_only === undefined ? true : Boolean(req.body.active_only);
    const fillMissingDates = req.body?.fill_missing_dates === undefined ? true : Boolean(req.body.fill_missing_dates);
    const version = Number.parseInt(String(req.body?.version ?? "1"), 10);
    if (!Number.isFinite(version) || version < 1) return res.status(400).json({ error: "invalid_version" });

    const range = await marketAdmin.getHistoricalMarketDateRange(req.ctx.pool, { activeOnly });
    if (!range.from || !range.to) {
      return res.status(409).json({ error: "no_historical_data" });
    }

    const schedulerConfig = loadSchedulerConfig();
    const latestReadyDate = getCurrentDateKey(new Date(), schedulerConfig.timeZone);
    if (!latestReadyDate || latestReadyDate < range.from) {
      return res.status(409).json({ error: "no_ready_historical_data" });
    }

    const bootstrap = await marketAdmin.bootstrapAssets(req.ctx.pool, {
      activeOnly,
      syncExisting: true,
    });
    const fundamentalsResult = await fundamentals.recalculateFundamentals(req.ctx.pool, {
      from: range.from,
      to: latestReadyDate,
      version,
      activeOnly,
      fillMissingDates,
    });
    const settlementResult = await settlement.settleMarketRange(req.ctx.pool, {
      from: range.from,
      to: latestReadyDate,
      force: true,
    });
    const latestSettled = settlementResult.settled_dates[settlementResult.settled_dates.length - 1]?.market_date || null;
    await marketState.setMarketOpen(lockClient, {
      nextScheduledSettlementAt: computeNextScheduledAt(new Date(), schedulerConfig).toISOString(),
      lastSettlementMarketDate: latestSettled,
      clearError: true,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);

    res.json({
      ok: true,
      range: {
        from: range.from,
        to: latestReadyDate,
      },
      bootstrap,
      fundamentals: fundamentalsResult,
      settlement: settlementResult,
    });
  } catch (e) {
    if (e?.code === "scheduler_running") {
      return res.status(409).json({ error: "scheduler_running" });
    }
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
    await releaseSchedulerLock(lockClient);
    lockClient.release();
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
