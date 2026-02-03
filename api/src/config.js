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
  const candidate = path.join(process.cwd(), ".env");
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate, override: false });
  }
}

function getConfig() {
  return {
    port: Number(process.env.PORT || 4001),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
    enableMigrations: (process.env.ENABLE_MIGRATIONS || "").toLowerCase() === "true"
  };
}

module.exports = { loadEnv, getConfig };


