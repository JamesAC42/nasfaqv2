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

module.exports = {
  requireUserId,
  requireVerifiedUserId,
  requireAdmin,
};
