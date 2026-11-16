// A small daily factor in each stock's fair value that only the server knows.
//
// Fair value (the target the day's ticks pull toward) comes from public channel numbers through a
// public formula (fundamentals.computeDerivedSnapshot), so without this anyone could work out a
// day's target before it is revealed (marketSecrecy.js). Each stock's fair value for a market date
// is multiplied by exp(nudge), with
//
//   u     = the first 48 bits of HMAC-SHA256(MARKET_TARGET_SECRET, "<youtube_channel_id>|<YYYY-MM-DD>") / 2^48
//   nudge = (2u − 1) × MARKET_TARGET_NUDGE_PCT / 100      (default 3: within ±3% in log terms)
//
// - Applied once, where the smoothed fundamental becomes the day's fair value (settlement and the
//   fundamentals refresh of current_fair_value), never inside the smoothing chain: the smoothed
//   fundamental feeds the next day, and a nudge there would compound into a random walk.
// - Deterministic: the same secret, stock and date always give the same factor, so a rebuild or a
//   regenerated day reproduces the values it wrote the first time. No Math.random.
// - Off when the secret is missing, empty or whitespace: the factor is exactly 1, the fair value is
//   returned untouched and nothing here touches the database.
// - Never rewrites history. Days before the activation date get no nudge. The activation date is
//   MARKET_TARGET_NUDGE_FROM when set; otherwise the first regular (not forced) settlement that runs
//   with the secret records its market date in market.market_runtime_state.target_nudge_from, and
//   that stays. A forced replay (rebuild, "Regenerate a day") never records it, and nothing is nudged
//   while no date is recorded.
// - The nudge itself is never stored or sent anywhere. Changing the secret or the percent after
//   activation changes what a replay of the days since would produce.

const crypto = require("node:crypto");

const DEFAULT_PCT = 3;
const MAX_PCT = 10;
const STATE_KEY = "primary";

