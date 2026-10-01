// Predictions v2 routes (docs/predictions/PREDICTIONS_DESIGN.md), mounted at /api/prediction-markets.
// Money moves only through POST /:slug/trade and the limit-order routes; live updates go out on
// /api/prediction-markets/ws.

const express = require("express");
const predictionMarketDb = require("../predictionMarketDb");
const markets = require("../services/predictions/markets");
const trading = require("../services/predictions/trading");
const resolution = require("../services/predictions/resolution");
const auto = require("../services/predictions/auto");
const events = require("../services/predictions/events");
const { requireAuthenticatedUser, requireVerifiedUser } = require("../services/predictionPermissions");

const router = express.Router();

const ERROR_STATUS = {
  unauthenticated: 401,
  email_verification_required: 403,
  forbidden: 403,
  prediction_market_self_approval_forbidden: 403,
  prediction_market_not_found: 404,
  order_not_found: 404,
  template_not_found: 404,
  invalid_prediction_market: 400,
  invalid_outcome: 400,
  invalid_side: 400,
  invalid_amount: 400,
  invalid_limit_price: 400,
  invalid_source_url: 400,
  source_required: 400,
  invalid_dispute_reason: 400,
  insufficient_cash: 409,
  insufficient_credit: 409,
  insufficient_shares: 409,
  price_moved: 409,
  price_at_limit: 409,
  prediction_market_closed: 409,
  prediction_market_transition_invalid: 409,
  order_not_open: 409,
  dispute_window_closed: 409,
  dispute_requires_position: 409,
  already_disputed: 409,
  confirm_requires_second_resolver: 409,
  no_open_proposal: 409,
};

function sendError(res, next, error) {
  const status = ERROR_STATUS[error?.code];
  if (!status) return next(error);
  const body = { error: error.code };
  for (const key of ["field", "quote", "cash_balance", "required_cash", "shares_held"]) if (error[key] !== undefined) body[key] = error[key];
  return res.status(status).json(body);
}

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendError(res, next, error);
  }
};

const marketId = (req) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("prediction_market_not_found");
    error.code = "prediction_market_not_found";
    throw error;
  }
  return id;
};

const notify = (req, action, result) => events.publishMarkets(req.ctx.redis, action, [result]);

// ── Public reads ───────────────────────────────────────────────────────────
router.get(
  "/categories",
  handle(async (req, res) => res.json({ categories: await markets.listCategories(req.ctx.pool) }))
);

router.get(
  "/",
  handle(async (req, res) => {
    const result = await markets.listMarkets(req.ctx.pool, {
      tab: req.query.tab,
      category: req.query.category,
      q: req.query.q,
      status: req.query.status,
      limit: req.query.limit,
      page: req.query.page,
    });
    const pageCount = result.total > 0 ? Math.ceil(result.total / result.limit) : 1;
    res.json({
      items: result.items,
      counts: result.counts,
      pagination: { total: result.total, page: result.page, limit: result.limit, page_count: pageCount, has_previous_page: result.page > 1, has_next_page: result.page < pageCount },
    });
  })
);

router.get("/tape", handle(async (req, res) => res.json({ trades: await markets.listTape(req.ctx.pool, { limit: req.query.limit }) })));
router.get("/leaderboard", handle(async (req, res) => res.json({ forecasters: await markets.getLeaderboard(req.ctx.pool, { limit: req.query.limit }) })));

router.get(
  "/portfolio",
  handle(async (req, res) => {
    const user = requireAuthenticatedUser(req);
    res.json(await markets.getPortfolio(req.ctx.pool, Number(user.id)));
  })
);

// ── Admin ──────────────────────────────────────────────────────────────────
function requireStaff(req) {
  const user = requireAuthenticatedUser(req);
  if (!user.is_admin && !user.can_approve_prediction_markets && !user.can_resolve_prediction_markets && !user.can_void_prediction_markets) {
    const error = new Error("forbidden");
    error.code = "forbidden";
    throw error;
  }
  return user;
}

router.get(
  "/admin/overview",
  handle(async (req, res) => {
    requireStaff(req);
    res.json(await markets.getAdminOverview(req.ctx.pool));
  })
);

router.put(
  "/admin/templates/:key",
  handle(async (req, res) => {
    const user = requireStaff(req);
    res.json({ template: await auto.updateTemplate(req.ctx.pool, user, req.params.key, { enabled: req.body?.enabled, params: req.body?.params }) });
  })
);

router.post(
  "/",
  handle(async (req, res) => {
    const user = requireVerifiedUser(req);
    const result = await markets.createMarket(req.ctx.pool, user, req.body || {});
    if (result.status === "open") await notify(req, "created", result);
    res.status(201).json({ market: result });
  })
);

const adminAction = (path, fn, action) =>
  router.post(
    `/:id/${path}`,
    handle(async (req, res) => {
      const user = requireAuthenticatedUser(req);
      const result = await fn(req, user, marketId(req));
      await notify(req, action, result);
      res.json({ market: result });
    })
  );

