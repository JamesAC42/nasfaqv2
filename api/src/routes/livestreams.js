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

module.exports = router;


