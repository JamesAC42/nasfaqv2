const path = require("node:path");
const mediaCatalog = require("../mediaCatalog");

const GACHA_GAME_KEY = "capsule-gacha";
const GACHA_PRIZE_PREFIX = "gachaprizes/";
const GACHA_PRIZE_CDN_BASE_URL = "https://images.nasfaq.biz/gachaprizes";

const IMAGE_EXTENSION_RE = /\.(avif|gif|jpe?g|png|webp)$/i;
const RARITY_WEIGHTS = {
  common: 32,
  rare: 12,
  epic: 4,
  legendary: 1,
};

function optionalTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeSlug(value) {
  const base = optionalTrimmedString(value);
  if (!base) return null;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || null;
}

function humanizeSlug(value) {
  const slug = normalizeSlug(value);
  if (!slug) return "Gacha Prize";
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function imageUrlForKey(imageKey) {
  const relative = String(imageKey || "").startsWith(GACHA_PRIZE_PREFIX)
    ? String(imageKey).slice(GACHA_PRIZE_PREFIX.length)
    : String(imageKey || "");
  return `${GACHA_PRIZE_CDN_BASE_URL}/${relative.split("/").map(encodeURIComponent).join("/")}`;
}

function inferRarity(slug) {
  const normalized = String(slug || "").toLowerCase();
  if (normalized.includes("legendary")) return "legendary";
  if (normalized.includes("epic")) return "epic";
  if (normalized.includes("rare")) return "rare";
  return "common";
}

function inferCosmeticType(slug) {
  const normalized = String(slug || "").toLowerCase();
  if (normalized.includes("frame")) return "profile_frame";
  if (normalized.includes("theme")) return "portfolio_theme";
  if (normalized.includes("flair")) return "chat_flair";
  if (normalized.includes("hat")) return "hat";
  if (normalized.includes("item")) return "item";
  return "profile_badge";
}

function slotKeyForType(cosmeticType) {
  if (cosmeticType === "profile_frame") return "profile_frame";
  if (cosmeticType === "portfolio_theme") return "portfolio_theme";
  if (cosmeticType === "chat_flair") return "chat_flair";
  if (cosmeticType === "hat") return "hat";
  if (cosmeticType === "item") return "item";
  return "profile_badge";
}

function parsePrizeKey(key) {
  if (!String(key || "").startsWith(GACHA_PRIZE_PREFIX)) return null;
  if (!IMAGE_EXTENSION_RE.test(key)) return null;
  const filename = path.basename(key);
  const slug = normalizeSlug(path.basename(filename, path.extname(filename)));
  const keySlug = normalizeSlug(String(key).slice(GACHA_PRIZE_PREFIX.length).replace(IMAGE_EXTENSION_RE, ""));
  if (!slug) return null;
  const rarity = inferRarity(slug);
  const cosmeticType = inferCosmeticType(slug);
  return {
    slug,
    filename,
    imageKey: key,
    displayName: humanizeSlug(slug),
    cosmeticKey: `gacha-${keySlug || slug}`,
    cosmeticType,
    rarity,
    slotKey: slotKeyForType(cosmeticType),
    pullWeight: RARITY_WEIGHTS[rarity] || RARITY_WEIGHTS.common,
  };
}

function invalidGachaPrize(code = "invalid_gacha_prize") {
  const error = new Error(code);
  error.code = code;
  return error;
}

function toPrizeRow(row, totalWeight = null) {
  const pullWeight = Number(row.pull_weight || 0);
  return {
    id: Number(row.id),
    game_key: row.game_key,
    key: row.cosmetic_key,
    cosmetic_key: row.cosmetic_key,
    type: row.cosmetic_type,
    cosmetic_type: row.cosmetic_type,
    rarity: row.rarity,
    display_name: row.display_name,
    description: row.description || "",
    slot_key: row.slot_key || null,
    weight: pullWeight,
    pull_weight: pullWeight,
    pull_chance: totalWeight && totalWeight > 0 ? pullWeight / totalWeight : 0,
    image_key: row.image_key,
    filename: row.filename,
    image_url: imageUrlForKey(row.image_key),
    metadata: row.metadata_json || {},
    is_active: Boolean(row.is_active),
    is_deleted: Boolean(row.is_deleted),
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function syncPrizeItems(pool, { gameKey = GACHA_GAME_KEY } = {}) {
  if (!mediaCatalog.isS3Configured()) {
    const error = new Error("s3_not_configured");
    error.code = "s3_not_configured";
    throw error;
  }

  const parsed = (await mediaCatalog.listObjectKeys(GACHA_PRIZE_PREFIX))
    .map(parsePrizeKey)
    .filter(Boolean)
    .sort((a, b) => a.imageKey.localeCompare(b.imageKey));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seenKeys = parsed.map((item) => item.imageKey);

    for (const item of parsed) {
      await client.query(
        `
        INSERT INTO games.gacha_prize_items (
          game_key,
          cosmetic_key,
          display_name,
          description,
          cosmetic_type,
          rarity,
          slot_key,
          pull_weight,
          image_key,
          filename,
          metadata_json,
          is_active,
          is_deleted,
          updated_at
        ) VALUES ($1,$2,$3,'',$4,$5,$6,$7,$8,$9,'{}'::jsonb,true,false,now())
        ON CONFLICT (game_key, image_key)
        DO UPDATE SET
          filename = EXCLUDED.filename,
          is_deleted = false,
          updated_at = now()
      `,
        [
          gameKey,
          item.cosmeticKey,
          item.displayName,
          item.cosmeticType,
          item.rarity,
          item.slotKey,
          item.pullWeight,
          item.imageKey,
          item.filename,
        ]
      );
    }

    await client.query(
      `
      UPDATE games.gacha_prize_items
      SET is_deleted = true,
          updated_at = now()
      WHERE game_key = $1
        AND NOT (image_key = ANY($2::text[]))
    `,
      [gameKey, seenKeys]
    );

    await client.query("COMMIT");
    return { total: parsed.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listAdminPrizeItems(pool, { gameKey = GACHA_GAME_KEY } = {}) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM games.gacha_prize_items
    WHERE game_key = $1
    ORDER BY is_deleted ASC, is_active DESC, sort_order ASC, lower(display_name) ASC, id ASC
  `,
    [gameKey]
  );
  const totalWeight = rows
    .filter((row) => row.is_active && !row.is_deleted)
    .reduce((sum, row) => sum + Number(row.pull_weight || 0), 0);
  return rows.map((row) => toPrizeRow(row, totalWeight));
}

async function listActivePrizePool(pool, { gameKey = GACHA_GAME_KEY } = {}) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM games.gacha_prize_items
    WHERE game_key = $1
      AND is_active = true
      AND is_deleted = false
      AND pull_weight > 0
    ORDER BY sort_order ASC, id ASC
  `,
    [gameKey]
  );
  const totalWeight = rows.reduce((sum, row) => sum + Number(row.pull_weight || 0), 0);
  return rows.map((row) => toPrizeRow(row, totalWeight));
}

async function updatePrizeItem(pool, prizeId, payload) {
  const displayName = optionalTrimmedString(payload.display_name ?? payload.name);
  const description = optionalTrimmedString(payload.description) || "";
  const cosmeticType = optionalTrimmedString(payload.cosmetic_type) || "profile_badge";
  const rarity = optionalTrimmedString(payload.rarity) || "common";
  const slotKey = slotKeyForType(cosmeticType);
  const pullWeight = Number(payload.pull_weight ?? payload.weight);
  const isActive = typeof payload.is_active === "boolean" ? payload.is_active : null;
  const sortOrder = Number.parseInt(String(payload.sort_order ?? 0), 10);

  if (!displayName || !Number.isFinite(pullWeight) || pullWeight < 0 || !Number.isFinite(sortOrder)) {
    throw invalidGachaPrize();
  }

  const { rows } = await pool.query(
    `
    UPDATE games.gacha_prize_items
    SET display_name = $2,
        description = $3,
        cosmetic_type = $4,
        rarity = $5,
        slot_key = $6,
        pull_weight = $7,
        is_active = COALESCE($8, is_active),
        sort_order = $9,
        updated_at = now()
    WHERE id = $1
    RETURNING *
  `,
    [prizeId, displayName, description, cosmeticType, rarity, slotKey, pullWeight, isActive, sortOrder]
  );

  if (!rows[0]) {
    const error = new Error("gacha_prize_not_found");
    error.code = "gacha_prize_not_found";
    throw error;
  }

  return toPrizeRow(rows[0]);
}

async function updatePrizeItemAndList(pool, prizeId, payload) {
  await updatePrizeItem(pool, prizeId, payload);
  const prizes = await listAdminPrizeItems(pool);
  return {
    prize: prizes.find((item) => item.id === Number(prizeId)) || null,
    prizes,
  };
}

module.exports = {
  GACHA_GAME_KEY,
  imageUrlForKey,
  listActivePrizePool,
  listAdminPrizeItems,
  syncPrizeItems,
  updatePrizeItemAndList,
  updatePrizeItem,
};
