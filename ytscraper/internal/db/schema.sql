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

  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT youtube_channel_daily_stats_time_utc_midnight CHECK (date_trunc('day', time AT TIME ZONE 'utc') = (time AT TIME ZONE 'utc'))
);

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



