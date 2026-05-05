const marketState = require("./services/marketState");

const PROFILE_PICTURE_CDN_BASE_URL = "https://images.nasfaq.biz/profile-pictures";

function profilePictureUrlSql(size, alias = "pp") {
  const folder = size === "small" ? "small" : "large";
  const field = size === "small" ? "filename_small" : "filename_large";
  return `CASE WHEN ${alias}.id IS NULL OR ${alias}.is_deleted THEN NULL ELSE '${PROFILE_PICTURE_CDN_BASE_URL}/${folder}/' || ${alias}.${field} END`;
}

function parseRangeToInterval(range) {
  switch ((range || "").toLowerCase()) {
    case "24h":
      return "24 hours";
    case "7d":
      return "7 days";
    case "30d":
      return "30 days";
    case "90d":
      return "90 days";
    case "1y":
      return "365 days";
    default:
      return "30 days";
  }
}

function parseCandleBucket(interval) {
  switch ((interval || "").toLowerCase()) {
    case "1m":
      return "1 minute";
    case "5m":
      return "5 minutes";
    case "1h":
      return "1 hour";
    case "1d":
      return "1 day";
    default:
      return null;
  }
}

function parseIndexWeighting(weighting) {
  switch ((weighting || "").toLowerCase()) {
    case "market_cap":
      return "market_cap";
    case "equal":
    default:
      return "equal";
  }
}

function parseRangeToMilliseconds(range) {
  switch ((range || "").toLowerCase()) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    case "90d":
      return 90 * 24 * 60 * 60 * 1000;
    case "1y":
      return 365 * 24 * 60 * 60 * 1000;
    default:
      return 30 * 24 * 60 * 60 * 1000;
  }
}

function getSuperchatTimeseriesConfig(range) {
  switch ((range || "").toLowerCase()) {
    case "7d":
      return {
        range: "7d",
        bucketUnit: "day",
        startExpr: "current_date - interval '7 days'",
        endExpr: "current_date - interval '1 day'",
        stepInterval: "1 day",
        bucketExpr: "date_trunc('day', started_at)::date",
      };
    case "14d":
      return {
        range: "14d",
        bucketUnit: "day",
        startExpr: "current_date - interval '14 days'",
        endExpr: "current_date - interval '1 day'",
        stepInterval: "1 day",
        bucketExpr: "date_trunc('day', started_at)::date",
      };
    case "1m":
      return {
        range: "1m",
        bucketUnit: "week",
        startExpr: "date_trunc('week', current_date - interval '27 days')::date",
        endExpr: "date_trunc('week', current_date)::date",
        stepInterval: "1 week",
        bucketExpr: "date_trunc('week', started_at)::date",
      };
    case "1y":
      return {
        range: "1y",
        bucketUnit: "day",
        startExpr: "current_date - interval '365 days'",
        endExpr: "current_date - interval '1 day'",
        stepInterval: "1 day",
        bucketExpr: "date_trunc('day', started_at)::date",
      };
    default: {
      const error = new Error("unsupported_superchat_range");
      error.code = "unsupported_superchat_range";
      throw error;
    }
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const ASSET_COMMENT_MOODS = new Set([
  "Bullish",
  "Bearish",
  "Neutral",
  "Hodling",
  "Dump Eet",
  "He Bought?",
  "He Sold?",
  "Diamond Hands",
  "Watching",
  "Accumulating",
]);

function normalizeTrimmedString(value, { maxLength = null, allowEmpty = false } = {}) {
  const trimmed = String(value || "").trim();
  const limited = maxLength ? trimmed.slice(0, maxLength) : trimmed;
  if (!allowEmpty && !limited) return null;
  return limited;
}

function normalizeAssetCommentMood(value) {
  const normalized = normalizeTrimmedString(value, { maxLength: 40, allowEmpty: false });
  if (!normalized) return null;
  return ASSET_COMMENT_MOODS.has(normalized) ? normalized : null;
}

function roundMetric(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(6));
}

const MARKET_ADJUSTMENT_INTERVALS = [
  { key: "open", label: "Open", time: "09:00", timezone: "America/New_York" },
  { key: "lunch", label: "Lunch", time: "15:00", timezone: "America/New_York" },
  { key: "late", label: "Late", time: "21:00", timezone: "America/New_York" },
  { key: "overnight", label: "Overnight", time: "03:00", timezone: "America/New_York", next_day: true },
];
const SUPPLY_EVALUATION_CADENCES = new Set(["weekly", "monthly", "quarterly", "manual"]);

function buildMarketTuningConfig() {
  return {
    vocabulary_version: 1,
    base_rate_source: "market.market_assets.current_fair_value",
    market_price_source: "market.market_assets.current_mid_price",
    premium_discount_source: "market.market_assets.current_premium_pct",
    interval_strength_total_pct: 200,
    intervals: MARKET_ADJUSTMENT_INTERVALS,
    asset_tuning_defaults: {
      adjustment_min_pct: 0,
      adjustment_max_pct: 200,
      adjustment_enabled: true,
      supply_evaluation_cadence: "weekly",
      broker_buffer_pct: 0.02,
    },
    phase: {
      key: "phase_1",
      status: "reporting_only",
      description: "Fair value is exposed as base rate; interval generation and execution arrive in Phase 2.",
    },
  };
}

function normalizeOptionalNumber(value, fieldName, { min = null, maxExclusive = null } = {}) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error(`invalid_${fieldName}`);
    error.code = "invalid_market_tuning";
    error.field = fieldName;
    throw error;
  }
  if ((min !== null && parsed < min) || (maxExclusive !== null && parsed >= maxExclusive)) {
    const error = new Error(`invalid_${fieldName}`);
    error.code = "invalid_market_tuning";
    error.field = fieldName;
    throw error;
  }
  return parsed;
}

function normalizeOptionalBoolean(value, fieldName) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    const error = new Error(`invalid_${fieldName}`);
    error.code = "invalid_market_tuning";
    error.field = fieldName;
    throw error;
  }
  return value;
}

function normalizeOptionalCadence(value) {
  if (value === undefined) return undefined;
  const cadence = String(value || "").trim().toLowerCase();
  if (!SUPPLY_EVALUATION_CADENCES.has(cadence)) {
    const error = new Error("invalid_supply_evaluation_cadence");
    error.code = "invalid_market_tuning";
    error.field = "supply_evaluation_cadence";
    throw error;
  }
  return cadence;
}

function sortByBucketAsc(points) {
  return [...points].sort((a, b) => String(a.bucket || "").localeCompare(String(b.bucket || "")));
}

function buildLiveVolumeSections(assets, limit = 5) {
  const rows = assets.map((asset) => {
    const candles = sortByBucketAsc(Array.isArray(asset.sparkline_candles) ? asset.sparkline_candles : [])
      .filter((point) => point && point.volume_shares !== null && point.volume_shares !== undefined);
    const previousVolume = candles.length >= 2 ? toNumber(candles[candles.length - 2].volume_shares, 0) : null;
    const currentVolume = toNumber(asset.volume_24h, 0);
    const volumeChangePct =
      previousVolume !== null && previousVolume > 0 ? roundMetric((currentVolume - previousVolume) / previousVolume) : null;

    return {
      asset_id: asset.id,
      symbol: asset.symbol,
      display_name: asset.display_name,
      volume_shares: roundMetric(currentVolume),
      volume_cash: roundMetric(asset.volume_cash_24h),
      volume_change_pct: volumeChangePct,
    };
  });

  const topBy = (items, metric, direction = "desc") =>
    [...items]
      .filter((item) => item[metric] !== null && item[metric] !== undefined)
      .sort((a, b) => {
        const av = toNumber(a[metric], 0);
        const bv = toNumber(b[metric], 0);
        return direction === "asc" ? av - bv : bv - av;
      })
      .slice(0, limit);

  return {
    volume_winners: topBy(rows, "volume_change_pct", "desc"),
    volume_losers: topBy(rows, "volume_change_pct", "asc"),
    top_volume: topBy(rows, "volume_shares", "desc"),
  };
}

