// Predictions v2 markets (docs/predictions/PREDICTIONS_DESIGN.md §1, §4, §7–8): creation,
// approval, and every read view the floor, market page, portfolio and admin console use.

const lmsr = require("./lmsr");
const core = require("./core");
const trading = require("./trading");
const { currentProposal } = require("./resolution");

const { num, round2, round6, predictionError } = core;

const DEFAULT_B = { binary: 250, multi: 200 };
const PUBLIC_STATUSES = ["open", "closed", "resolving", "proposed", "disputed", "resolved", "voided"];

// ── Creation ───────────────────────────────────────────────────────────────
function text(value, { min = 0, max = 1000, field }) {
  const out = String(value ?? "").trim();
  if (out.length < min || out.length > max) throw predictionError("invalid_prediction_market", { field });
  return out || null;
}

function date(value, { field, allowNull = false }) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw predictionError("invalid_prediction_market", { field });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw predictionError("invalid_prediction_market", { field });
  return parsed;
}

function slugify(value) {
  return String(value || "market")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "market";
}

async function uniqueSlug(client, base) {
  let slug = slugify(base);
  for (let n = 2; ; n += 1) {
    const { rows } = await client.query(`SELECT 1 FROM market.prediction_markets WHERE slug = $1`, [slug]);
    if (!rows.length) return slug;
    slug = `${slugify(base).slice(0, 84)}-${n}`;
  }
}

/**
 * Creates a market with its outcomes and seeds the market maker. Used by people (event markets)
 * and by the auto templates (`system: true`).
 */
