// GET /api/site: which release is live and whether maintenance is on. Every page reads it on load
// and when it comes back into view (changes also arrive on the market socket), so it's cached for a
// few seconds per process.

const express = require("express");
const siteState = require("../services/siteState");

const router = express.Router();
const CACHE_MS = 3000;
let cached = null;

router.get("/", async (req, res, next) => {
  try {
    if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), site: await siteState.getSiteState(req.ctx.pool) };
    res.set("Cache-Control", "no-store");
    res.json({ site: cached.site });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
