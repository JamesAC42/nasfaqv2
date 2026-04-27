const express = require("express");
const gachaPrizeCatalog = require("../services/games/gachaPrizeCatalog");
const mediaCatalog = require("../services/mediaCatalog");
const { requireAdmin } = require("../userContext");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    requireAdmin(req);
    const [emojis, profilePictures, gachaPrizes] = await Promise.all([
      mediaCatalog.listAdminEmojis(req.ctx.pool),
      mediaCatalog.listAdminProfilePictures(req.ctx.pool),
      gachaPrizeCatalog.listAdminPrizeItems(req.ctx.pool),
    ]);
    res.json({
      emojis,
      profile_pictures: profilePictures,
      gacha_prizes: gachaPrizes,
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

router.post("/gacha-prizes/sync", async (req, res, next) => {
  try {
    requireAdmin(req);
    const sync = await gachaPrizeCatalog.syncPrizeItems(req.ctx.pool);
    const gachaPrizes = await gachaPrizeCatalog.listAdminPrizeItems(req.ctx.pool);
    res.json({ sync, gacha_prizes: gachaPrizes });
  } catch (error) {
    next(error);
  }
});

router.patch("/gacha-prizes/:id", async (req, res, next) => {
  try {
    requireAdmin(req);
    const { prize, prizes } = await gachaPrizeCatalog.updatePrizeItemAndList(req.ctx.pool, Number(req.params.id), {
      display_name: req.body?.display_name,
      description: req.body?.description,
      cosmetic_type: req.body?.cosmetic_type,
      rarity: req.body?.rarity,
      pull_weight: req.body?.pull_weight,
      is_active: req.body?.is_active,
      sort_order: req.body?.sort_order,
    });
    res.json({ gacha_prize: prize, gacha_prizes: prizes });
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
