const DEFAULT_STARTER_CASH = 10000;

function getStarterCash() {
  const parsed = Number(process.env.MARKET_STARTER_CASH || DEFAULT_STARTER_CASH);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTER_CASH;
}

async function ensureUserCashAccount(client, userId) {
  const existing = await client.query(
    `
    SELECT user_id, cash_balance
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
  await client.query(
    `
    INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, updated_at)
    VALUES ($1, $2, now())
  `,
    [userId, starterCash]
  );

  await client.query(
    `
    INSERT INTO market.ledger_entries (
      user_id,
      asset_id,
      entry_type,
      quantity_delta,
      cash_delta,
      reference_type,
      reference_id
    ) VALUES ($1, NULL, 'starter_cash_grant', 0, $2, 'system', 0)
  `,
    [userId, starterCash]
  );

  return { user_id: userId, cash_balance: starterCash };
}

module.exports = {
  ensureUserCashAccount,
  getStarterCash,
};
