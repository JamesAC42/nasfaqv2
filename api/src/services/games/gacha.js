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

// Capsule pity (docs/games/GAMES_DESIGN.md §2): every 10th pull is epic or better, pull 60 is legendary.
const CAPSULE_RARITIES = ["common", "rare", "epic", "legendary"];
const CAPSULE_HIGH_EVERY = 10;
const CAPSULE_HARD_PITY = 60;
const CAPSULE_DUP_SHARDS = { common: 3, rare: 10, epic: 40, legendary: 150 };

function rollCapsuleReward(rewardPool, pity) {
  const byRarity = new Map(CAPSULE_RARITIES.map((rarity) => [rarity, rewardPool.filter((item) => item.rarity === rarity)]));
  const weightOf = (items) => items.reduce((sum, item) => sum + Number(item.pull_weight || item.weight || 0), 0);
  let allowed = CAPSULE_RARITIES.filter((rarity) => byRarity.get(rarity).length);
  if (pity.sinceTop + 1 >= CAPSULE_HARD_PITY && byRarity.get("legendary").length) allowed = ["legendary"];
  else if (pity.sinceHigh + 1 >= CAPSULE_HIGH_EVERY) {
    const high = allowed.filter((rarity) => rarity === "epic" || rarity === "legendary");
    if (high.length) allowed = high;
  }
  return chooseReward(allowed.flatMap((rarity) => byRarity.get(rarity)).filter((item) => weightOf([item]) > 0));
}

function advanceCapsulePity(pity, rarity) {
  const next = { ...pity, total: pity.total + 1 };
  if (rarity === "legendary") return { ...next, sinceTop: 0, sinceHigh: 0 };
  if (rarity === "epic") return { ...next, sinceTop: next.sinceTop + 1, sinceHigh: 0 };
  return { ...next, sinceTop: next.sinceTop + 1, sinceHigh: next.sinceHigh + 1 };
}

async function pullCapsuleGacha(pool, {
  userId,
  count = 1,
}) {
  const safeCount = Number(count) === 10 ? 10 : Number(count) === 1 ? 1 : null;
  if (!safeCount) {
    throw invalidGameGacha("invalid_pull_count");
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

  const pullCostCash = Number(
    safeCount === 10
      ? game.config_json?.ten_pull_cost_cash ?? 450
      : game.config_json?.pull_cost_cash ?? game.entry_fee_cash ?? 0
  );
  if (!(pullCostCash > 0)) {
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

    // Required lazily: cardGacha requires this module's siblings, not this one.
    const cardGacha = require("./cardGacha");
    await client.query(
      `INSERT INTO games.gacha_pity (user_id, pool_key) VALUES ($1, 'capsule') ON CONFLICT (user_id, pool_key) DO NOTHING`,
      [userId]
    );
    const pityRow = await client.query(
      `SELECT pulls_since_high, pulls_since_top, total_pulls FROM games.gacha_pity WHERE user_id = $1 AND pool_key = 'capsule' FOR UPDATE`,
      [userId]
    );
    let pity = {
      sinceHigh: Number(pityRow.rows[0].pulls_since_high),
      sinceTop: Number(pityRow.rows[0].pulls_since_top),
      total: Number(pityRow.rows[0].total_pulls),
    };

    const pulls = [];
    let shardsTotal = 0;
    for (let index = 0; index < safeCount; index += 1) {
      const rngSeed = crypto.randomBytes(32).toString("base64url");
      const reward = rollCapsuleReward(rewardPool, pity);
      pity = advanceCapsulePity(pity, reward.rarity);
      const existingCosmetic = await findExistingCosmeticWithClient(client, userId, reward.cosmetic_key);
      const isDuplicate = Boolean(existingCosmetic);
      const shards = isDuplicate ? CAPSULE_DUP_SHARDS[reward.rarity] ?? 0 : 0;
      shardsTotal += shards;

      // Duplicates convert to shards instead of stacking copies.
      const grantedCosmetic = isDuplicate
        ? null
        : await gamesInventory.grantCosmeticWithClient(client, {
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

      const pullRow = await insertGachaPullWithClient(client, {
        gameId: game.id,
        userId,
        gameSessionId: Number(session.id),
        costCash: pullCostCash / safeCount,
        rngSeedHash: hashSeed(rngSeed),
        rewardType: reward.cosmetic_type,
        rewardKey: reward.cosmetic_key,
        duplicateCompensationCash: 0,
        metadata: {
          game_key: game.key,
          rarity: reward.rarity,
          display_name: reward.display_name,
          image_key: reward.image_key,
          image_url: reward.image_url,
          pull_chance: reward.pull_chance,
          duplicate: isDuplicate,
          shards,
        },
      });

      pulls.push({
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
          pull_chance: reward.pull_chance,
          metadata: reward.metadata || {},
        },
        duplicate: isDuplicate,
        shards,
        granted_cosmetic: grantedCosmetic,
      });
    }

    await client.query(
      `UPDATE games.gacha_pity SET pulls_since_high = $2, pulls_since_top = $3, total_pulls = $4, updated_at = now() WHERE user_id = $1 AND pool_key = 'capsule'`,
      [userId, pity.sinceHigh, pity.sinceTop, pity.total]
    );
    const shardBalance = await cardGacha.changeShardsWithClient(client, userId, shardsTotal, "capsule_duplicate", "game_session", Number(session.id));

    await completeSessionWithClient(client, Number(session.id), {
      payoutCash: 0,
      result: {
        type: "gacha_pull",
        count: safeCount,
        rewards: pulls.map((pull) => ({ key: pull.reward.key, rarity: pull.reward.rarity, duplicate: pull.duplicate })),
        shards: shardsTotal,
      },
    });

    await client.query("COMMIT");

    return {
      game: gamesCatalog.toPublicGame(game),
      session: {
        id: Number(session.id),
        entry_fee_cash: pullCostCash,
        payout_cash: 0,
        created_at: session.created_at,
      },
      wallet: {
        debited_cash: pullCostCash,
        duplicate_compensation_cash: 0,
        cash_balance_after: debitResult.cash_balance,
      },
      shards: shardBalance,
      shards_awarded: shardsTotal,
      pity: {
        pulls_since_epic: pity.sinceHigh,
        pulls_since_legendary: pity.sinceTop,
        epic_guaranteed_in: Math.max(1, CAPSULE_HIGH_EVERY - pity.sinceHigh),
        legendary_guaranteed_in: Math.max(1, CAPSULE_HARD_PITY - pity.sinceTop),
      },
      pulls,
      pull: pulls[0],
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
