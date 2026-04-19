const predictionMarketDb = require("../predictionMarketDb");

const VALID_VISIBILITIES = new Set(["public", "unlisted", "private"]);
const VALID_LIST_STATUSES = new Set(["draft", "pending_approval", "open", "closed", "resolving", "resolved", "voided", "rejected"]);

function invalidPredictionMarket(message = "invalid_prediction_market") {
  const error = new Error(message);
  error.code = "invalid_prediction_market";
  return error;
}

function conflict(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeText(value, { min = 0, max = 1000, allowNull = true } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw invalidPredictionMarket();
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (allowNull) return null;
    throw invalidPredictionMarket();
  }
  if (normalized.length < min || normalized.length > max) {
    throw invalidPredictionMarket();
  }
  return normalized;
}

function normalizeDate(value, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw invalidPredictionMarket();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalidPredictionMarket();
  }
  return parsed.toISOString();
}

function normalizeOptionalBigInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw invalidPredictionMarket();
  }
  return parsed;
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || null;
}

function sameUserId(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return Number(left) === Number(right);
}

function assertCanViewMarket(market, viewerUserId, canViewNonPublic) {
  if (!market) {
    const error = new Error("prediction_market_not_found");
    error.code = "prediction_market_not_found";
    throw error;
  }

  if (canViewNonPublic) return market;
  if (market.visibility !== "private" && ["open", "closed", "resolving", "resolved", "voided"].includes(market.status)) {
    return market;
  }
  if (sameUserId(market.creator?.id, viewerUserId)) {
    return market;
  }

  const error = new Error("prediction_market_not_found");
  error.code = "prediction_market_not_found";
  throw error;
}

async function createPredictionMarket(pool, actorUser, input = {}) {
  const title = normalizeText(input.title, { min: 1, max: 200, allowNull: false });
  const subtitle = normalizeText(input.subtitle, { min: 0, max: 240, allowNull: true });
  const description = normalizeText(input.description, { min: 0, max: 10000, allowNull: true });
  const rulesText = normalizeText(input.rules_text, { min: 1, max: 10000, allowNull: false });
  const resolutionSourceText = normalizeText(input.resolution_source_text, { min: 1, max: 5000, allowNull: false });
  const visibility = normalizeText(input.visibility || "public", { min: 1, max: 20, allowNull: false });
  const opensAt = normalizeDate(input.opens_at, { allowNull: false });
  const closesAt = normalizeDate(input.closes_at, { allowNull: false });
  const resolvesAfter = normalizeDate(input.resolves_after, { allowNull: true });
  const categoryId = normalizeOptionalBigInt(input.category_id);
  const metadataJson = input.metadata_json && typeof input.metadata_json === "object" ? input.metadata_json : {};

  if (!VALID_VISIBILITIES.has(visibility)) {
    throw invalidPredictionMarket();
  }

  const slug = slugify(input.slug || title);
  if (!slug) {
    throw invalidPredictionMarket();
  }

  if (new Date(closesAt).getTime() <= new Date(opensAt).getTime()) {
    throw invalidPredictionMarket();
  }
  if (resolvesAfter && new Date(resolvesAfter).getTime() < new Date(closesAt).getTime()) {
    throw invalidPredictionMarket();
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const marketId = await predictionMarketDb.createPredictionMarketWithClient(client, {
      slug,
      title,
      subtitle,
      description,
      rulesText,
      resolutionSourceText,
      categoryId,
      visibility,
      creatorUserId: actorUser.id,
      opensAt,
      closesAt,
      resolvesAfter,
      metadataJson,
    });

    await predictionMarketDb.insertPredictionOutcomeWithClient(client, {
      marketId,
      outcomeCode: "yes",
      label: "Yes",
      sortOrder: 0,
    });
    await predictionMarketDb.insertPredictionOutcomeWithClient(client, {
      marketId,
      outcomeCode: "no",
      label: "No",
      sortOrder: 1,
    });
    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId,
      actorUserId: actorUser.id,
      eventType: "market_created",
      eventData: {
        title,
        visibility,
      },
    });

    const market = await predictionMarketDb.getPredictionMarketByIdWithClient(client, marketId);
    await client.query("COMMIT");
    return market;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error?.code === "23505") {
      throw conflict("prediction_market_slug_taken");
    }
    if (error?.code === "23503") {
      throw invalidPredictionMarket();
    }
    throw error;
  } finally {
    client.release();
  }
}

