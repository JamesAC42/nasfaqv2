const express = require("express");
const netWorth = require("../services/netWorth");
const {
  buildAssetOshiboardCacheKey,
  getCachedJson,
  MARKET_ASSET_OSHIBOARD_CACHE_TTL_SECONDS,
  setCachedJson,
} = require("../marketCache");

const router = express.Router();

function parseLimit(value, fallback = 25) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function parsePage(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 10000);
}

function parseScope(value) {
  return value === "friends" || value === "rivals" ? value : "global";
}

function parseWindow(value) {
  return value === "7d" || value === "all" ? value : "1d";
}

function parseUserIds(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return Array.from(
    new Set(
      list
        .map((item) => Number.parseInt(String(item || "").trim(), 10))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  ).slice(0, 200);
}

router.get("/net-worth", async (req, res, next) => {
  try {
    const userIds = parseUserIds(req.query.user_ids);
    const entries = await netWorth.listCurrentNetWorthByUserIds(req.ctx.pool, userIds);
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});

router.get("/oshiboard/memberships/:userId", async (req, res, next) => {
  try {
    const userId = Number.parseInt(String(req.params.userId || ""), 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: "invalid_user_id" });
    const memberships = await netWorth.listUserOshiboardMemberships(req.ctx.pool, userId);
    res.json({ memberships });
  } catch (error) {
    next(error);
  }
});

router.get("/oshiboard-assets", async (req, res, next) => {
  try {
    const rows = await netWorth.listOshiboardAssetStats(req.ctx.pool);
    res.json({ rows });
  } catch (error) {
    next(error);
  }
});

router.get("/oshiboard/:symbol", async (req, res, next) => {
  try {
    const symbol = String(req.params.symbol || "").trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: "missing_symbol" });
    const limit = parseLimit(req.query.limit, 50);
    const cacheKey = buildAssetOshiboardCacheKey(symbol, limit);
    const cached = await getCachedJson(req.ctx.redis, cacheKey);
    if (cached) return res.json(cached);

    const board = await netWorth.getAssetOshiboard(req.ctx.pool, symbol, { limit });
    if (!board) return res.status(404).json({ error: "asset_not_found" });
    await setCachedJson(req.ctx.redis, cacheKey, board, MARKET_ASSET_OSHIBOARD_CACHE_TTL_SECONDS);
    res.json(board);
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 25);
    const page = parsePage(req.query.page, 1);
    const scope = parseScope(req.query.scope);
    const window = parseWindow(req.query.window);
    const bundle = await netWorth.listLeaderboardBundle(req.ctx.pool, {
      viewerUserId: req.ctx.user?.id || null,
      scope,
      window,
      page,
      limit,
    });
    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
