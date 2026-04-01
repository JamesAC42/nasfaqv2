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




