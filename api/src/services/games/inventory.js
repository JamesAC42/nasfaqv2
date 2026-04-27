const { getLockedCashAccountWithClient } = require("./wallet");
const gachaPrizeCatalog = require("./gachaPrizeCatalog");

function invalidGameInventory(code = "invalid_game_inventory") {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeSlotKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9:_-]{1,64}$/.test(normalized)) {
    throw invalidGameInventory();
  }
  return normalized;
}

function normalizeCosmeticId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw invalidGameInventory();
  }
  return parsed;
}

function mapCosmeticRow(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    cosmetic_key: row.cosmetic_key,
    cosmetic_type: row.cosmetic_type,
    rarity: row.rarity,
    source_type: row.source_type,
    source_reference_id: row.source_reference_id === null ? null : Number(row.source_reference_id),
    metadata: row.metadata_json || {},
    granted_at: row.granted_at,
  };
}

function mapEquippedRow(row) {
  return {
    slot_key: row.slot_key,
    cosmetic: {
      id: Number(row.id),
      cosmetic_key: row.cosmetic_key,
      cosmetic_type: row.cosmetic_type,
      rarity: row.rarity,
      source_type: row.source_type,
      source_reference_id: row.source_reference_id === null ? null : Number(row.source_reference_id),
      metadata: row.metadata_json || {},
      granted_at: row.granted_at,
    },
    updated_at: row.updated_at,
  };
}

function mapLockerPullRow(row) {
  const metadata = row.metadata_json || {};
  const prizeImageUrl = row.prize_image_key ? gachaPrizeCatalog.imageUrlForKey(row.prize_image_key) : "";
  return {
    id: Number(row.id),
    game_id: Number(row.game_id),
    game_session_id: row.game_session_id === null ? null : Number(row.game_session_id),
    cost_cash: Number(row.cost_cash || 0),
    reward_type: row.prize_cosmetic_type || row.reward_type,
    reward_key: row.reward_key,
    duplicate_compensation_cash: Number(row.duplicate_compensation_cash || 0),
    metadata,
    created_at: row.created_at,
    reward: {
      key: row.reward_key,
      type: row.prize_cosmetic_type || row.reward_type,
      rarity: String(row.prize_rarity || metadata.rarity || "common"),
      display_name: String(row.prize_display_name || metadata.display_name || row.reward_key),
      image_key: row.prize_image_key ? String(row.prize_image_key) : metadata.image_key ? String(metadata.image_key) : "",
      image_url: prizeImageUrl || (metadata.image_url ? String(metadata.image_url) : ""),
      duplicate: Boolean(metadata.duplicate),
    },
  };
}

async function grantCosmeticWithClient(client, {
  userId,
  cosmeticKey,
  cosmeticType,
  rarity = "common",
  sourceType,
  sourceReferenceId = null,
  metadata = {},
}) {
  const safeCosmeticKey = String(cosmeticKey || "").trim();
  const safeCosmeticType = String(cosmeticType || "").trim();
  const safeRarity = String(rarity || "").trim() || "common";
  const safeSourceType = String(sourceType || "").trim();
  const safeSourceReferenceId = sourceReferenceId === null ? null : Number(sourceReferenceId);

  if (!safeCosmeticKey || !safeCosmeticType || !safeSourceType) {
    throw invalidGameInventory();
  }
  if (safeSourceReferenceId !== null && (!Number.isInteger(safeSourceReferenceId) || safeSourceReferenceId < 0)) {
    throw invalidGameInventory();
  }

  const { rows } = await client.query(
    `
    INSERT INTO games.user_cosmetics (
      user_id,
      cosmetic_key,
      cosmetic_type,
      rarity,
      source_type,
      source_reference_id,
      metadata_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id, user_id, cosmetic_key, cosmetic_type, rarity, source_type, source_reference_id, metadata_json, granted_at
  `,
    [
      userId,
      safeCosmeticKey,
      safeCosmeticType,
      safeRarity,
      safeSourceType,
      safeSourceReferenceId,
      JSON.stringify(metadata || {}),
    ]
  );

  return mapCosmeticRow(rows[0]);
}

async function getUserCosmeticByIdWithClient(client, userId, userCosmeticId) {
  const safeCosmeticId = normalizeCosmeticId(userCosmeticId);
  const { rows } = await client.query(
    `
    SELECT
      id,
      user_id,
      cosmetic_key,
      cosmetic_type,
      rarity,
      source_type,
      source_reference_id,
      metadata_json,
      granted_at
    FROM games.user_cosmetics
    WHERE id = $1
      AND user_id = $2
    LIMIT 1
    FOR UPDATE
  `,
    [safeCosmeticId, userId]
  );
  return rows[0] ? mapCosmeticRow(rows[0]) : null;
}

async function listUserInventory(pool, userId) {
  const [cosmeticsResult, equippedResult] = await Promise.all([
    pool.query(
      `
      SELECT
        id,
        user_id,
        cosmetic_key,
        cosmetic_type,
        rarity,
        source_type,
        source_reference_id,
        metadata_json,
        granted_at
      FROM games.user_cosmetics
      WHERE user_id = $1
      ORDER BY granted_at DESC, id DESC
    `,
      [userId]
    ),
    pool.query(
      `
      SELECT
        ec.slot_key,
        ec.updated_at,
        uc.id,
        uc.cosmetic_key,
        uc.cosmetic_type,
        uc.rarity,
        uc.source_type,
        uc.source_reference_id,
        uc.metadata_json,
        uc.granted_at
      FROM games.user_equipped_cosmetics ec
      JOIN games.user_cosmetics uc
        ON uc.id = ec.user_cosmetic_id
      WHERE ec.user_id = $1
      ORDER BY ec.slot_key ASC
    `,
      [userId]
    ),
  ]);

  const cosmetics = cosmeticsResult.rows.map(mapCosmeticRow);
  const equipped = equippedResult.rows.map(mapEquippedRow);
  const countsByType = cosmetics.reduce((acc, cosmetic) => {
    acc[cosmetic.cosmetic_type] = (acc[cosmetic.cosmetic_type] || 0) + 1;
    return acc;
  }, {});

  return {
    user_id: Number(userId),
    cosmetics,
    equipped,
    summary: {
      total_cosmetics: cosmetics.length,
      counts_by_type: countsByType,
    },
  };
}

