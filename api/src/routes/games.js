const express = require("express");
const gamesCatalog = require("../services/games/catalog");
const gamesGacha = require("../services/games/gacha");
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

module.exports = router;
