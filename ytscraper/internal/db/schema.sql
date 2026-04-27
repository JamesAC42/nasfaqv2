-- Embedded schema for the Go service.
-- Keep this in sync with db/init.sql (init.sql is provided for manual runs).

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE SCHEMA IF NOT EXISTS yt;

CREATE TABLE IF NOT EXISTS yt.youtube_channels (
  youtube_channel_id TEXT PRIMARY KEY,
  name_short TEXT NOT NULL,
  name_english TEXT NULL,
  name_japanese TEXT NULL,
  symbol TEXT NULL,
  icon TEXT NULL,
  youtube_channel_icon_url TEXT NULL,
  youtube_channel_banner_url TEXT NULL,
  channel_asset_icon_url TEXT NULL,
  channel_asset_banner_url TEXT NULL,
  youtube_channel_description TEXT NULL,
  color TEXT NULL,
  twitter_id TEXT NULL,
  profile_id TEXT NULL,
  birthday DATE NULL,
  height TEXT NULL,
  unit TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'yt'
      AND table_name = 'youtube_channels'
      AND column_name = 'name'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'yt'
        AND table_name = 'youtube_channels'
        AND column_name = 'name_short'
    ) THEN
      EXECUTE 'UPDATE yt.youtube_channels SET name_short = COALESCE(name_short, name)';
      EXECUTE 'ALTER TABLE yt.youtube_channels DROP COLUMN name';
    ELSE
      EXECUTE 'ALTER TABLE yt.youtube_channels RENAME COLUMN name TO name_short';
    END IF;
  END IF;
END $$;

ALTER TABLE yt.youtube_channels
  ADD COLUMN IF NOT EXISTS name_english TEXT NULL,
  ADD COLUMN IF NOT EXISTS name_japanese TEXT NULL,
  ADD COLUMN IF NOT EXISTS youtube_channel_icon_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS youtube_channel_banner_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS channel_asset_icon_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS channel_asset_banner_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS youtube_channel_description TEXT NULL,
  ADD COLUMN IF NOT EXISTS color TEXT NULL,
  ADD COLUMN IF NOT EXISTS twitter_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS birthday DATE NULL,
  ADD COLUMN IF NOT EXISTS height TEXT NULL,
  ADD COLUMN IF NOT EXISTS unit TEXT NULL;

