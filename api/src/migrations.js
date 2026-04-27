const fs = require("node:fs");
const path = require("node:path");

async function applySchema(pool) {
  // Reuse the schema from the Go service so API and scraper stay aligned.
  const schemaPath = path.resolve(__dirname, "..", "..", "ytscraper", "internal", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS info
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS info.member_news (
      id BIGSERIAL PRIMARY KEY,
      headline TEXT NOT NULL,
      thumbnail_url TEXT NULL,
      date DATE NOT NULL
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS member_news_headline_date_uidx
      ON info.member_news (headline, date)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS member_news_date_desc_idx
      ON info.member_news (date DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS info.member_news_channels (
      news_id BIGINT NOT NULL REFERENCES info.member_news(id) ON DELETE CASCADE,
      youtube_channel_id TEXT NOT NULL REFERENCES yt.youtube_channels(youtube_channel_id) ON DELETE CASCADE,
      PRIMARY KEY (news_id, youtube_channel_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS member_news_channels_channel_idx
      ON info.member_news_channels (youtube_channel_id, news_id DESC)
  `);
  await pool.query(`
    ALTER TABLE market.users
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE market.users
      ADD COLUMN IF NOT EXISTS email TEXT NULL,
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS google_sub TEXT NULL
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS market_users_email_uidx
      ON market.users (lower(email))
      WHERE email IS NOT NULL
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS market_users_google_sub_uidx
      ON market.users (google_sub)
      WHERE google_sub IS NOT NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.user_email_verification_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_email_verification_tokens_user_idx
      ON market.user_email_verification_tokens (user_id, created_at DESC)
  `);
  await pool.query(`
    ALTER TABLE market.users
      ADD COLUMN IF NOT EXISTS can_create_prediction_markets BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS can_approve_prediction_markets BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS can_resolve_prediction_markets BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS can_void_prediction_markets BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE market.users
      ADD COLUMN IF NOT EXISTS bio TEXT NULL,
      ADD COLUMN IF NOT EXISTS profile_picture_url TEXT NULL,
      ADD COLUMN IF NOT EXISTS profile_color TEXT NULL,
      ADD COLUMN IF NOT EXISTS oshi_coin_asset_id BIGINT NULL REFERENCES market.market_assets(id) ON DELETE SET NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.emojis (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS market_emojis_filename_uidx
      ON market.emojis (filename)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.profile_pictures (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      filename_large TEXT NOT NULL,
      filename_small TEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS market_profile_pictures_large_uidx
      ON market.profile_pictures (filename_large)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS market_profile_pictures_small_uidx
      ON market.profile_pictures (filename_small)
  `);
  await pool.query(`
    ALTER TABLE market.users
      ADD COLUMN IF NOT EXISTS profile_picture_id BIGINT NULL REFERENCES market.profile_pictures(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE market.users
      DROP CONSTRAINT IF EXISTS users_bio_length_check
  `);
  await pool.query(`
    ALTER TABLE market.users
      ADD CONSTRAINT users_bio_length_check CHECK (bio IS NULL OR char_length(btrim(bio)) <= 1000)
  `);
  await pool.query(`
    ALTER TABLE market.users
      DROP CONSTRAINT IF EXISTS users_bio_length_check
  `);
  await pool.query(`
    ALTER TABLE market.users
      ADD CONSTRAINT users_bio_length_check CHECK (bio IS NULL OR char_length(btrim(bio)) <= 250)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.user_friendships (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      addressee_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      accepted_at TIMESTAMPTZ NULL,
      CONSTRAINT user_friendships_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'canceled')),
      CONSTRAINT user_friendships_distinct_users_check CHECK (requester_id <> addressee_id)
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS market_user_friendships_pair_uidx
      ON market.user_friendships (
        LEAST(requester_id, addressee_id),
        GREATEST(requester_id, addressee_id)
      )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_friendships_requester_status_idx
      ON market.user_friendships (requester_id, status, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_friendships_addressee_status_idx
      ON market.user_friendships (addressee_id, status, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.user_rivals (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      rival_user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, rival_user_id),
      CONSTRAINT user_rivals_distinct_users_check CHECK (user_id <> rival_user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_rivals_rival_idx
      ON market.user_rivals (rival_user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.user_networth_history (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      recorded_at TIMESTAMPTZ NOT NULL,
      cash_balance NUMERIC NOT NULL DEFAULT 0,
      total_market_value NUMERIC NOT NULL DEFAULT 0,
      total_equity NUMERIC NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, recorded_at)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_networth_history_user_recorded_desc_idx
      ON market.user_networth_history (user_id, recorded_at DESC)
  `);
  await pool.query(`
    SELECT create_hypertable('market.user_networth_history', 'recorded_at', if_not_exists => TRUE, migrate_data => TRUE)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.achievement_definitions (
      id BIGSERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      badge_icon TEXT NULL,
      badge_color TEXT NULL,
      reward_cash NUMERIC NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_backfill_enabled BOOLEAN NOT NULL DEFAULT true,
      trigger_events TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      rule_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT achievement_definitions_reward_nonnegative_check CHECK (reward_cash >= 0)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_achievement_definitions_active_idx
      ON market.achievement_definitions (is_active, key)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.user_achievements (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      achievement_definition_id BIGINT NOT NULL REFERENCES market.achievement_definitions(id) ON DELETE CASCADE,
      achievement_key TEXT NOT NULL,
      achievement_version INTEGER NOT NULL,
      earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reward_cash NUMERIC NOT NULL DEFAULT 0,
      source_event_type TEXT NOT NULL,
      source_event_id BIGINT NULL,
      evaluation_run_id BIGINT NULL,
      progress_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, achievement_key, achievement_version),
      CONSTRAINT user_achievements_reward_nonnegative_check CHECK (reward_cash >= 0)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_achievements_user_earned_desc_idx
      ON market.user_achievements (user_id, earned_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.user_trade_streaks (
      user_id BIGINT PRIMARY KEY REFERENCES market.users(id) ON DELETE CASCADE,
      current_streak_days INTEGER NOT NULL DEFAULT 0,
      longest_streak_days INTEGER NOT NULL DEFAULT 0,
      last_trade_day DATE NULL,
      last_trade_fill_id BIGINT NULL,
      streak_started_day DATE NULL,
      longest_streak_started_day DATE NULL,
      longest_streak_ended_day DATE NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT user_trade_streaks_current_nonnegative_check CHECK (current_streak_days >= 0),
      CONSTRAINT user_trade_streaks_longest_nonnegative_check CHECK (longest_streak_days >= 0)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.achievement_evaluation_runs (
      id BIGSERIAL PRIMARY KEY,
      run_type TEXT NOT NULL,
      trigger_event_type TEXT NOT NULL,
      trigger_event_id BIGINT NULL,
      target_user_id BIGINT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ NULL,
      error_text TEXT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_achievement_evaluation_runs_target_idx
      ON market.achievement_evaluation_runs (target_user_id, started_at DESC)
  `);
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS games
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.game_catalog (
      id BIGSERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      game_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      entry_fee_cash NUMERIC NOT NULL DEFAULT 0,
      min_stake_cash NUMERIC NULL,
      max_stake_cash NUMERIC NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      icon_key TEXT NULL,
      banner_key TEXT NULL,
      config_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_game_catalog_type_check CHECK (game_type IN ('single_player', 'gacha', 'pvp', 'idle')),
      CONSTRAINT games_game_catalog_status_check CHECK (status IN ('draft', 'active', 'disabled')),
      CONSTRAINT games_game_catalog_entry_fee_nonnegative_check CHECK (entry_fee_cash >= 0),
      CONSTRAINT games_game_catalog_min_stake_nonnegative_check CHECK (min_stake_cash IS NULL OR min_stake_cash >= 0),
      CONSTRAINT games_game_catalog_max_stake_nonnegative_check CHECK (max_stake_cash IS NULL OR max_stake_cash >= 0),
      CONSTRAINT games_game_catalog_stake_order_check CHECK (
        min_stake_cash IS NULL OR max_stake_cash IS NULL OR max_stake_cash >= min_stake_cash
      )
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_game_catalog_status_sort_idx
      ON games.game_catalog (status, sort_order ASC, id ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.game_sessions (
      id BIGSERIAL PRIMARY KEY,
      game_id BIGINT NOT NULL REFERENCES games.game_catalog(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'created',
      entry_fee_cash NUMERIC NOT NULL DEFAULT 0,
      payout_cash NUMERIC NOT NULL DEFAULT 0,
      seed TEXT NULL,
      score NUMERIC NULL,
      result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_game_sessions_status_check CHECK (status IN ('created', 'active', 'completed', 'cancelled', 'refunded')),
      CONSTRAINT games_game_sessions_entry_fee_nonnegative_check CHECK (entry_fee_cash >= 0),
      CONSTRAINT games_game_sessions_payout_nonnegative_check CHECK (payout_cash >= 0)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_game_sessions_user_created_idx
      ON games.game_sessions (user_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_game_sessions_game_created_idx
      ON games.game_sessions (game_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_game_sessions_status_created_idx
      ON games.game_sessions (status, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.user_cosmetics (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      cosmetic_key TEXT NOT NULL,
      cosmetic_type TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      source_type TEXT NOT NULL,
      source_reference_id BIGINT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_user_cosmetics_user_granted_idx
      ON games.user_cosmetics (user_id, granted_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.user_equipped_cosmetics (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      slot_key TEXT NOT NULL,
      user_cosmetic_id BIGINT NOT NULL REFERENCES games.user_cosmetics(id) ON DELETE CASCADE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, slot_key)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.gacha_pulls (
      id BIGSERIAL PRIMARY KEY,
      game_id BIGINT NOT NULL REFERENCES games.game_catalog(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      game_session_id BIGINT NULL REFERENCES games.game_sessions(id) ON DELETE SET NULL,
      cost_cash NUMERIC NOT NULL DEFAULT 0,
      rng_seed_hash TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_key TEXT NOT NULL,
      duplicate_compensation_cash NUMERIC NOT NULL DEFAULT 0,
      metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_gacha_pulls_cost_nonnegative_check CHECK (cost_cash >= 0),
      CONSTRAINT games_gacha_pulls_duplicate_comp_nonnegative_check CHECK (duplicate_compensation_cash >= 0)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_gacha_pulls_user_created_idx
      ON games.gacha_pulls (user_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.pvp_matches (
      id BIGSERIAL PRIMARY KEY,
      game_id BIGINT NOT NULL REFERENCES games.game_catalog(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      stake_cash NUMERIC NOT NULL DEFAULT 0,
      prize_pool_cash NUMERIC NOT NULL DEFAULT 0,
      result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_pvp_matches_status_check CHECK (status IN ('queued', 'active', 'completed', 'cancelled')),
      CONSTRAINT games_pvp_matches_stake_nonnegative_check CHECK (stake_cash >= 0),
      CONSTRAINT games_pvp_matches_prize_pool_nonnegative_check CHECK (prize_pool_cash >= 0)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_pvp_matches_status_created_idx
      ON games.pvp_matches (status, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.pvp_match_players (
      id BIGSERIAL PRIMARY KEY,
      match_id BIGINT NOT NULL REFERENCES games.pvp_matches(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'joined',
      outcome TEXT NULL,
      payout_cash NUMERIC NOT NULL DEFAULT 0,
      submitted_at TIMESTAMPTZ NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_pvp_match_players_status_check CHECK (status IN ('joined', 'submitted', 'forfeited', 'removed')),
      CONSTRAINT games_pvp_match_players_outcome_check CHECK (outcome IS NULL OR outcome IN ('win', 'loss', 'draw', 'forfeit')),
      CONSTRAINT games_pvp_match_players_payout_nonnegative_check CHECK (payout_cash >= 0),
      CONSTRAINT games_pvp_match_players_match_user_unique UNIQUE (match_id, user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_pvp_match_players_user_joined_idx
      ON games.pvp_match_players (user_id, joined_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_market_categories (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT prediction_market_categories_slug_check CHECK (char_length(btrim(slug)) BETWEEN 1 AND 80),
      CONSTRAINT prediction_market_categories_display_name_check CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_categories_active_sort_idx
      ON market.prediction_market_categories (is_active, sort_order ASC, id ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_markets (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      subtitle TEXT NULL,
      description TEXT NULL,
      rules_text TEXT NOT NULL,
      resolution_source_text TEXT NOT NULL,
      category_id BIGINT NULL REFERENCES market.prediction_market_categories(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      trading_status TEXT NOT NULL DEFAULT 'pending_open',
      visibility TEXT NOT NULL DEFAULT 'public',
      market_type TEXT NOT NULL DEFAULT 'binary',
      creator_user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE RESTRICT,
      approver_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      resolver_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      resolution_outcome TEXT NULL,
      resolution_notes TEXT NULL,
      featured_image_url TEXT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      opens_at TIMESTAMPTZ NOT NULL,
      closes_at TIMESTAMPTZ NOT NULL,
      resolves_after TIMESTAMPTZ NULL,
      approved_at TIMESTAMPTZ NULL,
      trading_opened_at TIMESTAMPTZ NULL,
      trading_closed_at TIMESTAMPTZ NULL,
      resolved_at TIMESTAMPTZ NULL,
      voided_at TIMESTAMPTZ NULL,
      last_traded_probability NUMERIC NULL,
      last_trade_at TIMESTAMPTZ NULL,
      total_volume_cash NUMERIC NOT NULL DEFAULT 0,
      open_interest_shares NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT prediction_markets_status_check CHECK (status IN ('draft', 'pending_approval', 'open', 'closed', 'resolving', 'resolved', 'voided', 'rejected')),
      CONSTRAINT prediction_markets_trading_status_check CHECK (trading_status IN ('pending_open', 'open', 'halted', 'closed', 'resolved', 'voided')),
      CONSTRAINT prediction_markets_visibility_check CHECK (visibility IN ('public', 'unlisted', 'private')),
      CONSTRAINT prediction_markets_market_type_check CHECK (market_type IN ('binary')),
      CONSTRAINT prediction_markets_resolution_outcome_check CHECK (resolution_outcome IS NULL OR resolution_outcome IN ('yes', 'no', 'void')),
      CONSTRAINT prediction_markets_slug_check CHECK (char_length(btrim(slug)) BETWEEN 1 AND 120),
      CONSTRAINT prediction_markets_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
      CONSTRAINT prediction_markets_rules_check CHECK (char_length(btrim(rules_text)) BETWEEN 1 AND 10000),
      CONSTRAINT prediction_markets_resolution_source_check CHECK (char_length(btrim(resolution_source_text)) BETWEEN 1 AND 5000),
      CONSTRAINT prediction_markets_time_order_check CHECK (closes_at > opens_at),
      CONSTRAINT prediction_markets_resolves_after_check CHECK (resolves_after IS NULL OR resolves_after >= closes_at),
      CONSTRAINT prediction_markets_probability_bounds_check CHECK (
        last_traded_probability IS NULL OR (last_traded_probability >= 0.01 AND last_traded_probability <= 0.99)
      )
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_markets_status_opens_idx
      ON market.prediction_markets (status, opens_at ASC, id ASC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_markets_status_closes_idx
      ON market.prediction_markets (status, closes_at ASC, id ASC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_markets_creator_created_idx
      ON market.prediction_markets (creator_user_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_market_outcomes (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      outcome_code TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_winner BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT prediction_market_outcomes_code_check CHECK (outcome_code IN ('yes', 'no')),
      CONSTRAINT prediction_market_outcomes_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
      UNIQUE (market_id, outcome_code),
      UNIQUE (market_id, sort_order)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_outcomes_market_idx
      ON market.prediction_market_outcomes (market_id, sort_order ASC, id ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_market_orders (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      outcome_id BIGINT NOT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      side TEXT NOT NULL,
      order_type TEXT NOT NULL DEFAULT 'limit',
      time_in_force TEXT NOT NULL DEFAULT 'gtc',
      funding_type TEXT NOT NULL DEFAULT 'cash',
      price NUMERIC NOT NULL,
      original_quantity NUMERIC NOT NULL,
      open_quantity NUMERIC NOT NULL,
      matched_quantity NUMERIC NOT NULL DEFAULT 0,
      cash_reserved NUMERIC NOT NULL DEFAULT 0,
      coin_collateral_reserved NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      cancelled_at TIMESTAMPTZ NULL,
      expires_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT prediction_market_orders_side_check CHECK (side IN ('buy', 'sell')),
      CONSTRAINT prediction_market_orders_type_check CHECK (order_type IN ('limit')),
      CONSTRAINT prediction_market_orders_tif_check CHECK (time_in_force IN ('gtc')),
      CONSTRAINT prediction_market_orders_funding_check CHECK (funding_type IN ('cash', 'cash_and_collateral')),
      CONSTRAINT prediction_market_orders_status_check CHECK (status IN ('open', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired')),
      CONSTRAINT prediction_market_orders_price_check CHECK (price >= 0.01 AND price <= 0.99),
      CONSTRAINT prediction_market_orders_original_qty_check CHECK (original_quantity > 0),
      CONSTRAINT prediction_market_orders_open_qty_check CHECK (open_quantity >= 0),
      CONSTRAINT prediction_market_orders_matched_qty_check CHECK (matched_quantity >= 0),
      CONSTRAINT prediction_market_orders_cash_reserved_check CHECK (cash_reserved >= 0),
      CONSTRAINT prediction_market_orders_coin_reserved_check CHECK (coin_collateral_reserved >= 0)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_orders_book_idx
      ON market.prediction_market_orders (market_id, outcome_id, status, price DESC, created_at ASC, id ASC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_orders_user_idx
      ON market.prediction_market_orders (user_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_market_trades (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      outcome_id BIGINT NOT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE CASCADE,
      trade_kind TEXT NOT NULL DEFAULT 'secondary',
      maker_order_id BIGINT NULL REFERENCES market.prediction_market_orders(id) ON DELETE SET NULL,
      taker_order_id BIGINT NULL REFERENCES market.prediction_market_orders(id) ON DELETE SET NULL,
      maker_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      taker_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      maker_outcome_id BIGINT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE SET NULL,
      taker_outcome_id BIGINT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE SET NULL,
      maker_side TEXT NULL,
      taker_side TEXT NULL,
      buy_order_id BIGINT NULL REFERENCES market.prediction_market_orders(id) ON DELETE SET NULL,
      sell_order_id BIGINT NULL REFERENCES market.prediction_market_orders(id) ON DELETE SET NULL,
      buy_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      sell_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      price NUMERIC NOT NULL,
      quantity NUMERIC NOT NULL,
      notional_cash NUMERIC NOT NULL,
      fee_cash_buy NUMERIC NOT NULL DEFAULT 0,
      fee_cash_sell NUMERIC NOT NULL DEFAULT 0,
      matched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT prediction_market_trades_kind_check CHECK (trade_kind IN ('secondary', 'mint', 'redeem')),
      CONSTRAINT prediction_market_trades_maker_side_check CHECK (maker_side IS NULL OR maker_side IN ('buy', 'sell')),
      CONSTRAINT prediction_market_trades_taker_side_check CHECK (taker_side IS NULL OR taker_side IN ('buy', 'sell')),
      CONSTRAINT prediction_market_trades_price_check CHECK (price >= 0.01 AND price <= 0.99),
      CONSTRAINT prediction_market_trades_quantity_check CHECK (quantity > 0),
      CONSTRAINT prediction_market_trades_notional_check CHECK (notional_cash >= 0),
      CONSTRAINT prediction_market_trades_fee_buy_check CHECK (fee_cash_buy >= 0),
      CONSTRAINT prediction_market_trades_fee_sell_check CHECK (fee_cash_sell >= 0),
      CONSTRAINT prediction_market_trades_user_distinct_check CHECK (
        buy_user_id IS NULL OR sell_user_id IS NULL OR buy_user_id <> sell_user_id
      )
    )
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      ADD COLUMN IF NOT EXISTS trade_kind TEXT NOT NULL DEFAULT 'secondary',
      ADD COLUMN IF NOT EXISTS maker_order_id BIGINT NULL REFERENCES market.prediction_market_orders(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS taker_order_id BIGINT NULL REFERENCES market.prediction_market_orders(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS maker_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS taker_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS maker_outcome_id BIGINT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS taker_outcome_id BIGINT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS maker_side TEXT NULL,
      ADD COLUMN IF NOT EXISTS taker_side TEXT NULL
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      ALTER COLUMN buy_user_id DROP NOT NULL,
      ALTER COLUMN sell_user_id DROP NOT NULL
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      DROP CONSTRAINT IF EXISTS prediction_market_trades_kind_check
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      ADD CONSTRAINT prediction_market_trades_kind_check CHECK (trade_kind IN ('secondary', 'mint', 'redeem'))
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      DROP CONSTRAINT IF EXISTS prediction_market_trades_maker_side_check
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      ADD CONSTRAINT prediction_market_trades_maker_side_check CHECK (maker_side IS NULL OR maker_side IN ('buy', 'sell'))
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      DROP CONSTRAINT IF EXISTS prediction_market_trades_taker_side_check
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      ADD CONSTRAINT prediction_market_trades_taker_side_check CHECK (taker_side IS NULL OR taker_side IN ('buy', 'sell'))
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      DROP CONSTRAINT IF EXISTS prediction_market_trades_user_distinct_check
  `);
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      ADD CONSTRAINT prediction_market_trades_user_distinct_check CHECK (
        buy_user_id IS NULL OR sell_user_id IS NULL OR buy_user_id <> sell_user_id
      )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_trades_market_matched_idx
      ON market.prediction_market_trades (market_id, matched_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_trades_user_matched_idx
      ON market.prediction_market_trades (buy_user_id, matched_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_trades_counterparty_matched_idx
      ON market.prediction_market_trades (sell_user_id, matched_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_market_positions (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      outcome_id BIGINT NOT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE CASCADE,
      shares NUMERIC NOT NULL DEFAULT 0,
      avg_entry_price NUMERIC NOT NULL DEFAULT 0,
      realized_pnl_cash NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, market_id, outcome_id),
      CONSTRAINT prediction_market_positions_shares_check CHECK (shares >= 0),
      CONSTRAINT prediction_market_positions_avg_entry_check CHECK (avg_entry_price >= 0 AND avg_entry_price <= 0.99),
      CONSTRAINT prediction_market_positions_realized_pnl_check CHECK (realized_pnl_cash = realized_pnl_cash)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_positions_market_idx
      ON market.prediction_market_positions (market_id, outcome_id, shares DESC, user_id ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_market_price_history (
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      outcome_id BIGINT NOT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE CASCADE,
      bucket_interval TEXT NOT NULL,
      bucket_ts TIMESTAMPTZ NOT NULL,
      open NUMERIC NULL,
      high NUMERIC NULL,
      low NUMERIC NULL,
      close NUMERIC NULL,
      last NUMERIC NULL,
      volume_shares NUMERIC NOT NULL DEFAULT 0,
      volume_cash NUMERIC NOT NULL DEFAULT 0,
      trade_count INTEGER NOT NULL DEFAULT 0,
      best_bid NUMERIC NULL,
      best_ask NUMERIC NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (market_id, outcome_id, bucket_interval, bucket_ts),
      CONSTRAINT prediction_market_price_history_interval_check CHECK (bucket_interval IN ('1m', '5m', '1h', '1d')),
      CONSTRAINT prediction_market_price_history_trade_count_check CHECK (trade_count >= 0),
      CONSTRAINT prediction_market_price_history_volume_shares_check CHECK (volume_shares >= 0),
      CONSTRAINT prediction_market_price_history_volume_cash_check CHECK (volume_cash >= 0)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_price_history_lookup_idx
      ON market.prediction_market_price_history (market_id, outcome_id, bucket_interval, bucket_ts DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_market_events (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      actor_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      event_data JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT prediction_market_events_type_check CHECK (
        event_type IN (
          'market_created',
          'market_updated',
          'submitted_for_approval',
          'market_approved',
          'market_rejected',
          'market_opened',
          'market_closed',
          'resolution_proposed',
          'market_resolved',
          'market_voided',
          'order_placed',
          'order_cancelled',
          'trade_matched'
        )
      )
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS prediction_market_events_market_created_idx
      ON market.prediction_market_events (market_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.prediction_market_comments (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT content_prediction_market_comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_prediction_market_comments_market_idx
      ON content.prediction_market_comments (market_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_prediction_market_comments_author_idx
      ON content.prediction_market_comments (author_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.user_leaderboard_current (
      user_id BIGINT PRIMARY KEY REFERENCES market.users(id) ON DELETE CASCADE,
      username_snapshot TEXT NOT NULL,
      profile_picture_url TEXT NULL,
      profile_color TEXT NULL,
      cash_balance NUMERIC NOT NULL DEFAULT 0,
      holdings_market_value NUMERIC NOT NULL DEFAULT 0,
      total_unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
      total_equity NUMERIC NOT NULL DEFAULT 0,
      daily_change_abs NUMERIC NOT NULL DEFAULT 0,
      daily_change_pct NUMERIC NULL,
      weekly_change_abs NUMERIC NOT NULL DEFAULT 0,
      weekly_change_pct NUMERIC NULL,
      largest_position_asset_id BIGINT NULL REFERENCES market.market_assets(id) ON DELETE SET NULL,
      largest_position_symbol TEXT NULL,
      largest_position_value NUMERIC NULL,
      best_asset_id BIGINT NULL REFERENCES market.market_assets(id) ON DELETE SET NULL,
      best_asset_symbol TEXT NULL,
      best_asset_unrealized_pnl NUMERIC NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_leaderboard_current_equity_idx
      ON market.user_leaderboard_current (total_equity DESC, user_id ASC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_leaderboard_current_daily_change_idx
      ON market.user_leaderboard_current (daily_change_pct DESC NULLS LAST, user_id ASC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS market_user_leaderboard_current_updated_idx
      ON market.user_leaderboard_current (updated_at DESC)
  `);
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS content
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.articles (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      news_id BIGINT NULL UNIQUE REFERENCES info.member_news(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subtitle TEXT NULL,
      tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      thumbnail_url TEXT NULL,
      content TEXT NOT NULL DEFAULT '',
      author_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      likes INTEGER NOT NULL DEFAULT 0,
      saves INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      is_news BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'published',
      published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT content_articles_status_check CHECK (status IN ('draft', 'published'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_articles_published_idx
      ON content.articles (status, published_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_articles_author_idx
      ON content.articles (author_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_articles_is_news_idx
      ON content.articles (is_news, published_at DESC, id DESC)
  `);
  await pool.query(`
    ALTER TABLE content.articles
      ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.article_assets (
      article_id BIGINT NOT NULL REFERENCES content.articles(id) ON DELETE CASCADE,
      asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
      PRIMARY KEY (article_id, asset_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_article_assets_asset_idx
      ON content.article_assets (asset_id, article_id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.article_comments (
      id BIGSERIAL PRIMARY KEY,
      article_id BIGINT NOT NULL REFERENCES content.articles(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      mood TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT content_article_comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
      CONSTRAINT content_article_comments_mood_check CHECK (
        mood IS NULL
        OR mood IN (
          'Bullish',
          'Bearish',
          'Neutral',
          'Hodling',
          'Dump Eet',
          'He Bought?',
          'He Sold?',
          'Diamond Hands',
          'Watching',
          'Accumulating'
        )
      )
    )
  `);
  await pool.query(`
    ALTER TABLE content.article_comments
    ADD COLUMN IF NOT EXISTS mood TEXT
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'content_article_comments_mood_check'
      ) THEN
        ALTER TABLE content.article_comments
        ADD CONSTRAINT content_article_comments_mood_check CHECK (
          mood IS NULL
          OR mood IN (
            'Bullish',
            'Bearish',
            'Neutral',
            'Hodling',
            'Dump Eet',
            'He Bought?',
            'He Sold?',
            'Diamond Hands',
            'Watching',
            'Accumulating'
          )
        );
      END IF;
    END
    $$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_article_comments_article_idx
      ON content.article_comments (article_id, created_at ASC, id ASC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.asset_comments (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      mood TEXT,
      upvotes INTEGER NOT NULL DEFAULT 0,
      downvotes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT content_asset_comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
      CONSTRAINT content_asset_comments_vote_counts_check CHECK (upvotes >= 0 AND downvotes >= 0),
      CONSTRAINT content_asset_comments_mood_check CHECK (
        mood IS NULL
        OR mood IN (
          'Bullish',
          'Bearish',
          'Neutral',
          'Hodling',
          'Dump Eet',
          'He Bought?',
          'He Sold?',
          'Diamond Hands',
          'Watching',
          'Accumulating'
        )
      )
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_asset_comments_asset_idx
      ON content.asset_comments (asset_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_asset_comments_author_idx
      ON content.asset_comments (author_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.asset_comment_votes (
      comment_id BIGINT NOT NULL REFERENCES content.asset_comments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      value SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (comment_id, user_id),
      CONSTRAINT content_asset_comment_votes_value_check CHECK (value IN (-1, 1))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_asset_comment_votes_user_idx
      ON content.asset_comment_votes (user_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.article_likes (
      article_id BIGINT NOT NULL REFERENCES content.articles(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (article_id, user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_article_likes_user_idx
      ON content.article_likes (user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.article_saves (
      article_id BIGINT NOT NULL REFERENCES content.articles(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (article_id, user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_article_saves_user_idx
      ON content.article_saves (user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.news_article_proposals (
      id BIGSERIAL PRIMARY KEY,
      article_id BIGINT NOT NULL REFERENCES content.articles(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      title TEXT NULL,
      subtitle TEXT NULL,
      tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      thumbnail_url TEXT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT content_news_article_proposals_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
      CONSTRAINT content_news_article_proposals_content_check CHECK (char_length(btrim(content)) BETWEEN 1 AND 20000)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_news_article_proposals_article_idx
      ON content.news_article_proposals (article_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content.news_article_proposal_votes (
      proposal_id BIGINT NOT NULL REFERENCES content.news_article_proposals(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      value SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (proposal_id, user_id),
      CONSTRAINT content_news_article_proposal_votes_value_check CHECK (value IN (-1, 1))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_news_article_proposal_votes_user_idx
      ON content.news_article_proposal_votes (user_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_news_article_proposal_votes_proposal_idx
      ON content.news_article_proposal_votes (proposal_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS chat
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.channels (
      id BIGSERIAL PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NULL,
      posting_policy TEXT NOT NULL DEFAULT 'authenticated',
      is_active BOOLEAN NOT NULL DEFAULT true,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chat_channels_scope_type_check CHECK (scope_type IN ('asset', 'unit', 'market', 'meta')),
      CONSTRAINT chat_channels_posting_policy_check CHECK (posting_policy IN ('authenticated', 'admins_only', 'read_only'))
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_scope_uidx
      ON chat.channels (scope_type, scope_key)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_channels_scope_type_idx
      ON chat.channels (scope_type, is_active, display_name)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.messages (
      id BIGSERIAL PRIMARY KEY,
      channel_id BIGINT NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      reply_to_message_id BIGINT NULL REFERENCES chat.messages(id) ON DELETE SET NULL,
      edited_at TIMESTAMPTZ NULL,
      moderated_by BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      moderated_reason TEXT NULL,
      moderated_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chat_messages_status_check CHECK (status IN ('active', 'deleted', 'moderated')),
      CONSTRAINT chat_messages_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_messages_channel_message_idx
      ON chat.messages (channel_id, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_messages_author_created_idx
      ON chat.messages (author_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.user_channel_state (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      channel_id BIGINT NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
      last_read_message_id BIGINT NULL REFERENCES chat.messages(id) ON DELETE SET NULL,
      followed BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, channel_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_user_channel_state_channel_idx
      ON chat.user_channel_state (channel_id, updated_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.user_moderation_actions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      channel_id BIGINT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      reason TEXT NULL,
      created_by BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NULL,
      revoked_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chat_user_moderation_action_type_check CHECK (action_type IN ('mute', 'ban'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_user_moderation_actions_active_idx
      ON chat.user_moderation_actions (user_id, channel_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.message_reports (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
      reporter_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      reviewed_by BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chat_message_reports_status_check CHECK (status IN ('open', 'resolved', 'dismissed'))
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS chat_message_reports_message_reporter_uidx
      ON chat.message_reports (message_id, reporter_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_message_reports_status_idx
      ON chat.message_reports (status, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat.archived_messages (
      id BIGINT PRIMARY KEY,
      channel_id BIGINT NOT NULL REFERENCES chat.channels(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      reply_to_message_id BIGINT NULL,
      edited_at TIMESTAMPTZ NULL,
      moderated_by BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      moderated_reason TEXT NULL,
      moderated_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chat_archived_messages_status_check CHECK (status IN ('active', 'deleted', 'moderated'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_archived_messages_channel_message_idx
      ON chat.archived_messages (channel_id, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chat_archived_messages_channel_created_idx
      ON chat.archived_messages (channel_id, created_at DESC)
  `);
  await pool.query(`
    ALTER TABLE market.market_assets
      ADD COLUMN IF NOT EXISTS current_persistent_offset NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS current_transient_offset NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS offsets_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);
  await pool.query(`
    ALTER TABLE market.asset_daily_market_state
      ADD COLUMN IF NOT EXISTS mid_close_mark NUMERIC NULL
  `);
  await pool.query(`
    ALTER TABLE market.channel_daily_snapshots
      ALTER COLUMN video_count DROP NOT NULL
  `);
  await pool.query(`
    ALTER TABLE market.market_settlement_runs
      ADD COLUMN IF NOT EXISTS source_market_date DATE NULL
  `);
  await pool.query(`
    UPDATE market.market_settlement_runs
    SET source_market_date = market_date
    WHERE source_market_date IS NULL
  `);
}

module.exports = { applySchema };