async function createMarketWithClient(client, input, { creatorId = null, status = "draft", approverId = null, kind = "event", autoTemplate = null, autoKey = null, autoData = {} } = {}) {
  const marketType = input.market_type === "multi" ? "multi" : "binary";
  const title = text(input.title, { min: 4, max: 200, field: "title" });
  const rules = text(input.rules_text, { min: 10, max: 10_000, field: "rules_text" });
  const source = text(input.resolution_source_text, { min: 3, max: 5000, field: "resolution_source_text" });
  const opensAt = input.opens_at ? date(input.opens_at, { field: "opens_at" }) : new Date();
  const closesAt = date(input.closes_at, { field: "closes_at" });
  const resolvesAfter = date(input.resolves_after, { field: "resolves_after", allowNull: true });
  if (closesAt <= opensAt || closesAt <= new Date()) throw predictionError("invalid_prediction_market", { field: "closes_at" });
  if (resolvesAfter && resolvesAfter < closesAt) throw predictionError("invalid_prediction_market", { field: "resolves_after" });
  const b = Math.min(100_000, Math.max(10, num(input.liquidity_b, DEFAULT_B[marketType])));
  const feeBps = Math.min(1000, Math.max(0, Math.round(num(input.fee_bps, 100))));
  const disputeHours = Math.min(72, Math.max(1, Math.round(num(input.dispute_hours, 12))));

  // Outcomes: binary is YES/NO (labels optional); multi needs 3–12 labels.
  let outcomes;
  if (marketType === "binary") {
    const yes = Math.min(0.95, Math.max(0.05, num(input.probability, 0.5)));
    outcomes = [
      { code: "yes", label: text(input.yes_label || "Yes", { min: 1, max: 40, field: "yes_label" }), probability: yes },
      { code: "no", label: text(input.no_label || "No", { min: 1, max: 40, field: "no_label" }), probability: 1 - yes },
    ];
  } else {
    const list = Array.isArray(input.outcomes) ? input.outcomes : [];
    if (list.length < 3 || list.length > 12) throw predictionError("invalid_prediction_market", { field: "outcomes" });
    outcomes = list.map((entry, index) => ({
      code: `o${index + 1}`,
      label: text(entry?.label, { min: 1, max: 80, field: `outcomes.${index}.label` }),
      probability: Math.max(0.01, num(entry?.probability, 1 / list.length)),
      assetSymbol: entry?.asset_symbol ? String(entry.asset_symbol).toUpperCase().slice(0, 12) : null,
    }));
    const labels = new Set(outcomes.map((outcome) => outcome.label.toLowerCase()));
    if (labels.size !== outcomes.length) throw predictionError("invalid_prediction_market", { field: "outcomes" });
  }

  let categoryId = null;
  if (input.category) {
    const { rows } = await client.query(`SELECT id FROM market.prediction_market_categories WHERE slug = $1`, [String(input.category)]);
    categoryId = rows[0]?.id ?? null;
  } else if (input.category_id) {
    categoryId = Number(input.category_id) || null;
  }

  const slug = await uniqueSlug(client, input.slug || title);
  const tradingStatus = status === "open" ? (opensAt <= new Date() ? "open" : "pending_open") : "pending_open";
  const { rows } = await client.query(
    `INSERT INTO market.prediction_markets
       (slug, title, subtitle, description, rules_text, resolution_source_text, category_id, status, trading_status, visibility, market_type,
        creator_user_id, approver_user_id, approved_at, featured_image_url, opens_at, closes_at, resolves_after, trading_opened_at,
        kind, liquidity_b, fee_bps, dispute_hours, auto_template, auto_key, auto_data, amm_ready)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,true)
     RETURNING *`,
    [
      slug,
      title,
      input.subtitle ? text(input.subtitle, { max: 240, field: "subtitle" }) : null,
      input.description ? text(input.description, { max: 10_000, field: "description" }) : null,
      rules,
      source,
      categoryId,
      status,
      tradingStatus,
      ["public", "unlisted"].includes(input.visibility) ? input.visibility : "public",
      marketType,
      creatorId,
      approverId,
      approverId ? new Date() : null,
      input.featured_image_url ? text(input.featured_image_url, { max: 1000, field: "featured_image_url" }) : null,
      opensAt,
      closesAt,
      resolvesAfter,
      tradingStatus === "open" ? new Date() : null,
      kind,
      b,
      feeBps,
      disputeHours,
      autoTemplate,
      autoKey,
      JSON.stringify(autoData || {}),
    ]
  );
  const market = rows[0];
  const inserted = [];
  for (const [index, outcome] of outcomes.entries()) {
    let assetId = null;
    if (outcome.assetSymbol) {
      const asset = await client.query(`SELECT id FROM market.market_assets WHERE symbol = $1`, [outcome.assetSymbol]);
      assetId = asset.rows[0]?.id ?? null;
    }
    const { rows: outcomeRows } = await client.query(
      `INSERT INTO market.prediction_market_outcomes (market_id, outcome_code, label, sort_order, asset_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [market.id, outcome.code, outcome.label, index, assetId]
    );
    inserted.push(outcomeRows[0]);
  }
  const q = lmsr.seedShares(outcomes.map((outcome) => outcome.probability), b);
  const prices = lmsr.prices(q, b);
  await core.storePrices(client, market, inserted, q, prices);
  await core.recordHistory(client, market.id, inserted, prices);
  await core.logEvent(client, market.id, kind === "auto" ? "auto_created" : "market_created", { status, template: autoTemplate }, creatorId);
  return market;
}

async function createMarket(pool, actor, input) {
  const isAdmin = Boolean(actor?.is_admin);
  if (!isAdmin && !actor?.can_create_prediction_markets) throw predictionError("forbidden");
  const publish = Boolean(input?.publish) && isAdmin;
  return core.inTransaction(pool, async (client) => {
    const market = await createMarketWithClient(client, input || {}, {
      creatorId: actor.id,
      status: publish ? "open" : input?.submit ? "pending_approval" : "draft",
      approverId: publish ? actor.id : null,
    });
    if (input?.submit && !publish) await core.logEvent(client, market.id, "submitted_for_approval", {}, actor.id);
    if (publish) await core.logEvent(client, market.id, "market_approved", { self_published: true }, actor.id);
    return { id: Number(market.id), slug: market.slug, status: market.status };
  });
}

async function submitMarket(pool, actor, marketId) {
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (String(market.creator_user_id) !== String(actor.id) && !actor.is_admin) throw predictionError("forbidden");
    if (market.status !== "draft" && market.status !== "rejected") throw predictionError("prediction_market_transition_invalid");
    await client.query(`UPDATE market.prediction_markets SET status = 'pending_approval', updated_at = now() WHERE id = $1`, [market.id]);
    await core.logEvent(client, market.id, "submitted_for_approval", {}, actor.id);
    return { id: Number(market.id), slug: market.slug };
  });
}

async function approveMarket(pool, actor, marketId) {
  if (!actor?.is_admin && !actor?.can_approve_prediction_markets) throw predictionError("forbidden");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (market.status !== "pending_approval") throw predictionError("prediction_market_transition_invalid");
    if (String(market.creator_user_id) === String(actor.id) && !actor.is_admin) throw predictionError("prediction_market_self_approval_forbidden");
    if (new Date(market.closes_at) <= new Date()) throw predictionError("invalid_prediction_market", { field: "closes_at" });
    const openNow = new Date(market.opens_at) <= new Date();
    await client.query(
      `UPDATE market.prediction_markets SET status = 'open', trading_status = $2, approver_user_id = $3, approved_at = now(),
         trading_opened_at = CASE WHEN $2 = 'open' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`,
      [market.id, openNow ? "open" : "pending_open", actor.id]
    );
    await core.logEvent(client, market.id, "market_approved", {}, actor.id);
    return { id: Number(market.id), slug: market.slug };
  });
}

async function rejectMarket(pool, actor, marketId, { reason }) {
  if (!actor?.is_admin && !actor?.can_approve_prediction_markets) throw predictionError("forbidden");
  return core.inTransaction(pool, async (client) => {
    const market = await core.lockMarket(client, { id: marketId });
    if (market.status !== "pending_approval") throw predictionError("prediction_market_transition_invalid");
    await client.query(`UPDATE market.prediction_markets SET status = 'rejected', resolution_notes = $2, updated_at = now() WHERE id = $1`, [market.id, reason || null]);
    await core.logEvent(client, market.id, "market_rejected", { reason: reason || null }, actor.id);
    return { id: Number(market.id), slug: market.slug };
  });
}

// ── Views ──────────────────────────────────────────────────────────────────
const MARKET_SELECT = `
  SELECT pm.*, cat.slug AS category_slug, cat.display_name AS category_name,
         creator.username AS creator_username, approver.username AS approver_username, resolver.username AS resolver_username
  FROM market.prediction_markets pm
  LEFT JOIN market.prediction_market_categories cat ON cat.id = pm.category_id
  LEFT JOIN market.users creator ON creator.id = pm.creator_user_id
  LEFT JOIN market.users approver ON approver.id = pm.approver_user_id
  LEFT JOIN market.users resolver ON resolver.id = pm.resolver_user_id`;

/** Outcomes, 24 h stats and sparklines for a batch of markets. */
async function decorate(db, markets) {
  if (!markets.length) return [];
  const ids = markets.map((market) => market.id);
  const [outcomes, stats, history] = await Promise.all([
    db.query(
      `SELECT o.*, a.symbol AS asset_symbol, ch.icon AS asset_icon, ch.color AS asset_color
       FROM market.prediction_market_outcomes o LEFT JOIN market.market_assets a ON a.id = o.asset_id LEFT JOIN yt.youtube_channels ch ON ch.youtube_channel_id = a.youtube_channel_id
       WHERE o.market_id = ANY($1::bigint[]) ORDER BY o.sort_order, o.id`,
      [ids]
    ),
    db.query(
      `SELECT market_id, COALESCE(SUM(notional_cash), 0) AS volume, COUNT(*)::int AS trades, COUNT(DISTINCT taker_user_id)::int AS traders
       FROM market.prediction_market_trades WHERE market_id = ANY($1::bigint[]) AND matched_at > now() - interval '24 hours' GROUP BY market_id`,
      [ids]
    ),
    db.query(
      `SELECT market_id, outcome_id, bucket_ts, close FROM market.prediction_market_price_history
       WHERE market_id = ANY($1::bigint[]) AND bucket_interval = '1h' AND bucket_ts > now() - interval '25 hours'
       ORDER BY bucket_ts`,
      [ids]
    ),
  ]);
  const statsBy = new Map(stats.rows.map((row) => [String(row.market_id), row]));
  const historyBy = new Map();
  for (const row of history.rows) {
    const key = `${row.market_id}:${row.outcome_id}`;
    if (!historyBy.has(key)) historyBy.set(key, []);
    historyBy.get(key).push(num(row.close));
  }
  return markets.map((market) => {
    const own = outcomes.rows.filter((outcome) => String(outcome.market_id) === String(market.id));
    const view = marketView(market, own, historyBy);
    const stat = statsBy.get(String(market.id));
    view.volume_24h = round2(num(stat?.volume));
    view.trades_24h = num(stat?.trades);
    view.traders_24h = num(stat?.traders);
    return view;
  });
}

function marketView(market, outcomes, historyBy = new Map()) {
  const b = num(market.liquidity_b, 250);
  const prices = lmsr.prices(outcomes.map((outcome) => num(outcome.amm_shares)), b);
  const headline = core.headlineProbability(market, outcomes, prices);
  return {
    id: Number(market.id),
    slug: market.slug,
    title: market.title,
    subtitle: market.subtitle,
    kind: market.kind,
    market_type: market.market_type,
    status: market.status,
    trading_status: market.trading_status,
    visibility: market.visibility,
    category: market.category_slug ? { slug: market.category_slug, display_name: market.category_name } : null,
    featured_image_url: market.featured_image_url,
    opens_at: market.opens_at,
    closes_at: market.closes_at,
    resolves_after: market.resolves_after,
    created_at: market.created_at,
    resolved_at: market.resolved_at,
    voided_at: market.voided_at,
    resolution_outcome: market.resolution_outcome,
    winning_outcome_id: market.winning_outcome_id ? Number(market.winning_outcome_id) : null,
    total_volume_cash: round2(num(market.total_volume_cash)),
    liquidity_b: b,
    fee_bps: num(market.fee_bps),
    dispute_hours: num(market.dispute_hours, 12),
    auto_template: market.auto_template,
    last_traded_probability: round6(headline),
    last_trade_at: market.last_trade_at,
    outcomes: outcomes.map((outcome, index) => {
      const series = historyBy.get(`${market.id}:${outcome.id}`) || [];
      const open = series.length ? series[0] : null;
      return {
        id: Number(outcome.id),
        outcome_code: outcome.outcome_code,
        label: outcome.label,
        sort_order: Number(outcome.sort_order),
        price: round6(prices[index]),
        change_24h: open === null ? 0 : round6(prices[index] - open),
        sparkline: series.map(round6),
        is_winner: Boolean(outcome.is_winner),
        asset: outcome.asset_symbol ? { symbol: outcome.asset_symbol, icon: outcome.asset_icon, color: outcome.asset_color } : null,
      };
    }),
  };
}

const TAB_WHERE = {
  live: `pm.status = 'open'`,
  closing: `pm.status = 'open' AND pm.closes_at <= now() + interval '24 hours'`,
  auto: `pm.status = 'open' AND pm.kind = 'auto'`,
  events: `pm.status = 'open' AND pm.kind = 'event'`,
  resolving: `pm.status IN ('closed', 'resolving', 'proposed', 'disputed')`,
  resolved: `pm.status IN ('resolved', 'voided')`,
  all: `pm.status = ANY($STATUSES)`,
};

const TAB_ORDER = {
  live: `pm.last_trade_at DESC NULLS LAST, pm.created_at DESC`,
  closing: `pm.closes_at ASC`,
  auto: `pm.closes_at ASC`,
  events: `pm.total_volume_cash DESC, pm.created_at DESC`,
  resolving: `pm.closes_at DESC`,
  resolved: `COALESCE(pm.resolved_at, pm.voided_at) DESC`,
  all: `CASE WHEN pm.status = 'open' THEN 0 ELSE 1 END, pm.closes_at ASC`,
};

async function listMarkets(pool, { tab = "live", category = null, q = null, limit = 30, page = 1, status = null } = {}) {
  const safeTab = TAB_WHERE[tab] ? tab : "live";
  const params = [];
  const where = [`pm.visibility = 'public'`];
  if (status && PUBLIC_STATUSES.includes(status)) {
    params.push(status);
    where.push(`pm.status = $${params.length}`);
  } else {
    let clause = TAB_WHERE[safeTab];
    if (clause.includes("$STATUSES")) {
      params.push(PUBLIC_STATUSES);
      clause = clause.replace("$STATUSES", `$${params.length}::text[]`);
    }
    where.push(clause);
  }
  if (category) {
    params.push(String(category));
    where.push(`cat.slug = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).trim().slice(0, 80)}%`);
    where.push(`(pm.title ILIKE $${params.length} OR COALESCE(pm.subtitle, '') ILIKE $${params.length})`);
  }
  const safeLimit = Math.min(60, Math.max(1, Number(limit) || 30));
  const safePage = Math.max(1, Number(page) || 1);
  params.push(safeLimit, (safePage - 1) * safeLimit);
  const { rows } = await pool.query(
    `${MARKET_SELECT.replace("SELECT pm.*", "SELECT pm.*, COUNT(*) OVER()::int AS total_count")}
     WHERE ${where.join(" AND ")}
     ORDER BY ${status ? TAB_ORDER.all : TAB_ORDER[safeTab]}, pm.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const items = await decorate(pool, rows);
  if (safeTab === "live" && !status) items.sort((a, b) => b.volume_24h - a.volume_24h || 0);
  return { items, total: num(rows[0]?.total_count), page: safePage, limit: safeLimit };
}

