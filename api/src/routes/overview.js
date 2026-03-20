const express = require("express");
const db = require("../db");

const router = express.Router();
const HOLO_NEWS_META_KEY = "nasfaq_holonews:meta";
const HOLO_NEWS_ITEMS_KEY = "nasfaq_holonews:items";
const THUMBNAIL_CDN_BASE_URL = "https://images.nasfaq.biz";

function toVideoLink(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toThumbnailUrl(key) {
  if (!key) return null;
  return `${THUMBNAIL_CDN_BASE_URL}/${encodeURI(key)}`;
}

function sortHoloNewsItems(items) {
  return [...items].sort((a, b) => {
    const aHasThumb = Boolean(a.thumbnail_s3_key);
    const bHasThumb = Boolean(b.thumbnail_s3_key);
    if (aHasThumb !== bHasThumb) return aHasThumb ? -1 : 1;

    const aRank = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
    const bRank = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;

    return String(a.headline || "").localeCompare(String(b.headline || ""));
  });
}

router.get("/holonews", async (req, res, next) => {
  try {
    const redis = req.ctx.redis;
    if (!redis) return res.status(500).json({ error: "redis_not_configured" });

    const rawMeta = await redis.get(HOLO_NEWS_META_KEY);
    let payload = rawMeta ? safeParseJSON(rawMeta) : null;

    if (!payload) {
      const rawItems = await redis.lRange(HOLO_NEWS_ITEMS_KEY, 0, -1);
      payload = {
        thread_id: null,
        source_post: null,
        updated_at: null,
        items: rawItems.map(safeParseJSON).filter(Boolean)
      };
    }

    const channels = await db.listChannels(req.ctx.pool, { activeOnly: true });
    const iconByEnglishName = new Map(
      channels
        .filter((channel) => channel?.name_english)
        .map((channel) => [String(channel.name_english).trim().toLowerCase(), channel.icon || null])
    );

    const items = sortHoloNewsItems(
      Array.isArray(payload.items) ? payload.items : []
    ).map((item) => ({
      headline: item.headline || "",
      characters: (Array.isArray(item.characters) ? item.characters.filter(Boolean) : []).map((name) => ({
        name,
        icon: iconByEnglishName.get(String(name).trim().toLowerCase()) || null
      })),
      rank: Number.isFinite(item.rank) ? item.rank : null,
      thumbnail_s3_key: item.thumbnail_s3_key || null,
      thumbnail_url: toThumbnailUrl(item.thumbnail_s3_key || null)
    }));

    res.json({
      thread_id: payload.thread_id || null,
      source_post: payload.source_post || null,
      updated_at: payload.updated_at || null,
      items
    });
  } catch (e) {
    next(e);
  }
});

router.get("/latest", async (req, res, next) => {
  try {
    const [channels, stats] = await Promise.all([
      db.listChannels(req.ctx.pool, { activeOnly: true }),
      db.getLatestStatsAll(req.ctx.pool)
    ]);

    const statsById = new Map(stats.map((s) => [s.youtube_channel_id, s]));

    const out = channels.map((c) => {
      const s = statsById.get(c.youtube_channel_id) || null;
      return {
        channel: c,
        latest: s
          ? {
              ...s,
              last_upload_url: toVideoLink(s.last_upload_video_id),
              last_live_url: toVideoLink(s.last_live_video_id)
            }
          : null
      };
    });

    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.get("/timeseries", async (req, res, next) => {
  try {
    const days = Number(req.query.days || 90);
    const limit = Number(req.query.limit || 400);
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const channels = await db.listChannels(req.ctx.pool, { activeOnly: true });

    const series = await Promise.all(
      channels.map(async (c) => {
        const rows = await db.getTimeSeries(req.ctx.pool, c.youtube_channel_id, {
          start: start.toISOString(),
          end: end.toISOString(),
          limit
        });
        return {
          channel: c,
          series: rows
        };
      })
    );

    res.json(series);
  } catch (e) {
    next(e);
  }
});

module.exports = router;




