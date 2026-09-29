const express = require("express");
const db = require("../db");
const articleDb = require("../articleDb");
const wire = require("../services/wire");
const chatter = require("../services/chatter");

const { sendCachedJson } = require("../responseCache");

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

    const rawItems = sortHoloNewsItems(Array.isArray(payload.items) ? payload.items : []);
    const [channels, articleRefsByHeadline] = await Promise.all([
      db.listChannels(req.ctx.pool, { activeOnly: true }),
      articleDb.getNewsArticleRefsByHeadlines(
        req.ctx.pool,
        rawItems.map((item) => item.headline || "")
      ),
    ]);
    const iconByEnglishName = new Map(
      channels
        .filter((channel) => channel?.name_english)
        .map((channel) => [String(channel.name_english).trim().toLowerCase(), channel.icon || null])
    );

    const items = rawItems.map((item) => {
      const headline = String(item.headline || "");
      const articleRef = articleRefsByHeadline.get(headline) || null;
      return {
        headline,
        article_id: articleRef?.article_id || null,
        article_slug: articleRef?.slug || articleDb.buildNewsSlugBase(headline),
        characters: (Array.isArray(item.characters) ? item.characters.filter(Boolean) : []).map((name) => ({
          name,
          icon: iconByEnglishName.get(String(name).trim().toLowerCase()) || null
        })),
        rank: Number.isFinite(item.rank) ? item.rank : null,
        thumbnail_s3_key: item.thumbnail_s3_key || null,
        thumbnail_url: toThumbnailUrl(item.thumbnail_s3_key || null)
      };
    });

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

// Who /vt/'s hololive threads are talking about: posts per talent against their usual pace.
router.get("/chatter", async (req, res, next) => {
  try {
    res.set("cache-control", "public, max-age=60");
    res.json(await chatter.getSummary(req.ctx.pool));
  } catch (e) {
    next(e);
  }
});

// The Wire: automatic headlines from streams, milestones, the market and the games.
router.get("/wire", async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 40));
    const hours = Math.min(24 * 30, Math.max(1, Number.parseInt(req.query.hours, 10) || 168));
    const order = req.query.order === "time" ? "time" : "rank";
    const group = wire.WIRE_GROUPS[req.query.group] ? String(req.query.group) : null;
    const symbol = /^[A-Za-z0-9]{1,12}$/.test(String(req.query.symbol || "")) ? String(req.query.symbol).toUpperCase() : null;
    const beforeMs = req.query.before ? Date.parse(String(req.query.before)) : Number.NaN;
    const before = Number.isFinite(beforeMs) ? new Date(beforeMs).toISOString() : null;
    await sendCachedJson(req, res, `overview:wire:${limit}:${hours}:${order}:${group || "*"}:${symbol || "*"}:${before || "-"}`, {
      ttlSeconds: 30,
      memoMs: 5000,
      load: async () => ({ items: await wire.listWire(req.ctx.pool, { limit, hours, order, group, symbol, before }) }),
    });
  } catch (e) {
    next(e);
  }
});

// The Wire page's filter chips: items per group in the window.
router.get("/wire/counts", async (req, res, next) => {
  try {
    const hours = Math.min(24 * 30, Math.max(1, Number.parseInt(req.query.hours, 10) || 168));
    const symbol = /^[A-Za-z0-9]{1,12}$/.test(String(req.query.symbol || "")) ? String(req.query.symbol).toUpperCase() : null;
    await sendCachedJson(req, res, `overview:wire-counts:${hours}:${symbol || "*"}`, { ttlSeconds: 30, memoMs: 5000, load: () => wire.countWire(req.ctx.pool, { hours, symbol }) });
  } catch (e) {
    next(e);
  }
});

// Posts per hour on /vt/ over the last days (board-wide or one talent), topics and who's talked about.
router.get("/chatter/history", async (req, res, next) => {
  try {
    const days = Math.min(15, Math.max(1, Number.parseInt(req.query.days, 10) || 7));
    const symbol = /^[A-Za-z0-9]{1,12}$/.test(String(req.query.symbol || "")) ? String(req.query.symbol).toUpperCase() : null;
    await sendCachedJson(req, res, `overview:chatter-history:${days}:${symbol || "*"}`, { ttlSeconds: 300, memoMs: 30_000, load: () => chatter.getHistory(req.ctx.pool, { days, symbol }) });
  } catch (e) {
    next(e);
  }
});

router.get("/latest", async (req, res, next) => {
  try {
    // Daily YouTube numbers: a minute old is fine, and the query reads the whole stats history.
    await sendCachedJson(req, res, "overview:latest", { ttlSeconds: 60, memoMs: 10_000, load: () => loadLatest(req.ctx.pool) });
  } catch (e) {
    next(e);
  }
});

async function loadLatest(pool) {
  const [channels, stats] = await Promise.all([
    db.listChannels(pool, { activeOnly: true }),
    db.getLatestStatsAll(pool)
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

  return out;
}

router.get("/timeseries", async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days, 10) || 90));
    const limit = Math.min(2000, Math.max(1, Number.parseInt(req.query.limit, 10) || 400));
    // One query per channel on a miss, so it's cached for a few minutes (daily data).
    await sendCachedJson(req, res, `overview:timeseries:${days}:${limit}`, { ttlSeconds: 300, memoMs: 30_000, load: () => loadTimeseries(req.ctx.pool, days, limit) });
  } catch (e) {
    next(e);
  }
});

async function loadTimeseries(pool, days, limit) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const channels = await db.listChannels(pool, { activeOnly: true });

  // Four channels at a time, so a rebuild never takes every pooled connection at once.
  const series = [];
  for (let i = 0; i < channels.length; i += 4) {
    const batch = await Promise.all(
      channels.slice(i, i + 4).map(async (c) => ({
        channel: c,
        series: await db.getTimeSeries(pool, c.youtube_channel_id, { start: start.toISOString(), end: end.toISOString(), limit }),
      }))
    );
    series.push(...batch);
  }
  return series;
}

module.exports = router;


