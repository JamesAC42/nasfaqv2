const express = require("express");
const cors = require("cors");

const { loadEnv, getConfig } = require("./config");
const { createPool } = require("./db");
const { applySchema } = require("./migrations");
const { createRedis } = require("./redis");

const channelsRoutes = require("./routes/channels");
const overviewRoutes = require("./routes/overview");
const livestreamsRoutes = require("./routes/livestreams");
const analysisRoutes = require("./routes/analysis");

loadEnv();
const cfg = getConfig();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: cfg.corsOrigin,
    credentials: true
  })
);

const pool = createPool(cfg.databaseUrl);
let redis = null;

app.get("/health", async (_req, res) => {
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

app.use("/channels", channelsRoutes);
app.use("/overview", overviewRoutes);
app.use("/livestreams", livestreamsRoutes);
app.use("/analysis", analysisRoutes);

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
  redis = await createRedis(cfg.redisUrl);

  app.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${cfg.port}`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});