async function listAssets(pool) {
  const { rows } = await pool.query(
    `
    WITH volume_24h AS (
      SELECT
        tf.asset_id,
        COALESCE(SUM(tf.quantity), 0) AS volume_24h,
        COALESCE(SUM(tf.gross_cash), 0) AS volume_cash_24h
      FROM market.trade_fills tf
      WHERE tf.ts >= now() - interval '24 hours'
      GROUP BY tf.asset_id
    ),
    latest_daily AS (
      SELECT DISTINCT ON (d.asset_id)
        d.asset_id,
        d.market_date,
        d.mid_open,
        d.mid_close,
        d.mid_close_mark,
        d.volume_shares,
        d.volume_cash,
        d.trade_count
      FROM market.asset_daily_market_state d
      ORDER BY d.asset_id, d.market_date DESC
    ),
    latest_settlement_reset AS (
      SELECT DISTINCT ON (e.asset_id)
        e.asset_id,
        e.old_mid_price AS pre_settlement_mid_price
      FROM market.asset_price_events e
      WHERE e.event_type = 'daily_reset'
      ORDER BY e.asset_id, e.ts DESC
    ),
    sparkline_daily AS (
      SELECT
        d.asset_id,
        jsonb_agg(
          jsonb_build_object(
            'bucket', d.market_date::text,
            'open', d.mid_open,
            'high', COALESCE(d.mid_high, GREATEST(d.mid_open, COALESCE(d.mid_close, d.mid_open))),
            'low', COALESCE(d.mid_low, LEAST(d.mid_open, COALESCE(d.mid_close, d.mid_open))),
            'close', COALESCE(d.mid_close, d.mid_open),
            'close_mark', d.mid_close_mark,
            'volume_shares', d.volume_shares
          )
          ORDER BY d.market_date ASC
        ) AS sparkline_candles
      FROM market.asset_daily_market_state d
      WHERE d.market_date >= current_date - interval '14 days'
      GROUP BY d.asset_id
    ),
    next_adjustment AS (
      SELECT DISTINCT ON (i.asset_id)
        i.asset_id,
        i.interval_key,
        i.scheduled_at,
        i.strength_pct,
        i.base_rate,
        s.market_date
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      WHERE i.status = 'scheduled'
      ORDER BY i.asset_id, i.scheduled_at ASC, i.id ASC
    ),
    latest_adjustment AS (
      SELECT DISTINCT ON (i.asset_id)
        i.asset_id,
        i.interval_key,
        i.scheduled_at,
        i.applied_at,
        i.strength_pct,
        i.base_rate,
        i.price_before,
        i.price_after,
        s.market_date
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      WHERE i.status = 'applied'
      ORDER BY i.asset_id, i.applied_at DESC NULLS LAST, i.id DESC
    ),
    next_live_order_tick AS (
      SELECT MIN(execute_after) AS execute_after
      FROM market.trade_orders
      WHERE order_type = 'live_market'
        AND status = 'pending'
    ),
    pending_live_orders AS (
      SELECT
        o.asset_id,
        COUNT(*)::int AS pending_live_order_count,
        COUNT(*) FILTER (WHERE o.side = 'buy')::int AS pending_live_buy_count,
        COUNT(*) FILTER (WHERE o.side = 'sell')::int AS pending_live_sell_count,
        COALESCE(SUM(o.requested_quantity) FILTER (WHERE o.side = 'buy'), 0) AS pending_live_buy_quantity,
        COALESCE(SUM(o.requested_quantity) FILTER (WHERE o.side = 'sell'), 0) AS pending_live_sell_quantity,
        MIN(o.execute_after) AS next_live_order_execute_after
      FROM market.trade_orders o
      JOIN next_live_order_tick nt ON o.execute_after = nt.execute_after
      WHERE o.order_type = 'live_market'
        AND o.status = 'pending'
      GROUP BY o.asset_id
    ),
    oshicoin_users AS (
      SELECT
        u.oshi_coin_asset_id AS asset_id,
        COUNT(*)::INTEGER AS oshicoin_users
      FROM market.users u
      WHERE u.oshi_coin_asset_id IS NOT NULL
      GROUP BY u.oshi_coin_asset_id
    )
    SELECT
      a.id,
      a.symbol,
      a.display_name,
      a.status,
      a.youtube_channel_id,
      c.name_short,
      c.name_english,
      c.unit,
      c.icon,
      c.color,
      a.current_fair_value,
      a.current_fair_value AS base_rate,
      a.current_mid_price,
      a.current_mid_price AS market_price,
      ld.mid_open AS previous_settlement_mid_price,
      lsr.pre_settlement_mid_price,
      a.current_bid_price,
      a.current_ask_price,
      a.current_premium_pct,
      a.current_premium_pct AS premium_discount_pct,
      a.adjustment_min_pct,
      a.adjustment_max_pct,
      a.adjustment_enabled,
      a.supply_evaluation_cadence,
      a.broker_buffer_pct,
      (
        a.adjustment_enabled
        AND a.current_fair_value IS NOT NULL
        AND a.current_mid_price IS NOT NULL
      ) AS adjustment_ready,
      jsonb_build_object(
        'adjustment_min_pct', a.adjustment_min_pct,
        'adjustment_max_pct', a.adjustment_max_pct,
        'adjustment_enabled', a.adjustment_enabled,
        'supply_evaluation_cadence', a.supply_evaluation_cadence,
        'broker_buffer_pct', a.broker_buffer_pct
      ) AS market_tuning,
      CASE
        WHEN na.asset_id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'interval_key', na.interval_key,
          'scheduled_at', na.scheduled_at,
          'market_date', na.market_date
        )
      END AS next_adjustment,
      CASE
        WHEN la.asset_id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'interval_key', la.interval_key,
          'scheduled_at', la.scheduled_at,
          'applied_at', la.applied_at,
          'price_before', la.price_before,
          'price_after', la.price_after,
          'market_date', la.market_date
        )
      END AS latest_adjustment,
      a.current_daily_emission,
      a.treasury_supply,
      a.circulating_supply,
      a.max_supply,
      a.latest_snapshot_date,
      COALESCE(v.volume_24h, 0) AS volume_24h,
      COALESCE(v.volume_cash_24h, 0) AS volume_cash_24h,
      COALESCE(plo.pending_live_order_count, 0) AS pending_live_order_count,
      COALESCE(plo.pending_live_buy_count, 0) AS pending_live_buy_count,
      COALESCE(plo.pending_live_sell_count, 0) AS pending_live_sell_count,
      COALESCE(plo.pending_live_buy_quantity, 0) AS pending_live_buy_quantity,
      COALESCE(plo.pending_live_sell_quantity, 0) AS pending_live_sell_quantity,
      plo.next_live_order_execute_after,
      COALESCE(ou.oshicoin_users, 0) AS oshicoin_users,
      CASE
        WHEN ld.mid_open IS NULL OR ld.mid_open = 0 OR a.current_mid_price IS NULL THEN NULL
        ELSE (a.current_mid_price - ld.mid_open) / ld.mid_open
      END AS move_24h_pct,
      ld.market_date AS latest_market_date,
      COALESCE(sd.sparkline_candles, '[]'::jsonb) AS sparkline_candles
    FROM market.market_assets a
    JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    LEFT JOIN volume_24h v ON v.asset_id = a.id
    LEFT JOIN latest_daily ld ON ld.asset_id = a.id
    LEFT JOIN latest_settlement_reset lsr ON lsr.asset_id = a.id
    LEFT JOIN sparkline_daily sd ON sd.asset_id = a.id
    LEFT JOIN next_adjustment na ON na.asset_id = a.id
    LEFT JOIN latest_adjustment la ON la.asset_id = a.id
    LEFT JOIN pending_live_orders plo ON plo.asset_id = a.id
    LEFT JOIN oshicoin_users ou ON ou.asset_id = a.id
    ORDER BY a.symbol ASC
  `
  );
  return rows;
}

