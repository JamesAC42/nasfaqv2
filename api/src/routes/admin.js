// Admin console API, mounted at /api/admin (next to /api/admin/assets and /api/admin/holonews).
// Site admins only: GET /overview (activity numbers for the /admin hub), GET /users (search and
// staff list) and PATCH /users/:id/roles (toggle role flags; rules in services/adminConsole.js).
// Moderation (services/moderation.js): suspensions, profile resets, hidden comments and the log of
// admin actions (GET /moderation/actions).

const express = require("express");
const adminConsole = require("../services/adminConsole");
const exchange = require("../services/games/exchange");
const moderation = require("../services/moderation");
const profileDb = require("../profileDb");
const { requireAdmin } = require("../userContext");

const router = express.Router();

const ERROR_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  cannot_remove_own_admin: 403,
  cannot_suspend_self: 403,
  cannot_suspend_admin: 403,
  user_not_found: 404,
  profile_not_found: 404,
  comment_not_found: 404,
  invalid_role: 400,
  invalid_user_id: 400,
  invalid_suspension: 400,
  invalid_comment_kind: 400,
  invalid_request: 400,
  cannot_unverify_email: 400,
  admin_change_needs_confirm: 409,
  username_taken: 409,
};

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    const status = ERROR_STATUS[error?.code];
    if (!status) return next(error);
    const body = { error: error.code };
    if (error.field !== undefined) body.field = error.field;
    res.status(status).json(body);
  }
};

function requireSiteAdmin(req) {
  if (!req.ctx?.user?.id) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }
  return requireAdmin(req);
}

function targetUserId(req) {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    const error = new Error("invalid_user_id");
    error.code = "invalid_user_id";
    throw error;
  }
  return userId;
}

router.get(
  "/overview",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json(await adminConsole.getOverview(req.ctx.pool));
  })
);

// Card exchange transfers worth a look: lopsided sales and trades involving new accounts.
router.get(
  "/exchange-review",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    res.json(await exchange.reviewFlags(req.ctx.pool, { days }));
  })
);

router.get(
  "/users",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    const users = await adminConsole.searchUsers(req.ctx.pool, { q: req.query.q, role: req.query.role });
    res.json({ users, roles: adminConsole.ROLE_FLAGS });
  })
);

router.patch(
  "/users/:userId/roles",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    const userId = targetUserId(req);
    res.json(await adminConsole.updateUserRoles(req.ctx.pool, actor, userId, req.body));
  })
);

// Exchange freeze: { frozen: true, note? } shuts a player out of the card and item exchange.
router.patch(
  "/users/:userId/exchange",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    const userId = targetUserId(req);
    res.json(await adminConsole.setExchangeFreeze(req.ctx.pool, actor, userId, req.body));
  })
);

// Site-wide suspension: { suspended: true, duration: "24h" | "7d" | "30d" | "permanent", reason }
// makes the account read-only and signs it out everywhere; { suspended: false, reason? } lifts it.
router.patch(
  "/users/:userId/suspension",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    const userId = targetUserId(req);
    const result = await moderation.setSuspension(req.ctx.pool, actor, userId, req.body);
    res.json({ user: await adminConsole.getAdminUser(req.ctx.pool, userId), sessions_revoked: result.sessions_revoked });
  })
);

// Profile reset for an offensive profile: renames to player_<id>, clears the bio and the banner.
router.post(
  "/users/:userId/reset-profile",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    const userId = targetUserId(req);
    const { before, after } = await profileDb.resetProfile(req.ctx.pool, userId);
    await moderation.logAction(req.ctx.pool, {
      actor,
      action: "user.reset_profile",
      targetType: "user",
      targetId: userId,
      targetLabel: before.username,
      reason: req.body?.reason,
      details: { before, after },
    });
    res.json({ user: await adminConsole.getAdminUser(req.ctx.pool, userId), before, after });
  })
);

// Hide (or bring back) a comment: kind is stock, article or prediction; body { hidden, reason? }.
router.post(
  "/comments/:kind/:commentId/hide",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(
      await moderation.setCommentHidden(req.ctx.pool, actor, {
        kind: req.params.kind,
        commentId: req.params.commentId,
        hidden: req.body?.hidden,
        reason: req.body?.reason,
      })
    );
  })
);

// The admin action log, newest first (/admin/moderation).
router.get(
  "/moderation/actions",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json({ actions: await moderation.listActions(req.ctx.pool, { limit: req.query.limit }) });
  })
);

module.exports = router;
