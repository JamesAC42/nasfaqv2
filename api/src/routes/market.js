const express = require("express");
const marketDb = require("../marketDb");
const {
  invalidateMarketAssetsCache,
  getCachedJson,
  setCachedJson,
  buildAssetSuperchatRankCacheKey,
  buildMarketIndexOverviewCacheKey,
  buildMarketRankingsWeeklyActivityCacheKey,
  MARKET_ASSET_SUPERCHAT_RANK_CACHE_TTL_SECONDS,
  MARKET_INDEX_OVERVIEW_CACHE_TTL_SECONDS,
  MARKET_RANKINGS_WEEKLY_ACTIVITY_CACHE_TTL_SECONDS,
  MARKET_RANKINGS_OSHICOIN_CACHE_TTL_SECONDS,
  MARKET_RANKINGS_OSHICOIN_CACHE_KEY,
} = require("../marketCache");
const trading = require("../services/trading");
const marketAdjustments = require("../services/marketAdjustments");
const weeklyEvaluation = require("../services/weeklyEvaluation");
const { scrubPublicMarketPayload, publicDailyReport, revealedTargets } = require("../services/marketSecrecy");
const marketState = require("../services/marketState");
const { sendPublicAssets, sendLatestReport, sendHub, ADJUSTMENT_SUMMARY_LIMITS } = require("../publicMarketCache");
const { sendCachedJson } = require("../responseCache");
const { requireAdmin, requireUserId, requireVerifiedUserId } = require("../userContext");

const { rateLimit, byUser } = require("../rateLimit");
const router = express.Router();
const pendingIndexOverviewRequests = new Map();

function parsePositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSymbol(value) {
  // Tickers are short letters/digits; anything else can't match one (and shouldn't become a cache key).
  const symbol = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{1,12}$/.test(symbol) ? symbol : "";
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
    await sendHub(req, res, tradeLimit, async (limit) => {
      const hub = await marketDb.getMarketHub(req.ctx.pool, { tradeLimit: limit });
      const [report, revealed] = await Promise.all([publicDailyReport(req.ctx.pool, hub.report), revealedTargets(req.ctx.pool)]);
      return {
        ...scrubPublicMarketPayload(hub),
        report: report ? { ...report, revealed_targets: revealed } : null,
        recent_trades: {
          items: hub.recent_trades.items,
          next_cursor: encodeCursor(hub.recent_trades.next_cursor),
        },
      };
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

// Every open tab reads the board: served from the shared cache (publicMarketCache.js).
router.get("/assets", async (req, res, next) => {
  try {
    await sendPublicAssets(req, res);
  } catch (e) {
    next(e);
  }
});

// ── The weekly evaluation (dividends, fees, max shares, buybacks) ─────────
router.get("/evaluations", async (req, res, next) => {
  try {
    res.json({ items: await weeklyEvaluation.listEvaluations(req.ctx.pool, { limit: req.query.limit }) });
  } catch (e) {
    next(e);
  }
});

router.get("/evaluations/preview", async (req, res, next) => {
  try {
    requireAdmin(req);
    const evalDate = await weeklyEvaluation.pendingEvaluationDate(req.ctx.pool);
    const result = await weeklyEvaluation.runWeeklyEvaluation(req.ctx.pool, { evalDate, dryRun: true });
    res.json(result.report);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "forbidden") return res.status(403).json({ error: "forbidden" });
    next(e);
  }
});

router.get("/evaluations/latest", async (req, res, next) => {
  try {
    await sendCachedJson(req, res, "market:evaluations:latest", {
      ttlSeconds: 60,
      memoMs: 10_000,
      notFound: "evaluation_not_found",
      load: () => weeklyEvaluation.getEvaluation(req.ctx.pool),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/evaluations/:date", async (req, res, next) => {
  try {
    const date = String(req.params.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "invalid_date" });
    const report = await weeklyEvaluation.getEvaluation(req.ctx.pool, date);
    if (!report) return res.status(404).json({ error: "evaluation_not_found" });
    res.json(report);
  } catch (e) {
    next(e);
  }
});

router.get("/me/dividends", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json({ weeks: await weeklyEvaluation.listUserDividends(req.ctx.pool, userId, { limit: req.query.limit }) });
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    next(e);
  }
});

router.get("/report/daily/latest", async (req, res, next) => {
  try {
    await sendLatestReport(req, res);
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
    res.json(await publicDailyReport(req.ctx.pool, report));
  } catch (e) {
    next(e);
  }
});

router.get("/status", async (req, res, next) => {
  try {
    // Every tab's reconcile reads it; open/close is pushed on the socket too, so 2s is plenty.
    await sendCachedJson(req, res, "market:status", { ttlSeconds: 2, memoMs: 1000, load: async () => (await marketState.getMarketStatus(req.ctx.pool)) || {} });
  } catch (e) {
    next(e);
  }
});

router.get("/adjustments/summary", async (req, res, next) => {
  try {
    const asked = parsePositiveInt(req.query.recent_limit, 20, { min: 1, max: 100 });
    const recentLimit = ADJUSTMENT_SUMMARY_LIMITS.find((value) => value >= asked) ?? 100;
    // Changes four times a day; cleared by every tick (invalidateMarketAssetsCache).
    await sendCachedJson(req, res, `market:adjustments:${recentLimit}`, {
      ttlSeconds: 60,
      memoMs: 2000,
      load: () => marketAdjustments.getAdjustmentSummary(req.ctx.pool, { recentLimit }),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/live-orders/summary", async (req, res, next) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 12, { min: 1, max: 200 });
    const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : null;
    await sendCachedJson(req, res, `market:live-orders:${symbol || "*"}:${limit}`, {
      ttlSeconds: 3,
      memoMs: 1000,
      load: () => marketDb.getPendingLiveOrderSummary(req.ctx.pool, { symbol, limit }),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/live-orders/flow", async (req, res, next) => {
  try {
    const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : null;
    await sendCachedJson(req, res, `market:live-flow:${symbol || "*"}`, { ttlSeconds: 5, memoMs: 2000, load: () => marketDb.getLiveOrderFlow(req.ctx.pool, { symbol }) });
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
    res.json(scrubPublicMarketPayload(result));
  } catch (e) {
    if (e?.code === "unsupported_group_by") {
      return res.status(400).json({ error: "unsupported_group_by" });
    }
    next(e);
  }
});

router.get("/candles", async (req, res, next) => {
  try {
    const interval = String(req.query.interval || "1h");
    const range = String(req.query.range || "24h");
    await sendCachedJson(req, res, `market:candles:${interval}:${range}`, {
      ttlSeconds: 10,
      memoMs: 2000,
      load: async () => ({ symbol: null, interval, range, candles: await marketDb.getAllMarketCandles(req.ctx.pool, { interval, range }) }),
    });
  } catch (e) {
    if (e?.code === "unsupported_interval") {
      return res.status(400).json({ error: "unsupported_interval" });
    }
    next(e);
  }
});

router.get("/indexes/overview", async (req, res, next) => {
  try {
    const groupBy = String(req.query.group_by || "unit");
    const range = String(req.query.range || "1y");
    const weighting = String(req.query.weighting || "equal");
    const cacheKey = buildMarketIndexOverviewCacheKey({ groupBy, range, weighting });
    const cached = await getCachedJson(req.ctx.redis, cacheKey);
    if (cached) return res.json(scrubPublicMarketPayload(cached));

    let pending = pendingIndexOverviewRequests.get(cacheKey);
    if (!pending) {
      pending = marketDb.listGroupIndexes(req.ctx.pool, { groupBy, range, weighting })
        .then(async (result) => {
          await setCachedJson(req.ctx.redis, cacheKey, result, MARKET_INDEX_OVERVIEW_CACHE_TTL_SECONDS);
          return result;
        })
        .finally(() => {
          pendingIndexOverviewRequests.delete(cacheKey);
        });
      pendingIndexOverviewRequests.set(cacheKey, pending);
    }

    const result = await pending;
    res.json(scrubPublicMarketPayload(result));
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
    await sendCachedJson(req, res, `market:asset:${symbol}:candles:${interval}:${range}`, {
      ttlSeconds: 5,
      memoMs: 1000,
      load: async () => ({ symbol, interval, range, candles: await marketDb.getAssetCandles(req.ctx.pool, symbol, { interval, range }) }),
    });
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
    await sendCachedJson(req, res, `market:asset:${symbol}:trades:${limit}`, {
      ttlSeconds: 3,
      memoMs: 1000,
      load: async () => ({ symbol, trades: await marketDb.getAssetTrades(req.ctx.pool, symbol, { limit }) }),
    });
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

router.post("/assets/:symbol/comments", rateLimit(byUser("stock-comment", 10, 60)), async (req, res, next) => {
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
    const superchatRange = ["24h", "7d", "30d", "90d", "1y"].includes(String(req.query.superchat_range)) ? String(req.query.superchat_range) : "7d";
    // The whole table for 15s (the core query reads the daily YouTube history and 24h of fills).
    await sendCachedJson(req, res, `market:rankings:${superchatRange}`, { ttlSeconds: 15, memoMs: 3000, load: () => loadRankings(req, superchatRange) });
  } catch (e) {
    next(e);
  }
});

async function loadRankings(req, superchatRange) {
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

  const weeklyActivityByAssetId = toMetricMap(weeklyActivityRows, ["superchat_earnings", "stream_duration_seconds_7d", "stream_duration_seconds", "subs_growth", "views_growth", "growth_days"]);
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

  return scrubPublicMarketPayload({
    superchat_range: superchatRange,
    rows,
  });
}

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
    await sendCachedJson(req, res, `market:asset:${symbol}:stats:${range}`, {
      ttlSeconds: 60,
      memoMs: 5000,
      load: async () => scrubPublicMarketPayload({ symbol, range, stats: await marketDb.getAssetStats(req.ctx.pool, symbol, { range }) }),
    });
  } catch (e) {
    next(e);
  }
});

// Shares held vs max shares at each settlement (the stock page's Holders & supply).
router.get("/assets/:symbol/held-history", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
    await sendCachedJson(req, res, `market:asset:${symbol}:held:${days}`, {
      ttlSeconds: 300,
      memoMs: 30_000,
      load: async () => ({ symbol, days, points: await marketDb.getAssetHeldHistory(req.ctx.pool, symbol, { days }) }),
    });
  } catch (e) {
    next(e);
  }
});

// One stock's past Dividend Reviews (the stock page's Dividends section).
router.get("/assets/:symbol/evaluations", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });
    const limit = parsePositiveInt(req.query.limit, 12, { min: 1, max: 52 });
    await sendCachedJson(req, res, `market:asset:${symbol}:evaluations:${limit}`, {
      ttlSeconds: 60,
      memoMs: 10_000,
      load: async () => ({ symbol, items: await weeklyEvaluation.listAssetEvaluations(req.ctx.pool, symbol, { limit }) }),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/assets/:symbol/treasury", async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    await sendCachedJson(req, res, `market:asset:${symbol}:treasury`, {
      ttlSeconds: 10,
      memoMs: 2000,
      notFound: "asset_not_found",
      load: async () => {
        const treasury = await marketDb.getAssetTreasury(req.ctx.pool, symbol);
        return treasury ? scrubPublicMarketPayload(treasury) : null;
      },
    });
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

    await sendCachedJson(req, res, `market:asset:${symbol}`, {
      ttlSeconds: 5,
      memoMs: 1000,
      notFound: "asset_not_found",
      load: async () => {
        const asset = await marketDb.getAssetBySymbol(req.ctx.pool, symbol);
        return asset ? scrubPublicMarketPayload(asset) : null;
      },
    });
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
    // No board invalidation here: a queued order only moves the board's pending counts, which the
    // 5s cache picks up; rebuilding it on every order was a 20ms query per order.

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "invalid_quantity") return res.status(400).json({ error: "invalid_quantity" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "asset_not_active") return res.status(409).json({ error: "asset_not_active" });
    if (e?.code === "market_closed") return res.status(409).json({ error: "market_closed", market_status: e.marketStatus || null });
    if (e?.code === "insufficient_cash") return res.status(409).json({ error: "insufficient_cash" });
    if (e?.code === "sold_out") return res.status(409).json({ error: "sold_out" });
    if (e?.code === "buyback_frozen") return res.status(409).json({ error: "buyback_frozen" });
    if (e?.code === "live_order_limit_exceeded") {
      return res.status(429).json({
        error: "live_order_limit_exceeded",
        limit: e.limit || null,
        submitted_shares: e.submittedShares ?? null,
        remaining_tick_shares: null,
        remaining_interval_shares: e.remainingShares ?? null,
        window: e.windowKey ?? null,
        resets_at: e.resetsAt ?? null,
      });
    }
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
    // No board invalidation here: a queued order only moves the board's pending counts, which the
    // 5s cache picks up; rebuilding it on every order was a 20ms query per order.

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "invalid_quantity") return res.status(400).json({ error: "invalid_quantity" });
    if (e?.code === "asset_not_found") return res.status(404).json({ error: "asset_not_found" });
    if (e?.code === "asset_not_active") return res.status(409).json({ error: "asset_not_active" });
    if (e?.code === "market_closed") return res.status(409).json({ error: "market_closed", market_status: e.marketStatus || null });
    if (e?.code === "insufficient_holdings") return res.status(409).json({ error: "insufficient_holdings" });
    if (e?.code === "live_order_limit_exceeded") {
      return res.status(429).json({
        error: "live_order_limit_exceeded",
        limit: e.limit || null,
        submitted_shares: e.submittedShares ?? null,
        remaining_tick_shares: null,
        remaining_interval_shares: e.remainingShares ?? null,
        window: e.windowKey ?? null,
        resets_at: e.resetsAt ?? null,
      });
    }
    if (e?.code === "invalid_quote") return res.status(409).json({ error: "invalid_quote" });
    next(e);
  }
});

router.post("/orders/cancel", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const orderId = Number(req.body?.order_id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({ error: "invalid_order_id" });
    }

    const result = await trading.cancelLiveOrder(req.ctx.pool, {
      orderId,
      userId,
      redis: req.ctx.redis,
    });

    res.json(result);
  } catch (e) {
    if (e?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    if (e?.code === "live_order_not_found_or_not_pending") return res.status(404).json({ error: e.code });
    next(e);
  }
});

module.exports = router;
