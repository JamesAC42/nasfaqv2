const express = require("express");
const mediaCatalog = require("../services/mediaCatalog");

const router = express.Router();

router.get("/emojis", async (req, res, next) => {
  try {
    const emojis = await mediaCatalog.listActiveEmojis(req.ctx.pool);
    res.json({ emojis });
  } catch (error) {
    next(error);
  }
});

router.get("/profile-pictures", async (req, res, next) => {
  try {
    const profilePictures = await mediaCatalog.listActiveProfilePictures(req.ctx.pool);
    res.json({ profile_pictures: profilePictures });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
