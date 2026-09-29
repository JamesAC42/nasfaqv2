// GET /api/site: which release is live, whether maintenance is on, and how many people are online.
// Every page reads it on load and when it comes back into view (changes also arrive on the market
// socket), so it's cached for a few seconds per process.

const express = require("express");
const presence = require("../services/presence");
const siteState = require("../services/siteState");

const router = express.Router();
const CACHE_MS = 3000;
let cached = null;

router.get("/", async (req, res, next) => {
  try {
    if (!cached || Date.now() - cached.at > CACHE_MS) {
      const [site, online] = await Promise.all([
        siteState.getSiteState(req.ctx.pool),
        req.ctx.redis ? presence.count(req.ctx.redis).catch(() => null) : null,
      ]);
      cached = { at: Date.now(), site, online };
    }
    res.set("Cache-Control", "no-store");
    res.json({ site: cached.site, online: cached.online });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