adminAction("submit", (req, user, id) => markets.submitMarket(req.ctx.pool, user, id), "submitted");
adminAction("approve", (req, user, id) => markets.approveMarket(req.ctx.pool, user, id), "approved");
adminAction("reject", (req, user, id) => markets.rejectMarket(req.ctx.pool, user, id, { reason: req.body?.reason }), "rejected");
adminAction("close", (req, user, id) => resolution.closeMarket(req.ctx.pool, user, id), "closed");
adminAction("halt", (req, user, id) => resolution.setHalted(req.ctx.pool, user, id, true), "halted");
adminAction("resume", (req, user, id) => resolution.setHalted(req.ctx.pool, user, id, false), "resumed");
adminAction(
  "propose",
  (req, user, id) => resolution.propose(req.ctx.pool, user, id, { outcome: req.body?.outcome, sourceUrl: req.body?.source_url, note: req.body?.note }),
  "proposed"
);
adminAction(
  "overturn",
  (req, user, id) => resolution.overturn(req.ctx.pool, user, id, { outcome: req.body?.outcome, sourceUrl: req.body?.source_url, note: req.body?.note }),
  "proposed"
);
adminAction("withdraw", (req, user, id) => resolution.withdraw(req.ctx.pool, user, id), "withdrawn");
adminAction("confirm", (req, user, id) => resolution.confirm(req.ctx.pool, user, id), "resolved");
adminAction("void", (req, user, id) => resolution.voidMarket(req.ctx.pool, user, id, { reason: req.body?.reason }), "voided");

router.post(
  "/:id/dispute",
  handle(async (req, res) => {
    const user = requireVerifiedUser(req);
    const result = await resolution.dispute(req.ctx.pool, user, marketId(req), { reason: req.body?.reason });
    await notify(req, "disputed", result);
    res.status(201).json({ market: result });
  })
);

// ── Market reads ───────────────────────────────────────────────────────────
router.get("/:slug", handle(async (req, res) => res.json({ market: await markets.getMarketDetail(req.ctx.pool, req.params.slug, req.ctx.user || null) })));
// The chart, tape and quote follow the market page's rule: a draft or private market is only
// visible to its creator and the approvers (anyone else gets not-found, not its title and outcomes).
const visibleMarket = handle(async (req, res) => {
  const { rows } = await req.ctx.pool.query(`SELECT status, visibility, creator_user_id FROM market.prediction_markets WHERE slug = $1`, [String(req.params.slug || "")]);
  if (!rows[0] || !markets.canSeeMarket(rows[0], req.ctx.user || null)) {
    const error = new Error("prediction_market_not_found");
    error.code = "prediction_market_not_found";
    throw error;
  }
  req.visibleMarketChecked = true;
});
const whenVisible = (fn) => async (req, res, next) => {
  await visibleMarket(req, res, next);
  if (req.visibleMarketChecked) return fn(req, res, next);
};

router.get("/:slug/chart", whenVisible(handle(async (req, res) => res.json(await markets.getChart(req.ctx.pool, req.params.slug, { range: req.query.range })))));
router.get("/:slug/trades", whenVisible(handle(async (req, res) => res.json({ trades: await markets.listTrades(req.ctx.pool, req.params.slug, { limit: req.query.limit }) }))));
router.get(
  "/:slug/quote",
  whenVisible(handle(async (req, res) =>
    res.json(
      await trading.quote(req.ctx.pool, {
        slug: req.params.slug,
        outcomeCode: req.query.outcome,
        side: req.query.side === "sell" ? "sell" : "buy",
        amount: req.query.amount,
        shares: req.query.shares,
        userId: req.ctx.user?.id ?? null,
      })
    )
  ))
);

// ── Trading ────────────────────────────────────────────────────────────────
router.post(
  "/:slug/trade",
  handle(async (req, res) => {
    const user = requireVerifiedUser(req);
    const result = await trading.trade(req.ctx.pool, {
      userId: Number(user.id),
      slug: req.params.slug,
      outcomeCode: req.body?.outcome,
      side: req.body?.side,
      amount: req.body?.amount ?? null,
      shares: req.body?.shares ?? null,
      maxAvgPrice: req.body?.max_avg_price ?? null,
      minAvgPrice: req.body?.min_avg_price ?? null,
    });
    await events.publishTrades(req.ctx.redis, result.fills.map((fill, index) => (index === 0 ? { ...fill, username: user.username } : fill)));
    res.status(201).json({ fill: result.fill, cash_balance: result.cash_balance, triggered: result.fills.length - 1 });
  })
);

router.post(
  "/:slug/limit-orders",
  handle(async (req, res) => {
    const user = requireVerifiedUser(req);
    const result = await trading.placeLimitOrder(req.ctx.pool, {
      userId: Number(user.id),
      slug: req.params.slug,
      outcomeCode: req.body?.outcome,
      side: req.body?.side,
      limitPrice: req.body?.limit_price,
      amount: req.body?.amount ?? null,
      shares: req.body?.shares ?? null,
    });
    await events.publishTrades(req.ctx.redis, result.fills);
    res.status(201).json(result);
  })
);

router.delete(
  "/:slug/limit-orders/:orderId",
  handle(async (req, res) => {
    const user = requireAuthenticatedUser(req);
    res.json({ order: await trading.cancelLimitOrder(req.ctx.pool, { userId: Number(user.id), orderId: Number(req.params.orderId) }) });
  })
);

// ── Comments (from the first build) ───────────────────────────────────────
router.get(
  "/:slug/comments",
  handle(async (req, res) => {
    const result = await predictionMarketDb.listPredictionMarketComments(req.ctx.pool, req.params.slug, {
      page: req.query.page,
      limit: req.query.limit,
      viewerUserId: req.ctx.user?.id || null,
    });
    const pageCount = result.total > 0 ? Math.ceil(result.total / result.limit) : 1;
    res.json({
      slug: result.slug,
      comments: result.comments,
      pagination: { total: result.total, page: result.page, limit: result.limit, page_count: pageCount, has_previous_page: result.page > 1, has_next_page: result.page < pageCount },
      viewer_context: result.viewer_context,
    });
  })
);

router.post(
  "/:slug/comments",
  handle(async (req, res) => {
    const user = requireVerifiedUser(req);
    const comment = await predictionMarketDb.createPredictionMarketComment(req.ctx.pool, req.params.slug, user.id, { body: req.body?.body });
    res.status(201).json({ comment });
  })
);

module.exports = router;
