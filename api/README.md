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

- `PORT` (default `4001`)
- `CORS_ORIGIN` (default `http://localhost:3000`)
- `ENABLE_MIGRATIONS=true` to apply `../ytscraper/internal/db/schema.sql` on startup

### Run

```bash
cd api
npm run dev
```

### Endpoints

- `GET /health`
- `GET /channels?active=true|false`
- `GET /channels/:id`
- `POST /channels`
- `GET /channels/:id/latest`
- `GET /channels/:id/timeseries?start=ISO&end=ISO`
- `GET /channels/:id/timeseries?bucket=7%20days&start=ISO&end=ISO` (bucketed)
- `GET /overview/latest`
- `GET /livestreams` (aggregated from Redis)