async function listPredictionMarkets(pool, {
  status = null,
  query = null,
  page = 1,
  limit = 20,
  scope = "public",
  actorUser = null,
} = {}) {
  const normalizedStatus = status ? String(status).trim() : null;
  if (normalizedStatus && !VALID_LIST_STATUSES.has(normalizedStatus)) {
    throw invalidPredictionMarket();
  }

  const isMine = scope === "mine";
  const isReviewQueue = scope === "review_queue";
  const canViewNonPublic = Boolean(actorUser?.is_admin || actorUser?.can_approve_prediction_markets);

  if (isMine && !actorUser?.id) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }
  if (isReviewQueue && !canViewNonPublic) {
    const error = new Error("forbidden");
    error.code = "forbidden";
    throw error;
  }

  return predictionMarketDb.listPredictionMarkets(pool, {
    status: normalizedStatus,
    query,
    creatorUserId: isMine ? actorUser.id : null,
    reviewQueue: isReviewQueue,
    page,
    limit,
    viewerUserId: actorUser?.id || null,
    canViewNonPublic,
  });
}

async function getPredictionMarketDetail(pool, slug, actorUser = null) {
  const market = await predictionMarketDb.getPredictionMarketBySlug(pool, slugify(slug || ""));
  const visible = assertCanViewMarket(market, actorUser?.id || null, Boolean(actorUser?.is_admin || actorUser?.can_approve_prediction_markets));
  return {
    ...visible,
    viewer_permissions: {
      can_submit_for_approval: Boolean(actorUser?.id && sameUserId(visible.creator?.id, actorUser.id) && ["draft", "rejected"].includes(visible.status)),
      can_approve: Boolean(actorUser?.is_admin || actorUser?.can_approve_prediction_markets),
      can_resolve: Boolean(actorUser?.is_admin || actorUser?.can_resolve_prediction_markets),
      can_void: Boolean(actorUser?.is_admin || actorUser?.can_void_prediction_markets),
      is_creator: Boolean(actorUser?.id && sameUserId(visible.creator?.id, actorUser.id)),
    },
  };
}

async function submitPredictionMarket(pool, marketId, actorUser) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const market = await predictionMarketDb.lockPredictionMarketByIdWithClient(client, marketId);
    if (!market) {
      const error = new Error("prediction_market_not_found");
      error.code = "prediction_market_not_found";
      throw error;
    }
    if (!actorUser.is_admin && !sameUserId(market.creator_user_id, actorUser.id)) {
      const error = new Error("forbidden");
      error.code = "forbidden";
      throw error;
    }
    if (!["draft", "rejected"].includes(market.status)) {
      throw conflict("prediction_market_transition_invalid");
    }

    const updated = await predictionMarketDb.updatePredictionMarketWithClient(client, marketId, {
      status: "pending_approval",
      trading_status: "pending_open",
    });
    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId,
      actorUserId: actorUser.id,
      eventType: "submitted_for_approval",
    });
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function approvePredictionMarket(pool, marketId, actorUser) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const market = await predictionMarketDb.lockPredictionMarketByIdWithClient(client, marketId);
    if (!market) {
      const error = new Error("prediction_market_not_found");
      error.code = "prediction_market_not_found";
      throw error;
    }
    if (market.status !== "pending_approval") {
      throw conflict("prediction_market_transition_invalid");
    }
    if (!actorUser.is_admin && Number(market.creator_user_id) === Number(actorUser.id)) {
      throw conflict("prediction_market_self_approval_forbidden");
    }

    const now = new Date();
    const opensAt = new Date(market.opens_at);
    const shouldOpenTrading = !Number.isNaN(opensAt.getTime()) && opensAt.getTime() <= now.getTime();

    const updated = await predictionMarketDb.updatePredictionMarketWithClient(client, marketId, {
      status: "open",
      trading_status: shouldOpenTrading ? "open" : "pending_open",
      approver_user_id: actorUser.id,
      approved_at: now.toISOString(),
      trading_opened_at: shouldOpenTrading ? now.toISOString() : null,
    });
    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId,
      actorUserId: actorUser.id,
      eventType: "market_approved",
      eventData: {
        trading_status: shouldOpenTrading ? "open" : "pending_open",
      },
    });
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectPredictionMarket(pool, marketId, actorUser, { reason = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const market = await predictionMarketDb.lockPredictionMarketByIdWithClient(client, marketId);
    if (!market) {
      const error = new Error("prediction_market_not_found");
      error.code = "prediction_market_not_found";
      throw error;
    }
    if (market.status !== "pending_approval") {
      throw conflict("prediction_market_transition_invalid");
    }

    const updated = await predictionMarketDb.updatePredictionMarketWithClient(client, marketId, {
      status: "rejected",
      trading_status: "pending_open",
      approver_user_id: actorUser.id,
    });
    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId,
      actorUserId: actorUser.id,
      eventType: "market_rejected",
      eventData: {
        reason: reason ? String(reason).trim().slice(0, 1000) : null,
      },
    });
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  approvePredictionMarket,
  createPredictionMarket,
  getPredictionMarketDetail,
  listPredictionMarkets,
  rejectPredictionMarket,
  submitPredictionMarket,
};
