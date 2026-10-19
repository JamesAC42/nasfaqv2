const DEFAULT_STARTER_CASH = 10000;
// PLACEHOLDER (docs/market/credit.md). BBB: new players start with Credit equal to the total of all
// base rates, and Cash a tenth of that; this keeps that ratio to today's starter cash.
const DEFAULT_STARTER_CREDIT = 100000;

function getStarterCash() {
  const parsed = Number(process.env.MARKET_STARTER_CASH || DEFAULT_STARTER_CASH);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTER_CASH;
}

function getStarterCredit() {
  const parsed = Number(process.env.ECONOMY_STARTER_CREDIT || DEFAULT_STARTER_CREDIT);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTER_CREDIT;
}

async function ensureUserCashAccount(client, userId) {
  const existing = await client.query(
    `
    SELECT user_id, cash_balance, held_cash, credit_balance
    FROM market.portfolio_cash_balances
    WHERE user_id = $1
    FOR UPDATE
  `,
    [userId]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  const starterCash = getStarterCash();
  const starterCredit = getStarterCredit();
  const inserted = await client.query(
    `
    INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance, updated_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (user_id) DO NOTHING
  `,
    [userId, starterCash, starterCredit]
  );
  if (inserted.rowCount === 0) {
    // Another request opened the account first (it waited for that one to commit): use theirs.
    const { rows } = await client.query(
      `
      SELECT user_id, cash_balance, held_cash, credit_balance
      FROM market.portfolio_cash_balances
      WHERE user_id = $1
      FOR UPDATE
    `,
      [userId]
    );
    return rows[0];
  }

  await client.query(
    `
    INSERT INTO market.ledger_entries (
      user_id,
      asset_id,
      entry_type,
      quantity_delta,
      cash_delta,
      credit_delta,
      reference_type,
      reference_id
    ) VALUES ($1, NULL, 'starter_cash_grant', 0, $2, $3, 'system', 0)
  `,
    [userId, starterCash, starterCredit]
  );

  return { user_id: userId, cash_balance: starterCash, held_cash: 0, credit_balance: starterCredit };
}

/** The account's balances, or null if it has none yet. A plain read: no lock, no transaction. */
async function readUserCashAccount(db, userId) {
  const { rows } = await db.query(
    `
    SELECT user_id, cash_balance, held_cash, credit_balance
    FROM market.portfolio_cash_balances
    WHERE user_id = $1
  `,
    [userId]
  );
  return rows[0] || null;
}

/** Opens the account (starter cash) in its own transaction if it has none yet; returns its balances. */
async function openUserCashAccount(pool, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await ensureUserCashAccount(client, userId);
    await client.query("COMMIT");
    return account;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureUserCashAccount,
  openUserCashAccount,
  readUserCashAccount,
  getStarterCash,
  getStarterCredit,
};
