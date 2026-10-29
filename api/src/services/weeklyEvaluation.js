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
//   Rookies (listed by an IPO in the last ROOKIE_DAYS, docs/market/ipo.md): no dividend or fee (their
//   week-over-week shift reads the launch, so they're left out of the ranking too), and their max
//   shares never drop below what players hold.
//   4. The Dividend Review (report_json), notifications to holders, a market socket event.
//
// The transaction reads what it needs in a few set-based queries, works the whole evaluation out in
// memory (planEvaluation) and writes it back in a few more (applyEvaluation, like settlementBatch.js),
// so the stocks, holdings and wallets stay locked for about ten statements, not one to five per holder
// per stock. While CLOSE_TRADING, trading is also closed for the run (pauseTrading).
//
// runWeeklyEvaluation(pool, { evalDate, dryRun }) with dryRun works everything out the same way and
// writes nothing, without row locks (scripts/weekly-evaluation.js preview, GET /api/market/evaluations/preview).

const supply = require("./marketSupply");
const economy = require("./economy");
const pgNumeric = require("./pgNumeric");
const notifications = require("./notifications");
const marketState = require("./marketState");
const trading = require("./trading");
const { acquireSchedulerLock, releaseSchedulerLock } = require("./marketScheduler");
const { getStarterCash, getStarterCredit } = require("./portfolioCash");
const { publishMarketEvent, publishMarketStatusEvent } = require("./marketEvents");
const { invalidateMarketAssetsCache } = require("../marketCache");

const LOCK_KEY = 9_204_010;
const ROOKIE_DAYS = 28; // a new listing's first four evaluations
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

/**
 * The safety switch: close trading while a real evaluation runs (pauseTrading). On until the batched
 * evaluation has run in production once; then set MARKET_WEEKLY_EVALUATION_CLOSE_TRADING=false.
 */
const CLOSE_TRADING = (process.env.MARKET_WEEKLY_EVALUATION_CLOSE_TRADING || "true").toLowerCase() !== "false";

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

