## YouTube Timescale Scraper (Go)

This service scrapes **daily** time-series stats for YouTube channels and stores them in **Postgres + TimescaleDB**.

### What it stores

- Channel list/config in `yt.youtube_channels`
  - `youtube_channel_id`, `name`, `symbol`, `icon`
- Daily time-series metrics in `yt.youtube_channel_daily_stats` (Timescale hypertable)
  - `subscriber_count`, `view_count`, `video_count`
  - `last_upload_at` + `last_upload_video_id`
  - `last_live_at` + `last_live_video_id`

### Requirements

- Postgres with the **timescaledb** extension installed/enabled
- A YouTube Data API v3 key (env var `YOUTUBE_API_KEY`)

### Database initialization (schema)

The service runs schema creation automatically on startup using the embedded SQL in `internal/db/schema.sql`.

If you prefer running it manually, execute:

- `brokerbot/ytscraper/db/init.sql`

### Add channels to scrape

Insert channels into `yt.youtube_channels` (set `is_active=true`):

```sql
INSERT INTO yt.youtube_channels (youtube_channel_id, name, symbol, icon)
VALUES
  ('UC_x5XG1OV2P6uZZ5FSM9Ttw', 'Google Developers', 'GOOG', 'https://.../icon.png');
```

### Running the service

Create a local `.env` file (you can start from `env.example`) or set environment variables:

- `DATABASE_URL`: Postgres connection string, e.g. `postgres://user:pass@host:5432/dbname?sslmode=disable`
- `YOUTUBE_API_KEY`: YouTube Data API v3 key
- `REDIS_URL`: Redis connection string, e.g. `redis://localhost:6379/0`
- `REDIS_PASSWORD` (optional): Redis password for AUTH
- `SCRAPE_AT_UTC_HOUR` (optional, default `3`)
- `SCRAPE_AT_UTC_MIN` (optional, default `0`)
- `REQUEST_DELAY_MS` (optional, default `150`)
  - Optional: `ENV_FILE` to point at a non-default env file path
  - Livestream polling: `LIVE_POLL_SECONDS` (default `300`), `LIVE_MAX_RESULTS`, `UPCOMING_MAX_RESULTS`

Run:

```bash
cd brokerbot/ytscraper
go run ./cmd/ytscraper
```

### CLI: add channels interactively

```bash
cd brokerbot/ytscraper
go run ./cmd/ytchannels
```

Behavior:

- Runs **immediately** on startup
- Then runs **once per day** at the configured UTC time
- Upserts one row per channel per UTC day (`(youtube_channel_id, time)` unique index)


