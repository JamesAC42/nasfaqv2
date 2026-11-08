// Schema for prediction pools and margin (docs/design/predictions-pools.md). Pools live in
// market.prediction_markets beside the LMSR markets (pricing = 'pool'), so they share slugs,
// categories, comments, the event timeline and the auto-market guards. Idempotent: runs on every
// migrate, from the end of applySchema.

async function applyPoolsSchema(pool) {
  await pool.query(`
    ALTER TABLE market.prediction_markets
      ADD COLUMN IF NOT EXISTS pricing TEXT NOT NULL DEFAULT 'lmsr',
      ADD COLUMN IF NOT EXISTS pool_total NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pool_dust NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS min_bet NUMERIC NULL
  `);
  await replaceCheck(pool, "market.prediction_markets", "prediction_markets_pricing_check", `pricing IN ('lmsr', 'pool')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_markets_pool_creator_idx ON market.prediction_markets (creator_user_id, created_at DESC) WHERE pricing = 'pool'`);
  // A pool has 2 to 100 options (o1..o100). The outcome-code and event-type checks that allow them
  // and pools' events live in schema.js, which re-adds them on every migrate: a narrower copy there
  // would fail on the first pool's rows.
  await pool.query(`ALTER TABLE market.prediction_market_outcomes ADD COLUMN IF NOT EXISTS pool_stake NUMERIC NOT NULL DEFAULT 0`);

  // One row per player and option: what they have on it, how much of that was borrowed, and what it
  // paid (null until the pool settles).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_pool_stakes (
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      outcome_id BIGINT NOT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      stake NUMERIC NOT NULL CHECK (stake > 0),
      borrowed NUMERIC NOT NULL DEFAULT 0 CHECK (borrowed >= 0),
      payout NUMERIC NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (market_id, outcome_id, user_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_pool_stakes_user_idx ON market.prediction_pool_stakes (user_id, market_id)`);

  // Every bet and raise, as it happened: where the money came from.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_pool_bets (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      outcome_id BIGINT NOT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL CHECK (amount > 0),
      from_credit NUMERIC NOT NULL DEFAULT 0,
      from_cash NUMERIC NOT NULL DEFAULT 0,
      borrowed NUMERIC NOT NULL DEFAULT 0,
      stake_after NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_pool_bets_market_idx ON market.prediction_pool_bets (market_id, created_at DESC, id DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_pool_bets_user_idx ON market.prediction_pool_bets (user_id, created_at DESC)`);

  // The public record of how each pool ended: every resolve, correction and void, with who, the
  // source and what moved.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market.prediction_pool_resolutions (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES market.prediction_markets(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK (action IN ('resolved', 'corrected', 'voided')),
      outcome_id BIGINT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE SET NULL,
      previous_outcome_id BIGINT NULL REFERENCES market.prediction_market_outcomes(id) ON DELETE SET NULL,
      actor_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      source_url TEXT NULL,
      note TEXT NULL,
      evidence_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      pool_total NUMERIC NOT NULL DEFAULT 0,
      paid_out NUMERIC NOT NULL DEFAULT 0,
      refunded NUMERIC NOT NULL DEFAULT 0,
      clawed_back NUMERIC NOT NULL DEFAULT 0,
      no_winner_refund BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS prediction_pool_resolutions_market_idx ON market.prediction_pool_resolutions (market_id, created_at, id)`);



  // Bookies run pools (v1's word): they open them without approval and resolve them.
  await pool.query(`ALTER TABLE market.users ADD COLUMN IF NOT EXISTS is_bookie BOOLEAN NOT NULL DEFAULT false`);

  // Auto pools: the pool versions of stream-peak and tick-top-gainer. They start off, separately
  // from the pools flag, so the owner turns them on when they want them. They carry the November
  // pause's marker (schema.js), so that pause never turns one back off after the owner turns it on.
  await pool.query(`
    INSERT INTO market.prediction_auto_templates (key, enabled, params_json) VALUES
      ('stream-peak-pool', false, '{"talents": 15, "daily_cap": 5, "close_lead_minutes": 15, "open_lead_hours": 24, "min_past_streams": 3, "paused_2026_11": 1}'),
      ('top-gainer-pool', false, '{"count": 6, "paused_2026_11": 1}')
    ON CONFLICT (key) DO NOTHING
  `);
}

async function replaceCheck(pool, table, name, expression) {
  await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
  await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression})`);
}

module.exports = { applyPoolsSchema };
