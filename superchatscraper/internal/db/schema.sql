CREATE SCHEMA IF NOT EXISTS yt;

CREATE TABLE IF NOT EXISTS yt.youtube_superchats (
  date DATE NOT NULL,
  video_id TEXT PRIMARY KEY,
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
