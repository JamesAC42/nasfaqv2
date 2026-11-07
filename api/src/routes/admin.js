// Admin console API, mounted at /api/admin (next to /api/admin/assets and /api/admin/holonews).
// Site admins only: GET /overview (activity numbers for the /admin hub), GET /schedulers (heartbeats),
// GET /users (search and staff list) and PATCH /users/:id/roles (toggle role flags; rules in
// services/adminConsole.js).
// Moderation (services/moderation.js): suspensions, profile resets, hidden comments and the log of
// admin actions (GET /moderation/actions).
// The /admin/users page (services/adminUsers.js): GET /users/directory, POST /users/find-by-email,
// GET /users/:id and the account fixes under /users/:id.
// Site traffic (services/umami.js): GET /analytics. Our own numbers (services/playerAnalytics.js):
// GET /player-analytics.
// Announcement popups (services/announcements.js): GET and POST /announcements, PATCH and DELETE
// /announcements/:id, POST /announcements/:id/retire and /restore.

const express = require("express");
const adminConsole = require("../services/adminConsole");
const adminUsers = require("../services/adminUsers");
const announcements = require("../services/announcements");
const { announceSessionsRevoked } = require("../services/auth");
const exchange = require("../services/games/exchange");
const { ipClusters, ipHashingEnabled, sharedIpAccounts } = require("../services/ipHash");
const schedulerHealth = require("../services/schedulerHealth");
const moderation = require("../services/moderation");
const umami = require("../services/umami");
const playerAnalytics = require("../services/playerAnalytics");
const visits = require("../services/visits");
const v1Link = require("../services/v1Link");
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
  invalid_username: 400,
  username_not_allowed: 400,
  username_reserved: 400,
  username_talent: 400,
  invalid_email: 400,
  disposable_email: 400,
  email_taken: 409,
  email_unchanged: 409,
  email_change_needs_confirm: 409,
  reason_required: 400,
  cannot_change_own_email: 403,
  cannot_change_admin_email: 403,
  cannot_sign_out_self: 403,
  no_email: 409,
  already_verified: 409,
  too_soon: 429,
  invalid_site: 400,
  invalid_range: 400,
  // 503 rather than 502: Cloudflare can swap a 502 for its own error page, and the page needs the code.
  analytics_not_configured: 503,
  analytics_forbidden: 503,
  analytics_unavailable: 503,
  v1_link_not_found: 404,
  invalid_announcement: 400,
  announcement_not_found: 404,
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

// Every scheduler's heartbeat with the watchdog's verdict, and whether alerts reach Discord.
router.get(
  "/schedulers",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json({
      generated_at: new Date().toISOString(),
      alerts_configured: Boolean(process.env.DISCORD_ALERT_WEBHOOK_URL),
      schedulers: await schedulerHealth.listSchedulerHealth(req.ctx.redis),
    });
  })
);

// Visitors, page views, top pages and referrers for one site between two dates (New York days).
router.get(
  "/analytics",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json(await umami.siteAnalytics({ site: req.query.site, from: req.query.from, to: req.query.to }));
  })
);

// Sign-ups, active players, retention, referrals and source tags, activity by game and market, and
// signed-out visitors, from our own tables (no Umami, so ad blockers don't hide anyone).
router.get(
  "/player-analytics",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json(await playerAnalytics.playerAnalytics(req.ctx.pool, { from: req.query.from, to: req.query.to, today: visits.dayKey() }));
  })
);

// How many v1 players have linked, and why others didn't finish.
router.get(
  "/v1-links",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json(await v1Link.adminSummary(req.ctx.pool, { search: req.query.q, limit: req.query.limit }));
  })
);

// Undoes a link: takes back the badge and theme and frees the v1 account to link again.
router.delete(
  "/v1-links/:userId",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(await v1Link.unlink(req.ctx.pool, { userId: req.params.userId, actor, reason: req.body?.reason ?? null }));
  })
);