async function getAssetBySymbol(pool, symbol) {
  const { rows } = await pool.query(
    `
    WITH latest_daily AS (
      SELECT d.*
      FROM market.asset_daily_market_state d
      JOIN market.market_assets a ON a.id = d.asset_id
      WHERE a.symbol = $1
      ORDER BY d.market_date DESC
      LIMIT 1
    ),
    latest_snapshot AS (
      SELECT s.*
      FROM market.channel_daily_snapshots s
      JOIN market.market_assets a ON a.youtube_channel_id = s.youtube_channel_id
      WHERE a.symbol = $1
      ORDER BY s.snapshot_date DESC
      LIMIT 1
    ),
    volume_24h AS (
      SELECT
        tf.asset_id,
        COALESCE(SUM(tf.quantity), 0) AS volume_24h,
        COALESCE(SUM(tf.gross_cash), 0) AS volume_cash_24h,
        COUNT(*) AS trade_count_24h
      FROM market.trade_fills tf
      JOIN market.market_assets a ON a.id = tf.asset_id
      WHERE a.symbol = $1
        AND tf.ts >= now() - interval '24 hours'
      GROUP BY tf.asset_id
    ),
    latest_trade AS (
      SELECT
        tf.asset_id,
        tf.ts,
        tf.side,
        tf.price,
        tf.quantity,
        tf.gross_cash,
        tf.fee_cash,
        tf.net_cash
      FROM market.trade_fills tf
      JOIN market.market_assets a ON a.id = tf.asset_id
      WHERE a.symbol = $1
      ORDER BY tf.ts DESC, tf.id DESC
      LIMIT 1
    ),
    next_adjustment AS (
      SELECT
        i.interval_key,
        i.scheduled_at,
        i.strength_pct,
        i.base_rate,
        s.market_date
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      JOIN market.market_assets a ON a.id = i.asset_id
      WHERE a.symbol = $1
        AND i.status = 'scheduled'
      ORDER BY i.scheduled_at ASC, i.id ASC
      LIMIT 1
    ),
    latest_adjustment AS (
      SELECT
        i.interval_key,
        i.scheduled_at,
        i.applied_at,
        i.strength_pct,
        i.base_rate,
        i.price_before,
        i.price_after,
        s.market_date
      FROM market.asset_adjustment_intervals i
      JOIN market.adjustment_sessions s ON s.id = i.session_id
      JOIN market.market_assets a ON a.id = i.asset_id
      WHERE a.symbol = $1
        AND i.status = 'applied'
      ORDER BY i.applied_at DESC NULLS LAST, i.id DESC
      LIMIT 1
    ),
    pending_live_orders AS (
      SELECT
        o.asset_id,
        COUNT(*)::int AS pending_live_order_count,
        COUNT(*) FILTER (WHERE o.side = 'buy')::int AS pending_live_buy_count,
        COUNT(*) FILTER (WHERE o.side = 'sell')::int AS pending_live_sell_count,
        COALESCE(SUM(o.requested_quantity) FILTER (WHERE o.side = 'buy'), 0) AS pending_live_buy_quantity,
        COALESCE(SUM(o.requested_quantity) FILTER (WHERE o.side = 'sell'), 0) AS pending_live_sell_quantity,
        MIN(o.execute_after) AS next_live_order_execute_after
      FROM market.trade_orders o
      JOIN market.market_assets a ON a.id = o.asset_id
      WHERE a.symbol = $1
        AND o.order_type = 'live_market'
        AND o.status = 'pending'
        AND o.execute_after = (
          SELECT MIN(o2.execute_after)
          FROM market.trade_orders o2
          JOIN market.market_assets a2 ON a2.id = o2.asset_id
          WHERE a2.symbol = $1
            AND o2.order_type = 'live_market'
            AND o2.status = 'pending'
        )
      GROUP BY o.asset_id
    )
    SELECT
      a.id,
      a.symbol,
      a.display_name,
      a.status,
      a.youtube_channel_id,
      a.max_supply,
      a.circulating_supply,
      a.treasury_supply,
      a.base_emission,
      a.latest_snapshot_date,
      a.latest_snapshot_id,
      a.current_fair_value,
      a.current_fair_value_raw,
      a.current_mid_price,
      a.current_bid_price,
      a.current_ask_price,
      a.current_premium_pct,
      a.current_daily_emission,
      a.liquidity_depth,
      a.spread_bps,
      a.created_at,
      a.updated_at,
      c.name_short,
      c.name_english,
      c.name_japanese,
      c.icon,
      c.color,
      c.twitter_id,
      c.profile_id,
      c.birthday,
      c.height,
      c.unit,
      c.is_active,
      ls.id AS snapshot_id,
      ls.snapshot_date,
      ls.subscriber_count,
      ls.view_count,
      ls.video_count,
      ls.view_delta_1d,
      ls.view_delta_7d,
      ls.view_delta_30d,
      ls.video_delta_7d,
      ls.video_delta_30d,
      ls.estimated_sub_delta_7d,
      ls.estimated_sub_delta_30d,
      ls.size_anchor_raw,
      ls.view_signal,
      ls.upload_signal,
      ls.sub_signal,
      ls.momentum_raw,
      ls.momentum_multiplier,
      ls.fundamental_value_raw,
      ls.fundamental_value_smoothed,
      ls.calculation_version,
      ls.calculation_status,
      a.current_fair_value AS base_rate,
      a.current_mid_price AS market_price,
      a.current_premium_pct AS premium_discount_pct,
      a.adjustment_min_pct,
      a.adjustment_max_pct,
      a.adjustment_enabled,
      a.supply_evaluation_cadence,
      a.broker_buffer_pct,
      (
        a.adjustment_enabled
        AND a.current_fair_value IS NOT NULL
        AND a.current_mid_price IS NOT NULL
      ) AS adjustment_ready,
      jsonb_build_object(
        'adjustment_min_pct', a.adjustment_min_pct,
        'adjustment_max_pct', a.adjustment_max_pct,
        'adjustment_enabled', a.adjustment_enabled,
        'supply_evaluation_cadence', a.supply_evaluation_cadence,
        'broker_buffer_pct', a.broker_buffer_pct
      ) AS market_tuning,
      CASE
        WHEN na.interval_key IS NULL THEN NULL
        ELSE jsonb_build_object(
          'interval_key', na.interval_key,
          'scheduled_at', na.scheduled_at,
          'market_date', na.market_date
        )
      END AS next_adjustment,
      CASE
        WHEN la.interval_key IS NULL THEN NULL
        ELSE jsonb_build_object(
          'interval_key', la.interval_key,
          'scheduled_at', la.scheduled_at,
          'applied_at', la.applied_at,
          'price_before', la.price_before,
          'price_after', la.price_after,
          'market_date', la.market_date
        )
      END AS latest_adjustment,
      ld.market_date,
      ld.mid_open,
      ld.mid_close,
      ld.mid_close_mark,
      ld.mid_high,
      ld.mid_low,
      ld.bid_close,
      ld.ask_close,
      ld.premium_close_pct,
      ld.daily_emission,
      ld.treasury_supply_start,
      ld.treasury_supply_end,
      ld.circulating_supply_start,
      ld.circulating_supply_end,
      ld.volume_shares,
      ld.volume_cash,
      ld.trade_count,
      COALESCE(v.volume_24h, 0) AS volume_24h,
      COALESCE(v.volume_cash_24h, 0) AS volume_cash_24h,
      COALESCE(v.trade_count_24h, 0) AS trade_count_24h,
      COALESCE(plo.pending_live_order_count, 0) AS pending_live_order_count,
      COALESCE(plo.pending_live_buy_count, 0) AS pending_live_buy_count,
      COALESCE(plo.pending_live_sell_count, 0) AS pending_live_sell_count,
      COALESCE(plo.pending_live_buy_quantity, 0) AS pending_live_buy_quantity,
      COALESCE(plo.pending_live_sell_quantity, 0) AS pending_live_sell_quantity,
      plo.next_live_order_execute_after,
      lt.ts AS last_trade_ts,
      lt.side AS last_trade_side,
      lt.price AS last_trade_price,
      lt.quantity AS last_trade_quantity
    FROM market.market_assets a
    JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    LEFT JOIN latest_snapshot ls ON true
    LEFT JOIN latest_daily ld ON true
    LEFT JOIN volume_24h v ON v.asset_id = a.id
    LEFT JOIN latest_trade lt ON lt.asset_id = a.id
    LEFT JOIN next_adjustment na ON true
    LEFT JOIN latest_adjustment la ON true
    LEFT JOIN pending_live_orders plo ON plo.asset_id = a.id
    WHERE a.symbol = $1
    LIMIT 1
  `,
    [symbol]
  );
  return rows[0] || null;
}

async function updateAssetMarketTuning(pool, symbol, patch = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const { rows } = await pool.query(
    `
    SELECT
      adjustment_min_pct,
      adjustment_max_pct,
      adjustment_enabled,
      supply_evaluation_cadence,
      broker_buffer_pct
    FROM market.market_assets
    WHERE symbol = $1
    LIMIT 1
  `,
    [normalizedSymbol]
  );

  const current = rows[0] || null;
  if (!current) {
    const error = new Error("asset_not_found");
    error.code = "asset_not_found";
    throw error;
  }

  const adjustmentMinPct = normalizeOptionalNumber(patch.adjustment_min_pct, "adjustment_min_pct", { min: 0 });
  const adjustmentMaxPct = normalizeOptionalNumber(patch.adjustment_max_pct, "adjustment_max_pct", { min: 0 });
  const brokerBufferPct = normalizeOptionalNumber(patch.broker_buffer_pct, "broker_buffer_pct", {
    min: 0,
    maxExclusive: 1,
  });
  const adjustmentEnabled = normalizeOptionalBoolean(patch.adjustment_enabled, "adjustment_enabled");
  const supplyEvaluationCadence = normalizeOptionalCadence(patch.supply_evaluation_cadence);

  const nextMin = adjustmentMinPct === undefined ? toNumber(current.adjustment_min_pct, 0) : adjustmentMinPct;
  const nextMax = adjustmentMaxPct === undefined ? toNumber(current.adjustment_max_pct, 200) : adjustmentMaxPct;
  if (nextMax < nextMin) {
    const error = new Error("invalid_adjustment_range");
    error.code = "invalid_market_tuning";
    error.field = "adjustment_max_pct";
    throw error;
  }

  await pool.query(
    `
    UPDATE market.market_assets
    SET
      adjustment_min_pct = $2,
      adjustment_max_pct = $3,
      adjustment_enabled = $4,
      supply_evaluation_cadence = $5,
      broker_buffer_pct = $6,
      updated_at = now()
    WHERE symbol = $1
  `,
    [
      normalizedSymbol,
      nextMin,
      nextMax,
      adjustmentEnabled === undefined ? Boolean(current.adjustment_enabled) : adjustmentEnabled,
      supplyEvaluationCadence === undefined ? current.supply_evaluation_cadence : supplyEvaluationCadence,
      brokerBufferPct === undefined ? toNumber(current.broker_buffer_pct, 0.02) : brokerBufferPct,
    ]
  );

  return getAssetBySymbol(pool, normalizedSymbol);
}

