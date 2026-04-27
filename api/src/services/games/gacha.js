const crypto = require("node:crypto");
const gamesCatalog = require("./catalog");
const gachaPrizeCatalog = require("./gachaPrizeCatalog");
const gamesInventory = require("./inventory");
const gamesWallet = require("./wallet");

function invalidGameGacha(code = "invalid_game_gacha") {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizePullCount(value) {
  const parsed = Number.parseInt(String(value ?? 1), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw invalidGameGacha();
  }
  return parsed;
}

function randomUnitInterval() {
  const buffer = crypto.randomBytes(8);
  const int = buffer.readBigUInt64BE(0);
  return Number(int) / Number(2n ** 64n);
}

function hashSeed(seed) {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function chooseReward(pool) {
  const totalWeight = pool.reduce((sum, item) => sum + Number(item.pull_weight || item.weight || 0), 0);
  if (!(totalWeight > 0)) {
    throw invalidGameGacha();
  }

  const roll = randomUnitInterval() * totalWeight;
  let cursor = 0;
  for (const item of pool) {
    cursor += Number(item.pull_weight || item.weight || 0);
    if (roll < cursor) {
      return item;
    }
  }
  return pool[pool.length - 1];
}

async function createGachaSessionWithClient(client, { gameId, userId, entryFeeCash }) {
  const { rows } = await client.query(
    `
    INSERT INTO games.game_sessions (
      game_id,
      user_id,
      status,
      entry_fee_cash,
      payout_cash,
      started_at,
      created_at
    ) VALUES ($1,$2,'active',$3,0,now(),now())
    RETURNING id, created_at
  `,
    [gameId, userId, entryFeeCash]
  );
  return rows[0];
}

async function findExistingCosmeticWithClient(client, userId, cosmeticKey) {
  const { rows } = await client.query(
    `
    SELECT id
    FROM games.user_cosmetics
    WHERE user_id = $1
      AND cosmetic_key = $2
    ORDER BY granted_at DESC, id DESC
    LIMIT 1
  `,
    [userId, cosmeticKey]
  );
  return rows[0] || null;
}

async function insertGachaPullWithClient(client, {
  gameId,
  userId,
  gameSessionId,
  costCash,
  rngSeedHash,
  rewardType,
  rewardKey,
  duplicateCompensationCash,
  metadata,
}) {
  const { rows } = await client.query(
    `
    INSERT INTO games.gacha_pulls (
      game_id,
      user_id,
      game_session_id,
      cost_cash,
      rng_seed_hash,
      reward_type,
      reward_key,
      duplicate_compensation_cash,
      metadata_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id, created_at
  `,
    [
      gameId,
      userId,
      gameSessionId,
      costCash,
      rngSeedHash,
      rewardType,
      rewardKey,
      duplicateCompensationCash,
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0];
}

async function completeSessionWithClient(client, sessionId, {
  payoutCash,
  result,
}) {
  await client.query(
    `
    UPDATE games.game_sessions
    SET
      status = 'completed',
      payout_cash = $2,
      result_json = $3,
      completed_at = now()
    WHERE id = $1
  `,
    [sessionId, payoutCash, JSON.stringify(result || {})]
  );
}

async function pullCapsuleGacha(pool, {
  userId,
  count = 1,
}) {
  const safeCount = normalizePullCount(count);
  if (safeCount !== 1) {
    throw invalidGameGacha();
  }

  const game = await gamesCatalog.getGameByKey(pool, "capsule-gacha");
  if (!game) {
    const error = new Error("game_not_found");
    error.code = "game_not_found";
    throw error;
  }
  if (game.game_type !== "gacha") {
    throw invalidGameGacha();
  }

  const pullCostCash = Number(game.config_json?.pull_cost_cash ?? game.entry_fee_cash ?? 0);
  const duplicateCompensationCash = Number(game.config_json?.duplicate_compensation_cash ?? 0);
  if (!(pullCostCash > 0) || duplicateCompensationCash < 0) {
    throw invalidGameGacha();
  }

  const rewardPool = await gachaPrizeCatalog.listActivePrizePool(pool, { gameKey: game.key });
  if (!rewardPool.length) {
    const error = new Error("gacha_prize_pool_empty");
    error.code = "gacha_prize_pool_empty";
    throw error;
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const session = await createGachaSessionWithClient(client, {
      gameId: game.id,
      userId,
      entryFeeCash: pullCostCash,
    });

    const debitResult = await gamesWallet.debitCashForGameWithClient(client, {
      userId,
      amount: pullCostCash,
      entryType: "gacha_pull_fee",
      referenceType: "game_session",
      referenceId: Number(session.id),
    });

    const rngSeed = crypto.randomBytes(32).toString("base64url");
    const reward = chooseReward(rewardPool);
    const existingCosmetic = await findExistingCosmeticWithClient(client, userId, reward.cosmetic_key);
    const isDuplicate = Boolean(existingCosmetic);
    const compensationCash = isDuplicate ? duplicateCompensationCash : 0;

    let grantedCosmetic = null;
    if (!isDuplicate) {
      grantedCosmetic = await gamesInventory.grantCosmeticWithClient(client, {
        userId,
        cosmeticKey: reward.cosmetic_key,
        cosmeticType: reward.cosmetic_type,
        rarity: reward.rarity,
        sourceType: "gacha",
        sourceReferenceId: Number(session.id),
        metadata: {
          display_name: reward.display_name,
          description: reward.description,
          slot_key: reward.slot_key,
          image_key: reward.image_key,
          image_url: reward.image_url,
          ...(reward.metadata || {}),
        },
      });
    }

    const pullRow = await insertGachaPullWithClient(client, {
      gameId: game.id,
      userId,
      gameSessionId: Number(session.id),
      costCash: pullCostCash,
      rngSeedHash: hashSeed(rngSeed),
      rewardType: reward.cosmetic_type,
      rewardKey: reward.cosmetic_key,
      duplicateCompensationCash: compensationCash,
      metadata: {
        game_key: game.key,
        rarity: reward.rarity,
        display_name: reward.display_name,
        image_key: reward.image_key,
        image_url: reward.image_url,
        duplicate: isDuplicate,
      },
    });

    let creditResult = null;
    if (compensationCash > 0) {
      creditResult = await gamesWallet.creditCashForGameWithClient(client, {
        userId,
        amount: compensationCash,
        entryType: "gacha_duplicate_compensation",
        referenceType: "gacha_pull",
        referenceId: Number(pullRow.id),
      });
    }

    await completeSessionWithClient(client, Number(session.id), {
      payoutCash: compensationCash,
      result: {
        type: "gacha_pull",
        reward_key: reward.cosmetic_key,
        reward_type: reward.cosmetic_type,
        rarity: reward.rarity,
        duplicate: isDuplicate,
        compensation_cash: compensationCash,
      },
    });

    await client.query("COMMIT");

    return {
      game: gamesCatalog.toPublicGame(game),
      session: {
        id: Number(session.id),
        entry_fee_cash: pullCostCash,
        payout_cash: compensationCash,
        created_at: session.created_at,
      },
      wallet: {
        debited_cash: pullCostCash,
        duplicate_compensation_cash: compensationCash,
        cash_balance_after: creditResult?.cash_balance ?? debitResult.cash_balance,
      },
      pull: {
        id: Number(pullRow.id),
        created_at: pullRow.created_at,
        reward: {
          key: reward.cosmetic_key,
          type: reward.cosmetic_type,
          rarity: reward.rarity,
          display_name: reward.display_name,
          slot_key: reward.slot_key,
          description: reward.description,
          image_key: reward.image_key,
          image_url: reward.image_url,
          metadata: reward.metadata || {},
        },
        duplicate: isDuplicate,
        granted_cosmetic: grantedCosmetic,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pullCapsuleGacha,
};