// Card exchange transfers worth a look: lopsided sales and trades involving new accounts.
router.get(
  "/exchange-review",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    const [review, clusters] = await Promise.all([exchange.reviewFlags(req.ctx.pool, { days }), ipClusters(req.ctx.pool, { days })]);
    // Which flagged accounts have shared an IP hash with each other (services/ipHash.js), and the
    // groups of accounts tied together by shared hashes lately.
    const ids = [
      ...review.flags.flatMap((flag) => [flag.from.id, flag.to.id]),
      ...review.pairs.flatMap((pair) => [pair.a.id, pair.b.id]),
      ...review.funnels.map((funnel) => funnel.hub.id),
    ];
    const shared = await sharedIpAccounts(req.ctx.pool, ids);
    const shares = (x, y) => (shared.get(x) ?? []).some((account) => account.id === y);
    res.json({
      ...review,
      flags: review.flags.map((flag) => ({ ...flag, same_ip: shares(flag.from.id, flag.to.id) })),
      pairs: review.pairs.map((pair) => ({ ...pair, same_ip: shares(pair.a.id, pair.b.id) })),
      funnels: review.funnels.map((funnel) => ({ ...funnel, accounts: funnel.accounts.map((account) => ({ ...account, same_ip: shares(funnel.hub.id, account.id) })) })),
      ip_linking: ipHashingEnabled(),
      ip_clusters: clusters,
    });
  })
);

router.get(
  "/users",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    const users = await adminConsole.searchUsers(req.ctx.pool, { q: req.query.q, role: req.query.role });
    // ip_linking: false while IP_HASH_SALT is unset (nothing is recorded, so nothing is shared).
    res.json({ users, roles: adminConsole.ROLE_FLAGS, ip_linking: ipHashingEnabled() });
  })
);

// /admin/users: every account, a page at a time: ?q (username or #id), filter, sort, dir, page, limit.
router.get(
  "/users/directory",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json({ ...(await adminUsers.listUsers(req.ctx.pool, req.query)), ip_linking: ipHashingEnabled() });
  })
);

// Looks an account up by its exact address. A POST so the address stays out of URLs and access logs.
// It reads nothing back but the masked form, and changes nothing.
router.post(
  "/users/find-by-email",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json(await adminUsers.findUsersByEmail(req.ctx.pool, req.body));
  })
);

router.get(
  "/users/:userId",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json({ ...(await adminUsers.getUserDetail(req.ctx.pool, targetUserId(req))), ip_linking: ipHashingEnabled() });
  })
);

// Fix a username: { username, reason? }. Same format and name rules as a player's own rename.
router.patch(
  "/users/:userId/username",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(await adminUsers.renameUser(req.ctx.pool, actor, targetUserId(req), req.body));
  })
);

// Fix an email: { email, reason, confirm: true }. Back to unverified until the player uses the new link.
router.patch(
  "/users/:userId/email",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(await adminUsers.changeUserEmail(req.ctx.pool, actor, targetUserId(req), req.body));
  })
);

router.post(
  "/users/:userId/clear-bio",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(await adminUsers.clearBio(req.ctx.pool, actor, targetUserId(req), req.body));
  })
);

// Signed out on every device: { reason? }.
router.post(
  "/users/:userId/sign-out",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(await adminUsers.signOutUser(req.ctx.pool, req.ctx.redis, actor, targetUserId(req), req.body));
  })
);

// The account emails, to the address on file. Each answers { status }; the link is never returned.
router.post(
  "/users/:userId/verification-email",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(await adminUsers.sendVerification(req.ctx.pool, actor, targetUserId(req)));
  })
);

router.post(
  "/users/:userId/password-reset-email",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(await adminUsers.sendPasswordReset(req.ctx.pool, actor, targetUserId(req)));
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
    // Their open tabs too: a socket signs in once, when it connects.
    if (result.sessions_revoked) await announceSessionsRevoked(req.ctx.redis, userId);
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

// Announcement popups: every one there is, newest first, with how many players have dismissed it.
router.get(
  "/announcements",
  handle(async (req, res) => {
    requireSiteAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json({ announcements: await announcements.listForAdmin(req.ctx.pool) });
  })
);

router.post(
  "/announcements",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.status(201).json({ announcement: await announcements.create(req.ctx.pool, actor, req.body) });
  })
);

router.patch(
  "/announcements/:id",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json({ announcement: await announcements.update(req.ctx.pool, actor, req.params.id, req.body) });
  })
);

// Retire takes it down and keeps the row; restore puts it back up. Delete is for good.
router.post(
  "/announcements/:id/retire",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json({ announcement: await announcements.setRetired(req.ctx.pool, actor, req.params.id, true) });
  })
);

router.post(
  "/announcements/:id/restore",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json({ announcement: await announcements.setRetired(req.ctx.pool, actor, req.params.id, false) });
  })
);

router.delete(
  "/announcements/:id",
  handle(async (req, res) => {
    const actor = requireSiteAdmin(req);
    res.json(await announcements.remove(req.ctx.pool, actor, req.params.id));
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