async function getAssetTrades(pool, symbol, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT
      tf.id,
      tf.order_id,
      tf.user_id,
      tf.ts,
      tf.side,
      tf.price,
      tf.quantity,
      tf.gross_cash,
      tf.fee_cash,
      tf.net_cash,
      tf.counterparty_type
    FROM market.trade_fills tf
    JOIN market.market_assets a ON a.id = tf.asset_id
    WHERE a.symbol = $1
    ORDER BY tf.ts DESC, tf.id DESC
    LIMIT $2
  `,
    [symbol, limit]
  );
  return rows;
}

async function listRecentMarketTrades(pool, { limit = 50, beforeTs = null, beforeId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(String(limit || 50), 10) || 50));
  const hasCursor = beforeTs && beforeId;
  const params = hasCursor ? [beforeTs, beforeId, safeLimit + 1] : [safeLimit + 1];

  const { rows } = await pool.query(
    `
    SELECT
      tf.id,
      tf.order_id,
      tf.user_id,
      u.username,
      u.profile_color,
      tf.asset_id,
      ma.symbol,
      ma.display_name,
      c.icon,
      c.color,
      tf.ts,
      tf.side,
      tf.price,
      tf.quantity,
      tf.gross_cash,
      tf.fee_cash,
      tf.net_cash,
      tf.counterparty_type
    FROM market.trade_fills tf
    JOIN market.market_assets ma
      ON ma.id = tf.asset_id
    JOIN yt.youtube_channels c
      ON c.youtube_channel_id = ma.youtube_channel_id
    JOIN market.users u
      ON u.id = tf.user_id
    ${hasCursor ? "WHERE (tf.ts, tf.id) < ($1::timestamptz, $2::bigint)" : ""}
    ORDER BY tf.ts DESC, tf.id DESC
    LIMIT $${hasCursor ? 3 : 1}
  `,
    params
  );

  const hasMore = rows.length > safeLimit;
  const items = hasMore ? rows.slice(0, safeLimit) : rows;

  return {
    items,
    next_cursor: hasMore
      ? {
          ts: items[items.length - 1]?.ts || null,
          id: items[items.length - 1]?.id || null,
        }
      : null,
  };
}

async function getMarketActivityStats(pool) {
  const [windowResult, traderResult, liveOrders] = await Promise.all([
    pool.query(
      `
      WITH windows AS (
        SELECT '5m'::text AS key, interval '5 minutes' AS lookback
        UNION ALL
        SELECT '1h'::text AS key, interval '1 hour' AS lookback
        UNION ALL
        SELECT '24h'::text AS key, interval '24 hours' AS lookback
      )
      SELECT
        w.key,
        COUNT(tf.id)::int AS trade_count,
        COUNT(DISTINCT tf.user_id)::int AS trader_count,
        COUNT(DISTINCT tf.asset_id)::int AS asset_count,
        COALESCE(SUM(tf.quantity), 0) AS volume_shares,
        COALESCE(SUM(tf.gross_cash), 0) AS volume_cash,
        MAX(tf.ts) AS latest_trade_at
      FROM windows w
      LEFT JOIN market.trade_fills tf
        ON tf.ts >= now() - w.lookback
      GROUP BY w.key
      ORDER BY w.key ASC
    `
    ),
    pool.query(
      `
      SELECT
        tf.user_id,
        u.username,
        u.profile_color,
        COALESCE(${profilePictureUrlSql("small", "pp")}, u.profile_picture_url) AS profile_picture_url,
        COUNT(*)::int AS trade_count,
        COUNT(DISTINCT tf.asset_id)::int AS distinct_assets,
        COALESCE(SUM(tf.gross_cash), 0) AS volume_cash,
        COALESCE(SUM(tf.quantity), 0) AS volume_shares,
        MAX(tf.ts) AS latest_trade_at
      FROM market.trade_fills tf
      JOIN market.users u
        ON u.id = tf.user_id
      LEFT JOIN market.profile_pictures pp
        ON pp.id = u.profile_picture_id
      WHERE tf.ts >= now() - interval '24 hours'
      GROUP BY tf.user_id, u.username, u.profile_color, u.profile_picture_url, pp.id, pp.is_deleted, pp.filename_small
      ORDER BY trade_count DESC, volume_cash DESC, latest_trade_at DESC, tf.user_id DESC
      LIMIT 8
    `
    ),
    getPendingLiveOrderSummary(pool, { limit: 8 }),
  ]);

  const windows = {
    "5m": {
      trade_count: 0,
      trader_count: 0,
      asset_count: 0,
      volume_shares: 0,
      volume_cash: 0,
      latest_trade_at: null,
    },
    "1h": {
      trade_count: 0,
      trader_count: 0,
      asset_count: 0,
      volume_shares: 0,
      volume_cash: 0,
      latest_trade_at: null,
    },
    "24h": {
      trade_count: 0,
      trader_count: 0,
      asset_count: 0,
      volume_shares: 0,
      volume_cash: 0,
      latest_trade_at: null,
    },
  };

  for (const row of windowResult.rows) {
    windows[String(row.key)] = {
      trade_count: Number(row.trade_count || 0),
      trader_count: Number(row.trader_count || 0),
      asset_count: Number(row.asset_count || 0),
      volume_shares: roundMetric(row.volume_shares) || 0,
      volume_cash: roundMetric(row.volume_cash) || 0,
      latest_trade_at: row.latest_trade_at || null,
    };
  }

  return {
    windows,
    most_active_traders_24h: traderResult.rows.map((row) => ({
      user_id: Number(row.user_id),
      username: row.username,
      profile_color: row.profile_color || null,
      profile_picture_url: row.profile_picture_url || null,
      trade_count: Number(row.trade_count || 0),
      distinct_assets: Number(row.distinct_assets || 0),
      volume_cash: roundMetric(row.volume_cash) || 0,
      volume_shares: roundMetric(row.volume_shares) || 0,
      latest_trade_at: row.latest_trade_at || null,
    })),
    live_orders: liveOrders,
  };
}

async function getPendingLiveOrderSummary(pool, { symbol = null, limit = 12 } = {}) {
  const normalizedSymbol = symbol ? String(symbol).trim().toUpperCase() : null;
  const safeLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit || 12), 10) || 12));
  const params = normalizedSymbol ? [normalizedSymbol, safeLimit] : [safeLimit];
  const symbolFilter = normalizedSymbol ? "AND a.symbol = $1" : "";
  const limitParam = normalizedSymbol ? "$2" : "$1";

  const [totalsResult, assetsResult] = await Promise.all([
    pool.query(
      `
      WITH pending AS (
        SELECT
          o.*
        FROM market.trade_orders o
        JOIN market.market_assets a ON a.id = o.asset_id
        WHERE o.order_type = 'live_market'
          AND o.status = 'pending'
          ${symbolFilter}
      ),
      next_tick AS (
        SELECT MIN(execute_after) AS execute_after
        FROM pending
      )
      SELECT
        nt.execute_after AS next_execute_after,
        COUNT(p.id)::int AS pending_count,
        COUNT(*) FILTER (WHERE p.side = 'buy')::int AS pending_buy_count,
        COUNT(*) FILTER (WHERE p.side = 'sell')::int AS pending_sell_count,
        COALESCE(SUM(p.requested_quantity) FILTER (WHERE p.side = 'buy'), 0) AS pending_buy_quantity,
        COALESCE(SUM(p.requested_quantity) FILTER (WHERE p.side = 'sell'), 0) AS pending_sell_quantity
      FROM next_tick nt
      LEFT JOIN pending p
        ON p.execute_after = nt.execute_after
      GROUP BY nt.execute_after
    `,
      normalizedSymbol ? [normalizedSymbol] : []
    ),
    pool.query(
      `
      WITH pending AS (
        SELECT
          o.id,
          o.asset_id,
          o.side,
          o.requested_quantity,
          o.execute_after
        FROM market.trade_orders o
        JOIN market.market_assets a ON a.id = o.asset_id
        WHERE o.order_type = 'live_market'
          AND o.status = 'pending'
          ${symbolFilter}
      ),
      next_tick AS (
        SELECT MIN(execute_after) AS execute_after
        FROM pending
      )
      SELECT
        a.id AS asset_id,
        a.symbol,
        a.display_name,
        c.icon,
        c.color,
        nt.execute_after AS next_execute_after,
        COUNT(p.id)::int AS pending_count,
        COUNT(*) FILTER (WHERE p.side = 'buy')::int AS pending_buy_count,
        COUNT(*) FILTER (WHERE p.side = 'sell')::int AS pending_sell_count,
        COALESCE(SUM(p.requested_quantity) FILTER (WHERE p.side = 'buy'), 0) AS pending_buy_quantity,
        COALESCE(SUM(p.requested_quantity) FILTER (WHERE p.side = 'sell'), 0) AS pending_sell_quantity
      FROM next_tick nt
      JOIN pending p ON p.execute_after = nt.execute_after
      JOIN market.market_assets a ON a.id = p.asset_id
      JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
      GROUP BY a.id, a.symbol, a.display_name, c.icon, c.color, nt.execute_after
      ORDER BY pending_count DESC, (COALESCE(SUM(p.requested_quantity), 0)) DESC, a.symbol ASC
      LIMIT ${limitParam}
    `,
      params
    ),
  ]);

  const totals = totalsResult.rows[0] || {};
  return {
    generated_at: new Date().toISOString(),
    symbol: normalizedSymbol,
    next_execute_after: totals.next_execute_after || null,
    pending_count: Number(totals.pending_count || 0),
    pending_buy_count: Number(totals.pending_buy_count || 0),
    pending_sell_count: Number(totals.pending_sell_count || 0),
    pending_buy_quantity: roundMetric(totals.pending_buy_quantity) || 0,
    pending_sell_quantity: roundMetric(totals.pending_sell_quantity) || 0,
    assets: assetsResult.rows.map((row) => ({
      asset_id: Number(row.asset_id),
      symbol: row.symbol,
      display_name: row.display_name,
      icon: row.icon || null,
      color: row.color || null,
      next_execute_after: row.next_execute_after || null,
      pending_count: Number(row.pending_count || 0),
      pending_buy_count: Number(row.pending_buy_count || 0),
      pending_sell_count: Number(row.pending_sell_count || 0),
      pending_buy_quantity: roundMetric(row.pending_buy_quantity) || 0,
      pending_sell_quantity: roundMetric(row.pending_sell_quantity) || 0,
    })),
  };
}

async function getLiveOrderFlow(pool, { symbol = null } = {}) {
  const normalizedSymbol = symbol ? String(symbol).trim().toUpperCase() : null;
  const params = normalizedSymbol ? [normalizedSymbol] : [];
  const symbolFilter = normalizedSymbol ? "AND a.symbol = $1" : "";

  const [currentResult, minuteResult, cycleResult] = await Promise.all([
    pool.query(
      `
      WITH pending AS (
        SELECT
          o.id,
          o.side,
          o.requested_quantity,
          o.requested_at,
          o.execute_after
        FROM market.trade_orders o
        JOIN market.market_assets a ON a.id = o.asset_id
        WHERE o.order_type = 'live_market'
          AND o.status = 'pending'
          ${symbolFilter}
      ),
      next_tick AS (
        SELECT MIN(execute_after) AS execute_after
        FROM pending
      )
      SELECT
        date_trunc('minute', p.requested_at) AS bucket,
        COALESCE(SUM(p.requested_quantity) FILTER (WHERE p.side = 'buy'), 0) AS buy_quantity,
        COALESCE(SUM(p.requested_quantity) FILTER (WHERE p.side = 'sell'), 0) AS sell_quantity
      FROM pending p
      JOIN next_tick nt ON p.execute_after = nt.execute_after
      GROUP BY date_trunc('minute', p.requested_at)
      ORDER BY bucket ASC
    `,
      params
    ),
    pool.query(
      `
      SELECT
        date_trunc('minute', o.requested_at) AS bucket,
        COALESCE(SUM(o.requested_quantity) FILTER (WHERE o.side = 'buy'), 0) AS buy_quantity,
        COALESCE(SUM(o.requested_quantity) FILTER (WHERE o.side = 'sell'), 0) AS sell_quantity
      FROM market.trade_orders o
      JOIN market.market_assets a ON a.id = o.asset_id
      WHERE o.order_type = 'live_market'
        AND o.requested_at >= now() - interval '1 hour'
        ${symbolFilter}
      GROUP BY date_trunc('minute', o.requested_at)
      ORDER BY bucket ASC
    `,
      params
    ),
    pool.query(
      `
      SELECT
        o.execute_after AS bucket,
        COALESCE(SUM(o.requested_quantity) FILTER (WHERE o.side = 'buy'), 0) AS buy_quantity,
        COALESCE(SUM(o.requested_quantity) FILTER (WHERE o.side = 'sell'), 0) AS sell_quantity
      FROM market.trade_orders o
      JOIN market.market_assets a ON a.id = o.asset_id
      WHERE o.order_type = 'live_market'
        AND o.execute_after >= now() - interval '24 hours'
        AND o.execute_after IS NOT NULL
        ${symbolFilter}
      GROUP BY o.execute_after
      ORDER BY o.execute_after ASC
    `,
      params
    ),
  ]);

  const mapPoint = (row) => ({
    bucket: row.bucket || null,
    buy_quantity: roundMetric(row.buy_quantity) || 0,
    sell_quantity: roundMetric(row.sell_quantity) || 0,
  });

  return {
    generated_at: new Date().toISOString(),
    symbol: normalizedSymbol,
    current_tick: currentResult.rows.map(mapPoint),
    per_minute: minuteResult.rows.map(mapPoint),
    cycles_24h: cycleResult.rows.map(mapPoint),
  };
}

async function getMarketHub(pool, { tradeLimit = 20 } = {}) {
  const [assets, report, status, indexes, recentTrades, activity] = await Promise.all([
    listAssets(pool),
    getLatestDailyReport(pool),
    marketState.getMarketStatus(pool),
    listGroupIndexes(pool, { groupBy: "unit", range: "1y", weighting: "equal" }),
    listRecentMarketTrades(pool, { limit: tradeLimit }),
    getMarketActivityStats(pool),
  ]);

  const topBy = (rows, metric, direction = "desc", limit = 5) =>
    [...rows]
      .filter((row) => row[metric] !== null && row[metric] !== undefined)
      .sort((a, b) => {
        const av = toNumber(a[metric], 0);
        const bv = toNumber(b[metric], 0);
        return direction === "asc" ? av - bv : bv - av;
      })
      .slice(0, limit);

  const volumeSections = buildLiveVolumeSections(assets, 5);

  return {
    generated_at: new Date().toISOString(),
    status: status || {},
    market_tuning_config: buildMarketTuningConfig(),
    report: report || null,
    indexes,
    activity,
    leaders: {
      top_price: topBy(assets, "current_mid_price", "desc", 5),
      top_base_rate: topBy(assets, "base_rate", "desc", 5),
      top_volume: topBy(assets, "volume_24h", "desc", 5),
      top_movers: topBy(assets, "move_24h_pct", "desc", 5),
      top_losers: topBy(assets, "move_24h_pct", "asc", 5),
      top_premiums: topBy(assets, "current_premium_pct", "desc", 5),
      top_discounts: topBy(assets, "current_premium_pct", "asc", 5),
      top_market_premiums: topBy(assets, "premium_discount_pct", "desc", 5),
      top_market_discounts: topBy(assets, "premium_discount_pct", "asc", 5),
      volume_winners: volumeSections.volume_winners,
      volume_losers: volumeSections.volume_losers,
    },
    recent_trades: recentTrades,
  };
}

async function listAssetRankingCore(pool) {
  const { rows } = await pool.query(
    `
    WITH volume_24h AS (
      SELECT
        tf.asset_id,
        COALESCE(SUM(tf.quantity), 0) AS volume_24h
      FROM market.trade_fills tf
      WHERE tf.ts >= now() - interval '24 hours'
      GROUP BY tf.asset_id
    ),
    latest_daily AS (
      SELECT DISTINCT ON (d.asset_id)
        d.asset_id,
        d.mid_open,
        d.mid_close
      FROM market.asset_daily_market_state d
      ORDER BY d.asset_id, d.market_date DESC
    ),
    latest_stats AS (
      SELECT DISTINCT ON (s.youtube_channel_id)
        s.youtube_channel_id,
        s.subscriber_count,
        s.view_count,
        s.video_count
      FROM yt.youtube_channel_daily_stats s
      ORDER BY s.youtube_channel_id, s.time DESC
    )
    SELECT
      a.id,
      a.symbol,
      a.display_name,
      a.status,
      a.youtube_channel_id,
      c.unit,
      c.icon,
      c.color,
      a.current_fair_value AS base_rate,
      a.current_mid_price,
      a.current_mid_price AS market_price,
      a.current_premium_pct AS premium_discount_pct,
      (
        a.adjustment_enabled
        AND a.current_fair_value IS NOT NULL
        AND a.current_mid_price IS NOT NULL
      ) AS adjustment_ready,
      COALESCE(v.volume_24h, 0) AS volume_24h,
      CASE
        WHEN ld.mid_open IS NULL OR ld.mid_open = 0 OR ld.mid_close IS NULL THEN NULL
        ELSE (ld.mid_close - ld.mid_open) / ld.mid_open
      END AS move_24h_pct,
      ls.subscriber_count AS subscribers,
      ls.view_count AS views,
      ls.video_count AS videos
    FROM market.market_assets a
    JOIN yt.youtube_channels c
      ON c.youtube_channel_id = a.youtube_channel_id
    LEFT JOIN volume_24h v
      ON v.asset_id = a.id
    LEFT JOIN latest_daily ld
      ON ld.asset_id = a.id
    LEFT JOIN latest_stats ls
      ON ls.youtube_channel_id = a.youtube_channel_id
    ORDER BY a.symbol ASC
  `
  );

  return rows;
}

async function listAssetRankingWeeklyActivity(pool, { superchatRange = "7d" } = {}) {
  const interval = parseRangeToInterval(superchatRange);
  const { rows } = await pool.query(
    `
    WITH superchat_totals AS (
      SELECT
        a.id AS asset_id,
        a.symbol,
        COALESCE(SUM(sc.total_in_yen), 0)::DOUBLE PRECISION AS superchat_earnings
      FROM market.market_assets a
      LEFT JOIN yt.livestream_sessions s
        ON s.youtube_channel_id = a.youtube_channel_id
       AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) >= now() - $1::interval
       AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) <= now()
      LEFT JOIN yt.youtube_superchat_currency_breakdowns sc
        ON sc.video_id = s.video_id
      GROUP BY a.id, a.symbol
    ),
    stream_duration_totals AS (
      SELECT
        a.id AS asset_id,
        a.symbol,
        COALESCE(
          SUM(
            CASE
              WHEN COALESCE(s.ended_at, s.last_seen_at) IS NULL
                OR COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) IS NULL
              THEN 0
              ELSE GREATEST(
                0,
                EXTRACT(
                  EPOCH FROM (
                    COALESCE(s.ended_at, s.last_seen_at)
                    - COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at)
                  )
                )
              )
            END
          ),
          0
        )::BIGINT AS stream_duration_seconds_7d
      FROM market.market_assets a
      LEFT JOIN yt.livestream_sessions s
        ON s.youtube_channel_id = a.youtube_channel_id
       AND s.status = 'ended'
       AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) >= now() - interval '7 days'
       AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) <= now()
      GROUP BY a.id, a.symbol
    )
    SELECT
      a.id AS asset_id,
      a.symbol,
      COALESCE(st.superchat_earnings, 0) AS superchat_earnings,
      COALESCE(sd.stream_duration_seconds_7d, 0) AS stream_duration_seconds_7d
    FROM market.market_assets a
    LEFT JOIN superchat_totals st
      ON st.asset_id = a.id
    LEFT JOIN stream_duration_totals sd
      ON sd.asset_id = a.id
    ORDER BY a.symbol ASC
  `,
    [interval]
  );

  return rows;
}

async function listAssetRankingOshicoinUsers(pool) {
  const { rows } = await pool.query(
    `
    SELECT
      a.id AS asset_id,
      a.symbol,
      COUNT(u.id)::INTEGER AS oshicoin_users
    FROM market.market_assets a
    LEFT JOIN market.users u
      ON u.oshi_coin_asset_id = a.id
    GROUP BY a.id, a.symbol
    ORDER BY a.symbol ASC
  `
  );

  return rows;
}

async function getAssetSuperchatSummary(pool, symbol, { range = "7d" } = {}) {
  const assetResult = await pool.query(
    `
    SELECT symbol, youtube_channel_id
    FROM market.market_assets
    WHERE symbol = $1
    LIMIT 1
  `,
    [symbol]
  );

  const asset = assetResult.rows[0] || null;
  if (!asset) return null;

  const interval = parseRangeToInterval(range);
  const weekEnd = new Date();
  const weekStart = new Date(weekEnd.getTime() - parseRangeToMilliseconds(range));
  const { rows } = await pool.query(
    `
    WITH bounds AS (
      SELECT now() - $2::interval AS week_start, now() AS week_end
    ),
    windowed_streams AS (
      SELECT s.video_id
      FROM yt.livestream_sessions s
      CROSS JOIN bounds b
      WHERE s.youtube_channel_id = $1
        AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) >= b.week_start
        AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) <= b.week_end
    )
    SELECT
      b.week_start,
      b.week_end,
      sc.currency_name,
      SUM(sc.donation_count)::BIGINT AS donation_count,
      SUM(sc.total_in_currency)::TEXT AS total_in_currency,
      SUM(sc.total_in_yen)::BIGINT AS total_in_yen
    FROM bounds b
    LEFT JOIN windowed_streams ws ON true
    LEFT JOIN yt.youtube_superchat_currency_breakdowns sc ON sc.video_id = ws.video_id
    GROUP BY b.week_start, b.week_end, sc.currency_name
    HAVING sc.currency_name IS NOT NULL
    ORDER BY SUM(sc.total_in_yen) DESC, sc.currency_name ASC
  `,
    [asset.youtube_channel_id, interval]
  );

  return {
    symbol: asset.symbol,
    youtube_channel_id: asset.youtube_channel_id,
    range,
    week_start: rows[0]?.week_start || weekStart,
    week_end: rows[0]?.week_end || weekEnd,
    currencies: rows.map((row) => ({
      currency_name: row.currency_name,
      donation_count: row.donation_count,
      total_in_currency: row.total_in_currency,
      total_in_yen: row.total_in_yen,
    })),
  };
}

async function getAssetSuperchatRank(pool, symbol, { range = "7d" } = {}) {
  const interval = parseRangeToInterval(range);
  const { rows } = await pool.query(
    `
    WITH asset_totals AS (
      SELECT
        a.symbol,
        a.youtube_channel_id,
        COALESCE(SUM(sc.total_in_yen), 0)::BIGINT AS total_in_yen
      FROM market.market_assets a
      LEFT JOIN yt.livestream_sessions s
        ON s.youtube_channel_id = a.youtube_channel_id
       AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) >= now() - $2::interval
       AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) <= now()
      LEFT JOIN yt.youtube_superchat_currency_breakdowns sc ON sc.video_id = s.video_id
      GROUP BY a.symbol, a.youtube_channel_id
    ),
    ranked AS (
      SELECT
        symbol,
        youtube_channel_id,
        total_in_yen,
        ROW_NUMBER() OVER (ORDER BY total_in_yen DESC, symbol ASC)::INTEGER AS rank
      FROM asset_totals
    )
    SELECT
      symbol,
      youtube_channel_id,
      total_in_yen,
      rank
    FROM ranked
    WHERE symbol = $1
    LIMIT 1
  `,
    [symbol, interval]
  );

  const row = rows[0] || null;
  if (!row) return null;

  return {
    symbol: row.symbol,
    youtube_channel_id: row.youtube_channel_id,
    range,
    total_in_yen: row.total_in_yen,
    rank: row.rank,
  };
}

async function getAssetSuperchatTimeseries(pool, symbol, { range = "7d" } = {}) {
  const assetResult = await pool.query(
    `
    SELECT symbol, youtube_channel_id
    FROM market.market_assets
    WHERE symbol = $1
    LIMIT 1
  `,
    [symbol]
  );

  const asset = assetResult.rows[0] || null;
  if (!asset) return null;

  const config = getSuperchatTimeseriesConfig(range);
  const { rows } = await pool.query(
    `
    WITH bounds AS (
      SELECT
        ${config.startExpr} AS start_date,
        ${config.endExpr} AS end_date
    ),
    buckets AS (
      SELECT generate_series(
        (SELECT start_date FROM bounds),
        (SELECT end_date FROM bounds),
        '${config.stepInterval}'::interval
      )::date AS bucket
    ),
    source_rows AS (
      SELECT
        COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) AS started_at,
        sc.currency_name,
        sc.total_in_yen
      FROM yt.livestream_sessions s
      JOIN yt.youtube_superchat_currency_breakdowns sc ON sc.video_id = s.video_id
      CROSS JOIN bounds b
      WHERE s.youtube_channel_id = $1
        AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) >= b.start_date
        AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) < (b.end_date + interval '1 day')
    ),
    aggregated AS (
      SELECT
        ${config.bucketExpr} AS bucket,
        currency_name,
        SUM(total_in_yen)::BIGINT AS total_in_yen
      FROM source_rows
      GROUP BY 1, 2
    ),
    currencies AS (
      SELECT DISTINCT currency_name
      FROM aggregated
    )
    SELECT
      b.bucket::text AS bucket,
      c.currency_name,
      COALESCE(a.total_in_yen, 0)::BIGINT AS total_in_yen,
      (SELECT start_date::text FROM bounds) AS start_date,
      (SELECT end_date::text FROM bounds) AS end_date
    FROM buckets b
    CROSS JOIN currencies c
    LEFT JOIN aggregated a
      ON a.bucket = b.bucket
     AND a.currency_name = c.currency_name
    ORDER BY b.bucket ASC, c.currency_name ASC
  `,
    [asset.youtube_channel_id]
  );

  return {
    symbol: asset.symbol,
    youtube_channel_id: asset.youtube_channel_id,
    range: config.range,
    bucket_unit: config.bucketUnit,
    start_date: rows[0]?.start_date || null,
    end_date: rows[0]?.end_date || null,
    points: rows.map((row) => ({
      bucket: row.bucket,
      currency_name: row.currency_name,
      total_in_yen: row.total_in_yen,
    })),
  };
}

async function getAssetStreamTimeTimeseries(pool, symbol, { range = "7d" } = {}) {
  const assetResult = await pool.query(
    `
    SELECT symbol, youtube_channel_id
    FROM market.market_assets
    WHERE symbol = $1
    LIMIT 1
  `,
    [symbol]
  );

  const asset = assetResult.rows[0] || null;
  if (!asset) return null;

  if (String(range || "7d").toLowerCase() !== "7d") {
    const error = new Error("unsupported_stream_time_range");
    error.code = "unsupported_stream_time_range";
    throw error;
  }

  const { rows } = await pool.query(
    `
    WITH bounds AS (
      SELECT
        (current_date - interval '7 days')::date AS start_date,
        (current_date - interval '1 day')::date AS end_date
    ),
    buckets AS (
      SELECT generate_series(
        (SELECT start_date FROM bounds),
        (SELECT end_date FROM bounds),
        interval '1 day'
      )::date AS bucket
    ),
    aggregated AS (
      SELECT
        date_trunc('day', COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at))::date AS bucket,
        SUM(
          CASE
            WHEN COALESCE(s.ended_at, s.last_seen_at) IS NULL
              OR COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) IS NULL
            THEN 0
            ELSE GREATEST(
              0,
              EXTRACT(
                EPOCH FROM (
                  COALESCE(s.ended_at, s.last_seen_at)
                  - COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at)
                )
              )
            )
          END
        )::BIGINT AS duration_seconds
      FROM yt.livestream_sessions s
      CROSS JOIN bounds b
      WHERE s.youtube_channel_id = $1
        AND s.status = 'ended'
        AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) >= b.start_date
        AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) < (b.end_date + interval '1 day')
      GROUP BY 1
    )
    SELECT
      b.bucket::text AS bucket,
      COALESCE(a.duration_seconds, 0)::BIGINT AS duration_seconds,
      (SELECT start_date::text FROM bounds) AS start_date,
      (SELECT end_date::text FROM bounds) AS end_date
    FROM buckets b
    LEFT JOIN aggregated a
      ON a.bucket = b.bucket
    ORDER BY b.bucket ASC
  `,
    [asset.youtube_channel_id]
  );

  return {
    symbol: asset.symbol,
    youtube_channel_id: asset.youtube_channel_id,
    range: "7d",
    bucket_unit: "day",
    start_date: rows[0]?.start_date || null,
    end_date: rows[0]?.end_date || null,
    points: rows.map((row) => ({
      bucket: row.bucket,
      duration_seconds: row.duration_seconds,
    })),
  };
}

async function getAssetTreasury(pool, symbol) {
  const { rows } = await pool.query(
    `
    SELECT
      a.id,
      a.symbol,
      a.display_name,
      a.max_supply,
      a.circulating_supply,
      a.treasury_supply,
      a.base_emission,
      a.current_daily_emission,
      a.current_premium_pct,
      a.liquidity_depth,
      a.spread_bps,
      d.market_date,
      d.daily_emission AS settled_daily_emission,
      d.treasury_supply_start,
      d.treasury_supply_end,
      d.circulating_supply_start,
      d.circulating_supply_end
    FROM market.market_assets a
    LEFT JOIN LATERAL (
      SELECT *
      FROM market.asset_daily_market_state d
      WHERE d.asset_id = a.id
      ORDER BY d.market_date DESC
      LIMIT 1
    ) d ON true
    WHERE a.symbol = $1
    LIMIT 1
  `,
    [symbol]
  );
  return rows[0] || null;
}

async function getAssetStats(pool, symbol, { range = "30d" } = {}) {
  const interval = parseRangeToInterval(range);
  const { rows } = await pool.query(
    `
    SELECT
      s.snapshot_date,
      s.subscriber_count,
      s.view_count,
      s.video_count,
      s.view_delta_1d,
      s.view_delta_7d,
      s.view_delta_30d,
      s.video_delta_7d,
      s.video_delta_30d,
      s.estimated_sub_delta_7d,
      s.estimated_sub_delta_30d,
      s.fundamental_value_raw,
      s.fundamental_value_smoothed
    FROM market.channel_daily_snapshots s
    JOIN market.market_assets a ON a.youtube_channel_id = s.youtube_channel_id
    WHERE a.symbol = $1
      AND s.snapshot_date >= current_date - $2::interval
    ORDER BY s.snapshot_date ASC
  `,
    [symbol, interval]
  );
  return rows;
}

async function getAssetCandles(pool, symbol, { interval = "1d", range = "30d" } = {}) {
  const bucket = parseCandleBucket(interval);
  if (!bucket) {
    const error = new Error("unsupported_interval");
    error.code = "unsupported_interval";
    throw error;
  }

  const windowInterval = parseRangeToInterval(range);

  if (interval === "1d") {
    const { rows } = await pool.query(
      `
      SELECT
        d.market_date::timestamptz AS bucket,
        d.mid_open AS open,
        COALESCE(d.mid_high, GREATEST(d.mid_open, COALESCE(d.mid_close, d.mid_open))) AS high,
        COALESCE(d.mid_low, LEAST(d.mid_open, COALESCE(d.mid_close, d.mid_open))) AS low,
        COALESCE(d.mid_close, d.mid_open) AS close,
        d.mid_close_mark AS close_mark,
        d.volume_shares,
        d.volume_cash,
        d.trade_count,
        CASE
          WHEN d.volume_shares = 0 THEN NULL
          ELSE d.volume_cash / NULLIF(d.volume_shares, 0)
        END AS vwap
      FROM market.asset_daily_market_state d
      JOIN market.market_assets a ON a.id = d.asset_id
      WHERE a.symbol = $1
        AND d.market_date >= current_date - $2::interval
      ORDER BY d.market_date ASC
    `,
      [symbol, windowInterval]
    );
    return rows;
  }

  const { rows } = await pool.query(
    `
    WITH asset AS (
      SELECT id
      FROM market.market_assets
      WHERE symbol = $1
      LIMIT 1
    ),
    points AS (
      SELECT
        tf.asset_id,
        time_bucket($2::interval, tf.ts) AS bucket,
        tf.ts,
        1 AS sequence,
        tf.price,
        tf.quantity,
        tf.gross_cash,
        1 AS trade_count
      FROM market.trade_fills tf
      JOIN asset a ON a.id = tf.asset_id
      WHERE tf.ts >= now() - $3::interval
      UNION ALL
      SELECT
        e.asset_id,
        time_bucket($2::interval, e.ts) AS bucket,
        e.ts,
        0 AS sequence,
        e.old_mid_price AS price,
        0 AS quantity,
        0 AS gross_cash,
        0 AS trade_count
      FROM market.asset_price_events e
      JOIN asset a ON a.id = e.asset_id
      WHERE e.ts >= now() - $3::interval
        AND e.event_type IN ('interval_adjustment', 'daily_reset')
        AND e.old_mid_price IS NOT NULL
      UNION ALL
      SELECT
        e.asset_id,
        time_bucket($2::interval, e.ts) AS bucket,
        e.ts,
        2 AS sequence,
        e.new_mid_price AS price,
        0 AS quantity,
        0 AS gross_cash,
        0 AS trade_count
      FROM market.asset_price_events e
      JOIN asset a ON a.id = e.asset_id
      WHERE e.ts >= now() - $3::interval
        AND e.event_type IN ('interval_adjustment', 'daily_reset')
        AND e.new_mid_price IS NOT NULL
    )
    SELECT
      bucket,
      (array_agg(price ORDER BY ts ASC, sequence ASC))[1] AS open,
      MAX(price) AS high,
      MIN(price) AS low,
      (array_agg(price ORDER BY ts DESC, sequence DESC))[1] AS close,
      COALESCE(SUM(quantity), 0) AS volume_shares,
      COALESCE(SUM(gross_cash), 0) AS volume_cash,
      COALESCE(SUM(trade_count), 0)::INTEGER AS trade_count,
      CASE
        WHEN COALESCE(SUM(quantity), 0) = 0 THEN NULL
        ELSE SUM(gross_cash) / NULLIF(SUM(quantity), 0)
      END AS vwap
    FROM points
    GROUP BY bucket
    ORDER BY bucket ASC
  `,
    [symbol, bucket, windowInterval]
  );
  return rows;
}

async function getAllMarketCandles(pool, { interval = "1h", range = "24h" } = {}) {
  const bucket = parseCandleBucket(interval);
  if (!bucket) {
    const error = new Error("unsupported_interval");
    error.code = "unsupported_interval";
    throw error;
  }

  const windowInterval = parseRangeToInterval(range);
  const { rows } = await pool.query(
    `
    WITH points AS (
      SELECT
        time_bucket($1::interval, tf.ts) AS bucket,
        tf.ts,
        tf.id,
        tf.price,
        tf.quantity,
        tf.gross_cash
      FROM market.trade_fills tf
      WHERE tf.ts >= now() - $2::interval
    )
    SELECT
      bucket,
      (array_agg(price ORDER BY ts ASC, id ASC))[1] AS open,
      MAX(price) AS high,
      MIN(price) AS low,
      (array_agg(price ORDER BY ts DESC, id DESC))[1] AS close,
      NULL AS close_mark,
      COALESCE(SUM(quantity), 0) AS volume_shares,
      COALESCE(SUM(gross_cash), 0) AS volume_cash,
      COUNT(*)::integer AS trade_count,
      CASE
        WHEN COALESCE(SUM(quantity), 0) = 0 THEN NULL
        ELSE SUM(gross_cash) / NULLIF(SUM(quantity), 0)
      END AS vwap
    FROM points
    GROUP BY bucket
    ORDER BY bucket ASC
  `,
    [bucket, windowInterval]
  );
  return rows;
}

async function getLatestDailyReport(pool) {
  const { rows } = await pool.query(
    `
    SELECT market_date, report_json, created_at
    FROM market.daily_market_reports
    ORDER BY market_date DESC
    LIMIT 1
  `
  );
  if (!rows[0]) return null;
  const assets = await listAssets(pool);
  const liveVolumeSections = buildLiveVolumeSections(assets);
  return {
    created_at: rows[0].created_at,
    market_date: rows[0].market_date,
    ...(rows[0].report_json || {}),
    market_tuning_config: buildMarketTuningConfig(),
    ...liveVolumeSections,
  };
}

async function getDailyReportByDate(pool, marketDate) {
  const { rows } = await pool.query(
    `
    SELECT market_date, report_json, created_at
    FROM market.daily_market_reports
    WHERE market_date = $1
    LIMIT 1
  `,
    [marketDate]
  );
  if (!rows[0]) return null;
  return {
    created_at: rows[0].created_at,
    market_date: rows[0].market_date,
    ...(rows[0].report_json || {}),
    market_tuning_config: buildMarketTuningConfig(),
  };
}

async function getGroupIndex(pool, { groupBy = "unit", group = "all", range = "1y", weighting = "equal" } = {}) {
  if (groupBy !== "unit") {
    const error = new Error("unsupported_group_by");
    error.code = "unsupported_group_by";
    throw error;
  }

  const windowInterval = parseRangeToInterval(range);
  const normalizedGroup = String(group || "all").trim() || "all";
  const normalizedWeighting = parseIndexWeighting(weighting);

  const { rows } = await pool.query(
    `
    WITH filtered AS (
      SELECT
        d.market_date,
        a.id AS asset_id,
        a.symbol,
        c.unit,
        COALESCE(d.mid_close, d.mid_open) AS close_price,
        COALESCE(d.volume_cash, 0) AS volume_cash,
        d.premium_close_pct,
        GREATEST(COALESCE(d.circulating_supply_end, d.circulating_supply_start, a.circulating_supply, 0), 0) AS circulating_supply
      FROM market.asset_daily_market_state d
      JOIN market.market_assets a ON a.id = d.asset_id
      JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
      WHERE a.status = 'active'
        AND d.market_date >= current_date - $1::interval
        AND ($2 = 'all' OR c.unit = $2)
    ),
    asset_bases AS (
      SELECT DISTINCT ON (asset_id)
        asset_id,
        close_price AS base_close,
        NULLIF(close_price * circulating_supply, 0) AS base_market_cap
      FROM filtered
      WHERE close_price IS NOT NULL
        AND close_price > 0
      ORDER BY asset_id, market_date ASC
    ),
    normalized AS (
      SELECT
        f.market_date,
        f.asset_id,
        f.symbol,
        f.close_price,
        f.volume_cash,
        f.premium_close_pct,
        CASE
          WHEN b.base_close IS NULL OR b.base_close = 0 THEN NULL
          ELSE (f.close_price / b.base_close) * 100.0
        END AS normalized_index_value,
        CASE
          WHEN $3 = 'market_cap' THEN COALESCE(b.base_market_cap, 0)
          ELSE 1::numeric
        END AS weight
      FROM filtered f
      JOIN asset_bases b ON b.asset_id = f.asset_id
      WHERE f.close_price IS NOT NULL
    ),
    daily_index AS (
      SELECT
        market_date,
        CASE
          WHEN SUM(weight) = 0 THEN NULL
          ELSE SUM(normalized_index_value * weight) / SUM(weight)
        END AS index_value,
        SUM(volume_cash) AS total_volume_cash,
        AVG(premium_close_pct) AS avg_premium_pct,
        COUNT(*)::integer AS constituent_count
      FROM normalized
      GROUP BY market_date
    ),
    daily_returns AS (
      SELECT
        market_date,
        index_value,
        total_volume_cash,
        avg_premium_pct,
        constituent_count,
        CASE
          WHEN LAG(index_value) OVER (ORDER BY market_date) IS NULL OR LAG(index_value) OVER (ORDER BY market_date) = 0 THEN NULL
          ELSE (index_value - LAG(index_value) OVER (ORDER BY market_date)) / LAG(index_value) OVER (ORDER BY market_date)
        END AS day_return_pct
      FROM daily_index
    ),
    asset_day_returns AS (
      SELECT
        market_date,
        asset_id,
        CASE
          WHEN LAG(close_price) OVER (PARTITION BY asset_id ORDER BY market_date) IS NULL
            OR LAG(close_price) OVER (PARTITION BY asset_id ORDER BY market_date) = 0 THEN NULL
          ELSE (close_price - LAG(close_price) OVER (PARTITION BY asset_id ORDER BY market_date))
            / LAG(close_price) OVER (PARTITION BY asset_id ORDER BY market_date)
        END AS asset_return_pct
      FROM filtered
      WHERE close_price IS NOT NULL
    ),
    latest_day AS (
      SELECT MAX(market_date) AS market_date
      FROM daily_index
    ),
    index_bounds AS (
      SELECT
        FIRST_VALUE(dr.market_date) OVER (ORDER BY dr.market_date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS latest_market_date,
        FIRST_VALUE(dr.index_value) OVER (ORDER BY dr.market_date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS latest_index_value,
        FIRST_VALUE(dr.day_return_pct) OVER (ORDER BY dr.market_date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS latest_day_return_pct,
        FIRST_VALUE(dr.total_volume_cash) OVER (ORDER BY dr.market_date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS latest_total_volume_cash,
        FIRST_VALUE(dr.avg_premium_pct) OVER (ORDER BY dr.market_date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS latest_avg_premium_pct,
        FIRST_VALUE(dr.constituent_count) OVER (ORDER BY dr.market_date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS latest_constituent_count,
        FIRST_VALUE(dr.index_value) OVER (ORDER BY dr.market_date ASC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS first_index_value
      FROM daily_returns dr
    ),
    latest_summary AS (
      SELECT DISTINCT ON (ib.latest_market_date)
        ib.latest_market_date AS market_date,
        ib.latest_index_value AS index_value,
        ib.latest_day_return_pct AS day_return_pct,
        ib.latest_total_volume_cash AS total_volume_cash,
        ib.latest_avg_premium_pct AS avg_premium_pct,
        ib.latest_constituent_count AS constituent_count,
        CASE
          WHEN ib.first_index_value IS NULL OR ib.first_index_value = 0 THEN NULL
          ELSE (ib.latest_index_value - ib.first_index_value) / ib.first_index_value
        END AS total_return_pct
      FROM index_bounds ib
      ORDER BY ib.latest_market_date DESC
    ),
    breadth AS (
      SELECT
        COUNT(*) FILTER (WHERE adr.asset_return_pct > 0)::integer AS advancers,
        COUNT(*) FILTER (WHERE adr.asset_return_pct < 0)::integer AS decliners,
        COUNT(*) FILTER (WHERE adr.asset_return_pct = 0)::integer AS unchanged
      FROM asset_day_returns adr
      JOIN latest_day ld ON ld.market_date = adr.market_date
    )
    SELECT jsonb_build_object(
      'group_by', $4::text,
      'group', $2,
      'range', $5::text,
      'weighting', $3::text,
      'summary', jsonb_build_object(
        'market_date', ls.market_date,
        'index_value', ls.index_value,
        'day_return_pct', ls.day_return_pct,
        'total_return_pct', ls.total_return_pct,
        'total_volume_cash', ls.total_volume_cash,
        'avg_premium_pct', ls.avg_premium_pct,
        'constituent_count', ls.constituent_count,
        'advancers', COALESCE(b.advancers, 0),
        'decliners', COALESCE(b.decliners, 0),
        'unchanged', COALESCE(b.unchanged, 0)
      ),
      'series', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'bucket', dr.market_date::text,
              'value', dr.index_value,
              'day_return_pct', dr.day_return_pct,
              'total_volume_cash', dr.total_volume_cash,
              'avg_premium_pct', dr.avg_premium_pct,
              'constituent_count', dr.constituent_count
            )
            ORDER BY dr.market_date ASC
          )
          FROM daily_returns dr
        ),
        '[]'::jsonb
      )
    ) AS payload
    FROM latest_summary ls
    CROSS JOIN breadth b
  `,
    [windowInterval, normalizedGroup, normalizedWeighting, groupBy, range]
  );

  return rows[0]?.payload || {
    group_by: groupBy,
    group: normalizedGroup,
    range,
    weighting: normalizedWeighting,
    summary: null,
    series: [],
  };
}

async function listGroupIndexes(pool, { groupBy = "unit", range = "1y", weighting = "equal" } = {}) {
  if (groupBy !== "unit") {
    const error = new Error("unsupported_group_by");
    error.code = "unsupported_group_by";
    throw error;
  }

  const { rows } = await pool.query(
    `
    SELECT DISTINCT c.unit
    FROM market.market_assets a
    JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE a.status = 'active'
      AND c.unit IS NOT NULL
      AND btrim(c.unit) <> ''
    ORDER BY c.unit ASC
  `
  );

  const groups = ["all", ...rows.map((row) => String(row.unit))];
  const indexes = await Promise.all(
    groups.map((group) => getGroupIndex(pool, { groupBy, group, range, weighting }))
  );

  return indexes;
}

async function getAssetCommentViewerContext(client, symbol, viewerUserId = null) {
  const { rows } = await client.query(
    `
    SELECT
      a.id,
      a.symbol,
      a.display_name,
      COALESCE(h.quantity, 0) AS viewer_shares
    FROM market.market_assets a
    LEFT JOIN market.portfolio_holdings h
      ON h.asset_id = a.id
     AND h.user_id = $2
    WHERE a.symbol = $1
    LIMIT 1
  `,
    [symbol, viewerUserId]
  );

  const asset = rows[0] || null;
  if (!asset) {
    const error = new Error("asset_not_found");
    error.code = "asset_not_found";
    throw error;
  }

  const ownedShares = toNumber(asset.viewer_shares, 0);
  return {
    assetId: Number(asset.id),
    symbol: String(asset.symbol),
    displayName: String(asset.display_name || asset.symbol),
    ownedShares,
    canPost: Boolean(viewerUserId && ownedShares > 0),
  };
}

async function listAssetComments(pool, symbol, { page = 1, limit = 6, viewerUserId = null } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(24, Math.max(1, Number(limit) || 6));
  const offset = (safePage - 1) * safeLimit;

  const client = await pool.connect();
  try {
    const viewerContext = await getAssetCommentViewerContext(client, symbol, viewerUserId);
    const countResult = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM content.asset_comments
      WHERE asset_id = $1
    `,
      [viewerContext.assetId]
    );

    const commentsResult = await client.query(
      `
      SELECT
        c.id,
        c.body,
        c.mood,
        c.upvotes,
        c.downvotes,
        c.created_at,
        c.updated_at,
        COALESCE(viewer_vote.value, 0)::int AS viewer_vote,
        COALESCE(author_holding.quantity, 0) AS author_share_quantity,
        jsonb_build_object(
          'id', u.id,
          'username', u.username,
          'profile_picture_url', COALESCE(${profilePictureUrlSql("small", "pp")}, u.profile_picture_url),
          'profile_color', u.profile_color
        ) AS author
      FROM content.asset_comments c
      JOIN market.users u
        ON u.id = c.author_id
      LEFT JOIN market.profile_pictures pp
        ON pp.id = u.profile_picture_id
      LEFT JOIN market.portfolio_holdings author_holding
        ON author_holding.user_id = c.author_id
       AND author_holding.asset_id = c.asset_id
      LEFT JOIN LATERAL (
        SELECT value
        FROM content.asset_comment_votes v
        WHERE v.comment_id = c.id
          AND v.user_id = $2
        LIMIT 1
      ) viewer_vote ON TRUE
      WHERE c.asset_id = $1
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $3
      OFFSET $4
    `,
      [viewerContext.assetId, viewerUserId, safeLimit, offset]
    );

    return {
      symbol: viewerContext.symbol,
      comments: commentsResult.rows,
      total: Number(countResult.rows[0]?.total || 0),
      page: safePage,
      limit: safeLimit,
      viewer_context: {
        is_authenticated: Boolean(viewerUserId),
        owned_shares: viewerContext.ownedShares,
        can_post: viewerContext.canPost,
      },
    };
  } finally {
    client.release();
  }
}

