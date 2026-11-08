const express = require("express");
const netWorth = require("../services/netWorth");
const dividendBoard = require("../services/dividendBoard");
const features = require("../features");
const { scrubPublicMarketPayload } = require("../services/marketSecrecy");
const {
  buildAssetOshiboardCacheKey,
  getCachedJson,
  MARKET_ASSET_OSHIBOARD_CACHE_TTL_SECONDS,
  setCachedJson,
} = require("../marketCache");

const { sendCachedJson } = require("../responseCache");

const router = express.Router();

// A signed-in player's board (the page plus their own row and neighbours) ranks every player about
// four times over; kept this long per player and page, so going back and forth between tabs and
// windows doesn't do that again each time. Shorter than the signed-out board's 15 s.
const VIEWER_BOARD_TTL_SECONDS = 5;

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
    if (cached) return res.json(scrubPublicMarketPayload(cached));

    const board = scrubPublicMarketPayload(await netWorth.getAssetOshiboard(req.ctx.pool, symbol, { limit }));
    if (!board) return res.status(404).json({ error: "asset_not_found" });
    await setCachedJson(req.ctx.redis, cacheKey, board, MARKET_ASSET_OSHIBOARD_CACHE_TTL_SECONDS);
    res.json(board);
  } catch (error) {
    next(error);
  }
});

// The dividend leaderboard (services/dividendBoard.js), behind the dividend-spotlight flag. Each copy
// is per audience (features: true drops oshi protection's fields) and per oshi-protection answer
// (dropping rows that only exist because a fee was skipped), so a staff copy never reaches a player.
router.get("/dividends", features.requireFeature(dividendBoard.FLAG), async (req, res, next) => {
  try {
    const query = {
      window: dividendBoard.parseWindow(req.query.window),
      page: parsePage(req.query.page, 1),
      limit: parseLimit(req.query.limit, 25),
      withOshi: dividendBoard.withOshiFor(req.ctx.user),
    };
    await sendCachedJson(req, res, dividendBoard.pageKey(query), {
      ttlSeconds: 30,
      memoMs: 5000,
      features: true,
      load: () => dividendBoard.boardPage(req.ctx, query),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/dividends/me", features.requireFeature(dividendBoard.FLAG), async (req, res, next) => {
  try {
    const userId = req.ctx.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });
    const place = await dividendBoard.myPlace(req.ctx, userId, {
      window: dividendBoard.parseWindow(req.query.window),
      withOshi: dividendBoard.withOshiFor(req.ctx.user),
    });
    features.markPrivate(res);
    res.json(features.forAudience(place, features.audienceOf(req.ctx.user)));
  } catch (error) {
    next(error);
  }
});

router.get("/dividends/players/:userId", features.requireFeature(dividendBoard.FLAG), async (req, res, next) => {
  try {
    const userId = Number.parseInt(String(req.params.userId || ""), 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: "invalid_user_id" });
    const query = { userId, window: dividendBoard.parseWindow(req.query.window), withOshi: dividendBoard.withOshiFor(req.ctx.user) };
    await sendCachedJson(req, res, dividendBoard.breakdownKey(query), {
      ttlSeconds: 60,
      memoMs: 10_000,
      features: true,
      notFound: "player_not_found",
      load: () => dividendBoard.playerBreakdown(req.ctx.pool, userId, query),
    });
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
    // Signed-out visitors (the front page's top five) all see the same board: 15s cache.
    if (!req.ctx.user && scope === "global") {
      await sendCachedJson(req, res, `leaderboard:${window}:${page}:${limit}`, {
        ttlSeconds: 15,
        memoMs: 3000,
        load: () => netWorth.listLeaderboardBundle(req.ctx.pool, { viewerUserId: null, scope, window, page, limit }),
      });
      return;
    }
    // Global only: friends and rivals boards change the moment you add someone.
    const cacheKey = req.ctx.user && scope === "global" ? `leaderboard:viewer:${req.ctx.user.id}:${window}:${page}:${limit}` : null;
    if (cacheKey) {
      const cached = await getCachedJson(req.ctx.redis, cacheKey).catch(() => null);
      if (cached) return res.json(cached);
    }
    const bundle = await netWorth.listLeaderboardBundle(req.ctx.pool, {
      viewerUserId: req.ctx.user?.id || null,
      scope,
      window,
      page,
      limit,
    });
    if (cacheKey) await setCachedJson(req.ctx.redis, cacheKey, bundle, VIEWER_BOARD_TTL_SECONDS).catch(() => {});
    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
