// The Weekly Evaluation, Saturday 00:00 ET (docs/market/core-market.md; BBB's "Weekly Evaluation &
// Dividends"). In BBB's order, in one transaction:
//
//   1. Close buybacks: a stock still over its max shares has the excess bought back from every holder
//      in proportion, at its last revealed base rate. Ownership shares stay the same.
//   2. Dividends and share fees: each channel's value now against a week ago (ln of the smoothed
//      fundamental), ranked on a bell curve (rank → normal score) across the market. Within the
//      dead zone: 0.
//      Otherwise RATE_PER_SIGMA per standard deviation, capped at ±CAP, times the stock's average
//      revealed base rate over the week, per share held. Fees may take cash below zero.
//   3. Max shares from subscribers on a bell curve (normal CDF of the z-score of ln subscribers)
//      between MIN and MAX. A stock now over its max starts a buyback (frozen, see marketSupply.js).
//      The first evaluation never sets a max below what players already hold.
//   4. The Dividend Review (report_json), notifications to holders, a market socket event.
//
// runWeeklyEvaluation(pool, { evalDate, dryRun }) with dryRun computes everything the same way and
// rolls back (scripts/weekly-evaluation.js preview, GET /api/market/evaluations/preview).

const supply = require("./marketSupply");
const notifications = require("./notifications");
const { publishMarketEvent } = require("./marketEvents");
const { invalidateMarketAssetsCache } = require("../marketCache");

const LOCK_KEY = 9_204_010;
const TIME_ZONE = "America/New_York";

function envNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const CONFIG = {
  ratePerSigma: envNumber("MARKET_DIVIDEND_RATE_PER_SIGMA", 0.04),
  deadzoneSigma: envNumber("MARKET_DIVIDEND_DEADZONE_SIGMA", 0.35),
  cap: envNumber("MARKET_DIVIDEND_CAP", 0.1),
  maxSharesMin: envNumber("MARKET_MAX_SHARES_MIN", 6000),
  maxSharesMax: envNumber("MARKET_MAX_SHARES_MAX", 30000),
  maxSharesStep: 100,
};

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const round = (value, digits = 6) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(digits)));
const money = (value) => `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Dates ─────────────────────────────────────────────────────────────────
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });

/** The Saturday (ET) of the most recent evaluation time at or before `now`, as YYYY-MM-DD. */
function evaluationDateFor(now = new Date()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const daysSinceSaturday = (weekday - 6 + 7) % 7;
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysSinceSaturday);
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ── Maths ─────────────────────────────────────────────────────────────────
function zScores(values) {
  const present = values.filter((value) => Number.isFinite(value));
  if (present.length < 2) return values.map((value) => (Number.isFinite(value) ? 0 : null));
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  const sd = Math.sqrt(present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / present.length);
  return values.map((value) => (Number.isFinite(value) ? (sd > 0 ? (value - mean) / sd : 0) : null));
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
function normalQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * BBB's "bell curve ranking": each value's rank turned into a normal score, so every week has the
 * same spread of payers and fee-takers however lopsided the raw numbers are (ties share a rank).
 */
function rankScores(values) {
  const present = values.map((value, index) => ({ value, index })).filter((entry) => Number.isFinite(entry.value));
  const out = values.map(() => null);
  if (present.length < 2) {
    for (const entry of present) out[entry.index] = 0;
    return out;
  }
  present.sort((x, y) => x.value - y.value);
  let i = 0;
  while (i < present.length) {
    let j = i;
    while (j + 1 < present.length && present[j + 1].value === present[i].value) j += 1;
    const rank = (i + j) / 2 + 1; // average rank for ties, 1-based
    for (let k = i; k <= j; k += 1) out[present[k].index] = normalQuantile((rank - 0.5) / present.length);
    i = j + 1;
  }
  return out;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function dividendRate(z) {
  if (z === null || Math.abs(z) < CONFIG.deadzoneSigma) return 0;
  const signed = Math.sign(z) * (Math.abs(z) - CONFIG.deadzoneSigma) * CONFIG.ratePerSigma;
  return Math.max(-CONFIG.cap, Math.min(CONFIG.cap, signed));
}

function maxSharesFor(z) {
  const span = CONFIG.maxSharesMax - CONFIG.maxSharesMin;
  const raw = CONFIG.maxSharesMin + span * normalCdf(z ?? 0);
  return Math.round(raw / CONFIG.maxSharesStep) * CONFIG.maxSharesStep;
}

// ── Inputs ────────────────────────────────────────────────────────────────
/**
 * Every active stock with this week's inputs. Channel values and base rates come only from market
 * days whose four ticks have all landed (the latest is R), so nothing here tells anyone a base rate
 * that is still secret: "value now" is R's, "a week ago" is R − 7's, and the dividend basis is the
 * average base rate of R and the six days before it. Subscribers (public YouTube numbers) are the
 * latest snapshot's.
 */
async function loadAssets(client, evalDate, { lock = true } = {}) {
  const { rows } = await client.query(
    `
    WITH revealed_day AS (
      SELECT MAX(sess.market_date) AS d
      FROM market.adjustment_sessions sess
      WHERE sess.market_date < $1::date
        AND NOT EXISTS (SELECT 1 FROM market.asset_adjustment_intervals i WHERE i.session_id = sess.id AND i.status = 'scheduled')
    ),
    now_state AS (
      SELECT DISTINCT ON (d.asset_id) d.asset_id, d.market_date, s.fundamental_value_smoothed AS value_now
      FROM market.asset_daily_market_state d
      JOIN market.channel_daily_snapshots s ON s.id = d.snapshot_id
      CROSS JOIN revealed_day r
      WHERE d.market_date <= r.d
      ORDER BY d.asset_id, d.market_date DESC
    ),
    before_state AS (
      SELECT DISTINCT ON (d.asset_id) d.asset_id, s.fundamental_value_smoothed AS value_before
      FROM market.asset_daily_market_state d
      JOIN market.channel_daily_snapshots s ON s.id = d.snapshot_id
      JOIN now_state n ON n.asset_id = d.asset_id
      WHERE d.market_date <= n.market_date - 7
      ORDER BY d.asset_id, d.market_date DESC
    ),
    revealed AS (
      SELECT d.asset_id, AVG(d.fair_value) AS avg_base, (ARRAY_AGG(d.fair_value ORDER BY d.market_date DESC))[1] AS last_base
      FROM market.asset_daily_market_state d
      CROSS JOIN revealed_day r
      WHERE d.market_date > r.d - 7 AND d.market_date <= r.d
      GROUP BY d.asset_id
    ),
    subs AS (
      SELECT DISTINCT ON (s.youtube_channel_id) s.youtube_channel_id, s.subscriber_count
      FROM market.channel_daily_snapshots s
      WHERE s.calculation_status = 'complete' AND s.snapshot_date <= $1::date
      ORDER BY s.youtube_channel_id, s.snapshot_date DESC
    ),
    day_open AS (
      SELECT DISTINCT ON (d.asset_id) d.asset_id, d.mid_open
      FROM market.asset_daily_market_state d
      ORDER BY d.asset_id, d.market_date DESC
    )
    SELECT a.id, a.symbol, a.display_name, a.max_supply, a.circulating_supply, a.treasury_supply, a.broker_buffer_pct,
           a.trading_state, a.current_mid_price, o.mid_open AS day_open,
           sb.subscriber_count, n.value_now, b.value_before, r.avg_base, r.last_base AS last_revealed_base
    FROM market.market_assets a
    LEFT JOIN subs sb ON sb.youtube_channel_id = a.youtube_channel_id
    LEFT JOIN now_state n ON n.asset_id = a.id
    LEFT JOIN before_state b ON b.asset_id = a.id
    LEFT JOIN revealed r ON r.asset_id = a.id
    LEFT JOIN day_open o ON o.asset_id = a.id
    WHERE a.status = 'active'
    ORDER BY a.symbol
    ${lock ? "FOR UPDATE OF a" : ""}
  `,
    [evalDate]
  );
  return rows;
}

async function holdersOf(client, assetId, { lock = true } = {}) {
  const { rows } = await client.query(
    `SELECT user_id, quantity, avg_cost_basis FROM market.portfolio_holdings WHERE asset_id = $1 AND quantity > 0 ORDER BY user_id ${lock ? "FOR UPDATE" : ""}`,
    [assetId]
  );
  return rows.map((row) => ({ userId: Number(row.user_id), quantity: toNumber(row.quantity, 0), avgCost: toNumber(row.avg_cost_basis, 0) }));
}

async function addCash(client, userId, delta, { assetId, entryType, evaluationId }) {
  await client.query(
    `
    INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, updated_at) VALUES ($1, $2, now())
    ON CONFLICT (user_id) DO UPDATE SET cash_balance = market.portfolio_cash_balances.cash_balance + $2, updated_at = now()
  `,
    [userId, delta]
  );
  await client.query(
    `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id) VALUES ($1,$2,$3,0,$4,'weekly_evaluation',$5)`,
    [userId, assetId, entryType, delta, evaluationId]
  );
}

// ── The run ───────────────────────────────────────────────────────────────
async function runWeeklyEvaluation(pool, { evalDate = evaluationDateFor(), dryRun = false, redis = null, logger = console } = {}) {
  const client = await pool.connect();
  const toPublish = [];
  let report = null;
  try {
    await client.query("BEGIN");
    if (!dryRun) {
      const { rows: lock } = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [LOCK_KEY]);
      if (!lock[0]?.ok) {
        await client.query("ROLLBACK");
        return { ok: false, skipped: "locked" };
      }
    }
    // An evaluation runs once. (Its row only exists once it has committed; a failed run leaves none.)
    // Re-running would pay dividends twice and force buybacks that just started, so it is refused.
    const { rows: existing } = await client.query(`SELECT id, status FROM market.weekly_evaluations WHERE eval_date = $1`, [evalDate]);
    if (existing[0]) {
      await client.query("ROLLBACK");
      return { ok: true, skipped: "already_completed", eval_date: evalDate };
    }
    const { rows: previous } = await client.query(`SELECT COUNT(*)::int AS n FROM market.weekly_evaluations WHERE status = 'completed' AND eval_date < $1`, [evalDate]);
    const firstEvaluation = previous[0].n === 0;
    const { rows: created } = await client.query(`INSERT INTO market.weekly_evaluations (eval_date) VALUES ($1) RETURNING id`, [evalDate]);
    const evaluationId = Number(created[0].id);

    const lock = !dryRun; // a preview reads without row locks so it never holds up live fills
    const assets = await loadAssets(client, evalDate, { lock });
    const byUser = new Map(); // userId → { dividends, fees, forced: [...], buybacks: [...] }
    const userEntry = (userId) => {
      if (!byUser.has(userId)) byUser.set(userId, { dividends: 0, fees: 0, lines: [], forced: [], buybacks: [] });
      return byUser.get(userId);
    };
    // Keyed by the id as text (node-pg returns BIGINT ids as strings).
    const results = new Map(assets.map((asset) => [String(asset.id), { asset, held: toNumber(asset.circulating_supply, 0), buybackAction: null }]));

    // 1. Close buybacks.
    const buybacksClosed = [];
    const { rows: activeBuybacks } = await client.query(`SELECT * FROM market.asset_buybacks WHERE status = 'active' ORDER BY asset_id ${lock ? "FOR UPDATE" : ""}`);
    for (const buyback of activeBuybacks) {
      const result = results.get(String(buyback.asset_id));
      if (!result) continue;
      const { asset } = result;
      const holders = await holdersOf(client, asset.id, { lock });
      const held = holders.reduce((sum, holder) => sum + holder.quantity, 0);
      const excess = held - toNumber(asset.max_supply, 0);
      // The base rate of the last day whose ticks have landed (never today's secret one).
      const price = toNumber(asset.last_revealed_base, toNumber(buyback.frozen_price, 0));
      let forcedShares = 0;
      if (excess > 0 && held > 0) {
        for (const holder of holders) {
          // Rounded up to the micro-share so the stock ends at or just under its max.
          const take = Math.min(holder.quantity, Math.ceil(((holder.quantity * excess) / held) * 1e6) / 1e6);
          if (!(take > 0)) continue;
          forcedShares += take;
          const cash = take * price;
          await client.query(`UPDATE market.portfolio_holdings SET quantity = GREATEST(quantity - $3, 0), updated_at = now() WHERE user_id = $1 AND asset_id = $2`, [holder.userId, asset.id, take]);
          await client.query(
            `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id) VALUES ($1,$2,'forced_buyback',$3,0,'weekly_evaluation',$4)`,
            [holder.userId, asset.id, -take, evaluationId]
          );
          await addCash(client, holder.userId, cash, { assetId: asset.id, entryType: "forced_buyback_cash", evaluationId });
          userEntry(holder.userId).forced.push({ symbol: asset.symbol, shares: take, cash });
        }
      }
      await client.query(
        `UPDATE market.asset_buybacks SET status = $2, ended_at = now(), closed_evaluation_id = $3, forced_shares = $4, forced_price = $5 WHERE id = $1`,
        [buyback.id, forcedShares > 0 ? "forced" : "met", evaluationId, forcedShares, forcedShares > 0 ? price : null]
      );
      await client.query(`UPDATE market.market_assets SET trading_state = 'open', updated_at = now() WHERE id = $1`, [asset.id]);
      asset.trading_state = "open";
      result.held = held - forcedShares;
      await supply.setHeld(client, asset.id, result.held);
      result.buybackAction = forcedShares > 0 ? "forced" : "met";
      buybacksClosed.push({ symbol: asset.symbol, display_name: asset.display_name, status: result.buybackAction, forced_shares: round(forcedShares), forced_price: forcedShares > 0 ? round(price) : null, shares_bought: round(toNumber(buyback.shares_bought, 0)) });
    }

    // 2. Dividends and share fees.
    const shifts = assets.map((asset) => {
      const now = toNumber(asset.value_now, 0);
      const before = toNumber(asset.value_before, 0);
      return now > 0 && before > 0 ? Math.log(now / before) : NaN;
    });
    const shiftZ = rankScores(shifts);
    let dividendsTotal = 0;
    let feesTotal = 0;
    for (const [index, asset] of assets.entries()) {
      const result = results.get(String(asset.id));
      const z = shiftZ[index];
      const rate = dividendRate(z);
      const basis = toNumber(asset.avg_base, 0); // revealed base rates only; none known means no payout
      const perShare = rate * basis;
      Object.assign(result, { shift: Number.isFinite(shifts[index]) ? shifts[index] : null, z, rate, basis, perShare, paid: 0 });
      if (!perShare) continue;
      const holders = await holdersOf(client, asset.id, { lock });
      for (const holder of holders) {
        const amount = Math.round(holder.quantity * perShare * 100) / 100;
        if (!amount) continue;
        await addCash(client, holder.userId, amount, { assetId: asset.id, entryType: amount > 0 ? "dividend" : "share_fee", evaluationId });
        await client.query(
          `INSERT INTO market.dividend_payouts (evaluation_id, user_id, asset_id, quantity, per_share, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
          [evaluationId, holder.userId, asset.id, holder.quantity, perShare, amount]
        );
        const entry = userEntry(holder.userId);
        if (amount > 0) entry.dividends += amount;
        else entry.fees += amount;
        entry.lines.push({ symbol: asset.symbol, amount });
        result.paid += amount;
        if (amount > 0) dividendsTotal += amount;
        else feesTotal += amount;
      }
    }

    // 3. Max shares from subscribers; buybacks for stocks now over their max.
    const subsZ = zScores(assets.map((asset) => (toNumber(asset.subscriber_count, 0) > 0 ? Math.log(toNumber(asset.subscriber_count, 0)) : NaN)));
    const buybacksStarted = [];
    for (const [index, asset] of assets.entries()) {
      const result = results.get(String(asset.id));
      const before = toNumber(asset.max_supply, 0);
      const bufferPct = Math.max(0, toNumber(asset.broker_buffer_pct, 0.02));
      let after = subsZ[index] === null ? before : maxSharesFor(subsZ[index]);
      if (firstEvaluation) after = Math.max(after, Math.ceil(result.held / Math.max(1 - bufferPct, 0.5) / CONFIG.maxSharesStep) * CONFIG.maxSharesStep);
      result.maxBefore = before;
      result.maxAfter = after;
      await client.query(
        `UPDATE market.market_assets SET max_supply = $2, treasury_supply = GREATEST($2 - circulating_supply, 0), updated_at = now() WHERE id = $1`,
        [asset.id, after]
      );
      if (result.held > after + 0.001 && asset.trading_state !== "buyback") {
        // Frozen at the lower of now and today's open, so a late pump can't raise the broker's bid.
        const mid = toNumber(asset.current_mid_price, 0);
        const open = toNumber(asset.day_open, 0);
        const frozenPrice = open > 0 ? Math.min(mid, open) : mid;
        await client.query(
          `INSERT INTO market.asset_buybacks (asset_id, started_evaluation_id, frozen_price, target_max_supply, held_at_start) VALUES ($1,$2,$3,$4,$5)`,
          [asset.id, evaluationId, frozenPrice, after, result.held]
        );
        await client.query(`UPDATE market.market_assets SET trading_state = 'buyback', updated_at = now() WHERE id = $1`, [asset.id]);
        result.buybackAction = result.buybackAction ? `${result.buybackAction}+started` : "started";
        buybacksStarted.push({ symbol: asset.symbol, display_name: asset.display_name, held: round(result.held), max_supply: after, over: round(result.held - after), frozen_price: round(frozenPrice), offer: round(frozenPrice * supply.BUYBACK_START) });
        for (const holder of await holdersOf(client, asset.id, { lock })) userEntry(holder.userId).buybacks.push({ symbol: asset.symbol, offer: frozenPrice * supply.BUYBACK_START });
      }
      await client.query(
        `
        INSERT INTO market.weekly_asset_evaluations (evaluation_id, asset_id, value_now, value_before, shift, z_score, dividend_rate, value_basis, per_share, held, subscribers, max_supply_before, max_supply_after, buyback_action)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `,
        [evaluationId, asset.id, asset.value_now, asset.value_before, round(result.shift), round(result.z), round(result.rate), round(result.basis), round(result.perShare), round(result.held), asset.subscriber_count, before, after, result.buybackAction]
      );
    }

    // 4. The Dividend Review.
    const rows = assets.map((asset) => {
      const result = results.get(String(asset.id));
      return {
        symbol: asset.symbol,
        display_name: asset.display_name,
        rate: round(result.rate),
        per_share: round(result.perShare),
        paid: round(result.paid, 2),
        held: round(result.held),
        max_supply_before: result.maxBefore,
        max_supply_after: result.maxAfter,
        buyback: result.buybackAction,
      };
    });
    const payers = rows.filter((row) => row.rate > 0).sort((a, b) => b.rate - a.rate);
    const chargers = rows.filter((row) => row.rate < 0).sort((a, b) => a.rate - b.rate);
    const users = [...byUser.values()];
    report = {
      eval_date: evalDate,
      generated_at: new Date().toISOString(),
      first_evaluation: firstEvaluation,
      asset_count: rows.length,
      dividends_total: round(dividendsTotal, 2),
      fees_total: round(feesTotal, 2),
      holders_paid: users.filter((entry) => entry.dividends > 0).length,
      holders_charged: users.filter((entry) => entry.fees < 0).length,
      paying_count: payers.length,
      charging_count: chargers.length,
      flat_count: rows.length - payers.length - chargers.length,
      top_dividends: payers.slice(0, 5),
      top_fees: chargers.slice(0, 5),
      max_shares_raised: rows.filter((row) => row.max_supply_after > row.max_supply_before).sort((a, b) => b.max_supply_after - b.max_supply_before - (a.max_supply_after - a.max_supply_before)).slice(0, 5),
      max_shares_lowered: rows.filter((row) => row.max_supply_after < row.max_supply_before).sort((a, b) => a.max_supply_after - a.max_supply_before - (b.max_supply_after - b.max_supply_before)).slice(0, 5),
      buybacks_started: buybacksStarted,
      buybacks_closed: buybacksClosed,
      assets: rows,
      config: { ...CONFIG, buyback_start: supply.BUYBACK_START, buyback_daily_step: supply.BUYBACK_DAILY_STEP, buyback_floor: supply.BUYBACK_FLOOR },
    };
    await client.query(`UPDATE market.weekly_evaluations SET status = 'completed', completed_at = now(), report_json = $2::jsonb WHERE id = $1`, [evaluationId, JSON.stringify(report)]);

    if (!dryRun) {
      for (const [userId, entry] of byUser) {
        const net = entry.dividends + entry.fees + entry.forced.reduce((sum, item) => sum + item.cash, 0);
        const parts = [];
        if (entry.dividends) parts.push(`${money(entry.dividends)} in dividends`);
        if (entry.fees) parts.push(`${money(entry.fees)} in share fees`);
        for (const item of entry.forced) parts.push(`the broker bought back ${round(item.shares, 2)} ${item.symbol} for ${money(item.cash)}`);
        for (const item of entry.buybacks) parts.push(`${item.symbol} is frozen for a buyback at ${money(item.offer)} a share`);
        if (!parts.length) continue;
        const title = entry.dividends && !entry.fees ? `DIVS: ${money(entry.dividends)}` : entry.fees && !entry.dividends ? `Share fees: ${money(entry.fees)}` : `Weekly evaluation: ${money(net)}`;
        const row = await notifications.notify(
          client,
          userId,
          { kind: entry.buybacks.length || entry.forced.length ? "buyback" : "dividend", title, body: `${parts.join("; ")}.`, href: "/market/dividends", data: { eval_date: evalDate, net: round(net, 2) } },
          { publish: false }
        );
        if (row) toPublish.push(row);
      }
    }

    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error?.("weekly evaluation failed:", String(error?.message || error));
    throw error;
  } finally {
    client.release();
  }

  if (!dryRun) {
    notifications.publish(toPublish);
    await invalidateMarketAssetsCache(redis).catch(() => {});
    void publishMarketEvent(redis, { type: "market.weekly_evaluation", eval_date: evalDate, report, at: new Date().toISOString() });
  }
  return { ok: true, dry_run: dryRun, eval_date: evalDate, report };
}

