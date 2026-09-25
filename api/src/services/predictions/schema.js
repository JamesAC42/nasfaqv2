// Schema for predictions v2 (docs/predictions/PREDICTIONS_DESIGN.md §9). Extends the order-book
// build's tables; every statement is idempotent so it runs on every migrate.

async function applyPredictionsSchema(pool) {
  // ── Markets ────────────────────────────────────────────────────────────
  await pool.query(`
    ALTER TABLE market.prediction_markets
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'event',
      ADD COLUMN IF NOT EXISTS liquidity_b NUMERIC NOT NULL DEFAULT 250,
      ADD COLUMN IF NOT EXISTS fee_bps INTEGER NOT NULL DEFAULT 100,
      ADD COLUMN IF NOT EXISTS dispute_hours INTEGER NOT NULL DEFAULT 12,
      ADD COLUMN IF NOT EXISTS auto_template TEXT NULL,
      ADD COLUMN IF NOT EXISTS auto_key TEXT NULL,
      ADD COLUMN IF NOT EXISTS auto_data JSONB NOT NULL DEFAULT '{}'::JSONB,
      ADD COLUMN IF NOT EXISTS house_net_cash NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS winning_outcome_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS amm_ready BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`ALTER TABLE market.prediction_markets ALTER COLUMN creator_user_id DROP NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS prediction_markets_auto_key_uidx ON market.prediction_markets (auto_key) WHERE auto_key IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_markets_kind_status_idx ON market.prediction_markets (kind, status, closes_at)`);
  await replaceCheck(pool, "market.prediction_markets", "prediction_markets_status_check",
    `status IN ('draft', 'pending_approval', 'open', 'closed', 'resolving', 'proposed', 'disputed', 'resolved', 'voided', 'rejected')`);
  await replaceCheck(pool, "market.prediction_markets", "prediction_markets_market_type_check", `market_type IN ('binary', 'multi')`);
  await replaceCheck(pool, "market.prediction_markets", "prediction_markets_kind_check", `kind IN ('event', 'auto')`);
  await replaceCheck(pool, "market.prediction_markets", "prediction_markets_liquidity_check", `liquidity_b >= 10 AND liquidity_b <= 100000`);
  await replaceCheck(pool, "market.prediction_markets", "prediction_markets_fee_check", `fee_bps >= 0 AND fee_bps <= 1000`);
  await replaceCheck(pool, "market.prediction_markets", "prediction_markets_dispute_hours_check", `dispute_hours >= 1 AND dispute_hours <= 72`);
  // resolution_outcome now holds an outcome code of any shape (yes/no/o1..o12) or 'void'.
  await replaceCheck(pool, "market.prediction_markets", "prediction_markets_resolution_outcome_check",
    `resolution_outcome IS NULL OR resolution_outcome ~ '^(yes|no|void|o[0-9]{1,2})$'`);

  // ── Outcomes ───────────────────────────────────────────────────────────
  await pool.query(`
    ALTER TABLE market.prediction_market_outcomes
      ADD COLUMN IF NOT EXISTS amm_shares NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_price NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS asset_id BIGINT NULL REFERENCES market.market_assets(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS color TEXT NULL
  `);
  await replaceCheck(pool, "market.prediction_market_outcomes", "prediction_market_outcomes_code_check", `outcome_code ~ '^(yes|no|o[0-9]{1,2})$'`);

  // ── Positions ──────────────────────────────────────────────────────────
  await pool.query(`ALTER TABLE market.prediction_market_positions ADD COLUMN IF NOT EXISTS net_cost_cash NUMERIC NOT NULL DEFAULT 0`);
  // Average entry includes fees, so it can sit a hair over 99c.
  await replaceCheck(pool, "market.prediction_market_positions", "prediction_market_positions_avg_entry_check", `avg_entry_price >= 0 AND avg_entry_price <= 2`);

  // ── Trades ─────────────────────────────────────────────────────────────
  await pool.query(`
    ALTER TABLE market.prediction_market_trades
      ADD COLUMN IF NOT EXISTS limit_order_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS price_after NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS prices_after JSONB NULL
  `);
  await replaceCheck(pool, "market.prediction_market_trades", "prediction_market_trades_kind_check", `trade_kind IN ('secondary', 'mint', 'redeem', 'amm')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_market_trades_matched_idx ON market.prediction_market_trades (matched_at DESC, id DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_market_trades_taker_idx ON market.prediction_market_trades (taker_user_id, matched_at DESC)`);

  // ── Events ─────────────────────────────────────────────────────────────
  await replaceCheck(pool, "market.prediction_market_events", "prediction_market_events_type_check", `event_type IN (
    'market_created', 'market_updated', 'submitted_for_approval', 'market_approved', 'market_rejected', 'market_opened',
    'market_closed', 'market_halted', 'market_resumed', 'resolution_proposed', 'resolution_disputed', 'resolution_confirmed',
    'resolution_withdrawn', 'resolution_finalized', 'market_resolved', 'market_voided', 'order_placed', 'order_cancelled',
    'trade_matched', 'auto_created', 'legacy_orders_released'
  )`);

  // ── New tables ─────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_limit_orders (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      outcome_id BIGINT NOT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      limit_price NUMERIC NOT NULL CHECK (limit_price >= 0.01 AND limit_price <= 0.99),
      cash_budget NUMERIC NOT NULL DEFAULT 0,
      cash_reserved NUMERIC NOT NULL DEFAULT 0 CHECK (cash_reserved >= 0),
      shares_total NUMERIC NOT NULL DEFAULT 0,
      shares_reserved NUMERIC NOT NULL DEFAULT 0 CHECK (shares_reserved >= 0),
      filled_shares NUMERIC NOT NULL DEFAULT 0,
      spent_cash NUMERIC NOT NULL DEFAULT 0,
      received_cash NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled', 'released')),
      close_reason TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_limit_orders_open_idx ON market.prediction_limit_orders (market_id, status, created_at, id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_limit_orders_user_idx ON market.prediction_limit_orders (user_id, status, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_resolution_proposals (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      proposer_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      outcome_id BIGINT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE CASCADE,
      is_void BOOLEAN NOT NULL DEFAULT false,
      source_url TEXT NULL,
      note TEXT NULL,
      evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'disputed', 'finalized', 'withdrawn', 'overturned')),
      window_ends_at TIMESTAMPTZ NOT NULL,
      confirmer_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      self_confirmed BOOLEAN NOT NULL DEFAULT false,
      finalized_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT prediction_proposals_outcome_or_void CHECK (is_void OR outcome_id IS NOT NULL)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_proposals_market_idx ON market.prediction_resolution_proposals (market_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_proposals_open_idx ON market.prediction_resolution_proposals (status, window_ends_at)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_disputes (
      id BIGSERIAL PRIMARY KEY,
      proposal_id BIGINT NOT NULL REFERENCES market.prediction_resolution_proposals(id) ON DELETE CASCADE,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 20 AND 2000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (proposal_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_auto_templates (
      key TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT true,
      params_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      last_run_at TIMESTAMPTZ NULL,
      last_result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    INSERT INTO market.prediction_auto_templates (key, enabled, params_json) VALUES
      ('tick-direction', true, '{"count": 6, "liquidity_b": 120, "fee_bps": 100}'),
      ('tick-top-gainer', true, '{"count": 6, "liquidity_b": 150, "fee_bps": 100}'),
      ('stream-peak', true, '{"liquidity_b": 150, "fee_bps": 100, "min_past_streams": 3}')
    ON CONFLICT (key) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO market.prediction_market_categories (slug, display_name, description, sort_order) VALUES
      ('ticks', 'Ticks', 'Auto markets on the four daily price ticks.', 10),
      ('streams', 'Streams', 'Auto markets on live streams.', 20),
      ('hololive', 'hololive', 'News, announcements, debuts, collabs.', 30),
      ('market', 'Market', 'NASFAQ prices, records and milestones.', 40),
      ('community', 'Community', 'Everything else.', 50)
    ON CONFLICT (slug) DO NOTHING
  `);
}

async function replaceCheck(pool, table, name, expression) {
  await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression})`);
}

module.exports = { applyPredictionsSchema };
