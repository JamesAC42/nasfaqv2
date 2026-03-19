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

    res.json({ live, upcoming });
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
          s.avg_concurrent_viewers,
          s.max_concurrent_viewers,
          s.max_concurrent_viewers_at,
          c.name_short AS channel_name,
          c.icon AS channel_icon
        FROM yt.livestream_sessions s
        JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
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