async function createAssetComment(pool, symbol, authorId, { body, mood }) {
  const safeBody = normalizeTrimmedString(body, { maxLength: 4000, allowEmpty: false });
  const safeMood = normalizeAssetCommentMood(mood);
  if (!safeBody || (mood != null && !safeMood)) {
    const error = new Error("invalid_asset_comment");
    error.code = "invalid_asset_comment";
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const viewerContext = await getAssetCommentViewerContext(client, symbol, authorId);
    if (!viewerContext.canPost) {
      const error = new Error("asset_comment_requires_holding");
      error.code = "asset_comment_requires_holding";
      throw error;
    }

    await client.query(
      `
      INSERT INTO content.asset_comments (asset_id, author_id, body, mood, created_at, updated_at)
      VALUES ($1, $2, $3, $4, now(), now())
    `,
      [viewerContext.assetId, authorId, safeBody, safeMood]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function voteCountDeltas(previousValue, nextValue) {
  const previousUp = previousValue === 1 ? 1 : 0;
  const previousDown = previousValue === -1 ? 1 : 0;
  const nextUp = nextValue === 1 ? 1 : 0;
  const nextDown = nextValue === -1 ? 1 : 0;
  return {
    upvotes: nextUp - previousUp,
    downvotes: nextDown - previousDown,
  };
}

async function setAssetCommentVote(pool, symbol, commentId, userId, value) {
  const safeCommentId = Number(commentId);
  const safeValue = Number(value);
  if (!Number.isInteger(safeCommentId) || safeCommentId <= 0) {
    const error = new Error("asset_comment_not_found");
    error.code = "asset_comment_not_found";
    throw error;
  }
  if (![ -1, 0, 1 ].includes(safeValue)) {
    const error = new Error("invalid_asset_comment_vote");
    error.code = "invalid_asset_comment_vote";
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const viewerContext = await getAssetCommentViewerContext(client, symbol, userId);
    const commentResult = await client.query(
      `
      SELECT id, asset_id, author_id
      FROM content.asset_comments
      WHERE id = $1
        AND asset_id = $2
      LIMIT 1
      FOR UPDATE
    `,
      [safeCommentId, viewerContext.assetId]
    );
    const comment = commentResult.rows[0] || null;
    if (!comment) {
      const error = new Error("asset_comment_not_found");
      error.code = "asset_comment_not_found";
      throw error;
    }
    if (Number(comment.author_id) === userId) {
      const error = new Error("asset_comment_self_vote");
      error.code = "asset_comment_self_vote";
      throw error;
    }

    const voteResult = await client.query(
      `
      SELECT value
      FROM content.asset_comment_votes
      WHERE comment_id = $1
        AND user_id = $2
      LIMIT 1
      FOR UPDATE
    `,
      [safeCommentId, userId]
    );
    const previousValue = voteResult.rows[0] ? Number(voteResult.rows[0].value) : 0;
    const deltas = voteCountDeltas(previousValue, safeValue);

    if (safeValue === 0) {
      await client.query(
        `
        DELETE FROM content.asset_comment_votes
        WHERE comment_id = $1
          AND user_id = $2
      `,
        [safeCommentId, userId]
      );
    } else if (voteResult.rows[0]) {
      await client.query(
        `
        UPDATE content.asset_comment_votes
        SET value = $3, updated_at = now()
        WHERE comment_id = $1
          AND user_id = $2
      `,
        [safeCommentId, userId, safeValue]
      );
    } else {
      await client.query(
        `
        INSERT INTO content.asset_comment_votes (comment_id, user_id, value, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
      `,
        [safeCommentId, userId, safeValue]
      );
    }

    if (deltas.upvotes !== 0 || deltas.downvotes !== 0) {
      await client.query(
        `
        UPDATE content.asset_comments
        SET
          upvotes = GREATEST(upvotes + $2, 0),
          downvotes = GREATEST(downvotes + $3, 0),
          updated_at = now()
        WHERE id = $1
      `,
        [safeCommentId, deltas.upvotes, deltas.downvotes]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listAssets,
  listAssetRankingCore,
  listAssetRankingWeeklyActivity,
  listAssetRankingOshicoinUsers,
  getAssetBySymbol,
  updateAssetMarketTuning,
  listAssetComments,
  createAssetComment,
  setAssetCommentVote,
  getAssetCandles,
  getAllMarketCandles,
  getAssetStats,
  getAssetTrades,
  listRecentMarketTrades,
  getMarketActivityStats,
  getPendingLiveOrderSummary,
  getLiveOrderFlow,
  getMarketHub,
  getAssetSuperchatSummary,
  getAssetSuperchatRank,
  getAssetSuperchatTimeseries,
  getAssetStreamTimeTimeseries,
  getAssetTreasury,
  getLatestDailyReport,
  getDailyReportByDate,
  getMarketTuningConfig: buildMarketTuningConfig,
  getGroupIndex,
  listGroupIndexes,
};
