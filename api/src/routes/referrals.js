// Referral links (services/referrals.js).
// GET /api/referrals/me: the signed-in player's link, who joined through it and what's been paid.
// GET /api/referrals/invite/:code: whose link a code is, for the sign-up form's "Invited by" line.
// Behind the `referrals` flag: /me 404s for anyone it's off for (so no code is made for them), and
// /invite 404s for a code whose owner it's off for (services/referrals.js, inviteFor).

const express = require("express");
const { requireFeature } = require("../features");
const { rateLimit, byIp } = require("../rateLimit");
const referrals = require("../services/referrals");

const router = express.Router();

router.get("/me", requireFeature("referrals"), async (req, res, next) => {
  try {
    if (!req.ctx.user) return res.status(401).json({ error: "unauthenticated" });
    res.set("Cache-Control", "no-store");
    res.json(await referrals.referralSummary(req.ctx.pool, Number(req.ctx.user.id)));
  } catch (error) {
    next(error);
  }
});

router.get("/invite/:code", rateLimit(byIp("referral-invite", 30, 60)), async (req, res, next) => {
  try {
    const invite = await referrals.inviteFor(req.ctx.pool, req.params.code);
    res.set("Cache-Control", "no-store");
    if (!invite) return res.status(404).json({ error: "not_found" });
    res.json({ ...invite, reward: referrals.publicSettings() });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
