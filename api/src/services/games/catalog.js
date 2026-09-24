// See docs/games/GAMES_DESIGN.md for the rules and numbers behind each entry.
const GAME_DEFINITIONS = [
  {
    key: "talent-cards",
    name: "Talent Cards",
    description: "Pull talent cards from C to UR, build your collection and bring your best five to the duel.",
    game_type: "gacha",
    status: "active",
    entry_fee_cash: 100,
    min_stake_cash: null,
    max_stake_cash: null,
    sort_order: 5,
    icon_key: "cards",
    banner_key: "talent-cards",
    config_json: {
      pull_cost_cash: 100,
      ten_pull_cost_cash: 900,
    },
  },
  {
    key: "capsule-gacha",
    name: "Capsule Gacha",
    description: "Hats, frames and chat flair. Cosmetic pulls that show up next to your name across the site.",
    game_type: "gacha",
    status: "active",
    entry_fee_cash: 50,
    min_stake_cash: null,
    max_stake_cash: null,
    sort_order: 10,
    icon_key: "capsule",
    banner_key: "capsule-gacha-season-1",
    config_json: {
      pull_cost_cash: 50,
      ten_pull_cost_cash: 450,
      reward_mode: "cosmetic_only",
      duplicate_compensation_cash: 0,
      featured_banner: "season-1",
    },
  },
  {
    key: "oshi-duel",
    name: "Oshi Card Duel",
    description: "Two players, five cards each, market conditions every round. Stake cash and play live, or watch.",
    game_type: "pvp",
    status: "active",
    entry_fee_cash: 0,
    min_stake_cash: 0,
    max_stake_cash: 5000,
    sort_order: 15,
    icon_key: "duel",
    banner_key: "oshi-duel",
    config_json: {
      rake_bps: 500,
      max_players: 2,
      deck_size: 5,
      wins_needed: 3,
      pick_seconds: 20,
      open_table_minutes: 10,
    },
  },
  {
    key: "blackjack",
    name: "Blackjack",
    description: "Up to five seats against the house dealer. Blackjack pays 3:2.",
    game_type: "table",
    status: "active",
    entry_fee_cash: 0,
    min_stake_cash: 10,
    max_stake_cash: 10000,
    sort_order: 18,
    icon_key: "blackjack",
    banner_key: "blackjack",
    config_json: {
      seats: 5,
      decks: 6,
      bet_seconds: 15,
      turn_seconds: 15,
    },
  },
  {
    key: "high-low",
    name: "High-Low Duel",
    description: "Call the next card higher or lower against another player. Nine rounds, one double down.",
    game_type: "pvp",
    status: "active",
    entry_fee_cash: 0,
    min_stake_cash: 0,
    max_stake_cash: 5000,
    sort_order: 19,
    icon_key: "highlow",
    banner_key: "high-low",
    config_json: {
      rake_bps: 500,
      max_players: 2,
      rounds: 9,
      call_seconds: 10,
      open_table_minutes: 10,
    },
  },
  {
    key: "ticker-tap",
    name: "Ticker Tap",
    description: "Tap the green tickers, dodge the red, chase the gold. The week's top ten split the prize pool.",
    game_type: "single_player",
    status: "active",
    entry_fee_cash: 100,
    min_stake_cash: null,
    max_stake_cash: null,
    sort_order: 20,
    icon_key: "ticker",
    banner_key: "ticker-tap-launch",
    config_json: {
      run_duration_seconds: 45,
      payout_mode: "weekly_pool",
      pool_share_bps: 9000,
      leaderboard_window: "weekly",
    },
  },
  {
    key: "prediction-duel",
    name: "Prediction Duel",
    description: "A head-to-head async contest where two players stake cash and compete for the pool.",
    game_type: "pvp",
    status: "disabled",
    entry_fee_cash: 0,
    min_stake_cash: 100,
    max_stake_cash: 1000,
    sort_order: 30,
    icon_key: "duel",
    banner_key: "prediction-duel-foundation",
    config_json: {
      mode: "asynchronous",
      rake_bps: 500,
      max_players: 2,
    },
  },
];

