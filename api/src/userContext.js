function requireUserId(req) {
  const userId = req.ctx?.user?.id || null;
  if (!userId) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }
  return userId;
}

function requireVerifiedUserId(req) {
  const userId = requireUserId(req);
  if (!req.ctx?.user?.email_verified) {
    const error = new Error("email_verification_required");
    error.code = "email_verification_required";
    throw error;
  }
  return userId;
}

function requireAdmin(req) {
  if (!req.ctx?.user?.is_admin) {
    const error = new Error("forbidden");
    error.code = "forbidden";
    throw error;
  }
  return req.ctx.user;
}

function requireAssetManager(req) {
  if (!req.ctx?.user?.is_admin && !req.ctx?.user?.can_manage_assets) {
    const error = new Error("forbidden");
    error.code = "forbidden";
    throw error;
  }
  return req.ctx.user;
}

/**
 * Middleware for routes that take big uploads: a request carrying a body goes on only when
 * allowed(user) says that user may send one; anyone else gets 401/403 before the body is parsed
 * (Node discards it unread, so the client still gets the answer). Requests without a body (reads,
 * CORS preflights) always go on.
 */
function requireUploader(allowed) {
  return (req, res, next) => {
    const hasBody = req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] || 0) > 0;
    const user = req.ctx?.user || null;
    if (!hasBody || allowed(user)) return next();
    return res.status(user ? 403 : 401).json({ error: user ? "forbidden" : "unauthenticated" });
  };
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Writes a suspended player can still make: signing in and out, password resets, marking things read. */
const ALLOWED_WHILE_SUSPENDED = [/^\/api\/auth\//, /^\/api\/notifications\/read$/, /^\/api\/chat\/channels\/[^/]+\/read$/];

/**
 * Middleware, right after the session lookup: a suspended player (services/moderation.js) keeps
 * reading, but every write gets 403 account_suspended with the reason and the end date (`until`
 * is null when it's permanent).
 */
function blockSuspendedWrites(req, res, next) {
  const suspension = req.ctx?.user?.suspension;
  if (!suspension || READ_METHODS.has(req.method) || ALLOWED_WHILE_SUSPENDED.some((pattern) => pattern.test(req.path))) return next();
  return res.status(403).json({
    error: "account_suspended",
    reason: suspension.reason,
    until: suspension.until,
    permanent: suspension.permanent,
  });
}

module.exports = {
  blockSuspendedWrites,
  requireUserId,
  requireVerifiedUserId,
  requireAdmin,
  requireAssetManager,
  requireUploader,
};
