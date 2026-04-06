const express = require("express");
const netWorth = require("../services/netWorth");

const router = express.Router();

function parseLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}

router.get("/", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 100);
    const entries = await netWorth.listCurrentNetWorthLeaderboard(req.ctx.pool, { limit });
    res.json(entries);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
