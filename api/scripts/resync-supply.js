// Checks (and with --fix, repairs) each stock's circulating supply against the shares players hold.
//
//   node scripts/resync-supply.js           list stocks whose count is off; writes nothing
//   node scripts/resync-supply.js --fix     set circulating = sum of holdings, treasury = max − held
//
// Circulating supply is kept in step by every fill, buyback and weekly evaluation. The one known way
// it drifts: during a deploy, pods still running the previous version keep filling orders after the
// migration has recounted it. Run this once the rollout is done. Max shares are never changed here.
// Uses DATABASE_URL from api/.env (or the environment).

const { loadEnv } = require("../src/config");
const { createPool } = require("../src/db");

async function main() {
  loadEnv();
  const fix = process.argv.includes("--fix");
  const pool = createPool(process.env.DATABASE_URL);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Holdings locked against fills for the moment it takes, so the count is exact.
    if (fix) await client.query("LOCK TABLE market.portfolio_holdings IN SHARE MODE");
    const { rows } = await client.query(`
      SELECT a.id, a.symbol, a.max_supply, a.circulating_supply, a.treasury_supply, COALESCE(SUM(h.quantity), 0) AS held
      FROM market.market_assets a
      LEFT JOIN market.portfolio_holdings h ON h.asset_id = a.id
      GROUP BY a.id
      HAVING abs(a.circulating_supply - COALESCE(SUM(h.quantity), 0)) > 0.000001
      ORDER BY a.symbol
    `);
    if (!rows.length) {
      console.log("every stock's circulating supply matches its holdings");
      await client.query("ROLLBACK");
      return;
    }
    for (const row of rows) {
      console.log(`${row.symbol.padEnd(6)} circulating ${Number(row.circulating_supply)} vs held ${Number(row.held)} (max ${Number(row.max_supply)})`);
    }
    if (!fix) {
      console.log(`\n${rows.length} stock(s) off. Run with --fix to set circulating = held.`);
      await client.query("ROLLBACK");
      return;
    }
    await client.query(
      `
      UPDATE market.market_assets a
      SET circulating_supply = h.held,
          treasury_supply = GREATEST(a.max_supply - h.held, 0),
          updated_at = now()
      FROM (
        SELECT a2.id, COALESCE(SUM(p.quantity), 0) AS held
        FROM market.market_assets a2
        LEFT JOIN market.portfolio_holdings p ON p.asset_id = a2.id
        WHERE a2.id = ANY($1::bigint[])
        GROUP BY a2.id
      ) h
      WHERE a.id = h.id
    `,
      [rows.map((row) => row.id)]
    );
    await client.query("COMMIT");
    console.log(`\nfixed ${rows.length} stock(s).`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
