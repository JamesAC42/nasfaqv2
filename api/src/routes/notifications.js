const express = require("express");

const notifications = require("../services/notifications");
const { requireUserId } = require("../userContext");

const router = express.Router();

// GET /api/notifications?limit=30&before=<id> → { notifications, unread, has_more }
router.get("/", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json(await notifications.list(req.ctx.pool, userId, { limit: req.query.limit, before: req.query.before || null }));
  } catch (error) {
    if (error?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    next(error);
  }
});

router.get("/unread", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    res.json({ unread: await notifications.unreadCount(req.ctx.pool, userId) });
  } catch (error) {
    if (error?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    next(error);
  }
});

// POST /api/notifications/read { ids: [..] } or { all: true } → { unread }
router.post("/read", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const unread = await notifications.markRead(req.ctx.pool, userId, { ids: req.body?.ids, all: req.body?.all === true });
    res.json({ unread });
  } catch (error) {
    if (error?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
    next(error);
  }
});

module.exports = router;
