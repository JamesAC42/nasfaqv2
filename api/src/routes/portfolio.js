const express = require("express");
const trading = require("../services/trading");
const { requireUserId } = require("../userContext");

const router = express.Router();

function parseLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}

router.get("/me", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const portfolio = await trading.getPortfolioSummary(req.ctx.pool, userId);
    res.json(portfolio);
  } catch (e) {
    if (e?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(e);
  }
});

router.get("/me/ledger", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const limit = parseLimit(req.query.limit, 100);
    const ledger = await trading.getPortfolioLedger(req.ctx.pool, userId, { limit });
    res.json({ user_id: userId, ledger });
  } catch (e) {
    if (e?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(e);
  }
});

router.get("/me/orders", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const limit = parseLimit(req.query.limit, 100);
    const orders = await trading.getPortfolioOrders(req.ctx.pool, userId, { limit });
    res.json({ user_id: userId, orders });
  } catch (e) {
    if (e?.code === "unauthenticated") {
      return res.status(401).json({ error: "unauthenticated" });
    }
    next(e);
  }
});

module.exports = router;
