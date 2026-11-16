// The trade ticket's numbers: what an order should fill at (the quote moved by slippage on the order's
// size, the way api/src/services/trading.js computeExecutionPrice prices it), what it costs or brings
// in with the fee, and the most shares the MAX button can ask for. Plain JavaScript so `npm test` can
// run it without a build (trade-estimate.test.mjs).

/** trading.js DEFAULT_TRADING_FEE_RATE. */
export const FEE_RATE = 0.01;
/** trading.js DEFAULT_EXECUTION_SLIPPAGE_WEIGHT: an order pays this times its share of the stock's depth. */
export const SLIPPAGE_WEIGHT = 0.5;
/** Slippage over this share of the quote gets a line on the ticket. */
export const BIG_ORDER_SLIP = 0.01;
/** The share box takes six digits. */
const MAX_INPUT_SHARES = 999_999;

/**
 * How far an order this size fills from the quote, as a fraction (0.045 is 4.5%). Without a depth
 * (an older payload) there's nothing to work it out from, so none.
 * @param {number} quantity
 * @param {number | null | undefined} depth
 */
export function slippageFraction(quantity, depth) {
  if (depth === null || depth === undefined || !Number.isFinite(depth)) return 0;
  return (SLIPPAGE_WEIGHT * Math.max(quantity || 0, 0)) / Math.max(depth, 1);
}

/**
 * The price a share should fill at: a buy pays the ask plus slippage, a sell gets the bid less it.
 * @param {"buy" | "sell"} side
 * @param {number} quote The ask for a buy, the bid for a sell.
 * @param {number} quantity
 * @param {number | null | undefined} depth
 */
export function fillPrice(side, quote, quantity, depth) {
  const slip = slippageFraction(quantity, depth);
  return side === "buy" ? quote * (1 + slip) : quote * (1 - slip);
}

/**
 * What an order comes to at `price` a share. The fee comes out of Credit first: a buy's `total` is the
 * Cash it takes (shares plus whatever fee Credit doesn't cover), a sale's what lands in Cash.
 * @param {{ side: "buy" | "sell"; price: number; quantity: number; credit?: number | null; sellCreditRate?: number | null }} input
 */
export function orderTotals({ side, price, quantity, credit = 0, sellCreditRate = 0 }) {
  const gross = Math.max(price || 0, 0) * Math.max(quantity || 0, 0);
  const fee = gross * FEE_RATE;
  const feeFromCredit = Math.min(Math.max(credit || 0, 0), fee);
  const total = side === "buy" ? gross + fee - feeFromCredit : gross - (fee - feeFromCredit);
  const creditEarned = side === "sell" ? gross * (sellCreditRate || 0) : 0;
  return { gross, fee, feeFromCredit, total, creditEarned };
}

/**
 * The most whole shares a buy can ask for: no more than the share allowance left this tick, the
 * shares for sale, or what Cash covers at the ask with slippage and the fee (Credit paying the fee
 * first). A bigger order slips more, so this searches rather than divides.
 * @param {{ ask: number | null | undefined; depth?: number | null; cash: number | null | undefined; credit?: number | null; room?: number | null; forSale?: number | null }} input
 */
export function maxBuyShares({ ask, depth = null, cash, credit = 0, room = null, forSale = null }) {
  if (!(ask && ask > 0) || !(cash && cash > 0)) return 0;
  const caps = [MAX_INPUT_SHARES, room, forSale].filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  let hi = Math.max(0, Math.floor(Math.min(...caps)));
  // A hair under the balance, so rounding here never asks for a cent more than the API sees.
  const budget = cash * (1 - 1e-9);
  const fits = (/** @type {number} */ quantity) => orderTotals({ side: "buy", price: fillPrice("buy", ask, quantity, depth), quantity, credit }).total <= budget;
  if (fits(hi)) return hi;
  let lo = 0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The most whole shares a sale can ask for: what you hold less what queued sells already promised,
 * within the allowance left this tick. `all` says whether that's everything you hold.
 * @param {{ held: number | null | undefined; queued?: number | null; room?: number | null }} input
 */
export function maxSellShares({ held, queued = 0, room = null }) {
  const free = Math.max(0, (held || 0) - Math.max(queued || 0, 0));
  const capped = room !== null && room !== undefined && Number.isFinite(room) ? Math.min(free, room) : free;
  const shares = Math.max(0, Math.floor(capped));
  return { shares, all: shares > 0 && shares >= Math.floor(held || 0) };
}

/**
 * A share count the ticket can hold: whole, not negative, no more than `max` (the MAX button's
 * number), or what the share box takes when there's no max to go by.
 * @param {number | string | null | undefined} value
 * @param {number | null} [max]
 */
export function clampShares(value, max = null) {
  const cap = max !== null && max !== undefined && Number.isFinite(max) ? Math.min(Math.max(0, Math.floor(max)), MAX_INPUT_SHARES) : MAX_INPUT_SHARES;
  const shares = Math.floor(Number(value) || 0);
  return Math.min(Math.max(shares, 0), cap);
}

/**
 * The −/+ buttons: one share at a time, never past `max` and never under one share (when there's one
 * to have). A count already over the max steps down to the max.
 * @param {number} quantity
 * @param {number} delta
 * @param {number | null} [max]
 */
export function stepShares(quantity, delta, max = null) {
  const next = clampShares(Math.floor(quantity || 0) + delta, max);
  return Math.max(next, Math.min(1, clampShares(MAX_INPUT_SHARES, max)));
}

/**
 * How far the on-screen keyboard reaches up from the bottom of the layout viewport, from the visual
 * viewport's height and offset. Under `threshold` it's a browser bar moving, not a keyboard, so none.
 * @param {{ innerHeight: number; viewHeight: number; offsetTop?: number; threshold?: number }} input
 */
export function keyboardInset({ innerHeight, viewHeight, offsetTop = 0, threshold = 60 }) {
  const inset = Math.max(0, Math.round(innerHeight - viewHeight - (offsetTop || 0)));
  return inset > threshold ? inset : 0;
}
