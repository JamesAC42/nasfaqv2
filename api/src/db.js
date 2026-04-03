const { Pool } = require("pg");

function createPool(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL");
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    options: process.env.PG_OPTIONS || "-c timezone=UTC",
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 10000)
  });

  pool.on("connect", (client) => {
    client.query("SET TIME ZONE 'UTC'").catch(() => {});
  });

  return pool;
}

const CHANNEL_SELECT_COLUMNS = `
      youtube_channel_id,
      name_short,
      name_short AS name,
      name_english,
      name_japanese,
      symbol,
      icon,
      color,
      COALESCE(to_jsonb(youtube_channels)->>'channel_asset_icon_url', youtube_channel_icon_url) AS youtube_channel_icon_url,
      COALESCE(to_jsonb(youtube_channels)->>'channel_asset_banner_url', youtube_channel_banner_url) AS youtube_channel_banner_url,
      youtube_channel_description,
      twitter_id,
      profile_id,
      birthday,
      height,
      unit,
      is_active,
      created_at,
      updated_at
`;

async function listChannels(pool, { activeOnly = true } = {}) {
  const { rows } = await pool.query(
    `
    SELECT
${CHANNEL_SELECT_COLUMNS}
    FROM yt.youtube_channels
    WHERE ($1::boolean IS FALSE) OR (is_active = true)
    ORDER BY name_short ASC
  `,
    [activeOnly]
  );
  return rows;
}

async function listChannelIdentifiers(pool) {
  const { rows } = await pool.query(
    `
    SELECT youtube_channel_id, name_short, profile_id
    FROM yt.youtube_channels
    ORDER BY name_short ASC
  `
  );
  return rows;
}

async function getChannel(pool, channelId) {
  const { rows } = await pool.query(
    `
    SELECT
${CHANNEL_SELECT_COLUMNS}
    FROM yt.youtube_channels
    WHERE youtube_channel_id = $1
  `,
    [channelId]
  );
  return rows[0] || null;
}

async function findChannelByName(pool, name, { excludeChannelId = null } = {}) {
  const { rows } = await pool.query(
    `
    SELECT
${CHANNEL_SELECT_COLUMNS}
    FROM yt.youtube_channels
    WHERE lower(btrim(name_short)) = lower(btrim($1))
      AND ($2::text IS NULL OR youtube_channel_id <> $2)
    LIMIT 1
  `,
    [name, excludeChannelId]
  );
  return rows[0] || null;
}

async function getLatestStats(pool, channelId) {
  const { rows } = await pool.query(
    `
    SELECT time, youtube_channel_id,
           subscriber_count, view_count, video_count, hidden_subscriber_count,
           last_upload_at, last_upload_video_id,
           last_live_at, last_live_video_id,
           country, scraped_at
    FROM yt.youtube_channel_daily_stats
    WHERE youtube_channel_id = $1
    ORDER BY time DESC
    LIMIT 1
  `,
    [channelId]
  );
  return rows[0] || null;
}

async function getLatestStatsAll(pool) {
  // Latest row per channel using DISTINCT ON (fast with (channel_id, time desc) index).
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (s.youtube_channel_id)
      s.youtube_channel_id,
      s.time,
      s.subscriber_count, s.view_count, s.video_count, s.hidden_subscriber_count,
      s.last_upload_at, s.last_upload_video_id,
      s.last_live_at, s.last_live_video_id,
      s.country,
      s.scraped_at
    FROM yt.youtube_channel_daily_stats s
    ORDER BY s.youtube_channel_id, s.time DESC
  `);
  return rows;
}

async function countUsers(pool) {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM market.users
  `);
  return rows[0]?.count ?? 0;
}

