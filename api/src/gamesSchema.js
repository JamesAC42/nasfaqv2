// Games v2 schema: talent cards, card gacha banners and pity, shards, sets, showcase,
// multiplayer tables, blackjack rounds and the Ticker Tap weekly pool.
// See docs/games/GAMES_DESIGN.md. Every statement is idempotent.

async function applyGamesSchema(pool) {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS games`);

  // ── Cards ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.user_cards (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      card_key TEXT NOT NULL,
      asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
      rarity TEXT NOT NULL,
      stars SMALLINT NOT NULL DEFAULT 1,
      copies INTEGER NOT NULL DEFAULT 1,
      first_source TEXT NOT NULL,
      first_obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_user_cards_rarity_check CHECK (rarity IN ('C', 'R', 'SR', 'SSR', 'UR')),
      CONSTRAINT games_user_cards_stars_check CHECK (stars BETWEEN 1 AND 5),
      CONSTRAINT games_user_cards_copies_check CHECK (copies >= 1),
      CONSTRAINT games_user_cards_user_card_unique UNIQUE (user_id, card_key)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_user_cards_user_idx ON games.user_cards (user_id, rarity)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.user_currencies (
      user_id BIGINT PRIMARY KEY REFERENCES market.users(id) ON DELETE CASCADE,
      shards BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_user_currencies_shards_check CHECK (shards >= 0)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.shard_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      delta BIGINT NOT NULL,
      reason TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_shard_ledger_user_idx ON games.shard_ledger (user_id, created_at DESC)
  `);

  // Admin-scheduled featured banners. With none active, a featured talent rotates weekly.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.card_banners (
      id BIGSERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      featured_asset_id BIGINT NULL REFERENCES market.market_assets(id) ON DELETE SET NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_card_banners_window_check CHECK (ends_at > starts_at)
    )
  `);

  // Pity counters per user per pool ('standard', 'featured', 'capsule').
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.gacha_pity (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      pool_key TEXT NOT NULL,
      pulls_since_high INTEGER NOT NULL DEFAULT 0,
      pulls_since_top INTEGER NOT NULL DEFAULT 0,
      featured_guaranteed BOOLEAN NOT NULL DEFAULT false,
      total_pulls INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, pool_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.card_pulls (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      batch_id UUID NOT NULL,
      banner_key TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      cost_cash NUMERIC NOT NULL DEFAULT 0,
      card_key TEXT NOT NULL,
      asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
      rarity TEXT NOT NULL,
      was_featured BOOLEAN NOT NULL DEFAULT false,
      was_new BOOLEAN NOT NULL DEFAULT false,
      stars_after SMALLINT NOT NULL,
      shards_awarded BIGINT NOT NULL DEFAULT 0,
      pity_before INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_card_pulls_user_idx ON games.card_pulls (user_id, created_at DESC, id DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_card_pulls_top_idx ON games.card_pulls (rarity, created_at DESC) WHERE rarity IN ('SSR', 'UR')
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.user_card_showcase (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      slot SMALLINT NOT NULL,
      card_key TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, slot),
      CONSTRAINT games_user_card_showcase_slot_check CHECK (slot BETWEEN 1 AND 5)
    )
  `);

  // One row per claimed reward: unit sets, the starter pack.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.user_reward_claims (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      reward_key TEXT NOT NULL,
      reward_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, reward_key)
    )
  `);

  // ── Multiplayer tables (duel, high-low) ─────────────────────────────────
  await pool.query(`
    ALTER TABLE games.pvp_matches
      ADD COLUMN IF NOT EXISTS host_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      ADD COLUMN IF NOT EXISTS state_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      ADD COLUMN IF NOT EXISTS rake_cash NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS winner_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);
  await pool.query(`
    ALTER TABLE games.pvp_match_players
      ADD COLUMN IF NOT EXISTS seat SMALLINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS stake_cash NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS deck_json JSONB NOT NULL DEFAULT '[]'::JSONB
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_pvp_matches_game_status_idx ON games.pvp_matches (game_id, status, created_at DESC)
  `);

  // ── Blackjack ────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.blackjack_rounds (
      id BIGSERIAL PRIMARY KEY,
      table_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'betting',
      dealer_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      seats_json JSONB NOT NULL DEFAULT '[]'::JSONB,
      total_bet_cash NUMERIC NOT NULL DEFAULT 0,
      total_payout_cash NUMERIC NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at TIMESTAMPTZ NULL,
      CONSTRAINT games_blackjack_rounds_status_check CHECK (status IN ('betting', 'playing', 'settled', 'refunded'))
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.blackjack_bets (
      id BIGSERIAL PRIMARY KEY,
      round_id BIGINT NOT NULL REFERENCES games.blackjack_rounds(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      seat SMALLINT NOT NULL,
      bet_cash NUMERIC NOT NULL,
      doubled BOOLEAN NOT NULL DEFAULT false,
      outcome TEXT NULL,
      payout_cash NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_blackjack_bets_round_seat_unique UNIQUE (round_id, seat),
      CONSTRAINT games_blackjack_bets_outcome_check CHECK (outcome IS NULL OR outcome IN ('blackjack', 'win', 'push', 'loss', 'bust', 'refund'))
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS games_blackjack_bets_user_idx ON games.blackjack_bets (user_id, created_at DESC)
  `);

  // ── Ticker Tap weekly pool ───────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.weekly_prize_payouts (
      game_key TEXT NOT NULL,
      week_start DATE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      rank SMALLINT NOT NULL,
      score NUMERIC NOT NULL,
      payout_cash NUMERIC NOT NULL,
      pool_cash NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (game_key, week_start, rank)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.weekly_prize_settlements (
      game_key TEXT NOT NULL,
      week_start DATE NOT NULL,
      pool_cash NUMERIC NOT NULL,
      winners INTEGER NOT NULL,
      settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (game_key, week_start)
    )
  `);

  // ── Card exchange (docs/games/GAMES_DESIGN.md §Card exchange) ────────────
  // Starter-pack copies are bound to the account: `copies - bound_copies` can be traded.
  await pool.query(`ALTER TABLE games.user_cards ADD COLUMN IF NOT EXISTS bound_copies INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`
    UPDATE games.user_cards SET bound_copies = 1
    WHERE first_source = 'starter' AND bound_copies = 0
  `);
  await pool.query(`ALTER TABLE games.user_cards DROP CONSTRAINT IF EXISTS games_user_cards_bound_check`);
  await pool.query(`
    ALTER TABLE games.user_cards
      ADD CONSTRAINT games_user_cards_bound_check CHECK (bound_copies >= 0 AND bound_copies <= copies)
  `);

  // One copy per listing: a fixed price (buy now) or an auction (optional buy now). The copy sits
  // in escrow here while the listing is active; bids hold the bidder's cash.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.card_listings (
      id BIGSERIAL PRIMARY KEY,
      seller_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      card_key TEXT NOT NULL,
      asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
      rarity TEXT NOT NULL,
      stars_at_listing SMALLINT NOT NULL DEFAULT 1,
      kind TEXT NOT NULL,
      price NUMERIC(18,2) NULL,
      start_price NUMERIC(18,2) NULL,
      current_bid NUMERIC(18,2) NULL,
      current_bidder_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      bid_count INTEGER NOT NULL DEFAULT 0,
      extensions INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ends_at TIMESTAMPTZ NOT NULL,
      closed_at TIMESTAMPTZ NULL,
      buyer_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      sale_price NUMERIC(18,2) NULL,
      fee NUMERIC(18,2) NULL,
      CONSTRAINT games_card_listings_kind_check CHECK (kind IN ('fixed', 'auction')),
      CONSTRAINT games_card_listings_status_check CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
      CONSTRAINT games_card_listings_rarity_check CHECK (rarity IN ('C', 'R', 'SR', 'SSR', 'UR')),
      CONSTRAINT games_card_listings_price_check CHECK (
        (kind = 'fixed' AND price > 0)
        OR (kind = 'auction' AND start_price > 0 AND (price IS NULL OR price > start_price))
      )
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_listings_active_idx ON games.card_listings (status, ends_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_listings_card_idx ON games.card_listings (card_key, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_listings_seller_idx ON games.card_listings (seller_id, status, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.card_bids (
      id BIGSERIAL PRIMARY KEY,
      listing_id BIGINT NOT NULL REFERENCES games.card_listings(id) ON DELETE CASCADE,
      bidder_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      amount NUMERIC(18,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'leading',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_card_bids_status_check CHECK (status IN ('leading', 'outbid', 'won', 'refunded')),
      CONSTRAINT games_card_bids_amount_check CHECK (amount > 0)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_bids_listing_idx ON games.card_bids (listing_id, amount DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_bids_bidder_idx ON games.card_bids (bidder_id, created_at DESC)`);

  // Every completed market sale: the price history behind floors, charts and collection value.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.card_sales (
      id BIGSERIAL PRIMARY KEY,
      listing_id BIGINT NULL REFERENCES games.card_listings(id) ON DELETE SET NULL,
      card_key TEXT NOT NULL,
      asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
      rarity TEXT NOT NULL,
      kind TEXT NOT NULL,
      price NUMERIC(18,2) NOT NULL,
      fee NUMERIC(18,2) NOT NULL DEFAULT 0,
      seller_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      buyer_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_sales_card_idx ON games.card_sales (card_key, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_sales_recent_idx ON games.card_sales (created_at DESC)`);

  // Direct trades between two players. The proposer's side is in escrow while pending; a counter
  // closes the original (refunding it) and opens a new offer the other way.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.card_trades (
      id BIGSERIAL PRIMARY KEY,
      from_user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      to_user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      give_json JSONB NOT NULL,
      ask_json JSONB NOT NULL,
      message TEXT NULL,
      counter_of BIGINT NULL REFERENCES games.card_trades(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      responded_at TIMESTAMPTZ NULL,
      CONSTRAINT games_card_trades_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'countered')),
      CONSTRAINT games_card_trades_users_check CHECK (from_user_id <> to_user_id),
      CONSTRAINT games_card_trades_message_check CHECK (message IS NULL OR char_length(message) <= 200)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_trades_to_idx ON games.card_trades (to_user_id, status, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_trades_from_idx ON games.card_trades (from_user_id, status, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_card_trades_pending_idx ON games.card_trades (status, expires_at)`);
}

module.exports = { applyGamesSchema };
