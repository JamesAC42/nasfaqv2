const express = require("express");
const db = require("../db");

const router = express.Router();

function toVideoLink(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

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


