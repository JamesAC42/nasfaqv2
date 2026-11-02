// GET /api/site: which release is live, whether maintenance is on, how many people are online, and
// the announcement popups this visitor may see (services/announcements.js).
// GET /api/site/announcements/me: which popups a signed-in player has dismissed.
// POST /api/site/announcements/dismiss: a signed-in player dismisses some.
// POST /api/site/bug-reports: a bug report (services/bugReports.js).
// POST /api/site/csp-report: a browser's Content-Security-Policy violation report.
// Every page reads it on load and when it comes back into view (changes also arrive on the market
// socket), so it's cached for a few seconds per process.

const express = require("express");
const { rateLimit, byIp, byUser } = require("../rateLimit");
const announcements = require("../services/announcements");
const bugReports = require("../services/bugReports");
const cspReports = require("../services/cspReports");
const presence = require("../services/presence");
const siteState = require("../services/siteState");
const { requireUserId } = require("../userContext");

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
    const running = await announcements.listLive(req.ctx.pool);
    res.set("Cache-Control", "no-store");
    res.json({ site: cached.site, online: cached.online, announcements: announcements.forViewer(running, req.ctx.user) });
  } catch (error) {
    next(error);
  }
});

// The page only asks when it has an announcement left to show, so a player who has seen them all
// costs nothing here.
router.get("/announcements/me", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.set("Cache-Control", "no-store");
    res.json(await announcements.viewerState(req.ctx.pool, userId));
  } catch (error) {
    next(error);
  }
});

router.post("/announcements/dismiss", async (req, res, next) => {
  try {
    await announcements.dismiss(req.ctx.pool, requireUserId(req), req.body?.ids);
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === "invalid_announcement_ids") return res.status(400).json({ error: error.code });
    next(error);
  }
});

// POST /api/site/bug-reports: the "Report a bug" button. Signed out is fine (sign-in trouble is a
// bug too); the limits keep it from being a spam pipe into Discord.
router.post(
  "/bug-reports",
  rateLimit(byIp("bug-report", 6, 3600), byUser("bug-report", 10, 3600)),
  async (req, res, next) => {
    try {
      const report = await bugReports.createReport(req.ctx.pool, {
        user: req.ctx.user ?? null,
        message: req.body?.message,
        page: req.body?.page,
        userAgent: req.headers["user-agent"],
        version: req.body?.version,
      });
      void bugReports.notifyDiscord(report);
      res.status(201).json({ ok: true, id: report.id });
    } catch (error) {
      if (error?.code === "invalid_report") return res.status(400).json({ error: "invalid_report" });
      next(error);
    }
  }
);

// POST /api/site/csp-report: Content-Security-Policy violation reports, sent by browsers on their
// own (services/cspReports.js). server.js keeps them out of the players' write budget.
router.post(
  "/csp-report",
  rateLimit(byIp("csp-report", 60, 60)),
  express.json({ type: ["application/csp-report", "application/reports+json"], limit: "64kb" }),
  async (req, res) => {
    await cspReports.recordReports(req.ctx.redis, req.body).catch(() => {});
    res.status(204).end();
  }
);

module.exports = router;
