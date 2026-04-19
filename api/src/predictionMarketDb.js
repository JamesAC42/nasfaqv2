function parsePositiveInt(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function mapMarketRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle || null,
    description: row.description || null,
    rules_text: row.rules_text || "",
    resolution_source_text: row.resolution_source_text || "",
    status: row.status,
    trading_status: row.trading_status,
    visibility: row.visibility,
    market_type: row.market_type,
    resolution_outcome: row.resolution_outcome || null,
    resolution_notes: row.resolution_notes || null,
    featured_image_url: row.featured_image_url || null,
    metadata_json: row.metadata_json || {},
    opens_at: row.opens_at,
    closes_at: row.closes_at,
    resolves_after: row.resolves_after || null,
    approved_at: row.approved_at || null,
    trading_opened_at: row.trading_opened_at || null,
    trading_closed_at: row.trading_closed_at || null,
    resolved_at: row.resolved_at || null,
    voided_at: row.voided_at || null,
    last_traded_probability: row.last_traded_probability === null || row.last_traded_probability === undefined
      ? null
      : Number(row.last_traded_probability),
    last_trade_at: row.last_trade_at || null,
    total_volume_cash: Number(row.total_volume_cash || 0),
    open_interest_shares: Number(row.open_interest_shares || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    category: row.category_id
      ? {
          id: Number(row.category_id),
          slug: row.category_slug || null,
          display_name: row.category_display_name || null,
        }
      : null,
    creator: row.creator_user_id
      ? {
          id: Number(row.creator_user_id),
          username: row.creator_username || null,
          profile_color: row.creator_profile_color || null,
        }
      : null,
    approver: row.approver_user_id
      ? {
          id: Number(row.approver_user_id),
          username: row.approver_username || null,
        }
      : null,
    resolver: row.resolver_user_id
      ? {
          id: Number(row.resolver_user_id),
          username: row.resolver_username || null,
        }
      : null,
    outcomes: Array.isArray(row.outcomes) ? row.outcomes.map((outcome) => ({
      id: Number(outcome.id || 0),
      outcome_code: String(outcome.outcome_code || ""),
      label: String(outcome.label || ""),
      sort_order: Number(outcome.sort_order || 0),
      is_winner: Boolean(outcome.is_winner),
    })) : [],
  };
}

async function getPredictionMarketByIdWithClient(client, id) {
  const { rows } = await client.query(
    `
    SELECT
      pm.*,
      cat.slug AS category_slug,
      cat.display_name AS category_display_name,
      creator.username AS creator_username,
      creator.profile_color AS creator_profile_color,
      approver.username AS approver_username,
      resolver.username AS resolver_username,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'outcome_code', o.outcome_code,
            'label', o.label,
            'sort_order', o.sort_order,
            'is_winner', o.is_winner
          )
          ORDER BY o.sort_order ASC, o.id ASC
        )
        FROM market.prediction_market_outcomes o
        WHERE o.market_id = pm.id
      ) AS outcomes
    FROM market.prediction_markets pm
    LEFT JOIN market.prediction_market_categories cat ON cat.id = pm.category_id
    LEFT JOIN market.users creator ON creator.id = pm.creator_user_id
    LEFT JOIN market.users approver ON approver.id = pm.approver_user_id
    LEFT JOIN market.users resolver ON resolver.id = pm.resolver_user_id
    WHERE pm.id = $1
    LIMIT 1
  `,
    [id]
  );
  return mapMarketRow(rows[0] || null);
}

async function getPredictionMarketBySlug(pool, slug) {
  const { rows } = await pool.query(
    `
    SELECT
      pm.*,
      cat.slug AS category_slug,
      cat.display_name AS category_display_name,
      creator.username AS creator_username,
      creator.profile_color AS creator_profile_color,
      approver.username AS approver_username,
      resolver.username AS resolver_username,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'outcome_code', o.outcome_code,
            'label', o.label,
            'sort_order', o.sort_order,
            'is_winner', o.is_winner
          )
          ORDER BY o.sort_order ASC, o.id ASC
        )
        FROM market.prediction_market_outcomes o
        WHERE o.market_id = pm.id
      ) AS outcomes
    FROM market.prediction_markets pm
    LEFT JOIN market.prediction_market_categories cat ON cat.id = pm.category_id
    LEFT JOIN market.users creator ON creator.id = pm.creator_user_id
    LEFT JOIN market.users approver ON approver.id = pm.approver_user_id
    LEFT JOIN market.users resolver ON resolver.id = pm.resolver_user_id
    WHERE pm.slug = $1
    LIMIT 1
  `,
    [slug]
  );
  return mapMarketRow(rows[0] || null);
}

