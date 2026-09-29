const express = require("express");
const gamesCatalog = require("../services/games/catalog");
const gamesGacha = require("../services/games/gacha");
const gachaPrizeCatalog = require("../services/games/gachaPrizeCatalog");
const gamesInventory = require("../services/games/inventory");
const gamesSessions = require("../services/games/sessions");
const cardGacha = require("../services/games/cardGacha");
const exchange = require("../services/games/exchange");
const { requireUserId, requireVerifiedUserId } = require("../userContext");

const router = express.Router();

// Known game errors → HTTP status. Anything else falls through to the 500 handler.
const ERROR_STATUS = {
  unauthenticated: 401,
  email_verification_required: 403,
  forbidden: 403,
  insufficient_cash: 409,
  insufficient_shards: 409,
  reward_already_claimed: 409,
  set_incomplete: 409,
  card_not_owned: 409,
  table_full: 409,
  table_not_open: 409,
  already_seated: 409,
  not_your_turn: 409,
  invalid_action: 409,
  game_not_found: 404,
  banner_not_found: 404,
  table_not_found: 404,
  invalid_pull_count: 400,
  invalid_card: 400,
  invalid_reward: 400,
  invalid_stake: 400,
  invalid_deck: 400,
  invalid_bet: 400,
  card_pool_empty: 503,
  games_paused: 503,
  game_session_not_found: 404,
  game_session_not_active: 409,
  run_too_fast: 409,
  invalid_game_session: 400,
  // Card exchange
  card_bound: 409,
  card_not_tradeable: 409,
  exchange_account_too_new: 403,
  exchange_daily_limit: 429,
  exchange_listing_limit: 409,
  exchange_offer_limit: 409,
  exchange_wishlist_full: 409,
  invalid_price: 400,
  invalid_duration: 400,
  invalid_listing: 400,
  invalid_trade: 400,
  trade_one_sided: 400,
  trade_with_self: 400,
  listing_not_found: 404,
  trade_not_found: 404,
  trade_partner_not_found: 404,
  listing_closed: 409,
  auction_has_bids: 409,
  own_listing: 409,
  buy_now_unavailable: 409,
  not_an_auction: 409,
  bid_too_low: 409,
  trade_closed: 409,
};

function sendGameError(res, next, error) {
  const status = ERROR_STATUS[error?.code];
  if (!status) return next(error);
  const body = { error: error.code };
  for (const key of ["cash_balance", "required_cash", "shards", "required_shards", "min_bid", "available_at", "limit", "field", "card_key", "tradeable", "status"]) {
    if (error[key] !== undefined) body[key] = error[key];
  }
  return res.status(status).json(body);
}

