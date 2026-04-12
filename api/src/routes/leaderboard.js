const express = require("express");
const netWorth = require("../services/netWorth");

const router = express.Router();

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

router.get("/", async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 25);
    const page = parsePage(req.query.page, 1);
    const scope = parseScope(req.query.scope);
    const window = parseWindow(req.query.window);
    const bundle = await netWorth.listLeaderboardBundle(req.ctx.pool, {
      viewerUserId: req.ctx.user?.id || null,
      scope,
      window,
      page,
      limit,
    });
    res.json(bundle);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
