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
  return {
    port: Number(process.env.PORT || 5067),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    redisPassword: process.env.REDIS_PASSWORD,
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3010",
    enableMigrations: (process.env.ENABLE_MIGRATIONS || "").toLowerCase() === "true",
    enableMarketSettlementScheduler: (process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
  };
}

module.exports = { loadEnv, getConfig };