function cloneDefinition(definition) {
  return {
    ...definition,
    config_json: { ...(definition.config_json || {}) },
  };
}

function mapCatalogRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    key: row.key,
    name: row.name,
    description: row.description || "",
    game_type: row.game_type,
    status: row.status,
    entry_fee_cash: Number(row.entry_fee_cash || 0),
    min_stake_cash: row.min_stake_cash === null ? null : Number(row.min_stake_cash),
    max_stake_cash: row.max_stake_cash === null ? null : Number(row.max_stake_cash),
    sort_order: Number(row.sort_order || 0),
    icon_key: row.icon_key || null,
    banner_key: row.banner_key || null,
    config_json: row.config_json || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toPublicGame(game) {
  if (!game) return null;
  return {
    id: game.id,
    key: game.key,
    name: game.name,
    description: game.description,
    game_type: game.game_type,
    status: game.status,
    entry_fee_cash: game.entry_fee_cash,
    min_stake_cash: game.min_stake_cash,
    max_stake_cash: game.max_stake_cash,
    sort_order: game.sort_order,
    icon_key: game.icon_key,
    banner_key: game.banner_key,
    config: game.config_json || {},
  };
}

function listDefinitions() {
  return GAME_DEFINITIONS.map(cloneDefinition);
}

async function syncCatalog(pool) {
  const definitions = listDefinitions();
  if (definitions.length === 0) return [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const definition of definitions) {
      await client.query(
        `
        INSERT INTO games.game_catalog (
          key,
          name,
          description,
          game_type,
          status,
          entry_fee_cash,
          min_stake_cash,
          max_stake_cash,
          sort_order,
          icon_key,
          banner_key,
          config_json,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
        ON CONFLICT (key)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          game_type = EXCLUDED.game_type,
          status = EXCLUDED.status,
          entry_fee_cash = EXCLUDED.entry_fee_cash,
          min_stake_cash = EXCLUDED.min_stake_cash,
          max_stake_cash = EXCLUDED.max_stake_cash,
          sort_order = EXCLUDED.sort_order,
          icon_key = EXCLUDED.icon_key,
          banner_key = EXCLUDED.banner_key,
          config_json = EXCLUDED.config_json,
          updated_at = now()
      `,
        [
          definition.key,
          definition.name,
          definition.description,
          definition.game_type,
          definition.status,
          definition.entry_fee_cash,
          definition.min_stake_cash,
          definition.max_stake_cash,
          definition.sort_order,
          definition.icon_key,
          definition.banner_key,
          JSON.stringify(definition.config_json || {}),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return listActiveGames(pool, { includeDrafts: true });
}

async function listActiveGames(pool, { includeDrafts = false } = {}) {
  const statuses = includeDrafts ? ["active", "draft"] : ["active"];
  const { rows } = await pool.query(
    `
    SELECT
      id,
      key,
      name,
      description,
      game_type,
      status,
      entry_fee_cash,
      min_stake_cash,
      max_stake_cash,
      sort_order,
      icon_key,
      banner_key,
      config_json,
      created_at,
      updated_at
    FROM games.game_catalog
    WHERE status = ANY($1::text[])
    ORDER BY sort_order ASC, id ASC
  `,
    [statuses]
  );

  return rows.map(mapCatalogRow);
}

async function getGameByKey(pool, key, { includeDrafts = false } = {}) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  if (!normalizedKey) return null;

  const statuses = includeDrafts ? ["active", "draft"] : ["active"];
  const { rows } = await pool.query(
    `
    SELECT
      id,
      key,
      name,
      description,
      game_type,
      status,
      entry_fee_cash,
      min_stake_cash,
      max_stake_cash,
      sort_order,
      icon_key,
      banner_key,
      config_json,
      created_at,
      updated_at
    FROM games.game_catalog
    WHERE key = $1
      AND status = ANY($2::text[])
    LIMIT 1
  `,
    [normalizedKey, statuses]
  );

  return mapCatalogRow(rows[0] || null);
}

module.exports = {
  getGameByKey,
  listActiveGames,
  listDefinitions,
  syncCatalog,
  toPublicGame,
};
