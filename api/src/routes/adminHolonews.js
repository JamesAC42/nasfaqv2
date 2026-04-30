const express = require("express");
const holonewsThumbnails = require("../services/holonewsThumbnails");
const { requireAdmin } = require("../userContext");

const router = express.Router();

router.post("/thumbnails/regenerate", async (req, res, next) => {
  try {
    requireAdmin(req);
    const result = await holonewsThumbnails.regenerateThumbnail(req.ctx.pool, req.ctx.redis, req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
