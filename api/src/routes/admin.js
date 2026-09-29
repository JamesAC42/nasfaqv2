// Admin console API, mounted at /api/admin (next to /api/admin/assets and /api/admin/holonews).
// Site admins only: GET /overview (activity numbers for the /admin hub), GET /users (search and
// staff list) and PATCH /users/:id/roles (toggle role flags; rules in services/adminConsole.js).

const express = require("express");
const adminConsole = require("../services/adminConsole");
const exchange = require("../services/games/exchange");
const { requireAdmin } = require("../userContext");

const router = express.Router();

const ERROR_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  cannot_remove_own_admin: 403,
  user_not_found: 404,
  invalid_role: 400,
  invalid_user_id: 400,
  cannot_unverify_email: 400,
  admin_change_needs_confirm: 409,
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
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      const error = new Error("invalid_user_id");
      error.code = "invalid_user_id";
      throw error;
    }
    res.json(await adminConsole.updateUserRoles(req.ctx.pool, actor, userId, req.body));
  })
);

module.exports = router;
