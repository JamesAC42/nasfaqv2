// The market's formulas, line for line from the API, so the simulator prices a trade the way the
// exchange does. Each says where it comes from; tests/mechanics.test.ts checks them against numbers
// the API itself produced (api/test/fixtures/market-sim-parity.json, which api/test/market-sim.test.js
// keeps honest on the API side). Change one here only alongside the API.

import type { Rng } from "./rng";
import type { Side } from "./types";

export const MIN_PRICE = 0.000001;
export const TICKS_PER_DAY = 4;
/** fundamentals.js: momentum is clamped to ±1.35 and multiplies the size anchor by exp(0.35 × momentum). */
export const MOMENTUM_CLAMP = 1.35;
export const MOMENTUM_WEIGHT = 0.35;
/** fundamentals.js: the smoothed fundamental is 0.4 × yesterday's + 0.6 × today's raw value, moving at most ±25% a day. */
export const SMOOTHING_PREVIOUS_WEIGHT = 0.4;
export const SMOOTHING_RAW_WEIGHT = 0.6;
export const FAIR_MOVE_CAP_MIN = 0.75;
export const FAIR_MOVE_CAP_MAX = 1.25;

/** trading.js computeQuotes. */
export function computeQuotes(midPrice: number, spreadBps: number) {
  const spreadPct = Math.max(Number.isFinite(spreadBps) ? spreadBps : 0, 0) / 10000;
  return { bid: midPrice * (1 - spreadPct / 2), ask: midPrice * (1 + spreadPct / 2) };
}

/** trading.js computeShockPct. */
export function computeShockPct(quantity: number, liquidityDepth: number) {
  return Math.max(quantity || 0, 0) / Math.max(liquidityDepth || 0, 1);
}

/** trading.js computeExecutionPrice: the ask (bid) moved by slippage on the order's size. */
export function computeExecutionPrice(side: Side, bid: number, ask: number, quantity: number, liquidityDepth: number, slippageWeight: number) {
  const slip = slippageWeight * computeShockPct(quantity, liquidityDepth);
  return side === "buy" ? ask * (1 + slip) : bid * (1 - slip);
}

/** The fill price at a mid price: quotes, then slippage. */
export function fillPrice(side: Side, mid: number, spreadBps: number, quantity: number, depth: number, slippageWeight: number) {
  const { bid, ask } = computeQuotes(mid, spreadBps);
  return computeExecutionPrice(side, bid, ask, quantity, depth, slippageWeight);
}

/** The mid a fill was priced from (the price scales with the mid, so price ÷ the price at a mid of 1). */
export function midFromFillPrice(side: Side, price: number, spreadBps: number, quantity: number, depth: number, slippageWeight: number) {
  const unit = fillPrice(side, 1, spreadBps, quantity, depth, slippageWeight);
  return unit > 0 ? price / unit : price;
}

/** trading.js applyTradeShock: a buy pushes both offsets up, a sell down. */
export function applyTradeShock(side: Side, quantity: number, liquidityDepth: number, persistent: number, transient: number, weights: { persistent: number; transient: number }) {
  const shock = computeShockPct(quantity, liquidityDepth);
  const sign = side === "buy" ? 1 : -1;
  return { persistent: persistent + sign * weights.persistent * shock, transient: transient + sign * weights.transient * shock };
}

/** trading.js computeLiveMidPrice. */
export function computeLiveMidPrice(fair: number, persistent: number, transient: number) {
  return Math.max(fair || 0, MIN_PRICE) * Math.exp(persistent + transient);
}

/** trading.js decayTransientOffset, with the time since the offsets last moved in minutes. */
export function decayTransientOffset(transient: number, minutes: number, halfLifeMinutes: number) {
  if (!Number.isFinite(transient) || transient === 0) return 0;
  return transient * Math.pow(0.5, Math.max(0, minutes) / Math.max(halfLifeMinutes, 1));
}

/** marketAdjustments.js computeAdjustedPrice: a tick moves the price strengthPct of the way to the base rate. */
export function computeAdjustedPrice(currentMid: number, baseRate: number, strengthPct: number) {
  return currentMid + (baseRate - currentMid) * (strengthPct / 100);
}

/** Per-stock strength bounds that can still add up to the total (the API refuses ones that can't). */
export function feasibleStrengthBounds(total: number, minPct: number, maxPct: number, count = TICKS_PER_DAY) {
  let min = Math.max(1, Math.ceil(minPct || 0));
  let max = Math.max(min, Math.floor(maxPct ?? total));
  if (min * count > total) min = Math.max(1, Math.floor(total / count));
  if (max * count < total) max = Math.ceil(total / count);
  return { min, max: Math.max(min, max) };
}

