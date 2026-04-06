const DEFAULT_STARTER_CASH = 10000;

function getStarterCash() {
  const parsed = Number(process.env.MARKET_STARTER_CASH || DEFAULT_STARTER_CASH);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTER_CASH;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getCurrentNetWorth(pool, userId) {
  const starterCash = getStarterCash();
  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(pcb.cash_balance, $2) AS cash_balance,
      COALESCE(SUM(h.quantity * COALESCE(a.current_mid_price, 0)), 0) AS total_market_value,
      COALESCE(SUM(h.quantity * (COALESCE(a.current_mid_price, 0) - h.avg_cost_basis)), 0) AS total_unrealized_pnl
    FROM market.users u
    LEFT JOIN market.portfolio_cash_balances pcb
      ON pcb.user_id = u.id
    LEFT JOIN market.portfolio_holdings h
      ON h.user_id = u.id
     AND h.quantity > 0
    LEFT JOIN market.market_assets a
      ON a.id = h.asset_id
    WHERE u.id = $1
    GROUP BY u.id, pcb.cash_balance
  `,
    [userId, starterCash]
  );

  const row = rows[0] || {
    cash_balance: starterCash,
    total_market_value: 0,
    total_unrealized_pnl: 0,
  };
  const cashBalance = toNumber(row.cash_balance, starterCash);
  const totalMarketValue = toNumber(row.total_market_value, 0);
  const totalUnrealizedPnl = toNumber(row.total_unrealized_pnl, 0);

  return {
    cash_balance: cashBalance,
    total_market_value: totalMarketValue,
    total_unrealized_pnl: totalUnrealizedPnl,
    total_equity: cashBalance + totalMarketValue,
  };
}

async function listCurrentNetWorthLeaderboard(pool, { limit = 100 } = {}) {
  const starterCash = getStarterCash();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const { rows } = await pool.query(
    `
    WITH scored AS (
      SELECT
        u.id,
        u.username,
        COALESCE(pcb.cash_balance, $1) AS cash_balance,
        COALESCE(SUM(h.quantity * COALESCE(a.current_mid_price, 0)), 0) AS total_market_value
      FROM market.users u
      LEFT JOIN market.portfolio_cash_balances pcb
        ON pcb.user_id = u.id
      LEFT JOIN market.portfolio_holdings h
        ON h.user_id = u.id
       AND h.quantity > 0
      LEFT JOIN market.market_assets a
        ON a.id = h.asset_id
      GROUP BY u.id, u.username, pcb.cash_balance
    )
    SELECT
      id,
      username,
      cash_balance,
      total_market_value,
      cash_balance + total_market_value AS total_equity,
      ROW_NUMBER() OVER (
        ORDER BY cash_balance + total_market_value DESC, username ASC, id ASC
      )::INTEGER AS rank
    FROM scored
    ORDER BY rank ASC
    LIMIT $2
  `,
    [starterCash, safeLimit]
  );

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    label: row.username,
    cash_balance: toNumber(row.cash_balance, starterCash),
    total_market_value: toNumber(row.total_market_value, 0),
    total_equity: toNumber(row.total_equity, 0),
    rank: Number(row.rank),
  }));
}

async function listDailyNetWorthHistory(pool, userId, { limit = 60 } = {}) {
  const safeLimit = Math.max(1, Math.min(365, Number(limit) || 60));
  const { rows } = await pool.query(
    `
    SELECT
      market_date::text AS recorded_at,
      cash_balance,
      holdings_market_value AS total_market_value,
      total_equity
    FROM market.user_daily_net_worth
    WHERE user_id = $1
    ORDER BY market_date DESC
    LIMIT $2
  `,
    [userId, safeLimit]
  );
  return rows.reverse();
}

async function recordDailyNetWorthSnapshot(client, marketDate) {
  if (!marketDate) return { market_date: null, user_count: 0 };

  const starterCash = getStarterCash();
  const { rowCount } = await client.query(
    `
    INSERT INTO market.user_daily_net_worth (
      user_id,
      market_date,
      cash_balance,
      holdings_market_value,
      total_equity,
      priced_position_count,
      unpriced_position_count,
      created_at,
      updated_at
    )
    SELECT
      u.id,
      $1::date,
      COALESCE(pcb.cash_balance, $2) AS cash_balance,
      COALESCE(SUM(
        CASE
          WHEN d.asset_id IS NULL THEN 0
          ELSE h.quantity * COALESCE(d.mid_close, d.mid_open, 0)
        END
      ), 0) AS holdings_market_value,
      COALESCE(pcb.cash_balance, $2) + COALESCE(SUM(
        CASE
          WHEN d.asset_id IS NULL THEN 0
          ELSE h.quantity * COALESCE(d.mid_close, d.mid_open, 0)
        END
      ), 0) AS total_equity,
      COUNT(*) FILTER (WHERE h.asset_id IS NOT NULL AND d.asset_id IS NOT NULL)::INTEGER AS priced_position_count,
      COUNT(*) FILTER (WHERE h.asset_id IS NOT NULL AND d.asset_id IS NULL)::INTEGER AS unpriced_position_count,
      now(),
      now()
    FROM market.users u
    LEFT JOIN market.portfolio_cash_balances pcb
      ON pcb.user_id = u.id
    LEFT JOIN market.portfolio_holdings h
      ON h.user_id = u.id
     AND h.quantity > 0
    LEFT JOIN market.asset_daily_market_state d
      ON d.asset_id = h.asset_id
     AND d.market_date = $1::date
    GROUP BY u.id, pcb.cash_balance
    ON CONFLICT (user_id, market_date)
    DO UPDATE SET
      cash_balance = EXCLUDED.cash_balance,
      holdings_market_value = EXCLUDED.holdings_market_value,
      total_equity = EXCLUDED.total_equity,
      priced_position_count = EXCLUDED.priced_position_count,
      unpriced_position_count = EXCLUDED.unpriced_position_count,
      updated_at = now()
  `,
    [marketDate, starterCash]
  );

  return {
    market_date: marketDate,
    user_count: rowCount,
  };
}

module.exports = {
  getCurrentNetWorth,
  listCurrentNetWorthLeaderboard,
  listDailyNetWorthHistory,
  recordDailyNetWorthSnapshot,
};
