// Admin, site-wide:
// - Maintenance by hand. Pauses new games site-wide with a message for players (games in play
//   finish). Trading has its own switch (/internal/market/close). Releases pause games on their own
//   (scripts/maintenance.js); ending maintenance here ends that too.
// - Bug reports from the "Report a bug" button: list them, mark them resolved (or open again).

const express = require("express");
const bugReports = require("../services/bugReports");
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

router.get("/bug-reports", async (req, res, next) => {
  try {
    res.json(await bugReports.listReports(req.ctx.pool, { status: String(req.query.status || "open"), limit: req.query.limit }));
  } catch (error) {
    next(error);
  }
});

router.post("/bug-reports/:id/resolve", async (req, res, next) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_request" });
    const resolved = req.body?.resolved !== false;
    res.json({ ok: true, report: await bugReports.setResolved(req.ctx.pool, id, { resolved, adminId: req.ctx.user.id }) });
  } catch (error) {
    if (error?.code === "bug_report_not_found") return res.status(404).json({ error: "bug_report_not_found" });
    next(error);
  }
});

module.exports = router;
