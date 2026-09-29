// Admin: maintenance by hand. Pauses new games site-wide with a message for players (games in play
// finish). Trading has its own switch (/internal/market/close). Releases pause games on their own
// (scripts/maintenance.js); ending maintenance here ends that too.

const express = require("express");
const siteState = require("../services/siteState");

const router = express.Router();

router.use((req, res, next) => {
  if (!req.ctx?.user) return res.status(401).json({ error: "unauthenticated" });
  if (!req.ctx.user.is_admin) return res.status(403).json({ error: "forbidden" });
  return next();
});

router.post("/maintenance", async (req, res, next) => {
  try {
    const on = req.body?.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: "invalid_request" });
    const site = await siteState.setMaintenance(req.ctx.pool, { state: on ? "on" : "off", source: "admin", message: on ? req.body?.message : null });
    void siteState.publishSiteState(req.ctx.redis, site);
    res.json({ ok: true, site });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