/** Saturday 00:00 in New York for an evaluation date, as a UTC Date (EDT or EST). */
function evaluationStartsAt(evalDate) {
  for (const hour of [4, 5]) {
    const candidate = new Date(`${evalDate}T0${hour}:00:00Z`);
    const et = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "2-digit", hour12: false }).format(candidate);
    if (Number(et) % 24 === 0) return candidate;
  }
  return new Date(`${evalDate}T05:00:00Z`);
}

/** The evaluation the preview should show: this Saturday's if it hasn't run yet, else next Saturday's. */
async function pendingEvaluationDate(pool, now = new Date()) {
  const latest = evaluationDateFor(now);
  const { rows } = await pool.query(`SELECT 1 FROM market.weekly_evaluations WHERE eval_date = $1`, [latest]);
  return rows.length ? shiftDate(latest, 7) : latest;
}

// It runs within CATCH_UP_HOURS of Saturday 00:00 ET (so a short outage still gets its Saturday),
// never for an older Saturday (a first deploy mid-week doesn't pay last week out of the blue), and
// waits RETRY_MS after a failure.
const CATCH_UP_HOURS = 36;
const RETRY_MS = 15 * 60_000;

function startWeeklyEvaluationScheduler(pool, logger = console, redis = null) {
  if ((process.env.MARKET_WEEKLY_EVALUATION_ENABLED || "true").toLowerCase() === "false") return () => {};
  let running = false;
  let retryAt = 0;
  async function tick() {
    if (running || Date.now() < retryAt) return;
    running = true;
    try {
      const evalDate = evaluationDateFor();
      const since = Date.now() - evaluationStartsAt(evalDate).getTime();
      if (since < 0 || since > CATCH_UP_HOURS * 3_600_000) return;
      const { rows } = await pool.query(`SELECT status FROM market.weekly_evaluations WHERE eval_date = $1`, [evalDate]);
      if (!rows.length) {
        const result = await runWeeklyEvaluation(pool, { evalDate, redis, logger });
        if (result.report) logger.log?.(`weekly evaluation ${evalDate}: ${result.report.paying_count} paying, ${result.report.charging_count} charging, ${result.report.buybacks_started.length} buybacks`);
      }
    } catch {
      retryAt = Date.now() + RETRY_MS; // logged in runWeeklyEvaluation
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), 60_000);
  void tick();
  return () => clearInterval(timer);
}

