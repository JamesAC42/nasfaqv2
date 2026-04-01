## YouTube Timescale Scraper (Go)

This service scrapes **daily** time-series stats for YouTube channels and stores them in **Postgres + TimescaleDB**.

### What it stores

- Channel list/config in `yt.youtube_channels`
  - `youtube_channel_id`, `name_short`, `name_english`, `name_japanese`
  - `symbol`, `icon`, `twitter_id`, `profile_id`, `birthday`, `height`, `unit`
  - `youtube_channel_icon_url`, `youtube_channel_banner_url`, `youtube_channel_description`
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
INSERT INTO yt.youtube_channels (
  youtube_channel_id,
  name_short,
  name_english,
  name_japanese,
  symbol,
  icon,
  twitter_id,
  profile_id,
  birthday,
  height,
  unit
)
VALUES
  (
    'UC_x5XG1OV2P6uZZ5FSM9Ttw',
    'Google Devs',
    'Google Developers',
    NULL,
    'GOOG',
    'https://.../icon.png',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  );
```

### Running the service

Create a local `.env` file (you can start from `env.example`) or set environment variables:

- `DATABASE_URL`: Postgres connection string, e.g. `postgres://user:pass@host:5432/dbname?sslmode=disable`
- `YOUTUBE_API_KEY`: YouTube Data API v3 key
- `REDIS_URL`: Redis connection string, e.g. `redis://localhost:6379/0`
- `REDIS_PASSWORD` (optional): Redis password for AUTH
- `SCRAPE_TIMEZONE` (optional, default `America/New_York`)
- `SCRAPE_AT_LOCAL_HOUR` (optional, default `0`)
- `SCRAPE_AT_LOCAL_MIN` (optional, default `5`)
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

### CLI: one-off backfill for YouTube channel metadata

This command fetches the current YouTube-hosted icon URL, banner URL, and channel description for every row already in `yt.youtube_channels`, then writes them back to the table.

```bash
cd brokerbot/ytscraper
go run ./cmd/backfill-channel-metadata
```

Optional:

- `go run ./cmd/backfill-channel-metadata --dry-run`

Behavior:

- Runs **immediately** on startup
- Then runs **once per day** at the configured local scrape time
- Stores one row per channel per New York / Eastern calendar day, with the stored `time` anchored to that local midnight


notes on inflation:
who cares if numbers go higher
this game is essentially cookie clicker
maybe have seasons where just normalize all prices back to some baseline
