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
  if (!rows[0]) return null;
  return {
    created_at: rows[0].created_at,
    market_date: rows[0].market_date,
    ...(rows[0].report_json || {}),
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

module.exports = {
  listAssets,
  getAssetBySymbol,
  getAssetCandles,
  getAssetStats,
  getAssetTrades,
  getAssetTreasury,
  getLatestDailyReport,
  getDailyReportByDate,
  getGroupIndex,
  listGroupIndexes,
};
