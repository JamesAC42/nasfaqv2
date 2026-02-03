const { Pool } = require("pg");

function createPool(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL");
  }
  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 10000)
  });
}

async function listChannels(pool, { activeOnly = true } = {}) {
  const { rows } = await pool.query(
    `
    SELECT youtube_channel_id, name, symbol, icon, is_active, created_at, updated_at
    FROM yt.youtube_channels
    WHERE ($1::boolean IS FALSE) OR (is_active = true)
    ORDER BY name ASC
  `,
    [activeOnly]
  );
  return rows;
}

async function getChannel(pool, channelId) {
  const { rows } = await pool.query(
    `
    SELECT youtube_channel_id, name, symbol, icon, is_active, created_at, updated_at
    FROM yt.youtube_channels
    WHERE youtube_channel_id = $1
  `,
    [channelId]
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

async function upsertChannel(pool, { youtube_channel_id, name, symbol, icon, is_active = true }) {
  const { rows } = await pool.query(
    `
    INSERT INTO yt.youtube_channels (
      youtube_channel_id,
      name,
      symbol,
      icon,
      is_active,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,now())
    ON CONFLICT (youtube_channel_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      symbol = EXCLUDED.symbol,
      icon = EXCLUDED.icon,
      is_active = EXCLUDED.is_active,
      updated_at = now()
    RETURNING youtube_channel_id, name, symbol, icon, is_active, created_at, updated_at
  `,
    [youtube_channel_id, name, symbol, icon, is_active]
  );
  return rows[0];
}

module.exports = {
  createPool,
  listChannels,
  getChannel,
  getLatestStats,
  getLatestStatsAll,
  getTimeSeries,
  getTimeSeriesBucketed,
  upsertChannel
};