async function listEvaluations(pool, { limit = 12 } = {}) {
  const { rows } = await pool.query(
    `SELECT eval_date::text AS eval_date, completed_at, report_json->'dividends_total' AS dividends_total, report_json->'fees_total' AS fees_total,
            jsonb_array_length(COALESCE(report_json->'buybacks_started', '[]'::jsonb)) AS buybacks_started
     FROM market.weekly_evaluations WHERE status = 'completed' ORDER BY eval_date DESC LIMIT $1`,
    [Math.min(52, Math.max(1, Number(limit) || 12))]
  );
  return rows;
}

async function getEvaluation(pool, evalDate = null) {
  const { rows } = await pool.query(
    evalDate
      ? `SELECT eval_date::text AS eval_date, report_json FROM market.weekly_evaluations WHERE status = 'completed' AND eval_date = $1`
      : `SELECT eval_date::text AS eval_date, report_json FROM market.weekly_evaluations WHERE status = 'completed' ORDER BY eval_date DESC LIMIT 1`,
    evalDate ? [evalDate] : []
  );
  return rows[0] ? { ...rows[0].report_json, eval_date: rows[0].eval_date } : null;
}

/** A player's own dividends and fees, newest evaluation first. */
async function listUserDividends(pool, userId, { limit = 8 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT e.eval_date::text AS eval_date, a.symbol, a.display_name, p.quantity, p.per_share, p.amount
    FROM market.dividend_payouts p
    JOIN market.weekly_evaluations e ON e.id = p.evaluation_id
    JOIN market.market_assets a ON a.id = p.asset_id
    WHERE p.user_id = $1 AND e.eval_date IN (
      SELECT eval_date FROM market.weekly_evaluations WHERE status = 'completed' ORDER BY eval_date DESC LIMIT $2
    )
    ORDER BY e.eval_date DESC, ABS(p.amount) DESC
  `,
    [userId, Math.min(52, Math.max(1, Number(limit) || 8))]
  );
  const weeks = new Map();
  for (const row of rows) {
    if (!weeks.has(row.eval_date)) weeks.set(row.eval_date, { eval_date: row.eval_date, net: 0, lines: [] });
    const week = weeks.get(row.eval_date);
    const amount = toNumber(row.amount, 0);
    week.net = Math.round((week.net + amount) * 100) / 100;
    week.lines.push({ symbol: row.symbol, display_name: row.display_name, quantity: toNumber(row.quantity, 0), per_share: toNumber(row.per_share, 0), amount });
  }
  return [...weeks.values()];
}

module.exports = {
  CONFIG,
  evaluationDateFor,
  evaluationStartsAt,
  pendingEvaluationDate,
  shiftDate,
  zScores,
  rankScores,
  normalQuantile,
  normalCdf,
  dividendRate,
  maxSharesFor,
  runWeeklyEvaluation,
  startWeeklyEvaluationScheduler,
  listEvaluations,
  getEvaluation,
  listUserDividends,
};
