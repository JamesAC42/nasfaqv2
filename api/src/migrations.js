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
      ADD COLUMN IF NOT EXISTS bio TEXT NULL,
      ADD COLUMN IF NOT EXISTS profile_picture_url TEXT NULL,
      ADD COLUMN IF NOT EXISTS profile_color TEXT NULL,
      ADD COLUMN IF NOT EXISTS oshi_coin_asset_id BIGINT NULL REFERENCES market.market_assets(id) ON DELETE SET NULL
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT content_article_comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_article_comments_article_idx
      ON content.article_comments (article_id, created_at ASC, id ASC)
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




