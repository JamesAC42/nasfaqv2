const { loadEnv } = require("../src/config");
const { createPool } = require("../src/db");
const { applySchema } = require("../src/migrations");
const articleDb = require("../src/articleDb");

async function main() {
  loadEnv();
  // Migrations may rewrite or index whole tables: no statement timeout here.
  const pool = createPool(process.env.DATABASE_URL, { statementTimeoutMs: 0 });
  try {
    await applySchema(pool);
    await articleDb.backfillAllNewsArticles(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("migration failed:", error);
  process.exit(1);
});
