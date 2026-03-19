-- TimescaleDB schema for YouTube channel time-series scraping
-- Safe to run multiple times (idempotent-ish).

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE SCHEMA IF NOT EXISTS yt;

-- Channel metadata / configuration table (source of truth for what to scrape).
CREATE TABLE IF NOT EXISTS yt.youtube_channels (
  youtube_channel_id TEXT PRIMARY KEY,
  name_short TEXT NOT NULL,
  name_english TEXT NULL,
  name_japanese TEXT NULL,
  symbol TEXT NULL,
  icon TEXT NULL,
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
  ADD COLUMN IF NOT EXISTS twitter_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS birthday DATE NULL,
  ADD COLUMN IF NOT EXISTS height TEXT NULL,
  ADD COLUMN IF NOT EXISTS unit TEXT NULL;

-- Time-series table: one row per channel per day.
-- The scraper stores the ET/New York day boundary as a timestamptz so it can
-- remain the Timescale time dimension while still matching the game's day.
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
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE yt.youtube_channel_daily_stats
  DROP CONSTRAINT IF EXISTS youtube_channel_daily_stats_time_utc_midnight;

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

