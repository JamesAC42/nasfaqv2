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
const marketAdjustments = require("../services/marketAdjustments");
const marketState = require("../services/marketState");
const { requireAdmin, requireVerifiedUserId } = require("../userContext");

const router = express.Router();

function parsePositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeMarketDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function invalidateMarketAssetsCacheAsync(redis) {
  invalidateMarketAssetsCache(redis).catch((error) => {
    // eslint-disable-next-line no-console
    console.error("market assets cache invalidation failed:", String(error?.message || error));
  });
}

function toMetricMap(rows, valueKeys) {
  return new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [
      Number(row.asset_id || 0),
      Object.fromEntries(valueKeys.map((key) => [key, row[key] ?? null])),
    ])
  );
}

const PUBLIC_MARKET_SENSITIVE_KEYS = new Set([
  "base_rate",
  "base_rate_change_pct",
  "biggest_base_rate_increases",
  "biggest_base_rate_decreases",
  "current_fair_value",
  "current_fair_value_raw",
  "current_premium_pct",
  "fair_value_change_pct",
  "fundamental_value_raw",
  "fundamental_value_smoothed",
  "largest_discounts",
  "largest_market_discounts",
  "largest_market_premiums",
  "largest_premiums",
  "premium_close_pct",
  "premium_discount_pct",
  "premium_pct",
  "top_base_rate",
  "top_discounts",
  "top_market_discounts",
  "top_market_premiums",
  "top_premiums",
]);

function scrubPublicMarketPayload(value) {
  if (Array.isArray(value)) return value.map(scrubPublicMarketPayload);
  if (value instanceof Date) return value;
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PUBLIC_MARKET_SENSITIVE_KEYS.has(key))
      .map(([key, item]) => [key, scrubPublicMarketPayload(item)])
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
      ...scrubPublicMarketPayload(hub),
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
      return res.json(scrubPublicMarketPayload(cachedAssets));
    }

    const assets = scrubPublicMarketPayload(await marketDb.listAssets(req.ctx.pool));
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
    res.json(scrubPublicMarketPayload(report));
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
    res.json(scrubPublicMarketPayload(report));
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

