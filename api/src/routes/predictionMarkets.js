const express = require("express");
const predictionMarketDb = require("../predictionMarketDb");
const predictionMarketService = require("../services/predictionMarketService");
const predictionOrderbook = require("../services/predictionOrderbook");
const predictionSettlement = require("../services/predictionSettlement");
const { publishPredictionMarketEvent } = require("../services/predictionMarketEvents");
const {
  requireAuthenticatedUser,
  requirePredictionApprover,
  requirePredictionCreator,
  requirePredictionResolver,
  requirePredictionVoider,
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

async function publishMarketUpdate(req, action, market, extra = {}) {
  await publishPredictionMarketEvent(req.ctx.redis, {
    type: "prediction.market.updated",
    action,
    slug: market?.slug || null,
    market_id: market?.id || null,
    market: market || null,
    ...extra,
  });
}

router.get("/categories", async (req, res, next) => {
  try {
    const categories = await predictionMarketDb.listPredictionMarketCategories(req.ctx.pool);
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

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

router.get("/:slug/events", async (req, res, next) => {
  try {
    await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      req.ctx.user || null
    );
    const events = await predictionMarketDb.listPredictionMarketEvents(req.ctx.pool, req.params.slug, {
      limit: req.query.limit,
    });
    res.json({ slug: req.params.slug, events });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug/positions/mine", async (req, res, next) => {
  try {
    const actor = requireAuthenticatedUser(req);
    await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      actor
    );
    const positions = await predictionMarketDb.listUserPredictionPositions(
      req.ctx.pool,
      req.params.slug,
      actor.id
    );
    res.json({ slug: req.params.slug, positions });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug/comments", async (req, res, next) => {
  try {
    await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      req.ctx.user || null
    );
    const result = await predictionMarketDb.listPredictionMarketComments(req.ctx.pool, req.params.slug, {
      page: req.query.page,
      limit: req.query.limit,
      viewerUserId: req.ctx.user?.id || null,
    });
    res.json({
      slug: result.slug,
      comments: result.comments,
      pagination: paginationShape(result),
      viewer_context: result.viewer_context,
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

router.post("/:slug/comments", async (req, res, next) => {
  try {
    const actor = requireVerifiedUser(req);
    await predictionMarketService.getPredictionMarketDetail(
      req.ctx.pool,
      req.params.slug,
      actor
    );
    await predictionMarketDb.createPredictionMarketComment(req.ctx.pool, req.params.slug, actor.id, {
      body: req.body?.body,
    });
    const result = await predictionMarketDb.listPredictionMarketComments(req.ctx.pool, req.params.slug, {
      page: 1,
      limit: req.query.limit || 12,
      viewerUserId: actor.id,
    });
    await publishMarketUpdate(req, "comment_created", { id: result.comments[0]?.market_id || null, slug: result.slug });
    res.status(201).json({
      slug: result.slug,
      comments: result.comments,
      pagination: paginationShape(result),
      viewer_context: result.viewer_context,
    });
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
    await publishMarketUpdate(req, "created", market);
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
    await publishMarketUpdate(req, "order_placed", result.market, {
      order_id: result.order_id,
      order_status: result.order_status,
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
    await publishMarketUpdate(req, "order_cancelled", result.market, {
      order_id: result.order_id,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/close", async (req, res, next) => {
  try {
    const actor = requirePredictionResolver(req);
    const marketId = parseId(req.params.id);
    if (!marketId) return res.status(400).json({ error: "invalid_prediction_market" });
    const market = await predictionSettlement.closePredictionMarket(req.ctx.pool, marketId, actor, {
      reason: req.body?.reason,
    });
    await publishMarketUpdate(req, "closed", market);
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/resolve", async (req, res, next) => {
  try {
    const actor = requirePredictionResolver(req);
    const marketId = parseId(req.params.id);
    if (!marketId) return res.status(400).json({ error: "invalid_prediction_market" });
    const market = await predictionSettlement.resolvePredictionMarket(req.ctx.pool, marketId, actor, {
      outcome: req.body?.outcome,
      notes: req.body?.notes,
    });
    await publishMarketUpdate(req, "resolved", market);
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/void", async (req, res, next) => {
  try {
    const actor = requirePredictionVoider(req);
    const marketId = parseId(req.params.id);
    if (!marketId) return res.status(400).json({ error: "invalid_prediction_market" });
    const market = await predictionSettlement.voidPredictionMarket(req.ctx.pool, marketId, actor, {
      reason: req.body?.reason,
    });
    await publishMarketUpdate(req, "voided", market);
    res.json({ market });
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
    await publishMarketUpdate(req, "submitted", market);
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
    await publishMarketUpdate(req, "approved", market);
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
    await publishMarketUpdate(req, "rejected", market);
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
