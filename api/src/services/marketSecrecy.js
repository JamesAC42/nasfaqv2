// What the public market API may say about fair value (the hidden target the day's four ticks pull
// each price toward).
//
// A target stays secret until the last tick that pulls toward it has landed; players read the
// channel signals and guess it. Once its day's ticks are all done, that day's fair values and
// premiums are history and the report shows them ("yesterday's target was X").
//
// - scrubPublicMarketPayload(value): drops every live fair-value field (current fair value, base
//   rate, premiums) anywhere in a payload. Used on assets, stats, the hub, indexes and socket events.
// - publicDailyReport(pool, report): a daily report as the public sees it. While its day's ticks are
//   still landing its fair values are withheld too (targets_revealed: false, targets_reveal_at).
// - revealedTargets(pool): the fair value movers from the newest report whose ticks have all landed.

const ALWAYS_HIDDEN = new Set([
  "avg_premium_pct",
  "base_rate",
  "base_rate_change_pct",
  "biggest_base_rate_increases",
  "biggest_base_rate_decreases",
  "current_fair_value",
  "current_fair_value_raw",
  "current_premium_pct",
  "fundamental_value_raw",
  "fundamental_value_smoothed",
  "latest_avg_premium_pct",
  "top_base_rate",
  "top_discounts",
  "top_market_discounts",
  "top_market_premiums",
  "top_premiums",
]);

// Fair value as of a settlement: secret until that day's ticks have landed.
const HIDDEN_UNTIL_TICKS_LAND = new Set([
  "biggest_fair_value_increases",
  "biggest_fair_value_decreases",
  "fair_value",
  "fair_value_change_pct",
  "largest_discounts",
  "largest_market_discounts",
  "largest_market_premiums",
  "largest_premiums",
  "premium_close_pct",
  "premium_discount_pct",
  "premium_pct",
]);

function scrub(value, hidden) {
  if (Array.isArray(value)) return value.map((item) => scrub(item, hidden));
  if (value instanceof Date) return value;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !ALWAYS_HIDDEN.has(key) && !(hidden && HIDDEN_UNTIL_TICKS_LAND.has(key)))
      .map(([key, item]) => [key, scrub(item, hidden)])
  );
}

/** Drops every live fair-value field (fair value, base rate, premiums) from a public payload. */
function scrubPublicMarketPayload(value) {
  return scrub(value, true);
}

function dateText(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

/** Whether the ticks that pull toward this settlement's fair values have all landed. */
async function targetsState(pool, marketDate) {
  const date = dateText(marketDate);
  if (!date) return { revealed: false, revealAt: null };
  const { rows } = await pool.query(
    `
    SELECT
      EXISTS (SELECT 1 FROM market.adjustment_sessions WHERE market_date = $1::date) AS has_session,
      EXISTS (SELECT 1 FROM market.daily_market_reports WHERE market_date > $1::date) AS superseded,
      COUNT(i.id) FILTER (WHERE i.status = 'scheduled')::int AS pending,
      MAX(i.scheduled_at) AS last_tick_at
    FROM market.adjustment_sessions s
    LEFT JOIN market.asset_adjustment_intervals i ON i.session_id = s.id
    WHERE s.market_date = $1::date
  `,
    [date]
  );
  const row = rows[0] || {};
  // No session yet right after settlement: the ticks are about to be scheduled, so still secret.
  const revealed = Number(row.pending || 0) === 0 && Boolean(row.has_session || row.superseded);
  return { revealed, revealAt: revealed ? null : row.last_tick_at || null };
}

/** A daily report as the public sees it. */
async function publicDailyReport(pool, report) {
  if (!report) return report;
  const { revealed, revealAt } = await targetsState(pool, report.market_date);
  return {
    ...scrub(report, !revealed),
    targets_revealed: revealed,
    targets_reveal_at: revealAt,
  };
}

/** The same report for a socket event at settlement time, when its ticks haven't started. */
function secretDailyReport(report) {
  if (!report) return report;
  return { ...scrub(report, true), targets_revealed: false, targets_reveal_at: null };
}

/** Fair value movers from the newest report whose ticks have all landed (null if none). */
async function revealedTargets(pool) {
  const { rows } = await pool.query(
    `
    SELECT r.market_date::text AS market_date, r.report_json
    FROM market.daily_market_reports r
    WHERE NOT EXISTS (
        SELECT 1
        FROM market.adjustment_sessions s
        JOIN market.asset_adjustment_intervals i ON i.session_id = s.id
        WHERE s.market_date = r.market_date AND i.status = 'scheduled'
      )
      AND (
        EXISTS (SELECT 1 FROM market.adjustment_sessions s WHERE s.market_date = r.market_date)
        OR EXISTS (SELECT 1 FROM market.daily_market_reports newer WHERE newer.market_date > r.market_date)
      )
    ORDER BY r.market_date DESC
    LIMIT 1
  `
  );
  if (!rows[0]) return null;
  const report = rows[0].report_json || {};
  return scrub(
    {
      market_date: rows[0].market_date,
      biggest_fair_value_increases: report.biggest_fair_value_increases || [],
      biggest_fair_value_decreases: report.biggest_fair_value_decreases || [],
    },
    false
  );
}

module.exports = { scrubPublicMarketPayload, publicDailyReport, secretDailyReport, revealedTargets, targetsState };
