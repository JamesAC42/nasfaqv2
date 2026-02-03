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
- `GET /api/channels/:id/latest`
- `GET /api/channels/:id/timeseries?start=ISO&end=ISO`
- `GET /api/channels/:id/timeseries?bucket=7%20days&start=ISO&end=ISO` (bucketed)
- `GET /api/overview/latest`
- `GET /api/livestreams` (aggregated from Redis)


