// One market day, step by step, for the report: each talent's opening price, the price before and
// after every adjustment that has landed, and the price now (or at the close). Trading moves the price
// between adjustments, so the steps show how much of the day each did.
//
// Secrecy (marketSecrecy.js): only landed adjustments have prices, and strengths (how hard each one
// pulled toward the target) come out only once the whole day has finished, with its targets.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function getSessionBreakdown(pool, marketDate) {
  if (!DATE.test(String(marketDate || ""))) {
    const error = new Error("invalid_date");
    error.code = "invalid_date";
    throw error;
  }
  const { rows: state } = await pool.query(`SELECT market.marks_revealed($1::date) AS finished`, [marketDate]);
  const finished = Boolean(state[0]?.finished);

  const { rows } = await pool.query(
    `
    SELECT
      a.symbol,
      d.mid_open::float8 AS open,
      COALESCE(d.mid_close, d.mid_open)::float8 AS close,
      COALESCE(
        json_agg(
          json_build_object(
            'key', i.interval_key,
            'scheduled_at', i.scheduled_at,
            'applied_at', CASE WHEN i.status = 'applied' THEN i.applied_at END,
            'status', i.status,
            'before', CASE WHEN i.status = 'applied' THEN i.price_before::float8 END,
            'after', CASE WHEN i.status = 'applied' THEN i.price_after::float8 END,
            'strength_pct', CASE WHEN $2 THEN i.strength_pct::float8 END
          )
          ORDER BY i.scheduled_at
        ) FILTER (WHERE i.id IS NOT NULL),
        '[]'
      ) AS steps
    FROM market.asset_daily_market_state d
    JOIN market.market_assets a ON a.id = d.asset_id
    LEFT JOIN market.adjustment_sessions s ON s.market_date = d.market_date
    LEFT JOIN market.asset_adjustment_intervals i ON i.session_id = s.id AND i.asset_id = a.id
    WHERE d.market_date = $1::date AND a.status = 'active'
    GROUP BY a.symbol, d.mid_open, d.mid_close
    ORDER BY a.symbol
  `,
    [marketDate, finished]
  );

  // The day's adjustments, from the talents' steps: when each is due and how many have landed.
  const byKey = new Map();
  for (const row of rows) {
    for (const step of row.steps) {
      const entry = byKey.get(step.key) ?? { key: step.key, scheduled_at: step.scheduled_at, landed: 0, total: 0 };
      entry.total += 1;
      if (step.status !== "scheduled") entry.landed += 1;
      if (step.scheduled_at < entry.scheduled_at) entry.scheduled_at = step.scheduled_at;
      byKey.set(step.key, entry);
    }
  }
  const adjustments = [...byKey.values()].sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  const pending = adjustments.filter((entry) => entry.landed < entry.total);

  return {
    market_date: marketDate,
    finished,
    reveal_at: finished || !pending.length ? null : pending[pending.length - 1].scheduled_at,
    adjustments,
    assets: rows.map((row) => ({
      symbol: row.symbol,
      open: row.open,
      close: row.close,
      steps: row.steps.map((step) => ({
        key: step.key,
        scheduled_at: step.scheduled_at,
        applied_at: step.applied_at,
        status: step.status,
        before: step.before,
        after: step.after,
        strength_pct: step.strength_pct,
      })),
    })),
  };
}

module.exports = { getSessionBreakdown };
