const express = require("express");
const v1Link = require("../services/v1Link");
const { appUrl } = require("../services/email");
const { requireUserId } = require("../userContext");
const { rateLimit, byUser } = require("../rateLimit");

const router = express.Router();
const startLimit = rateLimit(byUser("v1-link-start", 10, 60));

const ERROR_STATUS = { v1_link_not_configured: 503, v1_already_linked: 409, v1_link_not_found: 404 };

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    const status = ERROR_STATUS[error?.code];
    if (!status) return next(error);
    res.status(status).json({ error: error.code });
  }
};

router.get(
  "/me",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await v1Link.getLinkPage(req.ctx.pool, requireUserId(req)));
  })
);

router.post(
  "/start",
  startLimit,
  handle(async (req, res) => {
    requireUserId(req);
    res.json(await v1Link.startLink(req.ctx.pool, req.ctx.user));
  })
);

router.put(
  "/me",
  handle(async (req, res) => {
    res.json({ link: await v1Link.setShowOnProfile(req.ctx.pool, requireUserId(req), req.body?.show_on_profile !== false) });
  })
);

// Where v1 sends the browser back. It carries the signed result, so it answers with a redirect to a
// page with only the outcome in its URL, and without a referrer: the player came through v1 on an
// errand, and "Came from v1" on /admin/analytics shouldn't count that as a visit v1 sent.
router.get(
  "/callback",
  handle(async (req, res) => {
    const status = await v1Link.finishLink(req.ctx.pool, req.ctx.user, req.query.result);
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    res.redirect(303, appUrl(`/link-v1?status=${status}`) ?? `/link-v1?status=${status}`);
  })
);

module.exports = router;