async function listPredictionMarkets(pool, {
  status = null,
  query = null,
  creatorUserId = null,
  reviewQueue = false,
  limit = 20,
  page = 1,
  viewerUserId = null,
  canViewNonPublic = false,
} = {}) {
  const safeLimit = parsePositiveInt(limit, 20, { min: 1, max: 100 });
  const safePage = parsePositiveInt(page, 1, { min: 1, max: 1000 });
  const offset = (safePage - 1) * safeLimit;
  const params = [];
  const where = [];

  if (status) {
    params.push(status);
    where.push(`pm.status = $${params.length}`);
  }

  if (query) {
    params.push(`%${String(query).trim()}%`);
    where.push(`(pm.title ILIKE $${params.length} OR COALESCE(pm.subtitle, '') ILIKE $${params.length})`);
  }

  if (creatorUserId) {
    params.push(creatorUserId);
    where.push(`pm.creator_user_id = $${params.length}`);
  }

  if (reviewQueue) {
    where.push(`pm.status = 'pending_approval'`);
  } else if (!creatorUserId && !canViewNonPublic) {
    where.push(`pm.visibility <> 'private'`);
    where.push(`pm.status IN ('open', 'closed', 'resolving', 'resolved', 'voided')`);
  } else if (!creatorUserId && canViewNonPublic && !viewerUserId) {
    where.push(`pm.visibility <> 'private'`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(safeLimit, offset);

  const { rows } = await pool.query(
    `
    SELECT
      pm.id,
      pm.slug,
      pm.title,
      pm.subtitle,
      pm.status,
      pm.trading_status,
      pm.visibility,
      pm.market_type,
      pm.opens_at,
      pm.closes_at,
      pm.resolves_after,
      pm.last_traded_probability,
      pm.last_trade_at,
      pm.total_volume_cash,
      pm.open_interest_shares,
      pm.created_at,
      pm.updated_at,
      pm.creator_user_id,
      creator.username AS creator_username,
      creator.profile_color AS creator_profile_color,
      pm.approver_user_id,
      approver.username AS approver_username,
      pm.resolver_user_id,
      resolver.username AS resolver_username,
      pm.category_id,
      cat.slug AS category_slug,
      cat.display_name AS category_display_name,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'outcome_code', o.outcome_code,
            'label', o.label,
            'sort_order', o.sort_order,
            'is_winner', o.is_winner
          )
          ORDER BY o.sort_order ASC, o.id ASC
        )
        FROM market.prediction_market_outcomes o
        WHERE o.market_id = pm.id
      ) AS outcomes,
      COUNT(*) OVER()::INTEGER AS total_count
    FROM market.prediction_markets pm
    LEFT JOIN market.prediction_market_categories cat ON cat.id = pm.category_id
    LEFT JOIN market.users creator ON creator.id = pm.creator_user_id
    LEFT JOIN market.users approver ON approver.id = pm.approver_user_id
    LEFT JOIN market.users resolver ON resolver.id = pm.resolver_user_id
    ${whereSql}
    ORDER BY
      CASE pm.status
        WHEN 'open' THEN 0
        WHEN 'pending_approval' THEN 1
        WHEN 'closed' THEN 2
        WHEN 'resolving' THEN 3
        WHEN 'resolved' THEN 4
        WHEN 'voided' THEN 5
        ELSE 6
      END ASC,
      pm.closes_at ASC,
      pm.created_at DESC,
      pm.id DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `,
    params
  );

  return {
    items: rows.map(mapMarketRow),
    total: Number(rows[0]?.total_count || 0),
    page: safePage,
    limit: safeLimit,
  };
}

async function createPredictionMarketWithClient(client, {
  slug,
  title,
  subtitle,
  description,
  rulesText,
  resolutionSourceText,
  categoryId,
  visibility,
  creatorUserId,
  opensAt,
  closesAt,
  resolvesAfter,
  metadataJson,
} = {}) {
  const { rows } = await client.query(
    `
    INSERT INTO market.prediction_markets (
      slug,
      title,
      subtitle,
      description,
      rules_text,
      resolution_source_text,
      category_id,
      visibility,
      creator_user_id,
      opens_at,
      closes_at,
      resolves_after,
      metadata_json,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now())
    RETURNING id
  `,
    [
      slug,
      title,
      subtitle,
      description,
      rulesText,
      resolutionSourceText,
      categoryId,
      visibility,
      creatorUserId,
      opensAt,
      closesAt,
      resolvesAfter,
      JSON.stringify(metadataJson || {}),
    ]
  );
  return Number(rows[0].id);
}

async function insertPredictionOutcomeWithClient(client, {
  marketId,
  outcomeCode,
  label,
  sortOrder,
} = {}) {
  await client.query(
    `
    INSERT INTO market.prediction_market_outcomes (
      market_id,
      outcome_code,
      label,
      sort_order
    ) VALUES ($1,$2,$3,$4)
  `,
    [marketId, outcomeCode, label, sortOrder]
  );
}

async function insertPredictionMarketEventWithClient(client, {
  marketId,
  actorUserId = null,
  eventType,
  eventData = {},
} = {}) {
  await client.query(
    `
    INSERT INTO market.prediction_market_events (
      market_id,
      actor_user_id,
      event_type,
      event_data
    ) VALUES ($1,$2,$3,$4::jsonb)
  `,
    [marketId, actorUserId, eventType, JSON.stringify(eventData || {})]
  );
}

async function lockPredictionMarketByIdWithClient(client, id) {
  const { rows } = await client.query(
    `
    SELECT *
    FROM market.prediction_markets
    WHERE id = $1
    FOR UPDATE
  `,
    [id]
  );
  return rows[0] || null;
}

async function updatePredictionMarketWithClient(client, id, changes) {
  const entries = Object.entries(changes || {});
  if (!entries.length) {
    return getPredictionMarketByIdWithClient(client, id);
  }

  const values = [id];
  const setters = [];
  for (const [key, value] of entries) {
    values.push(value);
    setters.push(`${key} = $${values.length}`);
  }
  setters.push(`updated_at = now()`);

  await client.query(
    `
    UPDATE market.prediction_markets
    SET ${setters.join(", ")}
    WHERE id = $1
  `,
    values
  );

  return getPredictionMarketByIdWithClient(client, id);
}

async function getPredictionMarketBySlugForTradingWithClient(client, slug) {
  const { rows } = await client.query(
    `
    SELECT
      pm.id,
      pm.slug,
      pm.title,
      pm.status,
      pm.trading_status,
      pm.visibility,
      pm.opens_at,
      pm.closes_at,
      pm.resolves_after,
      pm.last_traded_probability,
      pm.last_trade_at,
      pm.total_volume_cash,
      pm.open_interest_shares
    FROM market.prediction_markets pm
    WHERE pm.slug = $1
    LIMIT 1
    FOR UPDATE
  `,
    [slug]
  );
  return rows[0] || null;
}

async function listPredictionOutcomesByMarketIdWithClient(client, marketId) {
  const { rows } = await client.query(
    `
    SELECT id, market_id, outcome_code, label, sort_order, is_winner
    FROM market.prediction_market_outcomes
    WHERE market_id = $1
    ORDER BY sort_order ASC, id ASC
  `,
    [marketId]
  );
  return rows;
}

async function listPredictionTrades(pool, slug, { limit = 50 } = {}) {
  const safeLimit = parsePositiveInt(limit, 50, { min: 1, max: 200 });
  const { rows } = await pool.query(
    `
    SELECT
      t.id,
      t.market_id,
      t.outcome_id,
      o.outcome_code,
      o.label AS outcome_label,
      t.trade_kind,
      t.maker_order_id,
      t.taker_order_id,
      t.maker_user_id,
      maker_user.username AS maker_username,
      t.taker_user_id,
      taker_user.username AS taker_username,
      t.maker_outcome_id,
      maker_outcome.outcome_code AS maker_outcome_code,
      t.taker_outcome_id,
      taker_outcome.outcome_code AS taker_outcome_code,
      t.maker_side,
      t.taker_side,
      t.buy_order_id,
      t.sell_order_id,
      t.buy_user_id,
      buy_user.username AS buy_username,
      t.sell_user_id,
      sell_user.username AS sell_username,
      t.price,
      t.quantity,
      t.notional_cash,
      t.fee_cash_buy,
      t.fee_cash_sell,
      t.matched_at
    FROM market.prediction_market_trades t
    JOIN market.prediction_markets pm ON pm.id = t.market_id
    JOIN market.prediction_market_outcomes o ON o.id = t.outcome_id
    LEFT JOIN market.users maker_user ON maker_user.id = t.maker_user_id
    LEFT JOIN market.users taker_user ON taker_user.id = t.taker_user_id
    LEFT JOIN market.prediction_market_outcomes maker_outcome ON maker_outcome.id = t.maker_outcome_id
    LEFT JOIN market.prediction_market_outcomes taker_outcome ON taker_outcome.id = t.taker_outcome_id
    LEFT JOIN market.users buy_user ON buy_user.id = t.buy_user_id
    LEFT JOIN market.users sell_user ON sell_user.id = t.sell_user_id
    WHERE pm.slug = $1
    ORDER BY t.matched_at DESC, t.id DESC
    LIMIT $2
  `,
    [slug, safeLimit]
  );
  return rows.map((row) => ({
    id: Number(row.id || 0),
    market_id: Number(row.market_id || 0),
    outcome_id: Number(row.outcome_id || 0),
    outcome_code: String(row.outcome_code || ""),
    outcome_label: String(row.outcome_label || ""),
    trade_kind: String(row.trade_kind || "secondary"),
    maker_order_id: row.maker_order_id ? Number(row.maker_order_id) : null,
    taker_order_id: row.taker_order_id ? Number(row.taker_order_id) : null,
    maker_user_id: row.maker_user_id ? Number(row.maker_user_id) : null,
    maker_username: row.maker_username || null,
    taker_user_id: row.taker_user_id ? Number(row.taker_user_id) : null,
    taker_username: row.taker_username || null,
    maker_outcome_id: row.maker_outcome_id ? Number(row.maker_outcome_id) : null,
    maker_outcome_code: row.maker_outcome_code || null,
    taker_outcome_id: row.taker_outcome_id ? Number(row.taker_outcome_id) : null,
    taker_outcome_code: row.taker_outcome_code || null,
    maker_side: row.maker_side || null,
    taker_side: row.taker_side || null,
    buy_order_id: row.buy_order_id ? Number(row.buy_order_id) : null,
    sell_order_id: row.sell_order_id ? Number(row.sell_order_id) : null,
    buy_user_id: row.buy_user_id ? Number(row.buy_user_id) : null,
    buy_username: row.buy_username || null,
    sell_user_id: row.sell_user_id ? Number(row.sell_user_id) : null,
    sell_username: row.sell_username || null,
    price: Number(row.price || 0),
    quantity: Number(row.quantity || 0),
    notional_cash: Number(row.notional_cash || 0),
    fee_cash_buy: Number(row.fee_cash_buy || 0),
    fee_cash_sell: Number(row.fee_cash_sell || 0),
    matched_at: row.matched_at,
  }));
}

async function listOpenPredictionOrders(pool, slug) {
  const { rows } = await pool.query(
    `
    SELECT
      ord.id,
      ord.market_id,
      ord.outcome_id,
      o.outcome_code,
      ord.user_id,
      ord.side,
      ord.price,
      ord.open_quantity
    FROM market.prediction_market_orders ord
    JOIN market.prediction_markets pm ON pm.id = ord.market_id
    JOIN market.prediction_market_outcomes o ON o.id = ord.outcome_id
    WHERE pm.slug = $1
      AND ord.status IN ('open', 'partially_filled')
      AND ord.open_quantity > 0
  `,
    [slug]
  );
  return rows;
}

async function getPredictionOrderBook(pool, slug, { depth = 10 } = {}) {
  const safeDepth = parsePositiveInt(depth, 10, { min: 1, max: 50 });
  const rows = await listOpenPredictionOrders(pool, slug);

  const orderbook = {
    yes: { buy: [], sell: [] },
    no: { buy: [], sell: [] },
  };

  function addLevel(outcomeCode, side, price, quantity) {
    const levels = orderbook[outcomeCode][side];
    const normalizedPrice = Number(price.toFixed(4));
    const existing = levels.find((level) => level.price === normalizedPrice);
    if (existing) {
      existing.quantity += quantity;
    } else {
      levels.push({ price: normalizedPrice, quantity });
    }
  }

  for (const row of rows) {
    const outcomeCode = row.outcome_code === "no" ? "no" : "yes";
    const side = row.side === "sell" ? "sell" : "buy";
    const price = Number(row.price || 0);
    const quantity = Number(row.open_quantity || 0);

    addLevel(outcomeCode, side, price, quantity);

    if (outcomeCode === "yes" && side === "buy") addLevel("no", "sell", 1 - price, quantity);
    if (outcomeCode === "yes" && side === "sell") addLevel("no", "buy", 1 - price, quantity);
    if (outcomeCode === "no" && side === "buy") addLevel("yes", "sell", 1 - price, quantity);
    if (outcomeCode === "no" && side === "sell") addLevel("yes", "buy", 1 - price, quantity);
  }

  orderbook.yes.buy.sort((left, right) => right.price - left.price);
  orderbook.yes.sell.sort((left, right) => left.price - right.price);
  orderbook.no.buy.sort((left, right) => right.price - left.price);
  orderbook.no.sell.sort((left, right) => left.price - right.price);

  orderbook.yes.buy = orderbook.yes.buy.slice(0, safeDepth);
  orderbook.yes.sell = orderbook.yes.sell.slice(0, safeDepth);
  orderbook.no.buy = orderbook.no.buy.slice(0, safeDepth);
  orderbook.no.sell = orderbook.no.sell.slice(0, safeDepth);

  return orderbook;
}

async function getPredictionCandles(pool, slug, {
  interval = "1h",
  outcomeCode = "yes",
  limit = 200,
} = {}) {
  const safeLimit = parsePositiveInt(limit, 200, { min: 1, max: 1000 });
  const { rows } = await pool.query(
    `
    SELECT
      h.bucket_ts,
      h.open,
      h.high,
      h.low,
      h.close,
      h.last,
      h.volume_shares,
      h.volume_cash,
      h.trade_count,
      h.best_bid,
      h.best_ask
    FROM market.prediction_market_price_history h
    JOIN market.prediction_markets pm ON pm.id = h.market_id
    JOIN market.prediction_market_outcomes o ON o.id = h.outcome_id
    WHERE pm.slug = $1
      AND h.bucket_interval = $2
      AND o.outcome_code = $3
    ORDER BY h.bucket_ts DESC
    LIMIT $4
  `,
    [slug, interval, outcomeCode, safeLimit]
  );

  return rows
    .map((row) => ({
      bucket: row.bucket_ts,
      open: row.open === null ? null : Number(row.open),
      high: row.high === null ? null : Number(row.high),
      low: row.low === null ? null : Number(row.low),
      close: row.close === null ? null : Number(row.close),
      last: row.last === null ? null : Number(row.last),
      volume_shares: Number(row.volume_shares || 0),
      volume_cash: Number(row.volume_cash || 0),
      trade_count: Number(row.trade_count || 0),
      best_bid: row.best_bid === null ? null : Number(row.best_bid),
      best_ask: row.best_ask === null ? null : Number(row.best_ask),
    }))
    .reverse();
}

module.exports = {
  createPredictionMarketWithClient,
  getPredictionCandles,
  getPredictionMarketByIdWithClient,
  getPredictionMarketBySlug,
  getPredictionMarketBySlugForTradingWithClient,
  getPredictionOrderBook,
  listOpenPredictionOrders,
  listPredictionOutcomesByMarketIdWithClient,
  listPredictionTrades,
  insertPredictionMarketEventWithClient,
  insertPredictionOutcomeWithClient,
  listPredictionMarkets,
  lockPredictionMarketByIdWithClient,
  updatePredictionMarketWithClient,
};
