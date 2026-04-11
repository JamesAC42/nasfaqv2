const express = require("express");
const profileDb = require("../profileDb");
const { requireUserId } = require("../userContext");

const router = express.Router();

function parsePositiveInt(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

router.get("/me", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const bundle = await profileDb.getProfileBundle(req.ctx.pool, {
      viewerUserId: userId,
      selfOnly: true,
      articlesPage: parsePositiveInt(req.query.articles_page, 1, { min: 1, max: 1000 }),
      articlesLimit: parsePositiveInt(req.query.articles_limit, 6, { min: 1, max: 24 }),
      tradesPage: parsePositiveInt(req.query.trades_page, 1, { min: 1, max: 1000 }),
      tradesLimit: parsePositiveInt(req.query.trades_limit, 10, { min: 1, max: 25 }),
    });
    res.json(bundle);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.get("/me/articles", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const result = await profileDb.listProfileArticles(req.ctx.pool, userId, {
      page: parsePositiveInt(req.query.page, 1, { min: 1, max: 1000 }),
      limit: parsePositiveInt(req.query.limit, 6, { min: 1, max: 24 }),
      viewerUserId: userId,
    });
    res.json(result);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.get("/me/trades", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const result = await profileDb.listProfileTrades(req.ctx.pool, userId, {
      page: parsePositiveInt(req.query.page, 1, { min: 1, max: 1000 }),
      limit: parsePositiveInt(req.query.limit, 10, { min: 1, max: 25 }),
    });
    res.json(result);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.put("/me/profile-picture", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await profileDb.setProfilePicture(req.ctx.pool, userId, req.body?.profile_picture_id ?? null);
    const bundle = await profileDb.getProfileBundle(req.ctx.pool, {
      viewerUserId: userId,
      selfOnly: true,
      articlesPage: parsePositiveInt(req.query.articles_page, 1, { min: 1, max: 1000 }),
      articlesLimit: parsePositiveInt(req.query.articles_limit, 6, { min: 1, max: 24 }),
      tradesPage: parsePositiveInt(req.query.trades_page, 1, { min: 1, max: 1000 }),
      tradesLimit: parsePositiveInt(req.query.trades_limit, 10, { min: 1, max: 25 }),
    });
    res.json(bundle);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.put("/me", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await profileDb.updateProfileSettings(req.ctx.pool, userId, {
      bio: req.body?.bio,
      profileColor: req.body?.profile_color,
      oshiCoinAssetId: req.body?.oshi_coin_asset_id,
    });
    const bundle = await profileDb.getProfileBundle(req.ctx.pool, {
      viewerUserId: userId,
      selfOnly: true,
      articlesPage: parsePositiveInt(req.query.articles_page, 1, { min: 1, max: 1000 }),
      articlesLimit: parsePositiveInt(req.query.articles_limit, 6, { min: 1, max: 24 }),
      tradesPage: parsePositiveInt(req.query.trades_page, 1, { min: 1, max: 1000 }),
      tradesLimit: parsePositiveInt(req.query.trades_limit, 10, { min: 1, max: 25 }),
    });
    res.json(bundle);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.get("/:username", async (req, res, next) => {
  try {
    const bundle = await profileDb.getProfileBundle(req.ctx.pool, {
      username: req.params.username,
      viewerUserId: req.ctx.user?.id || null,
      articlesPage: parsePositiveInt(req.query.articles_page, 1, { min: 1, max: 1000 }),
      articlesLimit: parsePositiveInt(req.query.articles_limit, 6, { min: 1, max: 24 }),
      tradesPage: parsePositiveInt(req.query.trades_page, 1, { min: 1, max: 1000 }),
      tradesLimit: parsePositiveInt(req.query.trades_limit, 10, { min: 1, max: 25 }),
    });
    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

router.get("/:username/articles", async (req, res, next) => {
  try {
    const profileUser = await profileDb.resolveProfileUser(req.ctx.pool, {
      username: req.params.username,
      viewerUserId: req.ctx.user?.id || null,
    });
    const result = await profileDb.listProfileArticles(req.ctx.pool, profileUser.id, {
      page: parsePositiveInt(req.query.page, 1, { min: 1, max: 1000 }),
      limit: parsePositiveInt(req.query.limit, 6, { min: 1, max: 24 }),
      viewerUserId: req.ctx.user?.id || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:username/trades", async (req, res, next) => {
  try {
    const profileUser = await profileDb.resolveProfileUser(req.ctx.pool, {
      username: req.params.username,
      viewerUserId: req.ctx.user?.id || null,
    });
    const result = await profileDb.listProfileTrades(req.ctx.pool, profileUser.id, {
      page: parsePositiveInt(req.query.page, 1, { min: 1, max: 1000 }),
      limit: parsePositiveInt(req.query.limit, 10, { min: 1, max: 25 }),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:username/friend-request", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await profileDb.sendFriendRequest(req.ctx.pool, userId, req.params.username);
    const bundle = await profileDb.getProfileBundle(req.ctx.pool, {
      username: req.params.username,
      viewerUserId: userId,
    });
    res.status(201).json(bundle);
  } catch (error) {
    next(error);
  }
});

router.post("/:username/friend-request/accept", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await profileDb.acceptFriendRequest(req.ctx.pool, userId, req.params.username);
    const bundle = await profileDb.getProfileBundle(req.ctx.pool, {
      username: req.params.username,
      viewerUserId: userId,
    });
    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

router.delete("/:username/friendship", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await profileDb.removeFriendship(req.ctx.pool, userId, req.params.username);
    const bundle = await profileDb.getProfileBundle(req.ctx.pool, {
      username: req.params.username,
      viewerUserId: userId,
    });
    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

router.put("/:username/rival", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await profileDb.setRival(req.ctx.pool, userId, req.params.username, Boolean(req.body?.active));
    const bundle = await profileDb.getProfileBundle(req.ctx.pool, {
      username: req.params.username,
      viewerUserId: userId,
    });
    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
