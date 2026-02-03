const express = require("express");
const db = require("../db");

const router = express.Router();

function toVideoLink(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}
function toChannelLink(channelId) {
  return channelId ? `https://www.youtube.com/channel/${channelId}` : null;
}

router.get("/", async (req, res, next) => {
  try {
    const activeOnly = (req.query.active ?? "true").toString().toLowerCase() !== "false";
    const rows = await db.listChannels(req.ctx.pool, { activeOnly });
    res.json(
      rows.map((c) => ({
        ...c,
        youtube_channel_url: toChannelLink(c.youtube_channel_id)
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const youtube_channel_id = (req.body?.youtube_channel_id || "").toString().trim();
    const name = (req.body?.name || "").toString().trim();
    const symbolRaw = req.body?.symbol;
    const iconRaw = req.body?.icon;

    if (!youtube_channel_id) return res.status(400).json({ error: "youtube_channel_id_required" });
    if (!name) return res.status(400).json({ error: "name_required" });

    const symbol = symbolRaw === null || symbolRaw === undefined || symbolRaw === "" ? null : symbolRaw.toString().trim();
    const icon = iconRaw === null || iconRaw === undefined || iconRaw === "" ? null : iconRaw.toString().trim();

    const saved = await db.upsertChannel(req.ctx.pool, { youtube_channel_id, name, symbol, icon, is_active: true });
    res.json({
      ...saved,
      youtube_channel_url: toChannelLink(saved.youtube_channel_id)
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const channel = await db.getChannel(req.ctx.pool, req.params.id);
    if (!channel) return res.status(404).json({ error: "not_found" });
    res.json({ ...channel, youtube_channel_url: toChannelLink(channel.youtube_channel_id) });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/latest", async (req, res, next) => {
  try {
    const latest = await db.getLatestStats(req.ctx.pool, req.params.id);
    if (!latest) return res.status(404).json({ error: "not_found" });
    res.json({
      ...latest,
      last_upload_url: toVideoLink(latest.last_upload_video_id),
      last_live_url: toVideoLink(latest.last_live_video_id)
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/timeseries", async (req, res, next) => {
  try {
    const start = req.query.start ? new Date(req.query.start.toString()) : null;
    const end = req.query.end ? new Date(req.query.end.toString()) : null;
    const bucket = req.query.bucket ? req.query.bucket.toString() : null;

    const safeStart = start && !isNaN(start.getTime()) ? start.toISOString() : null;
    const safeEnd = end && !isNaN(end.getTime()) ? end.toISOString() : null;

    if (bucket) {
      const rows = await db.getTimeSeriesBucketed(req.ctx.pool, req.params.id, {
        start: safeStart,
        end: safeEnd,
        bucket
      });
      return res.json(rows);
    }

    const rows = await db.getTimeSeries(req.ctx.pool, req.params.id, { start: safeStart, end: safeEnd });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

module.exports = router;