CREATE TABLE IF NOT EXISTS yt.youtube_channel_daily_stats (
  time TIMESTAMPTZ NOT NULL,
  youtube_channel_id TEXT NOT NULL REFERENCES yt.youtube_channels (youtube_channel_id) ON DELETE CASCADE,

  subscriber_count BIGINT NULL,
  view_count BIGINT NULL,
  video_count BIGINT NULL,
  hidden_subscriber_count BOOLEAN NULL,

  last_upload_at TIMESTAMPTZ NULL,
  last_upload_video_id TEXT NULL,
  last_live_at TIMESTAMPTZ NULL,
  last_live_video_id TEXT NULL,

  country TEXT NULL,

  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE yt.youtube_channel_daily_stats
  DROP CONSTRAINT IF EXISTS youtube_channel_daily_stats_time_utc_midnight;

SELECT create_hypertable('yt.youtube_channel_daily_stats', 'time', if_not_exists => TRUE, migrate_data => TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS youtube_channel_daily_stats_channel_time_uidx
  ON yt.youtube_channel_daily_stats (youtube_channel_id, time);

CREATE INDEX IF NOT EXISTS youtube_channel_daily_stats_channel_time_desc_idx
  ON yt.youtube_channel_daily_stats (youtube_channel_id, time DESC);

ALTER TABLE yt.youtube_channel_daily_stats
  SET (timescaledb.compress, timescaledb.compress_segmentby = 'youtube_channel_id', timescaledb.compress_orderby = 'time DESC');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM timescaledb_information.jobs j
    JOIN timescaledb_information.job_stats js ON js.job_id = j.job_id
    WHERE j.proc_name = 'policy_compression'
      AND j.hypertable_name = 'youtube_channel_daily_stats'
      AND j.hypertable_schema = 'yt'
  ) THEN
    PERFORM add_compression_policy('yt.youtube_channel_daily_stats', INTERVAL '14 days');
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;



-- Livestream session metadata + per-stream aggregates.
-- One row per livestream "video id" (i.e., a specific livestream upload).
CREATE TABLE IF NOT EXISTS yt.livestream_sessions (
  youtube_channel_id TEXT NOT NULL REFERENCES yt.youtube_channels (youtube_channel_id) ON DELETE CASCADE,
  video_id TEXT PRIMARY KEY,

  status TEXT NOT NULL CHECK (status IN ('upcoming', 'live', 'ended')),

  video_title TEXT NULL,
  thumbnail_url TEXT NULL,

  scheduled_start_at TIMESTAMPTZ NULL,
  actual_start_at TIMESTAMPTZ NULL,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ NULL,
  end_reason TEXT NULL,

  total_views BIGINT NULL,

  -- Aggregates derived from persisted 5-minute buckets.
  avg_concurrent_viewers BIGINT NULL,
  max_concurrent_viewers BIGINT NULL,
  max_concurrent_viewers_at TIMESTAMPTZ NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS livestream_sessions_channel_actual_start_idx
  ON yt.livestream_sessions (youtube_channel_id, actual_start_at DESC);
CREATE INDEX IF NOT EXISTS livestream_sessions_status_idx
  ON yt.livestream_sessions (status);

ALTER TABLE yt.livestream_sessions
  ADD COLUMN IF NOT EXISTS total_views BIGINT NULL;

-- Viewer time-series persisted as 5-minute buckets.
-- We align/insert bucket_start on 5-minute boundaries in the scraper.
CREATE TABLE IF NOT EXISTS yt.livestream_viewer_buckets_5m (
  livestream_video_id TEXT NOT NULL REFERENCES yt.livestream_sessions (video_id) ON DELETE CASCADE,

  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_end TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL,

  avg_viewers BIGINT NULL,
  max_viewers BIGINT NULL,

  PRIMARY KEY (livestream_video_id, bucket_start)
);

SELECT create_hypertable(
  'yt.livestream_viewer_buckets_5m',
  'bucket_start',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

CREATE INDEX IF NOT EXISTS livestream_viewer_buckets_5m_video_bucket_desc_idx
  ON yt.livestream_viewer_buckets_5m (livestream_video_id, bucket_start DESC);

ALTER TABLE yt.livestream_viewer_buckets_5m
  SET (timescaledb.compress, timescaledb.compress_segmentby = 'livestream_video_id', timescaledb.compress_orderby = 'bucket_start DESC');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM timescaledb_information.jobs j
    JOIN timescaledb_information.job_stats js ON js.job_id = j.job_id
    WHERE j.proc_name = 'policy_compression'
      AND j.hypertable_name = 'livestream_viewer_buckets_5m'
      AND j.hypertable_schema = 'yt'
  ) THEN
    PERFORM add_compression_policy('yt.livestream_viewer_buckets_5m', INTERVAL '45 days');
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    -- Older TimescaleDB versions might not have the information views; skip silently.
    NULL;
END $$;

-- Channel-level rollups for equal-weight-per-stream metrics.
-- (Updated by scraper when streams end.)
CREATE TABLE IF NOT EXISTS yt.youtube_channel_livestream_stats (
  youtube_channel_id TEXT PRIMARY KEY REFERENCES yt.youtube_channels (youtube_channel_id) ON DELETE CASCADE,

  ended_streams_count BIGINT NOT NULL DEFAULT 0,

  -- Sum of per-stream averages (equal weight: average(stream_avg))
  sum_stream_avg_concurrent_viewers BIGINT NOT NULL DEFAULT 0,
  sum_stream_max_concurrent_viewers BIGINT NOT NULL DEFAULT 0,

  avg_concurrent_viewers_over_streams BIGINT NULL,
  max_concurrent_viewers_over_streams BIGINT NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yt.youtube_superchats (
  date DATE NOT NULL,
  video_id TEXT PRIMARY KEY,
  video_title TEXT NOT NULL,
  thumbnail_url TEXT NULL,
  superchat_total BIGINT NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS youtube_superchats_date_idx
  ON yt.youtube_superchats (date DESC);

CREATE TABLE IF NOT EXISTS yt.youtube_superchat_currency_breakdowns (
  video_id TEXT NOT NULL REFERENCES yt.youtube_superchats (video_id) ON DELETE CASCADE,
  currency_name TEXT NOT NULL,
  donation_count BIGINT NOT NULL,
  total_in_currency NUMERIC NOT NULL,
  total_in_yen BIGINT NOT NULL,

  PRIMARY KEY (video_id, currency_name)
);

CREATE INDEX IF NOT EXISTS youtube_superchat_currency_breakdowns_video_idx
  ON yt.youtube_superchat_currency_breakdowns (video_id);

CREATE SCHEMA IF NOT EXISTS market;

CREATE TABLE IF NOT EXISTS market.users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  username_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_params_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_length_check CHECK (char_length(username) BETWEEN 3 AND 32)
);

CREATE TABLE IF NOT EXISTS market.user_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_user_sessions_user_id_idx
  ON market.user_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market.fundamental_formula_versions (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO market.fundamental_formula_versions (
  version,
  name,
  description,
  parameters_json
)
VALUES (
  1,
  'phase1-v1',
  'Phase 1 fundamental formula with subscriber anchor, view/upload momentum, and smoothing.',
  '{
    "size_anchor": {"subscriber_exponent": 0.42, "view_30d_exponent": 0.08},
    "momentum_weights": {"view": 0.92, "upload": 0.08},
    "view_floor": 100,
    "view_signal_clamp": {"min": -0.4, "max": 0.4},
    "upload_floor": 0.05,
    "momentum_clamp": {"min": -1.35, "max": 1.35},
    "momentum_multiplier_scale": 0.35,
    "smoothing": {"previous": 0.35, "raw": 0.65},
    "daily_fair_value_move_cap": {"min_ratio": 0.5, "max_ratio": 1.5}
  }'::jsonb
)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS market.channel_daily_snapshots (
  id BIGSERIAL PRIMARY KEY,
  youtube_channel_id TEXT NOT NULL REFERENCES yt.youtube_channels(youtube_channel_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  subscriber_count BIGINT NOT NULL,
  view_count BIGINT NOT NULL,
  video_count BIGINT NULL,

  view_delta_1d BIGINT NULL,
  view_delta_7d BIGINT NULL,
  view_delta_30d BIGINT NULL,
  video_delta_7d INTEGER NULL,
  video_delta_30d INTEGER NULL,
  estimated_sub_delta_7d NUMERIC NULL,
  estimated_sub_delta_30d NUMERIC NULL,

  size_anchor_raw NUMERIC NULL,
  view_signal NUMERIC NULL,
  upload_signal NUMERIC NULL,
  sub_signal NUMERIC NULL,
  momentum_raw NUMERIC NULL,
  momentum_multiplier NUMERIC NULL,
  fundamental_value_raw NUMERIC NULL,
  fundamental_value_smoothed NUMERIC NULL,

  calculation_version INTEGER NULL REFERENCES market.fundamental_formula_versions(version),
  calculation_status TEXT NOT NULL DEFAULT 'pending',
  calculation_error TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (youtube_channel_id, snapshot_date),
  CONSTRAINT channel_daily_snapshots_nonnegative_counts_check CHECK (
    subscriber_count >= 0 AND view_count >= 0 AND video_count >= 0
  ),
  CONSTRAINT channel_daily_snapshots_status_check CHECK (
    calculation_status IN ('pending', 'complete', 'failed')
  ),
  CONSTRAINT channel_daily_snapshots_complete_fields_check CHECK (
    calculation_status <> 'complete'
    OR (
      calculation_version IS NOT NULL
      AND size_anchor_raw IS NOT NULL
      AND view_signal IS NOT NULL
      AND upload_signal IS NOT NULL
      AND momentum_raw IS NOT NULL
      AND momentum_multiplier IS NOT NULL
      AND fundamental_value_raw IS NOT NULL
      AND fundamental_value_smoothed IS NOT NULL
    )
  ),
  CONSTRAINT channel_daily_snapshots_failed_error_check CHECK (
    calculation_status <> 'failed' OR calculation_error IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS market_channel_daily_snapshots_channel_date_idx
  ON market.channel_daily_snapshots (youtube_channel_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS market.market_assets (
  id BIGSERIAL PRIMARY KEY,
  youtube_channel_id TEXT NOT NULL UNIQUE REFERENCES yt.youtube_channels(youtube_channel_id) ON DELETE CASCADE,
  symbol TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',

  max_supply NUMERIC NOT NULL,
  circulating_supply NUMERIC NOT NULL,
  treasury_supply NUMERIC NOT NULL,
  base_emission NUMERIC NOT NULL DEFAULT 0,

  latest_snapshot_date DATE NULL,
  latest_snapshot_id BIGINT NULL REFERENCES market.channel_daily_snapshots(id) ON DELETE SET NULL,
  current_fair_value NUMERIC NULL,
  current_fair_value_raw NUMERIC NULL,
  current_mid_price NUMERIC NULL,
  current_bid_price NUMERIC NULL,
  current_ask_price NUMERIC NULL,
  current_premium_pct NUMERIC NULL,
  current_daily_emission NUMERIC NULL,
  current_persistent_offset NUMERIC NOT NULL DEFAULT 0,
  current_transient_offset NUMERIC NOT NULL DEFAULT 0,
  offsets_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  adjustment_min_pct NUMERIC NOT NULL DEFAULT 0,
  adjustment_max_pct NUMERIC NOT NULL DEFAULT 200,
  adjustment_enabled BOOLEAN NOT NULL DEFAULT true,
  supply_evaluation_cadence TEXT NOT NULL DEFAULT 'weekly',
  broker_buffer_pct NUMERIC NOT NULL DEFAULT 0.02,

  liquidity_depth NUMERIC NOT NULL,
  spread_bps INTEGER NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT market_assets_status_check CHECK (status IN ('prelaunch', 'active', 'halted', 'delisted')),
  CONSTRAINT market_assets_supply_nonnegative_check CHECK (
    max_supply >= 0 AND circulating_supply >= 0 AND treasury_supply >= 0
  ),
  CONSTRAINT market_assets_supply_bounds_check CHECK (
    circulating_supply + treasury_supply <= max_supply
  ),
  CONSTRAINT market_assets_positive_prices_check CHECK (
    current_fair_value IS NULL OR current_fair_value > 0
  ),
  CONSTRAINT market_assets_positive_mid_check CHECK (
    current_mid_price IS NULL OR current_mid_price > 0
  ),
  CONSTRAINT market_assets_fair_value_pair_check CHECK (
    (current_fair_value IS NULL) = (current_fair_value_raw IS NULL)
  ),
  CONSTRAINT market_assets_quote_order_check CHECK (
    current_bid_price IS NULL OR current_ask_price IS NULL OR current_bid_price <= current_ask_price
  ),
  CONSTRAINT market_assets_latest_snapshot_pair_check CHECK (
    (latest_snapshot_date IS NULL) = (latest_snapshot_id IS NULL)
  ),
  CONSTRAINT market_assets_adjustment_pct_check CHECK (
    adjustment_min_pct >= 0 AND adjustment_max_pct >= adjustment_min_pct
  ),
  CONSTRAINT market_assets_supply_evaluation_cadence_check CHECK (
    supply_evaluation_cadence IN ('weekly', 'monthly', 'quarterly', 'manual')
  ),
  CONSTRAINT market_assets_broker_buffer_pct_check CHECK (
    broker_buffer_pct >= 0 AND broker_buffer_pct < 1
  )
);

CREATE INDEX IF NOT EXISTS market_market_assets_status_symbol_idx
  ON market.market_assets (status, symbol);

CREATE TABLE IF NOT EXISTS market.asset_price_events (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,
  old_mid_price NUMERIC NULL,
  new_mid_price NUMERIC NOT NULL,
  fair_value_at_event NUMERIC NULL,
  metadata_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_asset_price_events_asset_ts_desc_idx
  ON market.asset_price_events (asset_id, ts DESC);

CREATE TABLE IF NOT EXISTS market.trade_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE RESTRICT,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'market',
  requested_quantity NUMERIC NOT NULL,
  filled_quantity NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  quote_bid_at_submit NUMERIC NULL,
  quote_ask_at_submit NUMERIC NULL,
  rejection_reason TEXT NULL,
  metadata_json JSONB NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT trade_orders_side_check CHECK (side IN ('buy', 'sell')),
  CONSTRAINT trade_orders_type_check CHECK (order_type IN ('market')),
  CONSTRAINT trade_orders_status_check CHECK (status IN ('pending', 'filled', 'cancelled', 'rejected')),
  CONSTRAINT trade_orders_requested_quantity_check CHECK (requested_quantity > 0),
  CONSTRAINT trade_orders_filled_quantity_check CHECK (filled_quantity >= 0 AND filled_quantity <= requested_quantity)
);

CREATE INDEX IF NOT EXISTS market_trade_orders_user_requested_at_desc_idx
  ON market.trade_orders (user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS market.trade_fills (
  id BIGSERIAL,
  order_id BIGINT NOT NULL REFERENCES market.trade_orders(id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  side TEXT NOT NULL,
  price NUMERIC NOT NULL,
  quantity NUMERIC NOT NULL,
  gross_cash NUMERIC NOT NULL,
  fee_cash NUMERIC NOT NULL,
  net_cash NUMERIC NOT NULL,
  counterparty_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (asset_id, ts, id),
  CONSTRAINT trade_fills_side_check CHECK (side IN ('buy', 'sell')),
  CONSTRAINT trade_fills_quantity_check CHECK (quantity > 0),
  CONSTRAINT trade_fills_price_check CHECK (price > 0),
  CONSTRAINT trade_fills_counterparty_check CHECK (counterparty_type IN ('treasury', 'player'))
);

SELECT create_hypertable('market.trade_fills', 'ts', if_not_exists => TRUE, migrate_data => TRUE);

CREATE INDEX IF NOT EXISTS market_trade_fills_asset_ts_desc_idx
  ON market.trade_fills (asset_id, ts DESC);

CREATE INDEX IF NOT EXISTS market_trade_fills_order_idx
  ON market.trade_fills (order_id);

CREATE INDEX IF NOT EXISTS market_trade_fills_user_ts_desc_idx
  ON market.trade_fills (user_id, ts DESC);

CREATE TABLE IF NOT EXISTS market.ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  asset_id BIGINT NULL REFERENCES market.market_assets(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL,
  quantity_delta NUMERIC NOT NULL DEFAULT 0,
  cash_delta NUMERIC NOT NULL DEFAULT 0,
  reference_type TEXT NOT NULL,
  reference_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_ledger_entries_user_created_at_desc_idx
  ON market.ledger_entries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market.portfolio_holdings (
  user_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  avg_cost_basis NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id),
  CONSTRAINT portfolio_holdings_quantity_check CHECK (quantity >= 0),
  CONSTRAINT portfolio_holdings_cost_basis_check CHECK (avg_cost_basis >= 0)
);

CREATE TABLE IF NOT EXISTS market.portfolio_cash_balances (
  user_id BIGINT PRIMARY KEY,
  cash_balance NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_cash_balances_nonnegative_check CHECK (cash_balance >= 0)
);

CREATE TABLE IF NOT EXISTS market.user_daily_net_worth (
  user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
  market_date DATE NOT NULL,
  cash_balance NUMERIC NOT NULL DEFAULT 0,
  holdings_market_value NUMERIC NOT NULL DEFAULT 0,
  total_equity NUMERIC NOT NULL DEFAULT 0,
  priced_position_count INTEGER NOT NULL DEFAULT 0,
  unpriced_position_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, market_date)
);

CREATE INDEX IF NOT EXISTS market_user_daily_net_worth_user_date_desc_idx
  ON market.user_daily_net_worth (user_id, market_date DESC);

CREATE INDEX IF NOT EXISTS market_user_daily_net_worth_date_equity_desc_idx
  ON market.user_daily_net_worth (market_date DESC, total_equity DESC, user_id ASC);

CREATE TABLE IF NOT EXISTS market.asset_daily_market_state (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
  market_date DATE NOT NULL,
  snapshot_id BIGINT NOT NULL REFERENCES market.channel_daily_snapshots(id) ON DELETE RESTRICT,

  fair_value NUMERIC NOT NULL,
  fair_value_raw NUMERIC NULL,

  mid_open NUMERIC NOT NULL,
  mid_close NUMERIC NULL,
  mid_close_mark NUMERIC NULL,
  mid_high NUMERIC NULL,
  mid_low NUMERIC NULL,
  bid_close NUMERIC NULL,
  ask_close NUMERIC NULL,
  premium_close_pct NUMERIC NULL,

  daily_emission NUMERIC NOT NULL,
  treasury_supply_start NUMERIC NOT NULL,
  treasury_supply_end NUMERIC NULL,
  circulating_supply_start NUMERIC NOT NULL,
  circulating_supply_end NUMERIC NULL,

  volume_shares NUMERIC NOT NULL DEFAULT 0,
  volume_cash NUMERIC NOT NULL DEFAULT 0,
  trade_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (asset_id, market_date)
);

CREATE INDEX IF NOT EXISTS market_asset_daily_market_state_asset_date_desc_idx
  ON market.asset_daily_market_state (asset_id, market_date DESC);

CREATE TABLE IF NOT EXISTS market.market_settlement_runs (
  id BIGSERIAL PRIMARY KEY,
  market_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  error_text TEXT NULL,
  CONSTRAINT market_settlement_runs_status_check CHECK (status IN ('started', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS market.adjustment_sessions (
  id BIGSERIAL PRIMARY KEY,
  market_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'scheduled',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT adjustment_sessions_status_check CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS market.asset_adjustment_intervals (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES market.adjustment_sessions(id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL REFERENCES market.market_assets(id) ON DELETE CASCADE,
  interval_key TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  strength_pct NUMERIC NOT NULL,
  base_rate NUMERIC NOT NULL,
  price_before NUMERIC NULL,
  price_after NUMERIC NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  applied_at TIMESTAMPTZ NULL,
  metadata_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, asset_id, interval_key),
  CONSTRAINT asset_adjustment_intervals_interval_key_check CHECK (interval_key IN ('open', 'lunch', 'late', 'overnight')),
  CONSTRAINT asset_adjustment_intervals_strength_check CHECK (strength_pct >= 0),
  CONSTRAINT asset_adjustment_intervals_base_rate_check CHECK (base_rate > 0),
  CONSTRAINT asset_adjustment_intervals_status_check CHECK (status IN ('scheduled', 'applied', 'skipped', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS market_asset_adjustment_intervals_due_idx
  ON market.asset_adjustment_intervals (status, scheduled_at, id);

CREATE INDEX IF NOT EXISTS market_asset_adjustment_intervals_asset_scheduled_idx
  ON market.asset_adjustment_intervals (asset_id, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS market.fundamental_calculation_runs (
  id BIGSERIAL PRIMARY KEY,
  requested_from DATE NULL,
  requested_to DATE NULL,
  version INTEGER NOT NULL REFERENCES market.fundamental_formula_versions(version),
  youtube_channel_id TEXT NULL REFERENCES yt.youtube_channels(youtube_channel_id) ON DELETE SET NULL,
  active_only BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL,
  channels_processed INTEGER NOT NULL DEFAULT 0,
  snapshots_processed INTEGER NOT NULL DEFAULT 0,
  failed_snapshots INTEGER NOT NULL DEFAULT 0,
  assets_updated INTEGER NOT NULL DEFAULT 0,
  error_text TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT fundamental_calculation_runs_status_check CHECK (status IN ('started', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS market.daily_market_reports (
  market_date DATE PRIMARY KEY,
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market.market_runtime_state (
  state_key TEXT PRIMARY KEY,
  trading_status TEXT NOT NULL DEFAULT 'open',
  active_phase TEXT NOT NULL DEFAULT 'idle',
  trading_message TEXT NULL,
  current_market_date DATE NULL,
  current_cycle_started_at TIMESTAMPTZ NULL,
  current_cycle_updated_at TIMESTAMPTZ NULL,
  last_settlement_market_date DATE NULL,
  last_settlement_completed_at TIMESTAMPTZ NULL,
  next_scheduled_settlement_at TIMESTAMPTZ NULL,
  last_cycle_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT market_runtime_state_status_check CHECK (
    trading_status IN ('open', 'settling', 'manual_closed')
  ),
  CONSTRAINT market_runtime_state_phase_check CHECK (
    active_phase IN ('idle', 'fundamentals', 'settlement')
  )
);

INSERT INTO market.market_runtime_state (state_key)
VALUES ('primary')
ON CONFLICT (state_key) DO NOTHING;

