// Rebuilds the market's whole price history from the YouTube data (the admin page's Rebuild, without
// a web request to time out). Uses DATABASE_URL / REDIS_URL from the environment or api/.env.
//
//   node scripts/rebuild-market.js --yes            rebuild prices over the existing market
//   node scripts/rebuild-market.js --reset --yes    reset first: deletes ALL trades, holdings,
//                                                   leaderboards and assets, everyone gets starter cash
//
// Stop the API's market scheduler (or the API) first on a live server; the rebuild takes the
// scheduler lock and refuses to run while a scheduled cycle holds it.

const { Pool } = require("pg");
const { loadEnv } = require("../src/config");
const { createRedis } = require("../src/redis");
const marketAdmin = require("../src/services/marketAdmin");
const { runFullRebuild } = require("../src/services/marketRebuild");

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  if (!argv.includes("--yes")) {
    console.log("This rewrites the market's price history" + (argv.includes("--reset") ? " and deletes all trading data" : "") + ". Add --yes to run it.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  console.log(`database: ${new URL(process.env.DATABASE_URL).host}${new URL(process.env.DATABASE_URL).pathname}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = process.env.REDIS_URL ? await createRedis(process.env.REDIS_URL, process.env.REDIS_PASSWORD).catch(() => null) : null;
  const started = Date.now();
  try {
    if (argv.includes("--reset")) {
      const reset = await marketAdmin.resetMarketState(pool);
      console.log(`reset: everyone has ${reset.starter_cash} starter cash`);
    }
    let last = 0;
    const result = await runFullRebuild({ pool, redis }, {}, (progress) => {
      if (progress.phase !== "settling") return console.log(`${progress.phase}…`);
      if (Date.now() - last < 2000 && progress.done !== progress.total) return;
      last = Date.now();
      process.stdout.write(`\rsettling ${progress.done}/${progress.total} days (${progress.market_date})   `);
    });
    console.log(
      `\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s: ${result.range.from} to ${result.range.to}, ` +
        `${result.settlement.settled_count} days settled, ${result.adjustments_applied} adjustments replayed` +
        (result.settlement.skipped_dates.length ? `, ${result.settlement.skipped_dates.length} days skipped (first: ${result.settlement.skipped_dates[0].market_date} ${result.settlement.skipped_dates[0].error})` : "")
    );
  } finally {
    await pool.end().catch(() => {});
    if (redis) await redis.quit().catch(() => {});
  }
}

main().catch((error) => {
  console.error("\nrebuild failed:", error.code || error.message);
  process.exit(1);
});
