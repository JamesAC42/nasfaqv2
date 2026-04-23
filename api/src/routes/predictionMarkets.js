const express = require("express");
const predictionMarketDb = require("../predictionMarketDb");
const predictionMarketService = require("../services/predictionMarketService");
const predictionOrderbook = require("../services/predictionOrderbook");
const {
  requireAuthenticatedUser,
  requirePredictionApprover,
  requirePredictionCreator,
  requireVerifiedUser,
} = require("../services/predictionPermissions");

const router = express.Router();

function paginationShape(result) {
  const pageCount = result.total > 0 ? Math.ceil(result.total / result.limit) : 1;
  return {
    total: result.total,
    page: result.page,
    limit: result.limit,
    page_count: pageCount,
    has_previous_page: result.page > 1,
    has_next_page: result.page < pageCount,
  };
}

function parseId(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

router.get("/", async (req, res, next) => {
  try {
    const result = await predictionMarketService.listPredictionMarkets(req.ctx.pool, {
      status: req.query.status,
      query: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
      scope: req.query.scope || "public",
      actorUser: req.ctx.user || null,
    });

    res.json({
      items: result.items,
      pagination: paginationShape(result),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const market = await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      req.ctx.user || null
    );
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug/orderbook", async (req, res, next) => {
  try {
    await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      req.ctx.user || null
    );
    const orderbook = await predictionOrderbook.getPredictionOrderBook(req.ctx.pool, req.params.slug, {
      depth: req.query.depth,
    });
    res.json({ slug: req.params.slug, orderbook });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug/trades", async (req, res, next) => {
  try {
    await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      req.ctx.user || null
    );
    const trades = await predictionOrderbook.getPredictionTrades(req.ctx.pool, req.params.slug, {
      limit: req.query.limit,
    });
    res.json({ slug: req.params.slug, trades });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug/orders/mine", async (req, res, next) => {
  try {
    const actor = requireAuthenticatedUser(req);
    await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      actor
    );
    const orders = await predictionMarketDb.listUserOpenPredictionOrders(
      req.ctx.pool,
      req.params.slug,
      actor.id
    );
    res.json({ slug: req.params.slug, orders });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug/candles", async (req, res, next) => {
  try {
    await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      req.ctx.user || null
    );
    const candles = await predictionOrderbook.getPredictionCandles(req.ctx.pool, req.params.slug, {
      interval: req.query.interval,
      outcomeCode: req.query.outcome,
      limit: req.query.limit,
    });
    res.json({
      slug: req.params.slug,
      interval: String(req.query.interval || "1h"),
      outcome: String(req.query.outcome || "yes"),
      candles,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const actor = requirePredictionCreator(req);
    const market = await predictionMarketService.createPredictionMarket(req.ctx.pool, actor, req.body || {});
    res.status(201).json({ market });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/orders", async (req, res, next) => {
  try {
    const actor = requireVerifiedUser(req);
    const result = await predictionOrderbook.placePredictionOrder(req.ctx.pool, {
      userId: actor.id,
      slug: req.params.slug,
      outcomeCode: req.body?.outcome,
      side: req.body?.side,
      price: req.body?.price,
      quantity: req.body?.quantity,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/:slug/orders/:orderId", async (req, res, next) => {
  try {
    const actor = requireVerifiedUser(req);
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ error: "invalid_prediction_market_order" });
    const result = await predictionOrderbook.cancelPredictionOrder(req.ctx.pool, {
      userId: actor.id,
      slug: req.params.slug,
      orderId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/submit", async (req, res, next) => {
  try {
    const actor = requireVerifiedUser(req);
    const marketId = parseId(req.params.id);
    if (!marketId) return res.status(400).json({ error: "invalid_prediction_market" });
    const market = await predictionMarketService.submitPredictionMarket(req.ctx.pool, marketId, actor);
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/approve", async (req, res, next) => {
  try {
    const actor = requirePredictionApprover(req);
    const marketId = parseId(req.params.id);
    if (!marketId) return res.status(400).json({ error: "invalid_prediction_market" });
    const market = await predictionMarketService.approvePredictionMarket(req.ctx.pool, marketId, actor);
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/reject", async (req, res, next) => {
  try {
    const actor = requirePredictionApprover(req);
    const marketId = parseId(req.params.id);
    if (!marketId) return res.status(400).json({ error: "invalid_prediction_market" });
    const market = await predictionMarketService.rejectPredictionMarket(req.ctx.pool, marketId, actor, {
      reason: req.body?.reason,
    });
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
