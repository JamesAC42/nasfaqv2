const express = require("express");
const gamesCatalog = require("../services/games/catalog");
const gamesGacha = require("../services/games/gacha");
const gachaPrizeCatalog = require("../services/games/gachaPrizeCatalog");
const gamesInventory = require("../services/games/inventory");
const gamesSessions = require("../services/games/sessions");
const { requireUserId } = require("../userContext");

const router = express.Router();

router.get("/catalog", async (req, res, next) => {
  try {
    const games = await gamesCatalog.listActiveGames(req.ctx.pool);
    res.json({
      games: games.map(gamesCatalog.toPublicGame),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/catalog/:key", async (req, res, next) => {
  try {
    const game = await gamesCatalog.getGameByKey(req.ctx.pool, req.params.key);
    if (!game) {
      return res.status(404).json({ error: "game_not_found" });
    }

    res.json({
      game: gamesCatalog.toPublicGame(game),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me/summary", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const summary = await gamesInventory.getGamesSummary(req.ctx.pool, userId);
    res.json(summary);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.get("/me/inventory", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const inventory = await gamesInventory.listUserInventory(req.ctx.pool, userId);
    res.json(inventory);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.get("/me/item-locker", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const locker = await gamesInventory.listUserItemLocker(req.ctx.pool, userId);
    res.json(locker);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.get("/capsule-gacha/catalog", async (req, res, next) => {
  try {
    const game = await gamesCatalog.getGameByKey(req.ctx.pool, "capsule-gacha");
    if (!game) {
      return res.status(404).json({ error: "game_not_found" });
    }

    res.json({
      game: gamesCatalog.toPublicGame(game),
      rewards: await gachaPrizeCatalog.listActivePrizePool(req.ctx.pool, { gameKey: "capsule-gacha" }),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/me/cosmetics/equip", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const inventory = await gamesInventory.equipUserCosmetic(req.ctx.pool, userId, {
      slotKey: req.body?.slot_key,
      userCosmeticId: req.body?.user_cosmetic_id,
    });
    res.json(inventory);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.post("/capsule-gacha/pull", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const result = await gamesGacha.pullCapsuleGacha(req.ctx.pool, {
      userId,
      count: req.body?.count,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    if (error?.code === "insufficient_cash") {
      return res.status(409).json({ error: "insufficient_cash" });
    }
    next(error);
  }
});

router.post("/ticker-tap/sessions", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const result = await gamesSessions.createTickerTapSession(req.ctx.pool, { userId });
    res.status(201).json(result);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    if (error?.code === "insufficient_cash") {
      return res.status(409).json({ error: "insufficient_cash" });
    }
    next(error);
  }
});

router.get("/ticker-tap/sessions/:id", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const session = await gamesSessions.getTickerTapSession(req.ctx.pool, {
      userId,
      sessionId: req.params.id,
    });
    res.json({ session });
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(error);
  }
});

router.post("/ticker-tap/sessions/:id/submit", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const result = await gamesSessions.submitTickerTapSession(req.ctx.pool, {
      userId,
      sessionId: req.params.id,
      payload: req.body,
    });
    res.json(result);
  } catch (error) {
    if (error?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    if (error?.code === "game_session_not_active") {
      return res.status(409).json({ error: "game_session_not_active" });
    }
    next(error);
  }
});

router.get("/ticker-tap/leaderboard", async (req, res, next) => {
  try {
    const result = await gamesSessions.listTickerTapLeaderboard(req.ctx.pool);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/capsule-gacha/spending-leaderboard", async (req, res, next) => {
  try {
    const result = await gamesInventory.listGachaSpendingLeaderboard(req.ctx.pool, {
      limit: req.query.limit,
    });
    res.json({
      game_key: "capsule-gacha",
      leaderboard: result,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:username/item-locker", async (req, res, next) => {
  try {
    const { rows } = await req.ctx.pool.query(
      `SELECT id FROM market.users WHERE username_normalized = $1 LIMIT 1`,
      [String(req.params.username || "").trim().toLowerCase()]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "profile_not_found" });
    }
    const targetUserId = Number(rows[0].id);
    const locker = await gamesInventory.listUserItemLockerByUserId(req.ctx.pool, targetUserId);
    res.json(locker);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