router.get("/adjustments/summary", async (req, res, next) => {
  try {
    const recentLimit = parsePositiveInt(req.query.recent_limit, 20, { min: 1, max: 100 });
    const summary = await marketAdjustments.getAdjustmentSummary(req.ctx.pool, { recentLimit });
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.get("/live-orders/summary", async (req, res, next) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 12, { min: 1, max: 50 });
    const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : null;
    const summary = await marketDb.getPendingLiveOrderSummary(req.ctx.pool, { symbol, limit });
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.get("/live-orders/admin/health", async (req, res, next) => {
  try {
    requireAdmin(req);
    const batchLimit = parsePositiveInt(req.query.batch_limit, 10, { min: 1, max: 50 });
    const result = await trading.getLiveOrderAdminHealth(req.ctx.pool, { batchLimit });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get("/adjustments/admin/sessions", async (req, res, next) => {
  try {
    requireAdmin(req);
    const limit = parsePositiveInt(req.query.limit, 30, { min: 1, max: 100 });
    const result = await marketAdjustments.listAdminAdjustmentSessions(req.ctx.pool, { limit });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get("/adjustments/admin/sessions/:sessionId", async (req, res, next) => {
  try {
    requireAdmin(req);
    const sessionId = Number(req.params.sessionId);
    if (!Number.isFinite(sessionId) || sessionId <= 0) return res.status(400).json({ error: "invalid_session_id" });
    const result = await marketAdjustments.getAdminAdjustmentSession(req.ctx.pool, sessionId);
    if (!result.session) return res.status(404).json({ error: "session_not_found" });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get("/adjustments/admin/health", async (req, res, next) => {
  try {
    requireAdmin(req);
    const result = await marketAdjustments.getAdminAdjustmentHealth(req.ctx.pool);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/adjustments/force-next", async (req, res, next) => {
  try {
    requireAdmin(req);

    let marketDate = normalizeMarketDate(req.body?.market_date);
    if (!marketDate) {
      const status = await marketState.getMarketStatus(req.ctx.pool);
      marketDate = normalizeMarketDate(status?.current_market_date) || normalizeMarketDate(status?.last_settlement_market_date);
    }
    if (!marketDate) {
      const report = await marketDb.getLatestDailyReport(req.ctx.pool);
      marketDate = normalizeMarketDate(report?.market_date);
    }
    if (!marketDate) return res.status(409).json({ error: "missing_market_date" });

    const result = await marketAdjustments.forceNextAdjustment(req.ctx.pool, {
      marketDate,
      redis: req.ctx.redis,
    });
    res.json(result);
  } catch (e) {
    if (e?.code === "invalid_market_date") return res.status(400).json({ error: "invalid_market_date" });
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

router.get("/assets/:symbol/adjustments", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const limit = parsePositiveInt(req.query.limit, 20, { min: 1, max: 100 });
    const recentLimit = parsePositiveInt(req.query.recent_limit, 5, { min: 1, max: 20 });
    const upcomingLimit = parsePositiveInt(req.query.upcoming_limit, 2, { min: 0, max: 10 });
    const result = await marketAdjustments.getAssetAdjustmentHistory(req.ctx.pool, symbol, {
      limit,
      recentLimit,
      upcomingLimit,
    });
    res.json(result);
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
    const userId = requireVerifiedUserId(req);
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
    const userId = requireVerifiedUserId(req);
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

    res.json(scrubPublicMarketPayload({
      superchat_range: superchatRange,
      rows,
    }));
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
    res.json(scrubPublicMarketPayload({ symbol, range, stats }));
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
    res.json(scrubPublicMarketPayload(treasury));
  } catch (e) {
    next(e);
  }
});

router.get("/tuning/config", async (_req, res, next) => {
  try {
    res.json(marketDb.getMarketTuningConfig());
  } catch (e) {
    next(e);
  }
});

router.patch("/assets/:symbol/tuning", async (req, res, next) => {
  try {
    requireAdmin(req);
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const asset = await marketDb.updateAssetMarketTuning(req.ctx.pool, symbol, req.body || {});
    await invalidateMarketAssetsCache(req.ctx.redis);
    res.json({ asset });
  } catch (e) {
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "invalid_market_tuning") {
      return res.status(400).json({ error: "invalid_market_tuning", field: e.field || null });
    }
    next(e);
  }
});

router.get("/assets/:symbol", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const asset = await marketDb.getAssetBySymbol(req.ctx.pool, symbol);
    if (!asset) return res.status(404).json({ error: "asset_not_found" });
    res.json(scrubPublicMarketPayload(asset));
  } catch (e) {
    next(e);
  }
});

router.post("/orders/buy", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const symbol = normalizeSymbol(req.body?.symbol);
    const quantity = req.body?.quantity;
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const result = await trading.submitLiveOrder(req.ctx.pool, {
      userId,
      symbol,
      side: "buy",
      quantity,
      redis: req.ctx.redis,
    });
    invalidateMarketAssetsCacheAsync(req.ctx.redis);

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "invalid_quantity") return res.status(400).json({ error: "invalid_quantity" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "asset_not_active") return res.status(409).json({ error: "asset_not_active" });
    if (e?.code === "market_closed") return res.status(409).json({ error: "market_closed", market_status: e.marketStatus || null });
    if (e?.code === "insufficient_cash") return res.status(409).json({ error: "insufficient_cash" });
    if (e?.code === "live_order_limit_exceeded") return res.status(429).json({ error: "live_order_limit_exceeded", limit: e.limit || null });
    if (e?.code === "invalid_quote") return res.status(409).json({ error: "invalid_quote" });
    next(e);
  }
});

router.post("/orders/sell", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const symbol = normalizeSymbol(req.body?.symbol);
    const quantity = req.body?.quantity;
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    const result = await trading.submitLiveOrder(req.ctx.pool, {
      userId,
      symbol,
      side: "sell",
      quantity,
      redis: req.ctx.redis,
    });
    invalidateMarketAssetsCacheAsync(req.ctx.redis);

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "invalid_quantity") return res.status(400).json({ error: "invalid_quantity" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "asset_not_active") return res.status(409).json({ error: "asset_not_active" });
    if (e?.code === "market_closed") return res.status(409).json({ error: "market_closed", market_status: e.marketStatus || null });
    if (e?.code === "insufficient_holdings") return res.status(409).json({ error: "insufficient_holdings" });
    if (e?.code === "live_order_limit_exceeded") return res.status(429).json({ error: "live_order_limit_exceeded", limit: e.limit || null });
    if (e?.code === "invalid_quote") return res.status(409).json({ error: "invalid_quote" });
    next(e);
  }
});

module.exports = router;
