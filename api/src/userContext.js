function requireUserId(req) {
  const userId = req.ctx?.user?.id || null;
  if (!userId) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }
  return userId;
}

module.exports = {
  requireUserId,
};