// ── Talent cards ─────────────────────────────────────────────────────────
router.get("/cards/banners", async (req, res, next) => {
  try {
    const talents = await require("../services/games/cards").listTalents(req.ctx.pool);
    const banners = await cardGacha.getBanners(req.ctx.pool, talents);
    const game = await gamesCatalog.getGameByKey(req.ctx.pool, cardGacha.GAME_KEY);
    res.json({ banners, pull_cost_cash: Number(game?.config_json?.pull_cost_cash ?? 100), ten_pull_cost_cash: Number(game?.config_json?.ten_pull_cost_cash ?? 900) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/cards/collection", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json(await cardGacha.getCollection(req.ctx.pool, userId));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/cards/pull", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const result = await cardGacha.pullCards(req.ctx.pool, { userId, bannerKey: req.body?.banner, count: req.body?.count });
    res.status(201).json(result);
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/cards/craft", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    res.status(201).json(await cardGacha.craftCard(req.ctx.pool, { userId, cardKey: req.body?.card_key }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/cards/claim", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    res.status(201).json(await cardGacha.claimReward(req.ctx.pool, { userId, rewardKey: String(req.body?.reward_key || "") }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.put("/cards/showcase", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json(await cardGacha.setShowcase(req.ctx.pool, { userId, cardKeys: req.body?.card_keys }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/cards/feed", async (req, res, next) => {
  try {
    res.json({ pulls: await cardGacha.listRecentTopPulls(req.ctx.pool, { limit: req.query.limit }) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/cards/profile/:username", async (req, res, next) => {
  try {
    const result = await cardGacha.getPublicCollection(req.ctx.pool, req.params.username);
    if (!result) return res.status(404).json({ error: "profile_not_found" });
    res.json(result);
  } catch (error) {
    sendGameError(res, next, error);
  }
});

// ── Card exchange ────────────────────────────────────────────────────────
const viewerIdOf = (req) => (req.ctx?.user?.id ? Number(req.ctx.user.id) : null);
const idParam = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

router.get("/exchange/overview", async (req, res, next) => {
  try {
    res.json(await exchange.overview(req.ctx.pool, { viewerId: viewerIdOf(req) }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/exchange/listings", async (req, res, next) => {
  try {
    const { rarity, kind, symbol, unit, q, sort, page } = req.query;
    res.json(await exchange.browseListings(req.ctx.pool, { viewerId: viewerIdOf(req), rarity, kind, symbol, unit, q, sort, page }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/exchange/prices", async (req, res, next) => {
  try {
    res.json({ prices: await exchange.priceBook(req.ctx.pool) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/exchange/cards/:symbol/:rarity", async (req, res, next) => {
  try {
    const key = `card:${String(req.params.symbol).toUpperCase()}:${String(req.params.rarity).toUpperCase()}`;
    res.json(await exchange.cardDetail(req.ctx.pool, { cardKey: key, viewerId: viewerIdOf(req) }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

// Wishlist: POST { card_key } adds, DELETE /exchange/wishlist/:symbol/:rarity removes.
router.post("/exchange/wishlist", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.status(201).json(await exchange.addWish(req.ctx.pool, { userId, cardKey: req.body?.card_key }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.delete("/exchange/wishlist/:symbol/:rarity", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const key = `card:${String(req.params.symbol).toUpperCase()}:${String(req.params.rarity).toUpperCase()}`;
    res.json(await exchange.removeWish(req.ctx.pool, { userId, cardKey: key }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/exchange/me", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json(await exchange.myDesk(req.ctx.pool, { userId }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/exchange/listings", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const body = req.body || {};
    const result = await exchange.createListing(req.ctx.pool, {
      userId,
      cardKey: String(body.card_key || ""),
      kind: body.kind,
      price: body.price,
      startPrice: body.start_price,
      buyNow: body.buy_now,
      durationHours: body.duration_hours,
    });
    res.status(201).json(result);
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.delete("/exchange/listings/:id", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json(await exchange.cancelListing(req.ctx.pool, { userId, listingId: idParam(req.params.id) }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/exchange/listings/:id/buy", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    res.status(201).json(await exchange.buyListing(req.ctx.pool, { userId, listingId: idParam(req.params.id) }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/exchange/listings/:id/bids", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    res.status(201).json(await exchange.placeBid(req.ctx.pool, { userId, listingId: idParam(req.params.id), amount: req.body?.amount }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/exchange/trades", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json(await exchange.listTrades(req.ctx.pool, { userId }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/exchange/trades", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const body = req.body || {};
    const result = await exchange.proposeTrade(req.ctx.pool, {
      userId,
      toUsername: body.to_username,
      give: body.give,
      ask: body.ask,
      message: body.message,
      counterOf: body.counter_of ? idParam(body.counter_of) : null,
    });
    res.status(201).json(result);
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/exchange/trades/:id/:action(accept|decline|cancel)", async (req, res, next) => {
  try {
    const userId = req.params.action === "accept" ? requireVerifiedUserId(req) : requireUserId(req);
    res.json(await exchange.respondToTrade(req.ctx.pool, { userId, tradeId: idParam(req.params.id), action: req.params.action }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/exchange/players/:username/cards", async (req, res, next) => {
  try {
    res.json(await exchange.tradeableCards(req.ctx.pool, { username: req.params.username }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

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
    // user_cosmetic_id: null empties the slot.
    const inventory =
      req.body?.user_cosmetic_id === null
        ? await gamesInventory.unequipUserCosmetic(req.ctx.pool, userId, { slotKey: req.body?.slot_key })
        : await gamesInventory.equipUserCosmetic(req.ctx.pool, userId, {
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
    const userId = requireVerifiedUserId(req);
    const result = await gamesGacha.pullCapsuleGacha(req.ctx.pool, {
      userId,
      count: req.body?.count,
    });
    res.status(201).json(result);
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/ticker-tap/sessions", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    res.status(201).json(await gamesSessions.createTickerTapSession(req.ctx.pool, { userId }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/ticker-tap/sessions/:id", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json({ session: await gamesSessions.getTickerTapSession(req.ctx.pool, { userId, sessionId: req.params.id }) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/ticker-tap/sessions/:id/submit", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json(await gamesSessions.submitTickerTapSession(req.ctx.pool, { userId, sessionId: req.params.id, payload: req.body }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/ticker-tap/leaderboard", async (req, res, next) => {
  try {
    const result = await gamesSessions.listTickerTapLeaderboard(req.ctx.pool, { userId: req.ctx?.user?.id || null });
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
    const [locker, inventory] = await Promise.all([
      gamesInventory.listUserItemLockerByUserId(req.ctx.pool, targetUserId),
      gamesInventory.listUserInventory(req.ctx.pool, targetUserId),
    ]);
    // Owned cosmetics (capsule prizes and set rewards) and what's equipped are public, like the showcase.
    res.json({ ...locker, cosmetics: inventory.cosmetics, equipped: inventory.equipped });
  } catch (error) {
    next(error);
  }
});

router.sendGameError = sendGameError;

module.exports = router;
