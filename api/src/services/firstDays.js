// The first-days guide: what to do after signing up, ticked off from what the player has actually done.
//
// Only accounts made after the guide shipped have market.users.first_days_until (auth.createUser sets
// it FIRST_DAYS out), so players already active on v2 never see it. Linking a v1 account doesn't
// matter: a new v2 account gets the guide either way. Closing it sets the date to now.

const FIRST_DAYS = 14;

const num = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * The guide for one player, or { active: false } when they don't get one (an older account, or it
 * ran out or was closed). Each step is null until the player has done it.
 */
async function getFirstDays(pool, userId) {
  const { rows: users } = await pool.query(`SELECT first_days_until FROM market.users WHERE id = $1`, [userId]);
  const until = users[0]?.first_days_until ?? null;
  if (!until || new Date(until).getTime() <= Date.now()) return { active: false, until };

  const { rows } = await pool.query(
    `
    WITH first_fill AS (
      SELECT f.ts, f.asset_id, a.symbol
      FROM market.trade_fills f
      JOIN market.market_assets a ON a.id = f.asset_id
      WHERE f.user_id = $1
      ORDER BY f.ts, f.id
      LIMIT 1
    ),
    first_tick AS (
      SELECT i.interval_key, i.applied_at, i.price_before, i.price_after
      FROM market.asset_adjustment_intervals i
      JOIN first_fill ff ON ff.asset_id = i.asset_id
      WHERE i.status = 'applied' AND i.applied_at > ff.ts
      ORDER BY i.applied_at, i.id
      LIMIT 1
    ),
    first_review AS (
      SELECT e.id, e.eval_date
      FROM market.weekly_evaluations e
      JOIN first_fill ff ON e.completed_at > ff.ts
      WHERE e.status = 'completed'
      ORDER BY e.completed_at, e.id
      LIMIT 1
    )
    SELECT
      oshi.symbol AS oshi_symbol,
      oshi.display_name AS oshi_name,
      ff.ts AS fill_at,
      ff.symbol AS fill_symbol,
      ft.interval_key AS tick_key,
      ft.applied_at AS tick_at,
      ft.price_before AS tick_before,
      ft.price_after AS tick_after,
      fr.eval_date AS review_date,
      (SELECT SUM(d.amount) FROM market.dividend_payouts d WHERE d.evaluation_id = fr.id AND d.user_id = $1) AS review_net,
      EXISTS (SELECT 1 FROM games.user_reward_claims c WHERE c.user_id = $1 AND c.reward_key = 'starter') AS cards_claimed
    FROM market.users u
    LEFT JOIN market.market_assets oshi ON oshi.id = u.oshi_coin_asset_id
    LEFT JOIN first_fill ff ON true
    LEFT JOIN first_tick ft ON true
    LEFT JOIN first_review fr ON true
    WHERE u.id = $1
  `,
    [userId]
  );
  const row = rows[0] ?? {};
  const before = num(row.tick_before);
  const after = num(row.tick_after);
  return {
    active: true,
    until,
    oshi: row.oshi_symbol ? { symbol: row.oshi_symbol, name: row.oshi_name } : null,
    first_fill: row.fill_at ? { at: row.fill_at, symbol: row.fill_symbol } : null,
    first_tick: row.tick_at
      ? { at: row.tick_at, key: row.tick_key, symbol: row.fill_symbol, move_pct: before && after !== null ? after / before - 1 : null }
      : null,
    // net: dividends minus share fees on that review (0 when the stocks held sat in the middle).
    first_review: row.review_date ? { date: row.review_date, net: num(row.review_net) ?? 0 } : null,
    cards_claimed: Boolean(row.cards_claimed),
  };
}

/** Closes the guide for good. */
async function dismissFirstDays(pool, userId) {
  await pool.query(`UPDATE market.users SET first_days_until = now() WHERE id = $1 AND first_days_until > now()`, [userId]);
}

module.exports = { FIRST_DAYS, dismissFirstDays, getFirstDays };
