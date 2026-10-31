const crypto = require("node:crypto");
const express = require("express");
const articleDb = require("../articleDb");
const { invalidateCachedJson } = require("../responseCache");
const holonewsThumbnails = require("../services/holonewsThumbnails");
const moderation = require("../services/moderation");
const { requireAdmin } = require("../userContext");

const router = express.Router();

const THUMB_REGEN_JOB_PREFIX = "nasfaq_holonews:thumb_regen_job:";
const THUMB_REGEN_JOB_TTL_SEC = 900;

function thumbRegenJobKey(jobId) {
  return `${THUMB_REGEN_JOB_PREFIX}${jobId}`;
}

router.get("/thumbnails/regenerate/:jobId", async (req, res, next) => {
  try {
    requireAdmin(req);
    const redis = req.ctx.redis;
    if (!redis) {
      res.status(503).json({ error: "redis_unavailable" });
      return;
    }
    const raw = await redis.get(thumbRegenJobKey(req.params.jobId));
    if (!raw) {
      res.status(404).json({ error: "job_not_found" });
      return;
    }
    res.json(JSON.parse(raw));
  } catch (error) {
    next(error);
  }
});

router.post("/thumbnails/regenerate", async (req, res, next) => {
  try {
    requireAdmin(req);
    const pool = req.ctx.pool;
    const redis = req.ctx.redis;
    const body = req.body || {};

    // When Redis is available, run generation in the background so Cloudflare (524 ~100s) and
    // browsers do not wait on multi-minute Gemini + S3 work.
    if (redis) {
      const jobId = crypto.randomUUID();
      const key = thumbRegenJobKey(jobId);
      await redis.set(key, JSON.stringify({ status: "pending", started_at: new Date().toISOString() }), {
        EX: THUMB_REGEN_JOB_TTL_SEC,
      });

      void (async () => {
        try {
          const result = await holonewsThumbnails.regenerateThumbnail(pool, redis, body);
          await redis.set(
            key,
            JSON.stringify({
              status: "done",
              result,
              finished_at: new Date().toISOString(),
            }),
            { EX: THUMB_REGEN_JOB_TTL_SEC }
          );
        } catch (error) {
          const code = error?.code || "error";
          const message = error?.message || String(error);
          await redis.set(
            key,
            JSON.stringify({
              status: "error",
              code,
              message,
              finished_at: new Date().toISOString(),
            }),
            { EX: THUMB_REGEN_JOB_TTL_SEC }
          );
        }
      })();

      res.status(202).json({
        job_id: jobId,
        status: "pending",
      });
      return;
    }

    const result = await holonewsThumbnails.regenerateThumbnail(pool, null, body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Take a story's thumbnail off (body { news_id?, article_slug? }): the site shows its usual picture for
// a story without one, and holonews doesn't draw a new one until an admin asks for one.
router.post("/thumbnails/remove", async (req, res, next) => {
  try {
    const actor = requireAdmin(req);
    const result = await holonewsThumbnails.removeThumbnail(req.ctx.pool, req.ctx.redis, req.body || {});
    await moderation.logAction(req.ctx.pool, {
      actor,
      action: "news.thumbnail.remove",
      targetType: "news_article",
      targetId: result.news_item.article_slug ?? result.news_item.id,
      targetLabel: result.news_item.headline,
      details: { news_id: result.news_item.id, thumbnail_url: result.previous_thumbnail_url },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// The stories pinned to the top of the home page, in order.
router.get("/front-page", async (req, res, next) => {
  try {
    requireAdmin(req);
    res.json({ pins: await articleDb.listFrontPagePins(req.ctx.pool), limit: articleDb.FRONT_PAGE_PIN_LIMIT });
  } catch (error) {
    next(error);
  }
});

// Set the pins (body { slugs: [...] }, in order; [] unpins everything).
router.put("/front-page", async (req, res, next) => {
  try {
    const actor = requireAdmin(req);
    const pool = req.ctx.pool;
    const before = await articleDb.listFrontPagePins(pool);
    await articleDb.setFrontPagePins(pool, req.body?.slugs, actor.id);
    const pins = await articleDb.listFrontPagePins(pool);
    await invalidateCachedJson(req.ctx.redis, [articleDb.FRONT_PAGE_CACHE_KEY]);
    const slugsOf = (list) => list.map((pin) => pin.article_slug);
    if (JSON.stringify(slugsOf(before)) !== JSON.stringify(slugsOf(pins))) {
      await moderation.logAction(pool, {
        actor,
        action: "news.front_page.pins",
        targetType: "front_page",
        details: { before: slugsOf(before), after: slugsOf(pins), headlines: pins.map((pin) => pin.headline) },
      });
    }
    res.json({ pins, limit: articleDb.FRONT_PAGE_PIN_LIMIT });
  } catch (error) {
    next(error);
  }
});

router.delete("/articles/:slug", async (req, res, next) => {
  try {
    requireAdmin(req);
    await articleDb.deleteNewsArticle(req.ctx.pool, req.params.slug);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
