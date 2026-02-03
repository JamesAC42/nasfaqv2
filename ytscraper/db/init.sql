-- TimescaleDB schema for YouTube channel time-series scraping
-- Safe to run multiple times (idempotent-ish).

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE SCHEMA IF NOT EXISTS yt;

-- Channel metadata / configuration table (source of truth for what to scrape).
CREATE TABLE IF NOT EXISTS yt.youtube_channels (
  youtube_channel_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NULL,
  icon TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Time-series table: one row per channel per day (UTC midnight).
-- Store day in a timestamptz so it can be the Timescale time dimension.
CREATE TABLE IF NOT EXISTS yt.youtube_channel_daily_stats (
  time TIMESTAMPTZ NOT NULL,
  youtube_channel_id TEXT NOT NULL REFERENCES yt.youtube_channels (youtube_channel_id) ON DELETE CASCADE,

  -- Primary stats (from channels.list?part=statistics)
  subscriber_count BIGINT NULL,
  view_count BIGINT NULL,
  video_count BIGINT NULL,
  hidden_subscriber_count BOOLEAN NULL,

  -- Recent content pointers (from search.list)
  last_upload_at TIMESTAMPTZ NULL,
  last_upload_video_id TEXT NULL,
  last_live_at TIMESTAMPTZ NULL,
  last_live_video_id TEXT NULL,

  -- Optional extra: channel-level metadata from API that can change over time
  country TEXT NULL,

  -- Observability
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT youtube_channel_daily_stats_time_utc_midnight CHECK (date_trunc('day', time AT TIME ZONE 'utc') = (time AT TIME ZONE 'utc'))
);

-- Convert to hypertable if TimescaleDB is installed (no-op if already).
SELECT create_hypertable('yt.youtube_channel_daily_stats', 'time', if_not_exists => TRUE, migrate_data => TRUE);

-- Ensure upsert target exists (unique across channel+time).
CREATE UNIQUE INDEX IF NOT EXISTS youtube_channel_daily_stats_channel_time_uidx
  ON yt.youtube_channel_daily_stats (youtube_channel_id, time);

-- Common query patterns: latest per channel, range scans per channel.
CREATE INDEX IF NOT EXISTS youtube_channel_daily_stats_channel_time_desc_idx
  ON yt.youtube_channel_daily_stats (youtube_channel_id, time DESC);

-- Compression: compress older chunks (keeps storage low + improves IO for historical queries).
ALTER TABLE yt.youtube_channel_daily_stats
  SET (timescaledb.compress, timescaledb.compress_segmentby = 'youtube_channel_id', timescaledb.compress_orderby = 'time DESC');

-- Add compression policy only if it isn't already present (TimescaleDB doesn't have IF NOT EXISTS here in all versions).
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
    -- Older TimescaleDB versions might not have the information views; skip silently.
    NULL;
END $$;

-- Optional retention policy (commented out by default).
-- SELECT add_retention_policy('yt.youtube_channel_daily_stats', INTERVAL '3 years');