async function countChannels(pool, { activeOnly = true } = {}) {
  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM yt.youtube_channels
    WHERE ($1::boolean IS FALSE) OR (is_active = true)
  `,
    [activeOnly]
  );
  return rows[0]?.count ?? 0;
}

async function getTimeSeries(pool, channelId, { start, end, limit = 2000 } = {}) {
  const params = [channelId];
  let where = "youtube_channel_id = $1";
  if (start) {
    params.push(start);
    where += ` AND time >= $${params.length}`;
  }
  if (end) {
    params.push(end);
    where += ` AND time <= $${params.length}`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `
    SELECT time, youtube_channel_id,
           subscriber_count, view_count, video_count, hidden_subscriber_count,
           last_upload_at, last_upload_video_id,
           last_live_at, last_live_video_id,
           country, scraped_at
    FROM yt.youtube_channel_daily_stats
    WHERE ${where}
    ORDER BY time ASC
    LIMIT $${params.length}
  `,
    params
  );
  return rows;
}

async function getTimeSeriesBucketed(pool, channelId, { start, end, bucket = "7 days", limit = 2000 } = {}) {
  // Bucket with time_bucket, but avoid Timescale hyperfunctions so it works everywhere.
  // We take the "last" row in each bucket by ordering within array_agg.
  const params = [channelId, bucket];
  let where = "youtube_channel_id = $1";
  if (start) {
    params.push(start);
    where += ` AND time >= $${params.length}`;
  }
  if (end) {
    params.push(end);
    where += ` AND time <= $${params.length}`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `
    SELECT
      time_bucket($2::interval, time) AS bucket,
      (array_agg(subscriber_count ORDER BY time DESC))[1] AS subscriber_count,
      (array_agg(view_count ORDER BY time DESC))[1] AS view_count,
      (array_agg(video_count ORDER BY time DESC))[1] AS video_count
    FROM yt.youtube_channel_daily_stats
    WHERE ${where}
    GROUP BY bucket
    ORDER BY bucket ASC
    LIMIT $${params.length}
  `,
    params
  );
  return rows;
}

async function upsertChannel(pool, {
  youtube_channel_id,
  name_short,
  name_english = null,
  name_japanese = null,
  symbol,
  icon,
  color = null,
  twitter_id = null,
  profile_id = null,
  birthday = null,
  height = null,
  unit = null,
  is_active = true
}) {
  const { rows } = await pool.query(
    `
    INSERT INTO yt.youtube_channels (
      youtube_channel_id,
      name_short,
      name_english,
      name_japanese,
      symbol,
      icon,
      color,
      twitter_id,
      profile_id,
      birthday,
      height,
      unit,
      is_active,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
    ON CONFLICT (youtube_channel_id)
    DO UPDATE SET
      name_short = EXCLUDED.name_short,
      name_english = EXCLUDED.name_english,
      name_japanese = EXCLUDED.name_japanese,
      symbol = EXCLUDED.symbol,
      icon = EXCLUDED.icon,
      color = EXCLUDED.color,
      twitter_id = EXCLUDED.twitter_id,
      profile_id = EXCLUDED.profile_id,
      birthday = EXCLUDED.birthday,
      height = EXCLUDED.height,
      unit = EXCLUDED.unit,
      is_active = EXCLUDED.is_active,
      updated_at = now()
    RETURNING
${CHANNEL_SELECT_COLUMNS}
  `,
    [youtube_channel_id, name_short, name_english, name_japanese, symbol, icon, color, twitter_id, profile_id, birthday, height, unit, is_active]
  );
  return rows[0];
}

async function insertChannel(pool, {
  youtube_channel_id,
  name_short,
  name_english = null,
  name_japanese = null,
  symbol,
  icon,
  color = null,
  twitter_id = null,
  profile_id = null,
  birthday = null,
  height = null,
  unit = null,
  is_active = true
}) {
  const { rows } = await pool.query(
    `
    INSERT INTO yt.youtube_channels (
      youtube_channel_id,
      name_short,
      name_english,
      name_japanese,
      symbol,
      icon,
      color,
      twitter_id,
      profile_id,
      birthday,
      height,
      unit,
      is_active,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
    RETURNING
${CHANNEL_SELECT_COLUMNS}
  `,
    [youtube_channel_id, name_short, name_english, name_japanese, symbol, icon, color, twitter_id, profile_id, birthday, height, unit, is_active]
  );
  return rows[0];
}

async function updateChannel(pool, channelId, {
  name_short,
  name_english = null,
  name_japanese = null,
  symbol,
  icon,
  color = null,
  twitter_id = null,
  profile_id = null,
  birthday = null,
  height = null,
  unit = null,
  is_active = true
}) {
  const { rows } = await pool.query(
    `
    UPDATE yt.youtube_channels
    SET
      name_short = $2,
      name_english = $3,
      name_japanese = $4,
      symbol = $5,
      icon = $6,
      color = $7,
      twitter_id = $8,
      profile_id = $9,
      birthday = $10,
      height = $11,
      unit = $12,
      is_active = $13,
      updated_at = now()
    WHERE youtube_channel_id = $1
    RETURNING
${CHANNEL_SELECT_COLUMNS}
  `,
    [channelId, name_short, name_english, name_japanese, symbol, icon, color, twitter_id, profile_id, birthday, height, unit, is_active]
  );
  return rows[0] || null;
}

async function deleteChannel(pool, channelId) {
  const { rows } = await pool.query(
    `
    DELETE FROM yt.youtube_channels
    WHERE youtube_channel_id = $1
    RETURNING
${CHANNEL_SELECT_COLUMNS}
  `,
    [channelId]
  );
  return rows[0] || null;
}

function normalizeNewsSort(sort) {
  switch (String(sort || "").toLowerCase()) {
    case "oldest":
      return "oldest";
    case "headline_asc":
      return "headline_asc";
    case "headline_desc":
      return "headline_desc";
    default:
      return "newest";
  }
}

async function listNewsFeed(pool, {
  headlineQuery = null,
  channelQuery = null,
  stockQuery = null,
  unit = null,
  sort = "newest",
  page = 1,
  limit = 20,
} = {}) {
  const normalizedSort = normalizeNewsSort(sort);
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const offset = (safePage - 1) * safeLimit;
  const params = [
    headlineQuery?.trim() || null,
    channelQuery?.trim() || null,
    stockQuery?.trim() || null,
    unit?.trim() || null,
  ];

  const whereClause = `
    WHERE ($1::text IS NULL OR mn.headline ILIKE '%' || $1 || '%')
      AND (
        $2::text IS NULL
        OR EXISTS (
          SELECT 1
          FROM info.member_news_channels mnc
          JOIN yt.youtube_channels yc
            ON yc.youtube_channel_id = mnc.youtube_channel_id
          LEFT JOIN market.market_assets ma
            ON ma.youtube_channel_id = yc.youtube_channel_id
          WHERE mnc.news_id = mn.id
            AND (
              lower(yc.youtube_channel_id) = lower($2)
              OR yc.name_short ILIKE '%' || $2 || '%'
              OR COALESCE(yc.name_english, '') ILIKE '%' || $2 || '%'
              OR COALESCE(yc.symbol, '') ILIKE '%' || $2 || '%'
              OR COALESCE(ma.symbol, '') ILIKE '%' || $2 || '%'
            )
        )
      )
      AND (
        $3::text IS NULL
        OR EXISTS (
          SELECT 1
          FROM info.member_news_channels mnc
          JOIN market.market_assets ma
            ON ma.youtube_channel_id = mnc.youtube_channel_id
          WHERE mnc.news_id = mn.id
            AND ma.symbol ILIKE '%' || $3 || '%'
        )
      )
      AND (
        $4::text IS NULL
        OR EXISTS (
          SELECT 1
          FROM info.member_news_channels mnc
          JOIN yt.youtube_channels yc
            ON yc.youtube_channel_id = mnc.youtube_channel_id
          WHERE mnc.news_id = mn.id
            AND lower(COALESCE(yc.unit, '')) = lower($4)
        )
      )
  `;

  let orderClause = "ORDER BY mn.date DESC, mn.id DESC";
  if (normalizedSort === "oldest") {
    orderClause = "ORDER BY mn.date ASC, mn.id ASC";
  } else if (normalizedSort === "headline_asc") {
    orderClause = "ORDER BY lower(mn.headline) ASC, mn.id DESC";
  } else if (normalizedSort === "headline_desc") {
    orderClause = "ORDER BY lower(mn.headline) DESC, mn.id DESC";
  }

  const countResult = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM info.member_news mn
    ${whereClause}
  `,
    params
  );

  const itemsResult = await pool.query(
    `
    SELECT
      mn.id,
      mn.headline,
      'HoloNews'::text AS source,
      mn.date::text AS published_at,
      mn.thumbnail_url,
      COALESCE(a.id, NULL) AS article_id,
      COALESCE(a.slug, 'news-' || mn.id::text) AS article_slug,
      COALESCE(a.is_news, TRUE) AS is_news,
      COALESCE(a.likes, 0)::int AS like_count,
      COALESCE(a.saves, 0)::int AS save_count,
      COALESCE(comment_rel.comment_count, 0)::int AS comment_count,
      COALESCE(rel.characters, '[]'::json) AS characters,
      COALESCE(rel.related_names, ARRAY[]::text[]) AS related_names,
      COALESCE(rel.channel_ids, ARRAY[]::text[]) AS channel_ids,
      COALESCE(rel.stock_symbols, ARRAY[]::text[]) AS stock_symbols,
      COALESCE(rel.units, ARRAY[]::text[]) AS units
    FROM info.member_news mn
    LEFT JOIN content.articles a
      ON a.news_id = mn.id
    LEFT JOIN LATERAL (
      SELECT
        json_agg(
          DISTINCT jsonb_build_object(
            'name', yc.name_short,
            'icon', yc.icon,
            'youtube_channel_id', yc.youtube_channel_id,
            'symbol', ma.symbol,
            'unit', yc.unit
          )
        ) FILTER (WHERE yc.youtube_channel_id IS NOT NULL) AS characters,
        array_agg(DISTINCT yc.name_short) FILTER (WHERE yc.name_short IS NOT NULL) AS related_names,
        array_agg(DISTINCT yc.youtube_channel_id) FILTER (WHERE yc.youtube_channel_id IS NOT NULL) AS channel_ids,
        array_agg(DISTINCT ma.symbol) FILTER (WHERE ma.symbol IS NOT NULL) AS stock_symbols,
        array_agg(DISTINCT yc.unit) FILTER (WHERE yc.unit IS NOT NULL) AS units
      FROM info.member_news_channels mnc
      JOIN yt.youtube_channels yc
        ON yc.youtube_channel_id = mnc.youtube_channel_id
      LEFT JOIN market.market_assets ma
        ON ma.youtube_channel_id = yc.youtube_channel_id
      WHERE mnc.news_id = mn.id
    ) rel ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS comment_count
      FROM content.article_comments ac
      WHERE ac.article_id = a.id
    ) comment_rel ON TRUE
    ${whereClause}
    ${orderClause}
    LIMIT $5
    OFFSET $6
  `,
    [...params, safeLimit, offset]
  );

  return {
    items: itemsResult.rows,
    total: countResult.rows[0]?.total ?? 0,
    page: safePage,
    limit: safeLimit,
    sort: normalizedSort,
  };
}

module.exports = {
  createPool,
  countUsers,
  countChannels,
  listChannels,
  listChannelIdentifiers,
  getChannel,
  findChannelByName,
  getLatestStats,
  getLatestStatsAll,
  getTimeSeries,
  getTimeSeriesBucketed,
  listNewsFeed,
  upsertChannel,
  insertChannel,
  updateChannel,
  deleteChannel
};
