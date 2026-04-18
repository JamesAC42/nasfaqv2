const express = require("express");
const marketDb = require("../marketDb");
const {
  getCachedAssets,
  invalidateMarketAssetsCache,
  setCachedAssets,
  getCachedJson,
  setCachedJson,
  buildAssetSuperchatRankCacheKey,
  buildMarketRankingsWeeklyActivityCacheKey,
  MARKET_ASSET_SUPERCHAT_RANK_CACHE_TTL_SECONDS,
  MARKET_RANKINGS_WEEKLY_ACTIVITY_CACHE_TTL_SECONDS,
  MARKET_RANKINGS_OSHICOIN_CACHE_TTL_SECONDS,
  MARKET_RANKINGS_OSHICOIN_CACHE_KEY,
} = require("../marketCache");
const trading = require("../services/trading");
const marketState = require("../services/marketState");
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

function toMetricMap(rows, valueKeys) {
  return new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      Number(row.asset_id || 0),
      Object.fromEntries(valueKeys.map((key) => [key, row[key] ?? null])),
    ])
  );
}

function encodeCursor(cursor) {
  if (!cursor?.ts || !cursor?.id) return null;
  return Buffer.from(JSON.stringify({ ts: cursor.ts, id: cursor.id }), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed?.ts || !parsed?.id) return null;
    return { ts: parsed.ts, id: Number(parsed.id) };
  } catch {
    return null;
  }
}

router.get("/hub", async (req, res, next) => {
  try {
    const tradeLimit = parsePositiveInt(req.query.trade_limit, 20, { min: 1, max: 100 });
    const hub = await marketDb.getMarketHub(req.ctx.pool, { tradeLimit });
    res.json({
      ...hub,
      recent_trades: {
        items: hub.recent_trades.items,
        next_cursor: encodeCursor(hub.recent_trades.next_cursor),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/trades", async (req, res, next) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 200 });
    const cursor = decodeCursor(req.query.cursor);
    const result = await marketDb.listRecentMarketTrades(req.ctx.pool, {
      limit,
      beforeTs: cursor?.ts || null,
      beforeId: cursor?.id || null,
    });

    res.json({
      items: result.items,
      next_cursor: encodeCursor(result.next_cursor),
    });
  } catch (e) {
    next(e);
  }
});

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

router.get("/status", async (req, res, next) => {
  try {
    const status = await marketState.getMarketStatus(req.ctx.pool);
    res.json(status || {});
  } catch (e) {
    next(e);
  }
});

router.get("/indexes/candles", async (req, res, next) => {
  try {
    const groupBy = String(req.query.group_by || "unit");
    const group = String(req.query.group || "all");
    const range = String(req.query.range || "1y");
    const weighting = String(req.query.weighting || "equal");

    const result = await marketDb.getGroupIndex(req.ctx.pool, { groupBy, group, range, weighting });
    res.json(result);
  } catch (e) {
    if (e?.code === "unsupported_group_by") {
      return res.status(400).json({ error: "unsupported_group_by" });
    }
    next(e);
  }
});

router.get("/indexes/overview", async (req, res, next) => {
  try {
    const groupBy = String(req.query.group_by || "unit");
    const range = String(req.query.range || "1y");
    const weighting = String(req.query.weighting || "equal");

    const result = await marketDb.listGroupIndexes(req.ctx.pool, { groupBy, range, weighting });
    res.json(result);
  } catch (e) {
    if (e?.code === "unsupported_group_by") {
      return res.status(400).json({ error: "unsupported_group_by" });
    }
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

router.get("/assets/:symbol/comments", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const result = await marketDb.listAssetComments(req.ctx.pool, symbol, {
      page: req.query.page,
      limit: req.query.limit || 6,
      viewerUserId: req.ctx.user?.id || null,
    });
    res.json({
      symbol: result.symbol,
      comments: result.comments,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        page_count: result.total > 0 ? Math.ceil(result.total / result.limit) : 1,
        has_previous_page: result.page > 1,
        has_next_page: result.page < (result.total > 0 ? Math.ceil(result.total / result.limit) : 1),
      },
      viewer_context: result.viewer_context,
    });
  } catch (e) {
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    next(e);
  }
});

router.post("/assets/:symbol/comments", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    await marketDb.createAssetComment(req.ctx.pool, symbol, userId, {
      body: req.body?.body,
      mood: req.body?.mood,
    });
    const result = await marketDb.listAssetComments(req.ctx.pool, symbol, {
      page: 1,
      limit: 6,
      viewerUserId: userId,
    });
    res.status(201).json({
      symbol: result.symbol,
      comments: result.comments,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        page_count: result.total > 0 ? Math.ceil(result.total / result.limit) : 1,
        has_previous_page: result.page > 1,
        has_next_page: result.page < (result.total > 0 ? Math.ceil(result.total / result.limit) : 1),
      },
      viewer_context: result.viewer_context,
    });
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    next(e);
  }
});

router.post("/assets/:symbol/comments/:commentId/vote", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    await marketDb.setAssetCommentVote(req.ctx.pool, symbol, req.params.commentId, userId, req.body?.value);
    const result = await marketDb.listAssetComments(req.ctx.pool, symbol, {
      page: req.query.page || 1,
      limit: 6,
      viewerUserId: userId,
    });
    res.json({
      symbol: result.symbol,
      comments: result.comments,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        page_count: result.total > 0 ? Math.ceil(result.total / result.limit) : 1,
        has_previous_page: result.page > 1,
        has_next_page: result.page < (result.total > 0 ? Math.ceil(result.total / result.limit) : 1),
      },
      viewer_context: result.viewer_context,
    });
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "asset_not_found" || e?.code === "asset_comment_not_found") {
      return res.status(404).json({ error: e.code });
    }
    next(e);
  }
});

