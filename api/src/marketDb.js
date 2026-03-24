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
            'close_mark', d.mid_close_mark
          )
          ORDER BY d.market_date ASC
        ) AS sparkline_candles
      FROM market.asset_daily_market_state d
      WHERE d.market_date >= current_date - interval '14 days'
      GROUP BY d.asset_id
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
      a.current_mid_price,
      a.current_bid_price,
      a.current_ask_price,
      a.current_premium_pct,
      a.current_daily_emission,
      a.treasury_supply,
      a.circulating_supply,
      a.max_supply,
      a.latest_snapshot_date,
      COALESCE(v.volume_24h, 0) AS volume_24h,
      COALESCE(v.volume_cash_24h, 0) AS volume_cash_24h,
      CASE
        WHEN ld.mid_open IS NULL OR ld.mid_open = 0 OR ld.mid_close IS NULL THEN NULL
        ELSE (ld.mid_close - ld.mid_open) / ld.mid_open
      END AS move_24h_pct,
      ld.market_date AS latest_market_date,
      COALESCE(sd.sparkline_candles, '[]'::jsonb) AS sparkline_candles
    FROM market.market_assets a
    JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    LEFT JOIN volume_24h v ON v.asset_id = a.id
    LEFT JOIN latest_daily ld ON ld.asset_id = a.id
    LEFT JOIN sparkline_daily sd ON sd.asset_id = a.id
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
    WHERE a.symbol = $1
    LIMIT 1
  `,
    [symbol]
  );
  return rows[0] || null;
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
    WITH fills AS (
      SELECT
        tf.asset_id,
        time_bucket($2::interval, tf.ts) AS bucket,
        tf.ts,
        tf.price,
        tf.quantity,
        tf.gross_cash
      FROM market.trade_fills tf
      JOIN market.market_assets a ON a.id = tf.asset_id
      WHERE a.symbol = $1
        AND tf.ts >= now() - $3::interval
    )
    SELECT
      bucket,
      (array_agg(price ORDER BY ts ASC))[1] AS open,
      MAX(price) AS high,
      MIN(price) AS low,
      (array_agg(price ORDER BY ts DESC))[1] AS close,
      COALESCE(SUM(quantity), 0) AS volume_shares,
      COALESCE(SUM(gross_cash), 0) AS volume_cash,
      COUNT(*)::INTEGER AS trade_count,
      CASE
        WHEN COALESCE(SUM(quantity), 0) = 0 THEN NULL
        ELSE SUM(gross_cash) / NULLIF(SUM(quantity), 0)
      END AS vwap
    FROM fills
    GROUP BY bucket
    ORDER BY bucket ASC
  `,
    [symbol, bucket, windowInterval]
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
  return rows[0] || null;
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
  return rows[0] || null;
}

module.exports = {
  listAssets,
  getAssetBySymbol,
  getAssetCandles,
  getAssetStats,
  getAssetTrades,
  getAssetTreasury,
  getLatestDailyReport,
  getDailyReportByDate,
};