function isDateKey(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/** A market date as YYYY-MM-DD. A Date is read the way node-pg builds one for a DATE column (local midnight). */
function dateKey(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** The settings in force, read from the environment each time (so a test can change them). */
function settings(env = process.env) {
  const secret = String(env.MARKET_TARGET_SECRET ?? "").trim();
  const rawPct = String(env.MARKET_TARGET_NUDGE_PCT ?? "").trim();
  let pct = DEFAULT_PCT;
  let pctValid = true;
  if (rawPct) {
    const parsed = Number(rawPct);
    if (Number.isFinite(parsed) && parsed >= 0) pct = Math.min(parsed, MAX_PCT);
    else pctValid = false;
  }
  const rawFrom = String(env.MARKET_TARGET_NUDGE_FROM ?? "").trim();
  const from = isDateKey(rawFrom) ? rawFrom : null;
  return { secret, pct, from, enabled: secret.length > 0 && pct > 0, pctValid, fromValid: !rawFrom || from !== null };
}

/** The raw nudge for one stock on one market date, ignoring activation: in [−pct, +pct) as a fraction. */
function rawNudge(stableId, marketDate, config = settings()) {
  const key = dateKey(marketDate);
  if (!config.enabled || !stableId || !key) return 0;
  const digest = crypto.createHmac("sha256", config.secret).update(`${stableId}|${key}`).digest();
  const u = digest.readUIntBE(0, 6) / 2 ** 48;
  return (2 * u - 1) * (config.pct / 100);
}

/**
 * What every fair-value path asks: the nudge for a stock on a date (0 before the activation date or
 * when off), and the fair value with it applied. `from` is the activation date, `source` where it
 * came from ("env" or "recorded"), both null when nothing is nudged yet.
 */
function makeGate(config, from = null, source = null) {
  const active = Boolean(config.enabled && from);
  const nudge = (stableId, marketDate) => {
    if (!active) return 0;
    const key = dateKey(marketDate);
    if (!key || key < from) return 0;
    return rawNudge(stableId, key, config);
  };
  return {
    enabled: config.enabled,
    active,
    pct: config.pct,
    from: active ? from : null,
    source: active ? source : null,
    nudge,
    /** The fair value for that stock and date: `fairValue × exp(nudge)`, or the input itself when the nudge is 0. */
    apply(fairValue, stableId, marketDate) {
      const n = nudge(stableId, marketDate);
      if (n === 0) return fairValue;
      const value = Number(fairValue);
      return Number.isFinite(value) ? value * Math.exp(n) : fairValue;
    },
  };
}

const OFF = makeGate({ enabled: false, pct: 0, secret: "" });

/** Runs a query in a savepoint when inside a transaction, so a failure here never aborts the caller's. */
async function guardedQuery(db, sql, params, inTransaction) {
  if (!inTransaction) return db.query(sql, params);
  await db.query("SAVEPOINT target_nudge");
  try {
    const result = await db.query(sql, params);
    await db.query("RELEASE SAVEPOINT target_nudge");
    return result;
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT target_nudge");
    throw error;
  }
}

/**
 * The gate for reading paths (the fundamentals refresh, tick reasons, previews, forced replays): the
 * activation date from MARKET_TARGET_NUDGE_FROM or the recorded one. Never records anything.
 */
async function loadGate(db, { inTransaction = false, config = settings() } = {}) {
  if (!config.enabled) return OFF;
  if (config.from) return makeGate(config, config.from, "env");
  try {
    const { rows } = await guardedQuery(
      db,
      `SELECT target_nudge_from::text AS from_date FROM market.market_runtime_state WHERE state_key = $1`,
      [STATE_KEY],
      inTransaction
    );
    const from = dateKey(rows[0]?.from_date);
    return from ? makeGate(config, from, "recorded") : makeGate(config, null, null);
  } catch (error) {
    console.warn("target nudge: activation date unreadable, no nudge", String(error?.message || error));
    return makeGate(config, null, null);
  }
}

/**
 * The gate for a regular settlement of `marketDate`: as loadGate, but when the secret is set and no
 * activation date exists yet, records this market date as the activation date (first writer wins).
 * Runs in the settlement's transaction, so a settlement that fails records nothing.
 */
async function recordGate(client, marketDate, { config = settings() } = {}) {
  if (!config.enabled) return OFF;
  if (config.from) return makeGate(config, config.from, "env");
  const key = dateKey(marketDate);
  if (!key) return loadGate(client, { inTransaction: true, config });
  try {
    await guardedQuery(client, `INSERT INTO market.market_runtime_state (state_key) VALUES ($1) ON CONFLICT (state_key) DO NOTHING`, [STATE_KEY], true);
    const { rows } = await guardedQuery(
      client,
      `
      UPDATE market.market_runtime_state
      SET target_nudge_from = COALESCE(target_nudge_from, $2::date)
      WHERE state_key = $1
      RETURNING target_nudge_from::text AS from_date
    `,
      [STATE_KEY, key],
      true
    );
    const from = dateKey(rows[0]?.from_date);
    return from ? makeGate(config, from, "recorded") : makeGate(config, null, null);
  } catch (error) {
    console.warn("target nudge: activation date not recorded, no nudge", String(error?.message || error));
    return makeGate(config, null, null);
  }
}

/** For the admin tuning page: whether it's on and since when. Never the secret or a nudge. */
async function adminStatus(db, config = settings()) {
  const gate = await loadGate(db, { config });
  return {
    target_nudge_enabled: config.enabled,
    target_nudge_pct: config.enabled ? config.pct : 0,
    target_nudge_from: gate.from,
    target_nudge_from_source: gate.source,
  };
}

/** The one line the API logs at startup: on or off, never a value. */
function startupLine(config = settings()) {
  const warnings = [];
  if (!config.pctValid) warnings.push(`MARKET_TARGET_NUDGE_PCT is not a number ≥ 0, using ${DEFAULT_PCT}`);
  if (!config.fromValid) warnings.push("MARKET_TARGET_NUDGE_FROM is not a YYYY-MM-DD date, ignored");
  const state = config.enabled
    ? `on (±${config.pct}%, ${config.from ? `from ${config.from}` : "from the first settlement that runs with it"})`
    : "off";
  return `Market target nudge: ${state}${warnings.length ? `; ${warnings.join("; ")}` : ""}`;
}

module.exports = { DEFAULT_PCT, MAX_PCT, adminStatus, dateKey, loadGate, makeGate, rawNudge, recordGate, settings, startupLine, OFF };
