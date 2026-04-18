## NASFAQV2 API gateway

Node.js API gateway for reading YouTube TimescaleDB data from:

- `yt.youtube_channels`
- `yt.youtube_channel_daily_stats`

### Setup

```bash
cd api
npm install
```

Create an env file (example at `api/env.example`) and export vars, or create a local `.env` at `api/.env`.

Required:

- `DATABASE_URL`

Optional:

- `PORT` (default `5067`)
- `CORS_ORIGIN` (default `http://localhost:3010`)
- `REDIS_PASSWORD` (optional, password for Redis AUTH)
- `ENABLE_MIGRATIONS=true` to apply `../ytscraper/internal/db/schema.sql` on startup

### Run

```bash
cd api
npm run dev
```

### Endpoints

- `GET /api/health`
- `GET /api/channels?active=true|false`
- `GET /api/channels/:id`
- `POST /api/channels`
- `PUT /api/channels/:id`
- `GET /api/channels/:id/latest`
- `GET /api/channels/:id/timeseries?start=ISO&end=ISO`
- `GET /api/channels/:id/timeseries?bucket=7%20days&start=ISO&end=ISO` (bucketed)
- `GET /api/overview/latest`
- `GET /api/market/assets/:symbol/superchats?range=7d`
- `GET /api/market/assets/:symbol/superchats/timeseries?range=7d|14d|1m|1y`
- `GET /api/livestreams` (aggregated from Redis)
- `WebSocket /api/livestreams/ws` — live viewer count updates (JSON: `{ at, live: Stream[] }`) pushed when the scraper polls; clients should set `NEXT_PUBLIC_WS_API_BASE=ws://localhost:PORT` when the API is on a different origin (e.g. proxy mode).

`POST /api/channels` and `PUT /api/channels/:id` accept `name_short` plus the optional metadata fields
`name_english`, `name_japanese`, `twitter_id`, `profile_id`, `birthday`, `height`, and `unit`.
For backward compatibility, the API also accepts `name` as an alias for `name_short` and returns both fields.