async function listUserItemLocker(pool, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      gp.id,
      gp.game_id,
      gp.game_session_id,
      gp.cost_cash,
      gp.reward_type,
      gp.reward_key,
      gp.duplicate_compensation_cash,
      gp.metadata_json,
      gp.created_at,
      gpi.display_name AS prize_display_name,
      gpi.cosmetic_type AS prize_cosmetic_type,
      gpi.rarity AS prize_rarity,
      gpi.image_key AS prize_image_key
    FROM games.gacha_pulls gp
    LEFT JOIN games.gacha_prize_items gpi
      ON gpi.cosmetic_key = gp.reward_key
    WHERE gp.user_id = $1
    ORDER BY gp.created_at DESC, gp.id DESC
  `,
    [userId]
  );

  const items = rows.map(mapLockerPullRow);
  return {
    user_id: Number(userId),
    items,
    summary: {
      total_items: items.length,
      counts_by_type: items.reduce((acc, item) => {
        acc[item.reward_type] = (acc[item.reward_type] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

async function equipUserCosmetic(pool, userId, {
  slotKey,
  userCosmeticId,
}) {
  const safeSlotKey = normalizeSlotKey(slotKey);
  const safeCosmeticId = normalizeCosmeticId(userCosmeticId);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const cosmetic = await getUserCosmeticByIdWithClient(client, userId, safeCosmeticId);
    if (!cosmetic) {
      const error = new Error("cosmetic_not_found");
      error.code = "cosmetic_not_found";
      throw error;
    }

    await client.query(
      `
      INSERT INTO games.user_equipped_cosmetics (
        user_id,
        slot_key,
        user_cosmetic_id,
        updated_at
      ) VALUES ($1,$2,$3,now())
      ON CONFLICT (user_id, slot_key)
      DO UPDATE SET
        user_cosmetic_id = EXCLUDED.user_cosmetic_id,
        updated_at = now()
    `,
      [userId, safeSlotKey, cosmetic.id]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return listUserInventory(pool, userId);
}

async function getGamesSummary(pool, userId, { recentSessionLimit = 10 } = {}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const cashAccount = await getLockedCashAccountWithClient(client, userId);
    const [sessionResult, inventoryCountResult, equippedResult] = await Promise.all([
      client.query(
        `
        SELECT
          gs.id,
          gs.game_id,
          gc.key AS game_key,
          gc.name AS game_name,
          gc.game_type,
          gs.status,
          gs.entry_fee_cash,
          gs.payout_cash,
          gs.score,
          gs.started_at,
          gs.completed_at,
          gs.created_at
        FROM games.game_sessions gs
        JOIN games.game_catalog gc
          ON gc.id = gs.game_id
        WHERE gs.user_id = $1
        ORDER BY gs.created_at DESC, gs.id DESC
        LIMIT $2
      `,
        [userId, recentSessionLimit]
      ),
      client.query(
        `
        SELECT
          cosmetic_type,
          COUNT(*)::int AS item_count
        FROM games.user_cosmetics
        WHERE user_id = $1
        GROUP BY cosmetic_type
        ORDER BY cosmetic_type ASC
      `,
        [userId]
      ),
      client.query(
        `
        SELECT
          ec.slot_key,
          ec.updated_at,
          uc.id,
          uc.cosmetic_key,
          uc.cosmetic_type,
          uc.rarity,
          uc.source_type,
          uc.source_reference_id,
          uc.metadata_json,
          uc.granted_at
        FROM games.user_equipped_cosmetics ec
        JOIN games.user_cosmetics uc
          ON uc.id = ec.user_cosmetic_id
        WHERE ec.user_id = $1
        ORDER BY ec.slot_key ASC
      `,
        [userId]
      ),
    ]);

    await client.query("COMMIT");

    return {
      user_id: Number(userId),
      cash_balance: cashAccount.cash_balance,
      inventory: {
        total_cosmetics: inventoryCountResult.rows.reduce((sum, row) => sum + Number(row.item_count || 0), 0),
        counts_by_type: Object.fromEntries(
          inventoryCountResult.rows.map((row) => [row.cosmetic_type, Number(row.item_count || 0)])
        ),
        equipped: equippedResult.rows.map(mapEquippedRow),
      },
      recent_sessions: sessionResult.rows.map((row) => ({
        id: Number(row.id),
        game_id: Number(row.game_id),
        game_key: row.game_key,
        game_name: row.game_name,
        game_type: row.game_type,
        status: row.status,
        entry_fee_cash: Number(row.entry_fee_cash || 0),
        payout_cash: Number(row.payout_cash || 0),
        score: row.score === null ? null : Number(row.score),
        started_at: row.started_at,
        completed_at: row.completed_at,
        created_at: row.created_at,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  equipUserCosmetic,
  getGamesSummary,
  grantCosmeticWithClient,
  listUserInventory,
  listUserItemLocker,
};