async function getMarketRow(db, slug) {
  const { rows } = await db.query(`${MARKET_SELECT} WHERE pm.slug = $1`, [slug]);
  if (!rows[0]) throw predictionError("prediction_market_not_found");
  return rows[0];
}

function canSeeMarket(market, user) {
  if (PUBLIC_STATUSES.includes(market.status) && market.visibility !== "private") return true;
  if (!user) return false;
  return Boolean(user.is_admin || user.can_approve_prediction_markets || String(market.creator_user_id) === String(user.id));
}

async function getMarketDetail(pool, slug, user = null) {
  const market = await getMarketRow(pool, slug);
  if (!canSeeMarket(market, user)) throw predictionError("prediction_market_not_found");
  const [view] = await decorate(pool, [market]);
  const [proposals, disputes, events, holders] = await Promise.all([
    pool.query(
      `SELECT p.*, u.username AS proposer_username, c.username AS confirmer_username, o.outcome_code, o.label AS outcome_label
       FROM market.prediction_resolution_proposals p
       LEFT JOIN market.users u ON u.id = p.proposer_user_id LEFT JOIN market.users c ON c.id = p.confirmer_user_id
       LEFT JOIN market.prediction_market_outcomes o ON o.id = p.outcome_id
       WHERE p.market_id = $1 ORDER BY p.created_at DESC, p.id DESC`,
      [market.id]
    ),
    pool.query(
      `SELECT d.*, u.username FROM market.prediction_disputes d JOIN market.users u ON u.id = d.user_id WHERE d.market_id = $1 ORDER BY d.created_at`,
      [market.id]
    ),
    pool.query(
      `SELECT e.id, e.event_type, e.event_data, e.created_at, u.username AS actor_username
       FROM market.prediction_market_events e LEFT JOIN market.users u ON u.id = e.actor_user_id
       WHERE e.market_id = $1 AND e.event_type NOT IN ('trade_matched', 'order_placed', 'order_cancelled')
       ORDER BY e.created_at DESC, e.id DESC LIMIT 60`,
      [market.id]
    ),
    pool.query(
      `SELECT * FROM (
         SELECT p.outcome_id, p.shares, u.username, u.profile_color,
                ROW_NUMBER() OVER (PARTITION BY p.outcome_id ORDER BY p.shares DESC) AS rn
         FROM market.prediction_market_positions p JOIN market.users u ON u.id = p.user_id
         WHERE p.market_id = $1 AND p.shares > 0.0001
       ) ranked WHERE rn <= 8`,
      [market.id]
    ),
  ]);
  const holdersBy = {};
  for (const row of holders.rows) {
    (holdersBy[row.outcome_id] ||= []).push({ username: row.username, profile_color: row.profile_color, shares: round6(num(row.shares)) });
  }
  const detail = {
    ...view,
    description: market.description,
    rules_text: market.rules_text,
    resolution_source_text: market.resolution_source_text,
    dispute_hours: num(market.dispute_hours),
    auto_data: market.auto_data || {},
    creator: market.creator_username ? { username: market.creator_username } : null,
    approver: market.approver_username ? { username: market.approver_username } : null,
    resolver: market.resolver_username ? { username: market.resolver_username } : null,
    proposals: proposals.rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      is_void: row.is_void,
      outcome_code: row.outcome_code,
      outcome_label: row.outcome_label,
      source_url: row.source_url,
      note: row.note,
      evidence: row.evidence_json || {},
      window_ends_at: row.window_ends_at,
      proposer: row.proposer_username ? { username: row.proposer_username } : null,
      confirmer: row.confirmer_username ? { username: row.confirmer_username } : null,
      self_confirmed: row.self_confirmed,
      finalized_at: row.finalized_at,
      created_at: row.created_at,
      disputes: disputes.rows
        .filter((dispute) => String(dispute.proposal_id) === String(row.id))
        .map((dispute) => ({ id: Number(dispute.id), username: dispute.username, reason: dispute.reason, created_at: dispute.created_at })),
    })),
    timeline: events.rows.map((row) => ({ id: Number(row.id), type: row.event_type, data: row.event_data || {}, actor: row.actor_username || null, at: row.created_at })),
    holders: holdersBy,
    max_house_loss: round2(lmsr.maxLoss(num(market.liquidity_b), view.outcomes.length)),
  };
  if (user && (user.is_admin || user.can_resolve_prediction_markets || user.can_approve_prediction_markets)) {
    detail.admin = { house_net_cash: round2(num(market.house_net_cash)), auto_key: market.auto_key };
  }
  if (user) detail.mine = await myMarketState(pool, market.id, user.id);
  return detail;
}

