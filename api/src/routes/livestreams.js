const express = require("express");

const router = express.Router();

function safeParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function cmpAsc(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toListStream(item) {
  // Only include fields needed by the livestream list + modal open button.
  // Modal does its own fetch for session/buckets, so we intentionally omit
  // fields like `video_url`, `channel_id`, and `updated_at`.
  return {
    video_id: item.video_id,
    status: item.status,
    title: item.title,
    thumbnail_url: item.thumbnail_url,
    channel_name: item.channel_name,
    channel_icon: item.channel_icon,
    channel_color: item.channel_color,
    scheduled_start_time: item.scheduled_start_time,
    actual_start_time: item.actual_start_time,
    concurrent_viewers: item.concurrent_viewers,
  };
}

function parsePage(value) {
  const n = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function weekWindowForPage(page) {
  const now = new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return {
    page,
    start: new Date(now.getTime() - (page + 1) * weekMs),
    end: new Date(now.getTime() - page * weekMs),
  };
}

const SESSION_SELECT = `
  SELECT
    s.video_id,
    s.youtube_channel_id,
    s.status,
    s.video_title,
    s.thumbnail_url,
    s.scheduled_start_at,
    s.actual_start_at,
    s.first_seen_at,
    s.last_seen_at,
    s.ended_at,
    s.total_views,
    s.avg_concurrent_viewers,
    s.max_concurrent_viewers,
    s.max_concurrent_viewers_at,
    COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) AS started_at,
    CASE
      WHEN COALESCE(s.ended_at, s.last_seen_at) IS NULL OR COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) IS NULL THEN NULL
      ELSE GREATEST(
        0,
        EXTRACT(EPOCH FROM (COALESCE(s.ended_at, s.last_seen_at) - COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at)))
      )::BIGINT
    END AS duration_seconds,
    c.name_short AS channel_name,
    c.icon AS channel_icon,
    c.color AS channel_color
  FROM yt.livestream_sessions s
  JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
`;

router.get("/", async (req, res, next) => {
  try {
    const redis = req.ctx.redis;
    if (!redis) return res.status(500).json({ error: "redis_not_configured" });

    const channelFilter = req.query.channel ? req.query.channel.toString().trim() : null;

    const live = [];
    const upcoming = [];

    // Aggregate all per-channel hashes: nasfaq_livestreams:{channelId}
    const match = channelFilter ? `nasfaq_livestreams:{${channelFilter}}` : "nasfaq_livestreams:{*}";
    for await (const key of redis.scanIterator({ MATCH: match, COUNT: 200 })) {
      const h = await redis.hGetAll(key);
      for (const [, val] of Object.entries(h)) {
        const item = safeParseJSON(val);
        if (!item || !item.video_id) continue;
        if (item.status === "live") live.push(item);
        else if (item.status === "upcoming") upcoming.push(item);
      }
    }

    // Sort:
    // - upcoming by scheduled_start_time ascending (fallback updated_at)
    // - live by actual_start_time descending (fallback updated_at)
    upcoming.sort((a, b) => {
      const at = a.scheduled_start_time || a.updated_at;
      const bt = b.scheduled_start_time || b.updated_at;
      return cmpAsc(String(at), String(bt));
    });
    live.sort((a, b) => {
      const at = a.actual_start_time || a.updated_at;
      const bt = b.actual_start_time || b.updated_at;
      return cmpAsc(String(bt), String(at));
    });

    res.json({ live: live.map(toListStream), upcoming: upcoming.map(toListStream) });
  } catch (e) {
    next(e);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    const { pool } = req.ctx;
    const page = parsePage(req.query.page);
    const window = weekWindowForPage(page);

    const historyResult = await pool.query(
      `
        ${SESSION_SELECT}
        WHERE s.status = 'ended'
          AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) >= $1
          AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) < $2
        ORDER BY COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) DESC, s.video_id DESC
      `,
      [window.start, window.end]
    );

    const olderResult = await pool.query(
      `
        SELECT 1
        FROM yt.livestream_sessions s
        WHERE s.status = 'ended'
          AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) < $1
        LIMIT 1
      `,
      [window.start]
    );

    res.json({
      page,
      week_start: window.start.toISOString(),
      week_end: window.end.toISOString(),
      has_older: olderResult.rowCount > 0,
      streams: historyResult.rows,
    });
  } catch (e) {
    next(e);
  }
});

// Get livestream session metadata for a specific video id.
// Optional query param `channel` allows direct Redis lookup without scanning.
router.get("/:videoId", async (req, res, next) => {
  try {
    const { pool, redis } = req.ctx;
    const videoId = req.params.videoId ? req.params.videoId.toString().trim() : "";
    if (!videoId) return res.status(400).json({ error: "missing_video_id" });

    const channelID = req.query.channel ? req.query.channel.toString().trim() : null;

    let redisItem = null;
    if (redis && channelID) {
      const key = `nasfaq_livestreams:{${channelID}}`;
      const raw = await redis.hGet(key, videoId);
      redisItem = raw ? safeParseJSON(raw) : null;
    }

    const r = await pool.query(
      `
        ${SESSION_SELECT}
        WHERE s.video_id = $1
        LIMIT 1
      `,
      [videoId]
    );
    const session = r.rows[0] || null;

    res.json({ session, redis: redisItem });
  } catch (e) {
    next(e);
  }
});

// Get the viewer buckets (5-minute) for a specific livestream.
router.get("/:videoId/buckets", async (req, res, next) => {
  try {
    const { pool } = req.ctx;
    const videoId = req.params.videoId ? req.params.videoId.toString().trim() : "";
    if (!videoId) return res.status(400).json({ error: "missing_video_id" });

    const r = await pool.query(
      `
        SELECT
          bucket_start,
          bucket_end,
          duration_seconds,
          avg_viewers,
          max_viewers
        FROM yt.livestream_viewer_buckets_5m
        WHERE livestream_video_id = $1
        ORDER BY bucket_start ASC
      `,
      [videoId]
    );
    res.json({ video_id: videoId, buckets: r.rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
