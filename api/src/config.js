const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

function loadEnv() {
  const envFile = process.env.ENV_FILE;
  if (envFile) {
    dotenv.config({ path: envFile, override: false });
    return;
  }

  // Load local .env if present (don't override real env vars).
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
}

function getConfig() {
  const configuredCorsOrigins = String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const corsOrigins = Array.from(new Set([
    ...configuredCorsOrigins,
    "http://localhost:3000",
    "http://localhost:3010",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3010",
  ]));

  return {
    port: Number(process.env.PORT || 5067),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    redisPassword: process.env.REDIS_PASSWORD,
    corsOrigins,
    enableMigrations: (process.env.ENABLE_MIGRATIONS || "").toLowerCase() === "true",
    enableMarketSettlementScheduler: (process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
    enableMarketAdjustmentScheduler: (process.env.MARKET_ADJUSTMENT_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
    enablePredictionMarketScheduler: (process.env.PREDICTION_MARKET_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
  };
}

module.exports = { loadEnv, getConfig };