async function myMarketState(pool, marketId, userId) {
  const [positions, orders, cash] = await Promise.all([
    pool.query(
      `SELECT p.*, o.outcome_code FROM market.prediction_market_positions p JOIN market.prediction_market_outcomes o ON o.id = p.outcome_id
       WHERE p.market_id = $1 AND p.user_id = $2`,
      [marketId, userId]
    ),
    pool.query(
      `SELECT l.*, o.outcome_code FROM market.prediction_limit_orders l JOIN market.prediction_market_outcomes o ON o.id = l.outcome_id
       WHERE l.market_id = $1 AND l.user_id = $2 AND (l.status = 'open' OR l.closed_at > now() - interval '3 days') ORDER BY l.created_at DESC LIMIT 30`,
      [marketId, userId]
    ),
    pool.query(`SELECT cash_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [userId]),
  ]);
  return {
    cash_balance: num(cash.rows[0]?.cash_balance),
    positions: positions.rows.map((row) => ({
      outcome_id: Number(row.outcome_id),
      outcome_code: row.outcome_code,
      shares: round6(num(row.shares)),
      avg_price: round6(num(row.avg_entry_price)),
      net_cost: round2(num(row.net_cost_cash)),
      realized_pnl: round2(num(row.realized_pnl_cash)),
    })),
    orders: orders.rows.map((row) => ({ ...trading.limitOrderView(row), outcome_code: row.outcome_code })),
  };
}

const RANGES = {
  "1h": ["1m", "1 hour"],
  "6h": ["1m", "6 hours"],
  "24h": ["5m", "24 hours"],
  "7d": ["1h", "7 days"],
  "30d": ["1d", "30 days"],
  all: ["1d", "10 years"],
};

async function getChart(pool, slug, { range = "24h" } = {}) {
  const market = await getMarketRow(pool, slug);
  const [interval, span] = RANGES[range] || RANGES["24h"];
  const { rows } = await pool.query(
    `SELECT h.outcome_id, h.bucket_ts, h.close, h.volume_cash FROM market.prediction_market_price_history h
     WHERE h.market_id = $1 AND h.bucket_interval = $2 AND h.bucket_ts > now() - $3::interval ORDER BY h.bucket_ts`,
    [market.id, interval, span]
  );
  const outcomes = await core.loadOutcomes(pool, market.id);
  return {
    slug,
    range: RANGES[range] ? range : "24h",
    interval,
    series: outcomes.map((outcome) => ({
      outcome_id: Number(outcome.id),
      outcome_code: outcome.outcome_code,
      label: outcome.label,
      points: rows.filter((row) => String(row.outcome_id) === String(outcome.id)).map((row) => ({ t: row.bucket_ts, p: round6(num(row.close)), v: round2(num(row.volume_cash)) })),
    })),
  };
}

function tradeView(row) {
  return {
    id: Number(row.id),
    market_id: Number(row.market_id),
    slug: row.slug,
    market_title: row.title,
    outcome_code: row.outcome_code,
    outcome_label: row.outcome_label,
    side: row.taker_side,
    shares: round6(num(row.quantity)),
    cash: round2(num(row.notional_cash) + (row.taker_side === "buy" ? num(row.fee_cash_buy) : -num(row.fee_cash_sell))),
    avg_price: round6(num(row.price)),
    price_after: row.price_after === null ? null : round6(num(row.price_after)),
    via_limit: Boolean(row.limit_order_id),
    username: row.username,
    profile_color: row.profile_color,
    at: row.matched_at,
  };
}

const TRADE_SELECT = `
  SELECT t.*, pm.slug, pm.title, o.outcome_code, o.label AS outcome_label, u.username, u.profile_color
  FROM market.prediction_market_trades t
  JOIN market.prediction_markets pm ON pm.id = t.market_id
  JOIN market.prediction_market_outcomes o ON o.id = t.outcome_id
  LEFT JOIN market.users u ON u.id = t.taker_user_id`;

async function listTrades(pool, slug, { limit = 50 } = {}) {
  const { rows } = await pool.query(`${TRADE_SELECT} WHERE pm.slug = $1 AND t.trade_kind = 'amm' ORDER BY t.matched_at DESC, t.id DESC LIMIT $2`, [
    slug,
    Math.min(200, Math.max(1, Number(limit) || 50)),
  ]);
  return rows.map(tradeView);
}

async function listTape(pool, { limit = 40 } = {}) {
  const { rows } = await pool.query(
    `${TRADE_SELECT} WHERE pm.visibility = 'public' AND t.trade_kind = 'amm' ORDER BY t.matched_at DESC, t.id DESC LIMIT $1`,
    [Math.min(100, Math.max(1, Number(limit) || 40))]
  );
  return rows.map(tradeView);
}

async function getPortfolio(pool, userId) {
  const { rows } = await pool.query(
    `SELECT p.*, o.outcome_code, o.label AS outcome_label, o.amm_shares, o.color AS outcome_color,
            a.symbol AS asset_symbol, ch.icon AS asset_icon, ch.color AS asset_color, pm.slug, pm.title, pm.status, pm.market_type, pm.liquidity_b, pm.closes_at,
            pm.kind, pm.winning_outcome_id, pm.resolved_at, pm.voided_at,
            COALESCE((SELECT SUM(shares_reserved) FROM market.prediction_limit_orders l WHERE l.user_id = p.user_id AND l.outcome_id = p.outcome_id AND l.status = 'open'), 0) AS reserved
     FROM market.prediction_market_positions p
     JOIN market.prediction_market_outcomes o ON o.id = p.outcome_id
     JOIN market.prediction_markets pm ON pm.id = p.market_id
     LEFT JOIN market.market_assets a ON a.id = o.asset_id
     LEFT JOIN yt.youtube_channels ch ON ch.youtube_channel_id = a.youtube_channel_id
     WHERE p.user_id = $1
     ORDER BY pm.closes_at ASC`,
    [userId]
  );
  const marketIds = [...new Set(rows.map((row) => row.market_id))];
  const outcomeRows = marketIds.length
    ? (await pool.query(`SELECT id, market_id, amm_shares FROM market.prediction_market_outcomes WHERE market_id = ANY($1::bigint[]) ORDER BY sort_order, id`, [marketIds])).rows
    : [];
  const priceBy = new Map();
  for (const id of marketIds) {
    const own = outcomeRows.filter((row) => String(row.market_id) === String(id));
    const market = rows.find((row) => String(row.market_id) === String(id));
    const prices = lmsr.prices(own.map((row) => num(row.amm_shares)), num(market.liquidity_b, 250));
    own.forEach((row, index) => priceBy.set(String(row.id), prices[index]));
  }
  const open = [];
  const settled = [];
  for (const row of rows) {
    const shares = num(row.shares) + num(row.reserved);
    const live = ["open", "closed", "resolving", "proposed", "disputed"].includes(row.status);
    const price = priceBy.get(String(row.outcome_id)) ?? 0;
    const entry = {
      market_id: Number(row.market_id),
      slug: row.slug,
      title: row.title,
      status: row.status,
      kind: row.kind,
      market_type: row.market_type,
      closes_at: row.closes_at,
      outcome_id: Number(row.outcome_id),
      outcome_color: row.outcome_color || null,
      asset: row.asset_symbol ? { symbol: row.asset_symbol, icon: row.asset_icon, color: row.asset_color } : null,
      outcome_code: row.outcome_code,
      outcome_label: row.outcome_label,
      shares: round6(shares),
      shares_in_orders: round6(num(row.reserved)),
      avg_price: round6(num(row.avg_entry_price)),
      price: round6(price),
      value: round2(shares * price),
      cost: round2(shares * num(row.avg_entry_price)),
      unrealized_pnl: round2(shares * (price - num(row.avg_entry_price))),
      realized_pnl: round2(num(row.realized_pnl_cash)),
      won: row.winning_outcome_id ? String(row.winning_outcome_id) === String(row.outcome_id) : null,
      settled_at: row.resolved_at || row.voided_at,
    };
    if (live && shares > 0.000001) open.push(entry);
    else if (!live) settled.push(entry);
  }
  const orders = (
    await pool.query(
      `SELECT l.*, o.outcome_code, o.label AS outcome_label, pm.slug, pm.title FROM market.prediction_limit_orders l
       JOIN market.prediction_market_outcomes o ON o.id = l.outcome_id JOIN market.prediction_markets pm ON pm.id = l.market_id
       WHERE l.user_id = $1 AND l.status = 'open' ORDER BY l.created_at DESC`,
      [userId]
    )
  ).rows.map((row) => ({ ...trading.limitOrderView(row), outcome_code: row.outcome_code, outcome_label: row.outcome_label, slug: row.slug, title: row.title }));
  settled.sort((a, b) => new Date(b.settled_at || 0) - new Date(a.settled_at || 0));
  return {
    positions: open,
    orders,
    settled: settled.slice(0, 50),
    totals: {
      value: round2(open.reduce((sum, row) => sum + row.value, 0)),
      unrealized_pnl: round2(open.reduce((sum, row) => sum + row.unrealized_pnl, 0)),
      realized_pnl: round2(rows.reduce((sum, row) => sum + num(row.realized_pnl_cash), 0)),
      in_orders_cash: round2(orders.reduce((sum, order) => sum + (order.side === "buy" ? order.cash_reserved : 0), 0)),
    },
  };
}

/** Forecasters: realized P&L on markets settled in the last 7 days. */
async function getLeaderboard(pool, { limit = 10 } = {}) {
  const { rows } = await pool.query(
    `SELECT u.username, u.profile_color, SUM(p.realized_pnl_cash) AS pnl, COUNT(DISTINCT p.market_id)::int AS markets
     FROM market.prediction_market_positions p
     JOIN market.prediction_markets pm ON pm.id = p.market_id
     JOIN market.users u ON u.id = p.user_id
     WHERE pm.status IN ('resolved', 'voided') AND COALESCE(pm.resolved_at, pm.voided_at) > now() - interval '7 days'
     GROUP BY u.id ORDER BY pnl DESC LIMIT $1`,
    [Math.min(50, Math.max(1, Number(limit) || 10))]
  );
  return rows.map((row, index) => ({ rank: index + 1, username: row.username, profile_color: row.profile_color, pnl: round2(num(row.pnl)), markets: row.markets }));
}

async function getAdminOverview(pool) {
  const section = async (where, order, limit = 40) => {
    const { rows } = await pool.query(`${MARKET_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`);
    return decorate(pool, rows).then((views) =>
      views.map((view, index) => ({ ...view, house_net_cash: round2(num(rows[index].house_net_cash)), max_house_loss: round2(lmsr.maxLoss(view.liquidity_b, view.outcomes.length)), creator: rows[index].creator_username }))
    );
  };
  const [queue, needsCall, proposals, live, drafts, templates] = await Promise.all([
    section(`pm.status = 'pending_approval'`, `pm.created_at ASC`),
    section(`pm.kind = 'event' AND pm.status IN ('resolving', 'closed')`, `pm.closes_at ASC`),
    section(`pm.status IN ('proposed', 'disputed')`, `pm.updated_at ASC`),
    section(`pm.status = 'open'`, `pm.closes_at ASC`, 100),
    section(`pm.status IN ('draft', 'rejected')`, `pm.updated_at DESC`),
    pool.query(`SELECT * FROM market.prediction_auto_templates ORDER BY key`),
  ]);
  for (const market of proposals) {
    const proposal = await currentProposal(pool, market.id);
    const disputes = proposal
      ? (await pool.query(`SELECT d.reason, d.created_at, u.username FROM market.prediction_disputes d JOIN market.users u ON u.id = d.user_id WHERE d.proposal_id = $1 ORDER BY d.created_at`, [proposal.id])).rows
      : [];
    const outcome = proposal?.outcome_id ? market.outcomes.find((entry) => String(entry.id) === String(proposal.outcome_id)) : null;
    const proposer = proposal?.proposer_user_id ? (await pool.query(`SELECT username FROM market.users WHERE id = $1`, [proposal.proposer_user_id])).rows[0]?.username : null;
    market.proposal = proposal
      ? {
          id: Number(proposal.id),
          status: proposal.status,
          is_void: proposal.is_void,
          outcome_code: outcome?.outcome_code ?? null,
          outcome_label: outcome?.label ?? null,
          source_url: proposal.source_url,
          note: proposal.note,
          window_ends_at: proposal.window_ends_at,
          created_at: proposal.created_at,
          proposer,
          disputes,
        }
      : null;
  }
  return {
    queue,
    needs_call: needsCall,
    proposals,
    live,
    drafts,
    templates: templates.rows.map((row) => ({ key: row.key, enabled: row.enabled, params: row.params_json || {}, last_run_at: row.last_run_at, last_result: row.last_result_json || {} })),
    house: {
      open_markets: live.length,
      worst_case_loss: round2(live.reduce((sum, market) => sum + market.max_house_loss, 0)),
    },
  };
}

async function listCategories(pool) {
  const { rows } = await pool.query(`SELECT slug, display_name, description FROM market.prediction_market_categories WHERE is_active ORDER BY sort_order, id`);
  return rows;
}

module.exports = {
  approveMarket,
  canSeeMarket,
  createMarket,
  createMarketWithClient,
  getAdminOverview,
  getChart,
  getLeaderboard,
  getMarketDetail,
  getPortfolio,
  listCategories,
  listMarkets,
  listTape,
  listTrades,
  marketView,
  rejectMarket,
  submitMarket,
};
