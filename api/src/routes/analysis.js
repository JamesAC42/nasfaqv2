const express = require("express");

const router = express.Router();

const analysisKey = "nasfaq_4chan_analysis";

function safeParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

router.get("/4chan", async (req, res, next) => {
  try {
    const redis = req.ctx.redis;
    if (!redis) return res.status(500).json({ error: "redis_not_configured" });

    const limit = Number(req.query.limit || 0);
    let rawItems = [];
    try {
      rawItems = await redis.zRange(analysisKey, 0, -1, { REV: true });
    } catch (err) {
      if (String(err?.message || err).toLowerCase().includes("syntax")) {
        rawItems = await redis.sendCommand(["ZREVRANGE", analysisKey, "0", "-1"]);
      } else {
        throw err;
      }
    }

    const items = rawItems
      .map(safeParseJSON)
      .filter(Boolean)
      .map((item) => {
        if (!item.analysis && typeof item.analysis_raw === "string") {
          const parsed = safeParseJSON(item.analysis_raw);
          if (parsed && typeof parsed === "object") {
            return { ...item, analysis: parsed };
          }
        }
        return item;
      });

    if (Number.isFinite(limit) && limit > 0) {
      return res.json(items.slice(0, limit));
    }
    return res.json(items);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
