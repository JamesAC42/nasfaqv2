// The market package: four changes that go live together behind one market-wide flag
// (features/market-package.json, "off" until the owner turns it on; BBB approved the design on the
// admin Market sim page, preset "Proposed package" without its limit buys).
//
//   1. Spread: every stock at the old 4% (400 bps) moves to 1.5% (150 bps) at the next Open (the
//      regular settlement), and new listings start at 1.5%. At the Open because the price chart works
//      each fill's mid back from today's spread (marketDb.js), which assumes it held since the last
//      Open. Turning the flag off moves them back at the Open after.
//   2. The trading fee (trading.js getTradingFeeRate, 1%): buys pay none, and a sale pays it only on
//      the shares it takes from buys filled in the last QUICK_SELL_HOURS. A sale takes the newest
//      shares first, so buying more of a stock you already hold and selling the same day pays the fee
//      on what you just bought (as the sim charges a sale within 24 hours of the last buy).
//   3. Growth: fair values carry exp(GROWTH_PER_DAY × days the package has been on), recorded per
//      market day by the regular settlement (fairValueGrowth.js) and applied with the daily nudge,
//      after smoothing, never inside it.
//   4. A holder dividend at the Saturday review: HOLDER_DIVIDEND_PER_WEEK of each stock's dividend
//      basis (its average revealed base rate over the week) per share held, as Credit, on top of the
//      ranked dividend or share fee (weeklyEvaluation.js).
//
// Turning the flag off again: spreads go back at the next Open, fees apply to every trade again,
// growth stops where it got to (fair values keep what they gained, nothing drops), and the review
// pays no holder dividend.

const features = require("../features");

const FLAG = "market-package";
const SPREAD_BPS = 150;
const LEGACY_SPREAD_BPS = 400;
const QUICK_SELL_HOURS = 24;
const QUICK_SELL_MS = QUICK_SELL_HOURS * 3_600_000;
const GROWTH_PER_DAY = 0.0005;
const HOLDER_DIVIDEND_PER_WEEK = 0.0025;

/** Whether the package is on (the same for everyone: a market-wide flag). */
const isOn = () => features.marketOn(FLAG);

/** The spread a newly tracked talent's stock starts with. */
const listingSpreadBps = () => (isOn() ? SPREAD_BPS : LEGACY_SPREAD_BPS);

/** The growth per day fair values pick up while it's on (0 while off). */
const growthPerDay = () => (isOn() ? GROWTH_PER_DAY : 0);

/** The holder dividend's rate for a review (0 while off). */
const holderDividendRate = () => (isOn() ? HOLDER_DIVIDEND_PER_WEEK : 0);

/** The fee rule as the site shows it (portfolio.economy): who pays, and how long shares stay "recent". */
function publicFeeRule(feeRate) {
  return isOn()
    ? { fee_rate: feeRate, fee_on: "quick_sells", quick_sell_hours: QUICK_SELL_HOURS }
    : { fee_rate: feeRate, fee_on: "all_trades", quick_sell_hours: null };
}

const timeOf = (value) => (value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value));

/**
 * The shares still held from buys filled in the window before `now`, as lots oldest first
 * ([{ quantity, at }], `at` in ms). `fills` are this player's fills in one stock, oldest first
 * ({ side, quantity, ts }); a sale takes from the newest lot first, and once those are gone, from
 * shares bought before the window. Fills from before the window are ignored.
 */
function recentLots(fills, now = Date.now(), windowMs = QUICK_SELL_MS) {
  const nowMs = timeOf(now);
  const lots = [];
  for (const fill of fills || []) {
    const at = timeOf(fill.ts);
    const quantity = Number(fill.quantity);
    // A fill stamped a moment after `now` (the database's clock ahead of this one) still counts.
    if (!(quantity > 0) || !Number.isFinite(at) || at <= nowMs - windowMs) continue;
    if (fill.side === "buy") {
      lots.push({ quantity, at });
      continue;
    }
    let left = quantity;
    while (left > 1e-12 && lots.length) {
      const last = lots[lots.length - 1];
      const taken = Math.min(last.quantity, left);
      last.quantity -= taken;
      left -= taken;
      if (last.quantity <= 1e-12) lots.pop();
    }
  }
  return lots;
}

