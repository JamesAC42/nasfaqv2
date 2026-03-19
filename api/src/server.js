const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const { loadEnv, getConfig } = require("./config");
const { createPool } = require("./db");
const { applySchema } = require("./migrations");
const { createRedis } = require("./redis");

const channelsRoutes = require("./routes/channels");
const overviewRoutes = require("./routes/overview");
const livestreamsRoutes = require("./routes/livestreams");
const analysisRoutes = require("./routes/analysis");

const LIVESTREAM_VIEWER_UPDATES_CHANNEL = "nasfaq_livestreams:viewer_updates";

loadEnv();
const cfg = getConfig();

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(
  cors({
    origin: cfg.corsOrigin,
    credentials: true
  })
);

const pool = createPool(cfg.databaseUrl);
let redis = null;

const api = express.Router();

api.get("/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: r.rows[0].ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.use((req, _res, next) => {
  req.ctx = { pool, redis };
  next();
});

api.use("/channels", channelsRoutes);
api.use("/overview", overviewRoutes);
api.use("/livestreams", livestreamsRoutes);
api.use("/analysis", analysisRoutes);

app.use("/api", api);

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

async function main() {
  if (cfg.enableMigrations) {
    await applySchema(pool);
  }

  // Redis is required for livestream endpoints.
  redis = await createRedis(cfg.redisUrl, cfg.redisPassword);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/api/livestreams/ws" });

  wss.on("connection", (ws) => {
    // Optional: send current snapshot from GET /api/livestreams or leave it to client to fetch once.
    ws.on("close", () => {});
  });

  // Dedicated Redis client for pub/sub (subscriber mode can't run other commands).
  const redisSub = await createRedis(cfg.redisUrl, cfg.redisPassword);
  await redisSub.subscribe(LIVESTREAM_VIEWER_UPDATES_CHANNEL, (message) => {
    const payload = String(message);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  });
  // eslint-disable-next-line no-console
  console.log("Subscribed to Redis channel:", LIVESTREAM_VIEWER_UPDATES_CHANNEL);

  server.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${cfg.port} (HTTP + WebSocket /api/livestreams/ws)`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});


