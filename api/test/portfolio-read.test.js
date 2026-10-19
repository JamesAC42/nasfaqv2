const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const trading = require("../src/services/trading");
const { getStarterCash, getStarterCredit } = require("../src/services/portfolioCash");

// GET /api/portfolio/me on a freshly migrated database (its own): it reads without locking the cash
// row, and a player with no account yet gets exactly one, however many pages ask at once.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("reading your portfolio takes no locks and opens an account once", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_portfolio_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_portfolio_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_portfolio_test";
  const pool = new Pool({ connectionString: target.href, max: 12 });
  t.after(() => pool.end());
  const quiet = [console.warn, console.log];
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log] = quiet;
  }

  const { rows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('newbie', 'newbie', 'newbie@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  const newbie = Number(rows[0].id);

  // Several pages load at once for a player who has never had an account: one account, one grant.
  const summaries = await Promise.all(Array.from({ length: 6 }, () => trading.getPortfolioSummary(pool, newbie)));
  for (const summary of summaries) {
    assert.equal(summary.cash_balance, getStarterCash());
    assert.equal(summary.credit_balance, getStarterCredit());
    assert.deepEqual(summary.holdings, []);
  }
  const accounts = await pool.query(`SELECT COUNT(*)::int AS n FROM market.portfolio_cash_balances WHERE user_id = $1`, [newbie]);
  assert.equal(accounts.rows[0].n, 1);
  const grants = await pool.query(`SELECT COUNT(*)::int AS n FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'starter_cash_grant'`, [newbie]);
  assert.equal(grants.rows[0].n, 1);

  // A trade holding the cash row (FOR UPDATE, as fills do) doesn't hold up a read of it.
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT 1 FROM market.portfolio_cash_balances WHERE user_id = $1 FOR UPDATE`, [newbie]);
    const read = trading.getPortfolioSummary(pool, newbie);
    const outcome = await Promise.race([read.then(() => "read"), new Promise((resolve) => setTimeout(() => resolve("blocked"), 3_000))]);
    assert.equal(outcome, "read");
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
});
