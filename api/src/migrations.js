const fs = require("node:fs");
const path = require("node:path");

async function applySchema(pool) {
  // Reuse the schema from the Go service so API and scraper stay aligned.
  const schemaPath = path.resolve(__dirname, "..", "..", "ytscraper", "internal", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  await pool.query(`
    ALTER TABLE market.market_assets
      ADD COLUMN IF NOT EXISTS current_persistent_offset NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS current_transient_offset NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS offsets_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);
  await pool.query(`
    ALTER TABLE market.asset_daily_market_state
      ADD COLUMN IF NOT EXISTS mid_close_mark NUMERIC NULL
  `);
}

module.exports = { applySchema };




