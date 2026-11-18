// The market package's growth (marketPackage.js): while it's on, fair values grow GROWTH_PER_DAY a
// day. Each market date's fair value is multiplied by exp(log_growth), where log_growth is the growth
// so far: the day before's plus GROWTH_PER_DAY for each day since it.
//
// - Recorded, one row per market date, by the regular settlement of that date (recordGrowth), in its
//   transaction. A forced replay (rebuild, "Regenerate a day") and every reading path (the
//   fundamentals refresh, tick reasons, the IPO preview) only read it, so a replay reproduces what the
//   day got the first time and earlier days never change.
// - Applied where the daily nudge is (targetNudge.js), on top of the smoothed fundamental, never
//   inside the smoothing chain: the smoothed column feeds the next day unchanged. combine() folds it
//   into the nudge's gate, so every fair-value path that takes the gate takes this too.
// - A date with no row of its own takes the latest row before it; before the first row there is none.
// - Turning the package off stops the growth where it got to: the settlement keeps recording the same
//   log_growth (fair values keep what they gained). Nothing is written while it has never been on.

const targetNudge = require("./targetNudge");

const DAY_MS = 86_400_000;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Growth from rows sorted by date ([{ market_date: "YYYY-MM-DD", log_growth }]): logAt(date) is the latest at or before it. */
function fromRows(rows) {
  const dates = rows.map((row) => row.market_date);
  const logs = rows.map((row) => Number(row.log_growth) || 0);
  const logAt = (marketDate) => {
    const key = targetNudge.dateKey(marketDate);
    if (!key || !dates.length || key < dates[0]) return 0;
    let lo = 0;
    let hi = dates.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (dates[mid] <= key) lo = mid;
      else hi = mid - 1;
    }
    return logs[lo];
  };
  return { active: logs.some((log) => log !== 0), logAt, rows };
}

const NONE = fromRows([]);

/**
 * Every row, oldest first, or null when the table can't be read (a database without the migration).
 * Inside a transaction it reads in a savepoint, so a failure never aborts the caller's.
 */
async function readRows(db, inTransaction) {
  const sql = `SELECT market_date::text AS market_date, log_growth FROM market.fair_value_growth ORDER BY market_date ASC`;
  try {
    if (!inTransaction) return (await db.query(sql)).rows;
    await db.query("SAVEPOINT fair_value_growth");
    try {
      const { rows } = await db.query(sql);
      await db.query("RELEASE SAVEPOINT fair_value_growth");
      return rows;
    } catch (error) {
      await db.query("ROLLBACK TO SAVEPOINT fair_value_growth");
      throw error;
    }
  } catch (error) {
    console.warn("fair value growth: unreadable, no growth", String(error?.message || error));
    return null;
  }
}

/** The growth for reading paths. Never records anything. */
async function loadGrowth(db, { inTransaction = false } = {}) {
  return fromRows((await readRows(db, inTransaction)) ?? []);
}

/**
 * The growth for a regular settlement of `marketDate` (in its transaction): records the date's row
 * the first time it runs, with `perDay` (marketPackage.growthPerDay(), 0 while off) for each day
 * since the row before. Writes nothing while there has never been any growth, or when the date
 * already has a row or a later date does (a regular settle of an old gap day).
 */
async function recordGrowth(client, marketDate, perDay) {
  const key = targetNudge.dateKey(marketDate);
  const rows = await readRows(client, true);
  if (rows === null) return NONE;
  if (!key) return fromRows(rows);
  const last = rows[rows.length - 1] ?? null;
  if (last && last.market_date >= key) return fromRows(rows);
  if (!last && !(perDay > 0)) return NONE;
  const days = last ? Math.max(daysBetween(last.market_date, key), 0) : 1;
  const logGrowth = (last ? Number(last.log_growth) || 0 : 0) + (perDay > 0 ? perDay * days : 0);
  await client.query(`INSERT INTO market.fair_value_growth (market_date, log_growth, per_day) VALUES ($1::date, $2, $3) ON CONFLICT (market_date) DO NOTHING`, [key, logGrowth, perDay > 0 ? perDay : 0]);
  return fromRows([...rows, { market_date: key, log_growth: logGrowth }]);
}

/**
 * The nudge's gate with the growth folded in: nudge(stock, date) is the whole log factor on that
 * day's fair value, apply() multiplies by it. The nudge's own fields (pct, from, source) stay as
 * they are for the admin status.
 */
function combine(gate, growth) {
  if (!growth?.active) return gate;
  const nudge = (stableId, marketDate) => gate.nudge(stableId, marketDate) + growth.logAt(marketDate);
  return {
    ...gate,
    active: true,
    nudge,
    apply(fairValue, stableId, marketDate) {
      const n = nudge(stableId, marketDate);
      if (n === 0) return fairValue;
      const value = Number(fairValue);
      return Number.isFinite(value) ? value * Math.exp(n) : fairValue;
    },
  };
}

/** The nudge's reading gate with the growth folded in. */
async function loadFairValueGate(db, { inTransaction = false } = {}) {
  return combine(await targetNudge.loadGate(db, { inTransaction }), await loadGrowth(db, { inTransaction }));
}

module.exports = { NONE, combine, fromRows, loadFairValueGate, loadGrowth, recordGrowth };