router.get("/assets/:symbol/superchats", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const range = String(req.query.range || "7d");
    const summary = await marketDb.getAssetSuperchatSummary(req.ctx.pool, symbol, { range });
    if (!summary) return res.status(404).json({ error: "asset_not_found" });

    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.get("/rankings", async (req, res, next) => {
  try {
    const superchatRange = String(req.query.superchat_range || "7d");
    const weeklyActivityCacheKey = buildMarketRankingsWeeklyActivityCacheKey(superchatRange);
    const [coreRows, cachedWeeklyActivity, cachedOshicoinUsers] = await Promise.all([
      marketDb.listAssetRankingCore(req.ctx.pool),
      getCachedJson(req.ctx.redis, weeklyActivityCacheKey),
      getCachedJson(req.ctx.redis, MARKET_RANKINGS_OSHICOIN_CACHE_KEY),
    ]);

    const [weeklyActivityRows, oshicoinUserRows] = await Promise.all([
      cachedWeeklyActivity
        ? Promise.resolve(cachedWeeklyActivity)
        : marketDb.listAssetRankingWeeklyActivity(req.ctx.pool, { superchatRange }).then(async (rows) => {
            await setCachedJson(
              req.ctx.redis,
              weeklyActivityCacheKey,
              rows,
              MARKET_RANKINGS_WEEKLY_ACTIVITY_CACHE_TTL_SECONDS
            );
            return rows;
          }),
      cachedOshicoinUsers
        ? Promise.resolve(cachedOshicoinUsers)
        : marketDb.listAssetRankingOshicoinUsers(req.ctx.pool).then(async (rows) => {
            await setCachedJson(
              req.ctx.redis,
              MARKET_RANKINGS_OSHICOIN_CACHE_KEY,
              rows,
              MARKET_RANKINGS_OSHICOIN_CACHE_TTL_SECONDS
            );
            return rows;
          }),
    ]);

    const weeklyActivityByAssetId = toMetricMap(weeklyActivityRows, ["superchat_earnings", "stream_duration_seconds_7d"]);
    const oshicoinUsersByAssetId = toMetricMap(oshicoinUserRows, ["oshicoin_users"]);
    const rows = coreRows.map((row) => ({
      ...row,
      ...(weeklyActivityByAssetId.get(Number(row.id || 0)) || {
        superchat_earnings: 0,
        stream_duration_seconds_7d: 0,
      }),
      ...(oshicoinUsersByAssetId.get(Number(row.id || 0)) || {
        oshicoin_users: 0,
      }),
    }));

    res.json({
      superchat_range: superchatRange,
      rows,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/assets/:symbol/superchats/timeseries", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const range = String(req.query.range || "7d");
    const series = await marketDb.getAssetSuperchatTimeseries(req.ctx.pool, symbol, { range });
    if (!series) return res.status(404).json({ error: "asset_not_found" });

    res.json(series);
  } catch (e) {
    if (e?.code === "unsupported_superchat_range") {
      return res.status(400).json({ error: "unsupported_superchat_range" });
    }
    next(e);
  }
});

router.get("/assets/:symbol/stream-time/timeseries", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const range = String(req.query.range || "7d");
    const series = await marketDb.getAssetStreamTimeTimeseries(req.ctx.pool, symbol, { range });
    if (!series) return res.status(404).json({ error: "asset_not_found" });

    res.json(series);
  } catch (e) {
    if (e?.code === "unsupported_stream_time_range") {
      return res.status(400).json({ error: "unsupported_stream_time_range" });
    }
    next(e);
  }
});

router.get("/assets/:symbol/superchat-rank", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const range = String(req.query.range || "7d");
    const cacheKey = buildAssetSuperchatRankCacheKey(symbol, range);
    const cached = await getCachedJson(req.ctx.redis, cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const rank = await marketDb.getAssetSuperchatRank(req.ctx.pool, symbol, { range });
    if (!rank) return res.status(404).json({ error: "asset_not_found" });

    await setCachedJson(req.ctx.redis, cacheKey, rank, MARKET_ASSET_SUPERCHAT_RANK_CACHE_TTL_SECONDS);
    res.json(rank);
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
      redis: req.ctx.redis,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "invalid_quantity") return res.status(400).json({ error: "invalid_quantity" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "asset_not_active") return res.status(409).json({ error: "asset_not_active" });
    if (e?.code === "market_closed") return res.status(409).json({ error: "market_closed", market_status: e.marketStatus || null });
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
      redis: req.ctx.redis,
    });
    await invalidateMarketAssetsCache(req.ctx.redis);

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "invalid_quantity") return res.status(400).json({ error: "invalid_quantity" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "asset_not_active") return res.status(409).json({ error: "asset_not_active" });
    if (e?.code === "market_closed") return res.status(409).json({ error: "market_closed", market_status: e.marketStatus || null });
    if (e?.code === "insufficient_holdings") return res.status(409).json({ error: "insufficient_holdings" });
    if (e?.code === "invalid_quote") return res.status(409).json({ error: "invalid_quote" });
    next(e);
  }
});

module.exports = router;
