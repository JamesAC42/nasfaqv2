const express = require("express");
const gachaPrizeCatalog = require("../services/games/gachaPrizeCatalog");
const mediaCatalog = require("../services/mediaCatalog");
const { requireAdmin, requireAssetManager } = require("../userContext");

const router = express.Router();

// Max upload sizes for asset managers
const MAX_EMOJI_FILE_SIZE_BYTES = 200 * 1024; // 200 KB — 64x64 JPEG icons
const MAX_PROFILE_PICTURE_FILE_SIZE_BYTES = 500 * 1024; // 500 KB — 256px or 128px JPEG

function validateFileSize(bytes, maxBytes, label) {
  if (bytes.byteLength > maxBytes) {
    const error = new Error(`${label} exceeds the maximum file size of ${Math.round(maxBytes / 1024)} KB. Emojis should be small 64x64 square JPEGs under 200 KB. Profile pictures should be square JPEGs at 256x256 (large) / 128x128 (small) under 500 KB.`);
    error.code = "invalid_admin_asset";
    throw error;
  }
}

// ── Asset Manager Role Management (admin only) ──────────────────────────

router.get("/asset-managers", async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rows } = await req.ctx.pool.query(
      `SELECT id, username, created_at
       FROM market.users
       WHERE can_manage_assets = true
       ORDER BY username ASC`
    );
    res.json({ users: rows });
  } catch (error) {
    next(error);
  }
});

router.get("/search-users", async (req, res, next) => {
  try {
    requireAdmin(req);
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }
    const { rows } = await req.ctx.pool.query(
      `SELECT id, username, is_admin, can_manage_assets, created_at
       FROM market.users
       WHERE username_normalized LIKE $1
       ORDER BY username ASC
       LIMIT 20`,
      [`%${q.toLowerCase()}%`]
    );
    res.json({ users: rows });
  } catch (error) {
    next(error);
  }
});

router.patch("/asset-managers/:userId", async (req, res, next) => {
  try {
    requireAdmin(req);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "invalid_user_id" });
    }

    const canManageAssets = Boolean(req.body?.can_manage_assets);

    const { rows } = await req.ctx.pool.query(
      `UPDATE market.users
       SET can_manage_assets = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING id, username, is_admin, can_manage_assets`,
      [userId, canManageAssets]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "user_not_found" });
    }

    res.json({ user: rows[0] });
  } catch (error) {
    next(error);
  }
});

// ── Asset Upload / Management ──────────────────────────────────────────

router.get("/", async (req, res, next) => {
  try {
    // Admins see everything; asset managers see only emojis + profile pics
    const [emojis, profilePictures] = await Promise.all([
      mediaCatalog.listAdminEmojis(req.ctx.pool),
      mediaCatalog.listAdminProfilePictures(req.ctx.pool),
    ]);

    const response = {
      emojis,
      profile_pictures: profilePictures,
    };

    if (req.ctx?.user?.is_admin) {
      const gachaPrizes = await gachaPrizeCatalog.listAdminPrizeItems(req.ctx.pool);
      response.gacha_prizes = gachaPrizes;
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post("/emojis", async (req, res, next) => {
  try {
    requireAssetManager(req);
    const decoded = mediaCatalog.decodeDataUrl(req.body?.image_data_url);
    if (decoded) {
      validateFileSize(decoded.bytes, MAX_EMOJI_FILE_SIZE_BYTES, "Emoji image");
    }
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
    requireAssetManager(req);
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
    requireAssetManager(req);
    const decodedLarge = mediaCatalog.decodeDataUrl(req.body?.image_large_data_url);
    const decodedSmall = mediaCatalog.decodeDataUrl(req.body?.image_small_data_url);
    if (decodedLarge) {
      validateFileSize(decodedLarge.bytes, MAX_PROFILE_PICTURE_FILE_SIZE_BYTES, "Large profile picture");
    }
    if (decodedSmall) {
      validateFileSize(decodedSmall.bytes, MAX_PROFILE_PICTURE_FILE_SIZE_BYTES, "Small profile picture");
    }
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
    requireAssetManager(req);
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
