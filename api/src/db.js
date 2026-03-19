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

const CHANNEL_SELECT_COLUMNS = `
      youtube_channel_id,
      name_short,
      name_short AS name,
      name_english,
      name_japanese,
      symbol,
      icon,
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
      twitter_id,
      profile_id,
      birthday,
      height,
      unit,
      is_active,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
    ON CONFLICT (youtube_channel_id)
    DO UPDATE SET
      name_short = EXCLUDED.name_short,
      name_english = EXCLUDED.name_english,
      name_japanese = EXCLUDED.name_japanese,
      symbol = EXCLUDED.symbol,
      icon = EXCLUDED.icon,
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
    [youtube_channel_id, name_short, name_english, name_japanese, symbol, icon, twitter_id, profile_id, birthday, height, unit, is_active]
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
      twitter_id,
      profile_id,
      birthday,
      height,
      unit,
      is_active,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
    RETURNING
${CHANNEL_SELECT_COLUMNS}
  `,
    [youtube_channel_id, name_short, name_english, name_japanese, symbol, icon, twitter_id, profile_id, birthday, height, unit, is_active]
  );
  return rows[0];
}

async function updateChannel(pool, channelId, {
  name_short,
  name_english = null,
  name_japanese = null,
  symbol,
  icon,
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
      twitter_id = $7,
      profile_id = $8,
      birthday = $9,
      height = $10,
      unit = $11,
      is_active = $12,
      updated_at = now()
    WHERE youtube_channel_id = $1
    RETURNING
${CHANNEL_SELECT_COLUMNS}
  `,
    [channelId, name_short, name_english, name_japanese, symbol, icon, twitter_id, profile_id, birthday, height, unit, is_active]
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

module.exports = {
  createPool,
  listChannels,
  listChannelIdentifiers,
  getChannel,
  findChannelByName,
  getLatestStats,
  getLatestStatsAll,
  getTimeSeries,
  getTimeSeriesBucketed,
  upsertChannel,
  insertChannel,
  updateChannel,
  deleteChannel
};