/** Today's date in New York, as YYYY-MM-DD: the key an on-demand (playtest) evaluation runs under. */
function todayInNewYork(now = new Date()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
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
 * latest snapshot's. `ids` narrows it to stocks already locked (lockActiveAssets).
 */
async function loadAssets(client, evalDate, ids = null) {
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
           sb.subscriber_count, n.value_now, b.value_before, r.avg_base, r.last_base AS last_revealed_base,
           (l.listed_on IS NOT NULL AND l.listed_on > $1::date - ${ROOKIE_DAYS}) AS rookie
    FROM market.market_assets a
    LEFT JOIN market.ipo_listings l ON l.asset_id = a.id AND l.status = 'listed'
    LEFT JOIN subs sb ON sb.youtube_channel_id = a.youtube_channel_id
    LEFT JOIN now_state n ON n.asset_id = a.id
    LEFT JOIN before_state b ON b.asset_id = a.id
    LEFT JOIN revealed r ON r.asset_id = a.id
    LEFT JOIN day_open o ON o.asset_id = a.id
    WHERE a.status = 'active' ${ids ? "AND a.id = ANY($2::bigint[])" : ""}
    ORDER BY a.symbol
  `,
    ids ? [evalDate, ids] : [evalDate]
  );
  return rows;
}

/** Locks every active stock, in id order like settlement and trading, and returns their ids. */
async function lockActiveAssets(client) {
  const { rows } = await client.query(`SELECT id FROM market.market_assets WHERE status = 'active' ORDER BY id FOR UPDATE`);
  return rows.map((row) => row.id);
}

/** Every holding of these stocks: Map stock id (text) → Map player → exact quantity, players in id order. */
async function loadHoldings(client, assetIds, { lock }) {
  const { rows } = await client.query(
    `SELECT asset_id, user_id, quantity FROM market.portfolio_holdings WHERE asset_id = ANY($1::bigint[]) AND quantity > 0 ORDER BY asset_id, user_id ${lock ? "FOR UPDATE" : ""}`,
    [assetIds]
  );
  const holdings = new Map();
  for (const row of rows) {
    const key = String(row.asset_id);
    if (!holdings.has(key)) holdings.set(key, new Map());
    holdings.get(key).set(Number(row.user_id), pgNumeric.parse(row.quantity));
  }
  return holdings;
}

/** The wallets the evaluation can move (these players', and every positive Credit balance for the conversion), exact. */
async function loadWallets(client, userIds, { lock }) {
  const { rows } = await client.query(
    `SELECT user_id, cash_balance, credit_balance FROM market.portfolio_cash_balances WHERE user_id = ANY($1::bigint[]) OR credit_balance > 0 ORDER BY user_id ${lock ? "FOR UPDATE" : ""}`,
    [userIds]
  );
  return new Map(rows.map((row) => [Number(row.user_id), { cash: pgNumeric.parse(row.cash_balance), credit: pgNumeric.parse(row.credit_balance) }]));
}

// ── Working it out ────────────────────────────────────────────────────────
/**
 * The whole evaluation, worked out in memory from what the database holds, and the writes that make
 * it so. It replays the row-at-a-time version step for step (BBB's order, the same JS arithmetic, each
 * wallet read back exactly as its NUMERIC column would be after the moves before it), so it lands on
 * the same cents, ledger rows and notifications. Pure: a dry run reports it, a real run applies it.
 *
 * holdings: Map stock id (text) → Map player → exact quantity (loadHoldings); updated in place.
 * wallets: Map player → { cash, credit }, exact (loadWallets); updated in place.
 */
function planEvaluation({ evalDate, evaluationId, firstEvaluation, onDemand, assets, activeBuybacks, holdings, wallets }) {
  const writes = { holdings: [], buybacksClosed: [], assets: [], buybacksStarted: [], assetEvaluations: [], payouts: [], accountsOpened: [], moves: [] };
  const ledger = { referenceType: "weekly_evaluation", referenceId: evaluationId };
  const byUser = new Map(); // userId → { dividends, fees, forced: [...], buybacks: [...] }
  const userEntry = (userId) => {
    if (!byUser.has(userId)) byUser.set(userId, { dividends: 0, fees: 0, lines: [], forced: [], buybacks: [] });
    return byUser.get(userId);
  };
  // Keyed by the id as text (node-pg returns BIGINT ids as strings).
  const results = new Map(assets.map((asset) => [String(asset.id), { asset, held: toNumber(asset.circulating_supply, 0), buybackAction: null }]));
  /** A stock's holders (quantity > 0) in id order, as JS numbers. */
  const holdersOf = (assetId) => {
    const holders = [];
    for (const [userId, quantity] of holdings.get(String(assetId)) || []) {
      if (pgNumeric.compare(quantity, pgNumeric.ZERO) > 0) holders.push({ userId, quantity: pgNumeric.toNumber(quantity) });
    }
    return holders;
  };
  /**
   * The player's wallet. One that doesn't exist yet is opened the way the row-at-a-time version
   * opened it: empty when a forced buyback's Cash came first (it upserted that Cash alone), with the
   * starter balances and their ledger row when a dividend or fee did (lockWallet).
   */
  const walletOf = (userId, { opening }) => {
    if (!wallets.has(userId)) {
      const starter = opening === "starter";
      const cash = starter ? getStarterCash() : 0;
      const credit = starter ? getStarterCredit() : 0;
      wallets.set(userId, { cash: pgNumeric.parse(cash), credit: pgNumeric.parse(credit) });
      writes.accountsOpened.push({ userId, cash, credit, starter });
    }
    return wallets.get(userId);
  };
  /** economy.writeMove, recorded: the wallet moves by the numbers as written, and the ledger row is kept. */
  const move = (userId, { cash = 0, credit = 0, ...row }) => {
    const wallet = wallets.get(userId);
    wallet.cash = pgNumeric.add(wallet.cash, pgNumeric.parse(cash));
    wallet.credit = pgNumeric.add(wallet.credit, pgNumeric.parse(credit));
    writes.moves.push({ userId, cash, credit, ...ledger, ...row });
  };

  // 1. Close buybacks.
  const buybacksClosed = [];
  for (const buyback of activeBuybacks) {
    const result = results.get(String(buyback.asset_id));
    if (!result) continue;
    const { asset } = result;
    const holders = holdersOf(asset.id);
    const held = holders.reduce((sum, holder) => sum + holder.quantity, 0);
    const excess = held - toNumber(asset.max_supply, 0);
    // The base rate of the last day whose ticks have landed (never today's secret one).
    const price = toNumber(asset.last_revealed_base, toNumber(buyback.frozen_price, 0));
    let forcedShares = 0;
    if (excess > 0 && held > 0) {
      const quantities = holdings.get(String(asset.id));
      for (const holder of holders) {
        // Rounded up to the micro-share so the stock ends at or just under its max.
        const take = Math.min(holder.quantity, Math.ceil(((holder.quantity * excess) / held) * 1e6) / 1e6);
        if (!(take > 0)) continue;
        forcedShares += take;
        const cash = take * price;
        const left = pgNumeric.add(quantities.get(holder.userId), pgNumeric.parse(-take));
        quantities.set(holder.userId, pgNumeric.compare(left, pgNumeric.ZERO) > 0 ? left : pgNumeric.ZERO);
        writes.holdings.push({ userId: holder.userId, assetId: asset.id, take });
        writes.moves.push({ userId: holder.userId, assetId: asset.id, entryType: "forced_buyback", quantityDelta: -take, cash: 0, credit: 0, ...ledger });
        walletOf(holder.userId, { opening: "empty" });
        move(holder.userId, { assetId: asset.id, entryType: "forced_buyback_cash", cash });
        userEntry(holder.userId).forced.push({ symbol: asset.symbol, shares: take, cash });
      }
    }
    writes.buybacksClosed.push({ id: buyback.id, status: forcedShares > 0 ? "forced" : "met", forcedShares, forcedPrice: forcedShares > 0 ? price : null });
    asset.trading_state = "open";
    result.tradingState = "open";
    result.held = held - forcedShares;
    result.setHeld = true;
    result.buybackAction = forcedShares > 0 ? "forced" : "met";
    buybacksClosed.push({ symbol: asset.symbol, display_name: asset.display_name, status: result.buybackAction, forced_shares: round(forcedShares), forced_price: forcedShares > 0 ? round(price) : null, shares_bought: round(toNumber(buyback.shares_bought, 0)) });
  }

  // 2. Dividends and share fees.
  const shifts = assets.map((asset) => {
    const now = toNumber(asset.value_now, 0);
    const before = toNumber(asset.value_before, 0);
    return now > 0 && before > 0 && !asset.rookie ? Math.log(now / before) : NaN;
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
    for (const holder of holdersOf(asset.id)) {
      const amount = Math.round(holder.quantity * perShare * 100) / 100;
      if (!amount) continue;
      // Dividends pay Credit; share fees come out of Credit first, then Cash (which can go below zero).
      const wallet = walletOf(holder.userId, { opening: "starter" });
      if (amount > 0) move(holder.userId, { assetId: asset.id, entryType: "dividend", credit: Math.max(0, amount) });
      else {
        const split = economy.splitCharge({ cash: pgNumeric.toNumber(wallet.cash), credit: pgNumeric.toNumber(wallet.credit) }, -amount, "credit_then_cash", { shortfall: "cash" });
        move(holder.userId, { assetId: asset.id, entryType: "share_fee", cash: -split.cash, credit: -split.credit });
      }
      writes.payouts.push({ userId: holder.userId, assetId: asset.id, quantity: holder.quantity, perShare, amount });
      const entry = userEntry(holder.userId);
      if (amount > 0) entry.dividends += amount;
      else entry.fees += amount;
      entry.lines.push({ symbol: asset.symbol, amount });
      result.paid += amount;
      if (amount > 0) dividendsTotal += amount;
      else feesTotal += amount;
    }
  }

  // 2b. Part of every player's Credit turns into Cash (economy.SETTINGS.weeklyConversionRate).
  const conversion = economy.planCreditConversion(
    [...wallets.entries()].sort(([a], [b]) => a - b).map(([userId, wallet]) => ({ userId, credit: wallet.credit }))
  );
  writes.moves.push(...economy.conversionMoves(conversion, evaluationId));
  for (const converted of conversion.moves) if (byUser.has(converted.userId)) byUser.get(converted.userId).converted = converted.amount;

  // 3. Max shares from subscribers; buybacks for stocks now over their max.
  const subsZ = zScores(assets.map((asset) => (toNumber(asset.subscriber_count, 0) > 0 ? Math.log(toNumber(asset.subscriber_count, 0)) : NaN)));
  const buybacksStarted = [];
  for (const [index, asset] of assets.entries()) {
    const result = results.get(String(asset.id));
    const before = toNumber(asset.max_supply, 0);
    const bufferPct = Math.max(0, toNumber(asset.broker_buffer_pct, 0.02));
    let after = subsZ[index] === null ? before : maxSharesFor(subsZ[index]);
    if (firstEvaluation || asset.rookie) after = Math.max(after, Math.ceil(result.held / Math.max(1 - bufferPct, 0.5) / CONFIG.maxSharesStep) * CONFIG.maxSharesStep);
    result.maxBefore = before;
    result.maxAfter = after;
    if (result.held > after + 0.001 && asset.trading_state !== "buyback") {
      // Frozen at the lower of now and today's open, so a late pump can't raise the broker's bid.
      const mid = toNumber(asset.current_mid_price, 0);
      const open = toNumber(asset.day_open, 0);
      const frozenPrice = open > 0 ? Math.min(mid, open) : mid;
      writes.buybacksStarted.push({ assetId: asset.id, frozenPrice, targetMaxSupply: after, heldAtStart: result.held });
      result.tradingState = "buyback";
      result.buybackAction = result.buybackAction ? `${result.buybackAction}+started` : "started";
      buybacksStarted.push({ symbol: asset.symbol, display_name: asset.display_name, held: round(result.held), max_supply: after, over: round(result.held - after), frozen_price: round(frozenPrice), offer: round(frozenPrice * supply.BUYBACK_START) });
      for (const holder of holdersOf(asset.id)) userEntry(holder.userId).buybacks.push({ symbol: asset.symbol, offer: frozenPrice * supply.BUYBACK_START });
    }
    writes.assets.push({ id: asset.id, maxAfter: after, setHeld: Boolean(result.setHeld), held: result.held, tradingState: result.tradingState ?? null });
    writes.assetEvaluations.push({
      assetId: asset.id,
      valueNow: asset.value_now,
      valueBefore: asset.value_before,
      shift: round(result.shift),
      z: round(result.z),
      rate: round(result.rate),
      basis: round(result.basis),
      perShare: round(result.perShare),
      held: round(result.held),
      subscribers: asset.subscriber_count,
      maxBefore: before,
      maxAfter: after,
      buybackAction: result.buybackAction,
    });
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
  const report = {
    eval_date: evalDate,
    generated_at: new Date().toISOString(),
    first_evaluation: firstEvaluation,
    on_demand: onDemand,
    asset_count: rows.length,
    dividends_total: round(dividendsTotal, 2),
    fees_total: round(feesTotal, 2),
    credit_conversion_rate: conversion.rate ?? 0,
    credit_conversion_minimum: conversion.minimum ?? 0,
    credit_converted: conversion.converted,
    players_converted: conversion.players,
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

  // Each player's week, one notification apiece.
  const notices = [];
  for (const [userId, entry] of byUser) {
    const net = entry.dividends + entry.fees + entry.forced.reduce((sum, item) => sum + item.cash, 0);
    const parts = [];
    if (entry.dividends) parts.push(`${money(entry.dividends)} in dividends, as Credit`);
    if (entry.fees) parts.push(`${money(entry.fees)} in share fees`);
    if (entry.converted) parts.push(`${money(entry.converted)} of your Credit turned into Cash`);
    for (const item of entry.forced) parts.push(`the broker bought back ${round(item.shares, 2)} ${item.symbol} for ${money(item.cash)}`);
    for (const item of entry.buybacks) parts.push(`${item.symbol} is frozen for a buyback at ${money(item.offer)} a share`);
    if (!parts.length) continue;
    const title = entry.dividends && !entry.fees ? `DIVS: ${money(entry.dividends)}` : entry.fees && !entry.dividends ? `Share fees: ${money(entry.fees)}` : `Weekly evaluation: ${money(net)}`;
    notices.push({ userId, kind: entry.buybacks.length || entry.forced.length ? "buyback" : "dividend", title, body: `${parts.join("; ")}.`, href: "/market/dividends", data: { eval_date: evalDate, net: round(net, 2) } });
  }

  return { report, writes, notices };
}

// ── Writing it ────────────────────────────────────────────────────────────
/**
 * The plan's writes: a handful of set-based statements whatever the number of players (it was one to
 * five statements per holder per stock). Returns the notification rows to publish after COMMIT.
 */
async function applyEvaluation(client, evaluationId, { report, writes, notices }) {
  // Forced buybacks take their shares, and the buybacks that closed say how.
  if (writes.holdings.length || writes.buybacksClosed.length) {
    await client.query(
      `
      WITH taken AS (
        UPDATE market.portfolio_holdings h
        SET quantity = GREATEST(h.quantity - t.take, 0), updated_at = now()
        FROM jsonb_to_recordset($1::jsonb) AS t("userId" bigint, "assetId" bigint, take numeric)
        WHERE h.user_id = t."userId" AND h.asset_id = t."assetId"
      )
      UPDATE market.asset_buybacks b
      SET status = c.status, ended_at = now(), closed_evaluation_id = $3, forced_shares = c."forcedShares", forced_price = c."forcedPrice"
      FROM jsonb_to_recordset($2::jsonb) AS c(id bigint, status text, "forcedShares" numeric, "forcedPrice" numeric)
      WHERE b.id = c.id
    `,
      [JSON.stringify(writes.holdings), JSON.stringify(writes.buybacksClosed), evaluationId]
    );
  }
  // Stocks (max shares, shares held, trading state), the buybacks that start (in a later statement
  // than the closed ones: one active buyback per stock), each stock's line, the dividend lines and
  // the review itself.
  await client.query(
    `
    WITH stocks AS (
      UPDATE market.market_assets a
      SET circulating_supply = CASE WHEN s."setHeld" THEN GREATEST(s.held, 0) ELSE a.circulating_supply END,
          max_supply = s."maxAfter",
          treasury_supply = GREATEST(s."maxAfter" - CASE WHEN s."setHeld" THEN GREATEST(s.held, 0) ELSE a.circulating_supply END, 0),
          trading_state = COALESCE(s."tradingState", a.trading_state),
          updated_at = now()
      FROM jsonb_to_recordset($2::jsonb) AS s(id bigint, "setHeld" boolean, held numeric, "maxAfter" numeric, "tradingState" text)
      WHERE a.id = s.id
    ),
    started AS (
      INSERT INTO market.asset_buybacks (asset_id, started_evaluation_id, frozen_price, target_max_supply, held_at_start)
      SELECT b."assetId", $1, b."frozenPrice", b."targetMaxSupply", b."heldAtStart"
      FROM jsonb_to_recordset($3::jsonb) AS b("assetId" bigint, "frozenPrice" numeric, "targetMaxSupply" numeric, "heldAtStart" numeric)
    ),
    lines AS (
      INSERT INTO market.weekly_asset_evaluations (evaluation_id, asset_id, value_now, value_before, shift, z_score, dividend_rate, value_basis, per_share, held, subscribers, max_supply_before, max_supply_after, buyback_action)
      SELECT $1, e."assetId", e."valueNow", e."valueBefore", e.shift, e.z, e.rate, e.basis, e."perShare", e.held, e.subscribers, e."maxBefore", e."maxAfter", e."buybackAction"
      FROM jsonb_to_recordset($4::jsonb) AS e("assetId" bigint, "valueNow" numeric, "valueBefore" numeric, shift numeric, z numeric, rate numeric,
        basis numeric, "perShare" numeric, held numeric, subscribers bigint, "maxBefore" numeric, "maxAfter" numeric, "buybackAction" text)
    ),
    payouts AS (
      INSERT INTO market.dividend_payouts (evaluation_id, user_id, asset_id, quantity, per_share, amount)
      SELECT $1, p."userId", p."assetId", p.quantity, p."perShare", p.amount
      FROM jsonb_to_recordset($5::jsonb) AS p("userId" bigint, "assetId" bigint, quantity numeric, "perShare" numeric, amount numeric)
    )
    UPDATE market.weekly_evaluations SET status = 'completed', completed_at = now(), report_json = $6::jsonb WHERE id = $1
  `,
    [evaluationId, JSON.stringify(writes.assets), JSON.stringify(writes.buybacksStarted), JSON.stringify(writes.assetEvaluations), JSON.stringify(writes.payouts), JSON.stringify(report)]
  );
  // Money: accounts opened on the way, then every Cash and Credit move with its ledger row.
  if (writes.accountsOpened.length) {
    await client.query(
      `
      WITH opened AS (
        INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance, updated_at)
        SELECT o."userId", o.cash, o.credit, now()
        FROM jsonb_to_recordset($1::jsonb) AS o("userId" bigint, cash numeric, credit numeric)
      )
      INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, credit_delta, reference_type, reference_id)
      SELECT o."userId", NULL, 'starter_cash_grant', 0, o.cash, o.credit, 'system', 0
      FROM jsonb_to_recordset($1::jsonb) AS o("userId" bigint, cash numeric, credit numeric, starter boolean)
      WHERE o.starter
    `,
      [JSON.stringify(writes.accountsOpened)]
    );
  }
  await economy.writeMoves(client, writes.moves);
  return notifications.notifyMany(client, notices);
}

// ── Closing trading for it ────────────────────────────────────────────────
const LIVE_BATCH_WAIT_MS = 60_000;
const PAUSE_MESSAGE = "Trading is paused for the weekly evaluation (dividends, share fees and max shares). Back in a minute.";

/**
 * The safety switch (CLOSE_TRADING): trading closes for the evaluation the way it closes for the daily
 * settlement (trading_status 'settling': buys, sells and new orders are refused; queued orders wait
 * for the first batch after). It holds the settlement scheduler's lock, so the daily cycle can't run
 * meanwhile and reopen trading, and first waits (up to `waitMs`) for a live-order batch that is
 * filling to finish, so that batch's last orders aren't refused as the market closes. A market an
 * admin closed is left as it is. Returns { ok, closed, resume } or { ok: false, skipped }.
 */
async function pauseTrading(pool, { evalDate, redis = null, logger = console, waitMs = LIVE_BATCH_WAIT_MS }) {
  const client = await pool.connect();
  let schedulerLocked = false;
  let batchesLocked = false;
  const release = async () => {
    if (batchesLocked) await trading.releaseLiveOrderSchedulerLock(client);
    if (schedulerLocked) await releaseSchedulerLock(client);
    client.release();
  };
  try {
    schedulerLocked = await acquireSchedulerLock(client);
    if (!schedulerLocked) {
      await release();
      return { ok: false, skipped: "settlement_running" };
    }
    const deadline = Date.now() + waitMs;
    while (!(batchesLocked = await trading.acquireLiveOrderSchedulerLock(client)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!batchesLocked) logger.warn?.(`weekly evaluation ${evalDate}: a live-order batch was still filling after ${waitMs} ms; closing trading anyway`);
    const before = await marketState.getMarketStatusWithClient(client);
    // Open: close it. Closed by an admin (or left 'settling' by a crash, which a restart reopens): leave it.
    const closed = before?.trading_status === "open";
    if (closed) {
      const status = await marketState.setMarketSettling(client, {
        marketDate: null,
        phase: "settlement",
        message: PAUSE_MESSAGE,
        nextScheduledSettlementAt: before.next_scheduled_settlement_at,
      });
      void publishMarketStatusEvent(redis, status);
    }
    return {
      ok: true,
      closed,
      async resume() {
        try {
          if (closed) {
            const status = await marketState.setMarketOpen(client, {
              message: before.trading_message,
              nextScheduledSettlementAt: before.next_scheduled_settlement_at,
              lastCycleError: before.last_cycle_error, // closing cleared it; the daily cycle's error stays visible
            });
            void publishMarketStatusEvent(redis, status);
          }
        } catch (error) {
          // The API reopens a market left 'settling' when it restarts; until then, say so loudly.
          logger.error?.(`weekly evaluation ${evalDate}: reopening trading failed:`, String(error?.message || error));
        } finally {
          await release();
        }
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}

// ── The run ───────────────────────────────────────────────────────────────
async function evaluate(pool, { evalDate, dryRun, onDemand, redis, logger }) {
  const client = await pool.connect();
  const startedAt = Date.now();
  let lockedAt = startedAt;
  let toPublish = [];
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
    let evaluationId = null;
    if (!dryRun) {
      const { rows: created } = await client.query(`INSERT INTO market.weekly_evaluations (eval_date) VALUES ($1) RETURNING id`, [evalDate]);
      evaluationId = Number(created[0].id);
    }

    // A real run locks the stocks (in id order, like settlement and trading), then the holdings and
    // wallets it moves, and holds them to COMMIT: about ten statements in all, whatever the number of
    // players. A dry run reads without row locks and writes nothing, so it never holds up live fills.
    const lock = !dryRun;
    lockedAt = Date.now();
    const assets = await loadAssets(client, evalDate, lock ? await lockActiveAssets(client) : null);
    const { rows: activeBuybacks } = await client.query(`SELECT * FROM market.asset_buybacks WHERE status = 'active' ORDER BY asset_id ${lock ? "FOR UPDATE" : ""}`);
    const holdings = await loadHoldings(client, assets.map((asset) => asset.id), { lock });
    const holders = new Set();
    for (const stock of holdings.values()) for (const userId of stock.keys()) holders.add(userId);
    const wallets = await loadWallets(client, [...holders], { lock });
    const plan = planEvaluation({ evalDate, evaluationId, firstEvaluation, onDemand, assets, activeBuybacks, holdings, wallets });
    report = plan.report;
    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      toPublish = await applyEvaluation(client, evaluationId, plan);
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error?.("weekly evaluation failed:", String(error?.message || error));
    throw error;
  } finally {
    client.release();
  }
  const finishedAt = Date.now();

  if (!dryRun) {
    notifications.publish(toPublish);
    await notifications.pruneInboxes(pool, toPublish.map((row) => row.user_id)).catch(() => {});
    await invalidateMarketAssetsCache(redis).catch(() => {});
    void publishMarketEvent(redis, { type: "market.weekly_evaluation", eval_date: evalDate, report, at: new Date().toISOString() });
  }
  return { ok: true, dry_run: dryRun, eval_date: evalDate, report, timings_ms: { total: finishedAt - startedAt, rows_locked: finishedAt - lockedAt } };
}

/**
 * Runs the evaluation for `evalDate`, or with `dryRun` works it out and writes nothing. A real run
 * closes trading for its duration while `closeTrading` (CLOSE_TRADING unless told; see pauseTrading).
 */
async function runWeeklyEvaluation(pool, { evalDate = evaluationDateFor(), dryRun = false, onDemand = false, redis = null, logger = console, closeTrading = CLOSE_TRADING } = {}) {
  if (dryRun || !closeTrading) return evaluate(pool, { evalDate, dryRun, onDemand, redis, logger });
  // Don't close trading for one that has already run.
  const { rows: done } = await pool.query(`SELECT 1 FROM market.weekly_evaluations WHERE eval_date = $1`, [evalDate]);
  if (done.length) return { ok: true, skipped: "already_completed", eval_date: evalDate };
  const pause = await pauseTrading(pool, { evalDate, redis, logger });
  if (!pause.ok) return { ok: false, skipped: pause.skipped };
  try {
    return { ...(await evaluate(pool, { evalDate, dryRun, onDemand, redis, logger })), trading_closed: pause.closed };
  } finally {
    await pause.resume();
  }
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
        if (result.report) {
          const { total, rows_locked: locked } = result.timings_ms;
          logger.log?.(`weekly evaluation ${evalDate}: ${result.report.paying_count} paying, ${result.report.charging_count} charging, ${result.report.buybacks_started.length} buybacks; ${total} ms, rows locked ${locked} ms${result.trading_closed ? ", trading closed" : ""}`);
        }
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

/**
 * One stock's past reviews, newest first: its rate (dividend > 0, fee < 0), per share, where its
 * channel growth ranked that week, max shares before and after, and any buyback it started or ended.
 */
async function listAssetEvaluations(pool, symbol, { limit = 12 } = {}) {
  const { rows } = await pool.query(
    `
    WITH ranked AS (
      SELECT wae.*, e.eval_date, e.report_json->>'on_demand' AS on_demand,
             RANK() OVER (PARTITION BY wae.evaluation_id ORDER BY wae.z_score DESC NULLS LAST) AS rank,
             COUNT(*) OVER (PARTITION BY wae.evaluation_id) AS of
      FROM market.weekly_asset_evaluations wae
      JOIN market.weekly_evaluations e ON e.id = wae.evaluation_id AND e.status = 'completed'
    )
    SELECT r.eval_date::text AS eval_date, r.on_demand, r.dividend_rate, r.per_share, r.shift, r.held,
           r.max_supply_before, r.max_supply_after, r.buyback_action, r.rank, r.of
    FROM ranked r JOIN market.market_assets a ON a.id = r.asset_id
    WHERE a.symbol = $1
    ORDER BY r.eval_date DESC
    LIMIT $2
  `,
    [String(symbol).toUpperCase(), Math.min(52, Math.max(1, Number(limit) || 12))]
  );
  return rows.map((row) => ({
    eval_date: row.eval_date,
    on_demand: row.on_demand === "true",
    rate: toNumber(row.dividend_rate, 0),
    per_share: toNumber(row.per_share, 0),
    // The week's channel growth (from revealed days only): ln ratio as a percent.
    growth_pct: row.shift === null ? null : round((Math.exp(Number(row.shift)) - 1) * 100, 2),
    held: toNumber(row.held, 0),
    paid: round(toNumber(row.per_share, 0) * toNumber(row.held, 0), 2),
    max_supply_before: row.max_supply_before === null ? null : toNumber(row.max_supply_before, 0),
    max_supply_after: row.max_supply_after === null ? null : toNumber(row.max_supply_after, 0),
    buyback_action: row.buyback_action,
    rank: Number(row.rank),
    of: Number(row.of),
  }));
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
  listAssetEvaluations,
  CONFIG,
  evaluationDateFor,
  evaluationStartsAt,
  todayInNewYork,
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
