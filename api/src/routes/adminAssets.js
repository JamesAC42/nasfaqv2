const express = require("express");
const mediaCatalog = require("../services/mediaCatalog");
const { requireAdmin } = require("../userContext");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    requireAdmin(req);
    const [emojis, profilePictures] = await Promise.all([
      mediaCatalog.listAdminEmojis(req.ctx.pool),
      mediaCatalog.listAdminProfilePictures(req.ctx.pool),
    ]);
    res.json({
      emojis,
      profile_pictures: profilePictures,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/emojis", async (req, res, next) => {
  try {
    requireAdmin(req);
    const emoji = await mediaCatalog.createEmoji(req.ctx.pool, {
      name: req.body?.name,
      imageDataUrl: req.body?.image_data_url,
    });
    res.status(201).json({ emoji });
  } catch (error) {
    next(error);
  }
});

router.patch("/emojis/:id", async (req, res, next) => {
  try {
    requireAdmin(req);
    const emoji = await mediaCatalog.updateEmoji(req.ctx.pool, Number(req.params.id), {
      name: req.body?.name,
      isDeleted: req.body?.is_deleted,
    });
    res.json({ emoji });
  } catch (error) {
    next(error);
  }
});

router.post("/profile-pictures", async (req, res, next) => {
  try {
    requireAdmin(req);
    const profilePicture = await mediaCatalog.createProfilePicture(req.ctx.pool, {
      name: req.body?.name,
      imageLargeDataUrl: req.body?.image_large_data_url,
      imageSmallDataUrl: req.body?.image_small_data_url,
    });
    res.status(201).json({ profile_picture: profilePicture });
  } catch (error) {
    next(error);
  }
});

router.patch("/profile-pictures/:id", async (req, res, next) => {
  try {
    requireAdmin(req);
    const profilePicture = await mediaCatalog.updateProfilePicture(req.ctx.pool, Number(req.params.id), {
      name: req.body?.name,
      isDeleted: req.body?.is_deleted,
    });
    res.json({ profile_picture: profilePicture });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
