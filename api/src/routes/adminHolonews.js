const crypto = require("node:crypto");
const express = require("express");
const articleDb = require("../articleDb");
const holonewsThumbnails = require("../services/holonewsThumbnails");
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
