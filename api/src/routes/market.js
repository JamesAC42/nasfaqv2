const express = require("express");
const marketDb = require("../marketDb");
const { getCachedAssets, invalidateMarketAssetsCache, setCachedAssets } = require("../marketCache");
const trading = require("../services/trading");
const { requireUserId } = require("../userContext");

const router = express.Router();

function parsePositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

router.get("/assets", async (req, res, next) => {
  try {
    const cachedAssets = await getCachedAssets(req.ctx.redis);
    if (cachedAssets) {
      return res.json(cachedAssets);
    }

    const assets = await marketDb.listAssets(req.ctx.pool);
    await setCachedAssets(req.ctx.redis, assets);
    res.json(assets);
  } catch (e) {
    next(e);
  }
});

router.get("/report/daily/latest", async (req, res, next) => {
  try {
    const report = await marketDb.getLatestDailyReport(req.ctx.pool);
    if (!report) return res.status(404).json({ error: "report_not_found" });
    res.json(report);
  } catch (e) {
    next(e);
  }
});

router.get("/report/daily/:date", async (req, res, next) => {
  try {
    const marketDate = String(req.params.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
      return res.status(400).json({ error: "invalid_date" });
    }

    const report = await marketDb.getDailyReportByDate(req.ctx.pool, marketDate);
    if (!report) return res.status(404).json({ error: "report_not_found" });
    res.json(report);
  } catch (e) {
    next(e);
  }
});

router.get("/assets/:symbol/candles", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const interval = String(req.query.interval || "1d");
    const range = String(req.query.range || "30d");
    const candles = await marketDb.getAssetCandles(req.ctx.pool, symbol, { interval, range });

    res.json({ symbol, interval, range, candles });
  } catch (e) {
    if (e?.code === "unsupported_interval") {
      return res.status(400).json({ error: "unsupported_interval" });
    }
    next(e);
  }
});

router.get("/assets/:symbol/trades", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 200 });
    const trades = await marketDb.getAssetTrades(req.ctx.pool, symbol, { limit });
    res.json({ symbol, trades });
  } catch (e) {
    next(e);
  }
});

router.get("/assets/:symbol/stats", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const range = String(req.query.range || "30d");
    const stats = await marketDb.getAssetStats(req.ctx.pool, symbol, { range });
    res.json({ symbol, range, stats });
  } catch (e) {
    next(e);
  }
});

router.get("/assets/:symbol/treasury", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const treasury = await marketDb.getAssetTreasury(req.ctx.pool, symbol);
    if (!treasury) return res.status(404).json({ error: "asset_not_found" });
    res.json(treasury);
  } catch (e) {
    next(e);
  }
});

router.get("/assets/:symbol", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const asset = await marketDb.getAssetBySymbol(req.ctx.pool, symbol);
    if (!asset) return res.status(404).json({ error: "asset_not_found" });
    res.json(asset);
  } catch (e) {
    next(e);
  }
});

router.post("/orders/buy", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const symbol = normalizeSymbol(req.body?.symbol);
    const quantity = req.body?.quantity;
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const result = await trading.executeOrder(req.ctx.pool, {
      userId,
      symbol,
      side: "buy",
      quantity,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "invalid_quantity") return res.status(400).json({ error: "invalid_quantity" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "asset_not_active") return res.status(409).json({ error: "asset_not_active" });
    if (e?.code === "insufficient_cash") return res.status(409).json({ error: "insufficient_cash" });
    if (e?.code === "invalid_quote") return res.status(409).json({ error: "invalid_quote" });
    next(e);
  }
});

router.post("/orders/sell", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const symbol = normalizeSymbol(req.body?.symbol);
    const quantity = req.body?.quantity;
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const result = await trading.executeOrder(req.ctx.pool, {
      userId,
      symbol,
      side: "sell",
      quantity,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "invalid_quantity") return res.status(400).json({ error: "invalid_quantity" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "asset_not_active") return res.status(409).json({ error: "asset_not_active" });
    if (e?.code === "insufficient_holdings") return res.status(409).json({ error: "insufficient_holdings" });
    if (e?.code === "invalid_quote") return res.status(409).json({ error: "invalid_quote" });
    next(e);
  }
});

module.exports = router;