/** The held shares that would pay the fee if sold now: what the recent lots add up to, never more than `held`. */
function recentShares(lots, held) {
  const total = (lots || []).reduce((sum, lot) => sum + lot.quantity, 0);
  return Math.max(0, Math.min(Number(held) || 0, total));
}

/** When the last of the recent shares stops paying the fee (ISO), or null when none do. */
function feeFreeAt(lots, held, windowMs = QUICK_SELL_MS) {
  if (!(recentShares(lots, held) > 0)) return null;
  return new Date(lots[lots.length - 1].at + windowMs).toISOString();
}

/** How many of a sale's `quantity` shares pay the fee: the recent ones it takes (newest first). */
function feeSharesForSale(lots, held, quantity) {
  return Math.max(0, Math.min(Number(quantity) || 0, recentShares(lots, held)));
}

/**
 * The fee on one fill, as the rules in force charge it. `lots` (recentLots) only matter for a sale
 * while the package is on; with it off every fill pays `feeRate` on its whole value.
 */
function fillFee({ side, price, quantity, feeRate, lots = [], held = 0, on = isOn() }) {
  const gross = price * quantity;
  if (!on) return { feeCash: gross * feeRate, feeShares: quantity };
  if (side === "buy") return { feeCash: 0, feeShares: 0 };
  const feeShares = feeSharesForSale(lots, held, quantity);
  return { feeCash: feeShares >= quantity ? gross * feeRate : price * feeShares * feeRate, feeShares };
}

/** This player's fills in these stocks within the window, oldest first: Map "userId:assetId" → fills. */
async function loadRecentFills(db, pairs, now = new Date()) {
  const byKey = new Map();
  const unique = [...new Map((pairs || []).map(([userId, assetId]) => [`${Number(userId)}:${Number(assetId)}`, [Number(userId), Number(assetId)]])).values()];
  if (!unique.length) return byKey;
  const { rows } = await db.query(
    `
    SELECT f.user_id, f.asset_id, f.side, f.quantity, f.ts
    FROM market.trade_fills f
    JOIN jsonb_to_recordset($1::jsonb) AS p(user_id bigint, asset_id bigint) ON p.user_id = f.user_id AND p.asset_id = f.asset_id
    WHERE f.ts > $2::timestamptz - make_interval(secs => $3)
    ORDER BY f.ts ASC, f.id ASC
  `,
    [JSON.stringify(unique.map(([user_id, asset_id]) => ({ user_id, asset_id }))), now.toISOString(), QUICK_SELL_MS / 1000]
  );
  for (const row of rows) {
    const key = `${Number(row.user_id)}:${Number(row.asset_id)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ side: row.side, quantity: Number(row.quantity), ts: row.ts });
  }
  return byKey;
}

/**
 * At a regular settlement, before the day's quotes are worked out: stocks on the old spread move to
 * the package's while it's on, and back while it's off. A stock on any other spread is left alone.
 */
async function syncSpreads(client) {
  const [from, to] = isOn() ? [LEGACY_SPREAD_BPS, SPREAD_BPS] : [SPREAD_BPS, LEGACY_SPREAD_BPS];
  const { rowCount } = await client.query(`UPDATE market.market_assets SET spread_bps = $2, updated_at = now() WHERE spread_bps = $1`, [from, to]);
  return rowCount || 0;
}

module.exports = {
  FLAG,
  GROWTH_PER_DAY,
  HOLDER_DIVIDEND_PER_WEEK,
  LEGACY_SPREAD_BPS,
  QUICK_SELL_HOURS,
  QUICK_SELL_MS,
  SPREAD_BPS,
  feeFreeAt,
  feeSharesForSale,
  fillFee,
  growthPerDay,
  holderDividendRate,
  isOn,
  listingSpreadBps,
  loadRecentFills,
  publicFeeRule,
  recentLots,
  recentShares,
  syncSpreads,
};