/**
 * marketAdjustments.js generateStrengths: `count` whole-percent strengths adding up to `total`, each
 * between the bounds, in random order. Draws from `rng` exactly where the API calls Math.random.
 */
export function generateStrengths(rng: Rng, { total, count = TICKS_PER_DAY, minPct = 0, maxPct = total }: { total: number; count?: number; minPct?: number; maxPct?: number }) {
  const min = Math.max(1, Math.ceil(minPct || 0));
  const max = Math.max(min, Math.floor(maxPct));
  if (min * count > total || max * count < total) throw new Error("invalid_adjustment_strength_bounds");
  const span = max - min;
  let remaining = total - min * count;
  const values = Array.from({ length: count }, () => min);
  for (let index = 0; index < count; index += 1) {
    const remainingSlots = count - index - 1;
    const lower = Math.max(0, remaining - remainingSlots * span);
    const upper = Math.min(span, remaining);
    const extra = index === count - 1 ? remaining : lower + Math.floor(rng() * (upper - lower + 1));
    values[index] += extra;
    remaining -= extra;
  }
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

/**
 * settlement.js computeOpeningState: the persistent offset fades by `persistentDecay`; a day that
 * carries yesterday's close opens there (the transient offset takes up the rest), otherwise the
 * transient offset fades by `transientDecay`.
 */
export function computeOpeningState(
  { previousPersistent, previousTransient, fairValue, carriedPrice }: { previousPersistent: number; previousTransient: number; fairValue: number; carriedPrice: number | null },
  { persistentDecay, transientDecay }: { persistentDecay: number; transientDecay: number },
) {
  const persistent = (previousPersistent || 0) * persistentDecay;
  const fair = Math.max(fairValue || 0, MIN_PRICE);
  if (carriedPrice !== null && carriedPrice > 0) {
    const midOpen = Math.max(carriedPrice, MIN_PRICE);
    return { persistent, transient: Math.log(midOpen / fair) - persistent, midOpen };
  }
  const transient = (previousTransient || 0) * transientDecay;
  return { persistent, transient, midOpen: fair * Math.exp(persistent + transient) };
}

/** fundamentals.js: the next smoothed fair value from today's raw one, capped at ±25% a day. */
export function smoothFairValue(previous: number, raw: number) {
  const next = SMOOTHING_PREVIOUS_WEIGHT * previous + SMOOTHING_RAW_WEIGHT * raw;
  if (!(previous > 0) || !(next > 0)) return next;
  return Math.min(previous * FAIR_MOVE_CAP_MAX, Math.max(previous * FAIR_MOVE_CAP_MIN, next));
}

/** weeklyEvaluation.js normalQuantile (Acklam). */
export function normalQuantile(p: number) {
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

/** weeklyEvaluation.js rankScores: each value's rank as a normal score (ties share a rank; non-numbers are null). */
export function rankScores(values: number[]): (number | null)[] {
  const present = values.map((value, index) => ({ value, index })).filter((entry) => Number.isFinite(entry.value));
  const out: (number | null)[] = values.map(() => null);
  if (present.length < 2) {
    for (const entry of present) out[entry.index] = 0;
    return out;
  }
  present.sort((x, y) => x.value - y.value);
  let i = 0;
  while (i < present.length) {
    let j = i;
    while (j + 1 < present.length && present[j + 1].value === present[i].value) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[present[k].index] = normalQuantile((rank - 0.5) / present.length);
    i = j + 1;
  }
  return out;
}

export type DividendConfig = { ratePerSigma: number; deadzoneSigma: number; cap: number };

/** weeklyEvaluation.js dividendRate: nothing inside the dead zone, then ratePerSigma per σ past it, capped. */
export function dividendRate(z: number | null, { ratePerSigma, deadzoneSigma, cap }: DividendConfig) {
  if (z === null || Math.abs(z) < deadzoneSigma) return 0;
  const signed = Math.sign(z) * (Math.abs(z) - deadzoneSigma) * ratePerSigma;
  return Math.max(-cap, Math.min(cap, signed));
}

/** economy.js planCreditConversion for one wallet: rate × Credit or the minimum, whichever is more (all of a smaller balance). */
export function creditConversion(credit: number, { rate, minimum }: { rate: number; minimum: number }) {
  const share = Math.min(Math.max(rate || 0, 0), 0.5);
  const floor = Math.max(minimum || 0, 0);
  if ((!(share > 0) && !(floor > 0)) || !(credit > 0)) return 0;
  const portion = Math.round(credit * share * 100) / 100;
  const atLeast = portion >= floor ? portion : floor;
  return credit <= atLeast ? credit : atLeast;
}

/** economy.js: a sale earns this much Credit (rounded to the cent). */
export function sellCredit(gross: number, sellCreditRate: number) {
  return Math.round(gross * sellCreditRate * 100) / 100;
}
