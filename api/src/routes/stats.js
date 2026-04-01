const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const [user_count, channel_count] = await Promise.all([
      db.countUsers(req.ctx.pool),
      db.countChannels(req.ctx.pool, { activeOnly: true }),
    ]);

    res.json({
      user_count,
      channel_count,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
