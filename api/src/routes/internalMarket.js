const express = require("express");
const { invalidateMarketAssetsCache } = require("../marketCache");
const fundamentals = require("../services/fundamentals");
const marketAdmin = require("../services/marketAdmin");
const settlement = require("../services/settlement");

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
  try {
    const marketDate = optionalDate(req.params.date);
    if (!marketDate) return res.status(400).json({ error: "invalid_market_date" });

    const force = Boolean(req.body?.force);
    const result = await settlement.settleMarketDay(req.ctx.pool, { marketDate, force });
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
  }
});

router.post("/settle-range", async (req, res, next) => {
  try {
    const from = optionalDate(req.body?.from);
    const to = optionalDate(req.body?.to);
    if (!from) return res.status(400).json({ error: "invalid_from_date" });
    if (!to) return res.status(400).json({ error: "invalid_to_date" });

    const force = Boolean(req.body?.force);
    const result = await settlement.settleMarketRange(req.ctx.pool, { from, to, force });
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
  }
});

router.post("/rebuild-full", async (req, res, next) => {
  try {
    const activeOnly = req.body?.active_only === undefined ? true : Boolean(req.body.active_only);
    const fillMissingDates = req.body?.fill_missing_dates === undefined ? true : Boolean(req.body.fill_missing_dates);
    const force = req.body?.force === undefined ? true : Boolean(req.body.force);
    const version = Number.parseInt(String(req.body?.version ?? "1"), 10);
    if (!Number.isFinite(version) || version < 1) return res.status(400).json({ error: "invalid_version" });

    const range = await marketAdmin.getHistoricalMarketDateRange(req.ctx.pool, { activeOnly });
    if (!range.from || !range.to) {
      return res.status(409).json({ error: "no_historical_data" });
    }

    const bootstrap = await marketAdmin.bootstrapAssets(req.ctx.pool, {
      activeOnly,
      syncExisting: true,
    });
    const fundamentalsResult = await fundamentals.recalculateFundamentals(req.ctx.pool, {
      from: range.from,
      to: range.to,
      version,
      activeOnly,
      fillMissingDates,
    });
    const settlementResult = await settlement.settleMarketRange(req.ctx.pool, {
      from: range.from,
      to: range.to,
      force,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);

    res.json({
      ok: true,
      range,
      bootstrap,
      fundamentals: fundamentalsResult,
      settlement: settlementResult,
    });
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
