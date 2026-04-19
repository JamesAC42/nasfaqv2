function requireAuthenticatedUser(req) {
  const user = req.ctx?.user || null;
  if (!user?.id) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }
  return user;
}

function canManagePredictionMarkets(user) {
  return Boolean(
    user?.is_admin
    || user?.can_create_prediction_markets
    || user?.can_approve_prediction_markets
    || user?.can_resolve_prediction_markets
    || user?.can_void_prediction_markets
  );
}

function requirePredictionCreator(req) {
  const user = requireAuthenticatedUser(req);
  if (!user.is_admin && !user.can_create_prediction_markets) {
    const error = new Error("forbidden");
    error.code = "forbidden";
    throw error;
  }
  return user;
}

function requirePredictionApprover(req) {
  const user = requireAuthenticatedUser(req);
  if (!user.is_admin && !user.can_approve_prediction_markets) {
    const error = new Error("forbidden");
    error.code = "forbidden";
    throw error;
  }
  return user;
}

function requirePredictionResolver(req) {
  const user = requireAuthenticatedUser(req);
  if (!user.is_admin && !user.can_resolve_prediction_markets) {
    const error = new Error("forbidden");
    error.code = "forbidden";
    throw error;
  }
  return user;
}

function requirePredictionVoider(req) {
  const user = requireAuthenticatedUser(req);
  if (!user.is_admin && !user.can_void_prediction_markets) {
    const error = new Error("forbidden");
    error.code = "forbidden";
    throw error;
  }
  return user;
}

module.exports = {
  canManagePredictionMarkets,
  requireAuthenticatedUser,
  requirePredictionApprover,
  requirePredictionCreator,
  requirePredictionResolver,
  requirePredictionVoider,
};
