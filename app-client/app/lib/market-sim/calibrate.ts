// Fits each stock's fair value model to its revealed history, so a forward run moves fair values the
// way they have been moving.
//
// The API's model (fundamentals.js): raw = size anchor × exp(0.35 × momentum clamped to ±1.35), and
// the fair value smooths it: fair = 0.4 × yesterday's + 0.6 × raw. Undoing the smoothing gives each
// day's raw value: raw = (fair − 0.4 × fair yesterday) ÷ 0.6. Its log, less a slow trend (the size
// anchor), is 0.35 × momentum. Momentum follows a mean-reverting walk, M = ρ·M + σ·noise: ρ is its
// day-to-day correlation and σ is set so its spread matches. Stocks with little history borrow the
// market-wide (median) ρ and σ, in proportion to how little they have.

import { FAIR_MOVE_CAP_MAX, MOMENTUM_WEIGHT, SMOOTHING_PREVIOUS_WEIGHT, SMOOTHING_RAW_WEIGHT } from "./mechanics";
import { correlation, dailyChanges, mean, median, stdev } from "./stats";
import type { SimInputs } from "./types";

export type FairModel = {
  /** The size anchor at the last revealed day. */
  anchor: number;
  rho: number;
  sigma: number;
  /** Momentum at the last revealed day. */
  momentum: number;
  /** The last revealed fair value, and its day's index in SimInputs.dates. */
  fair: number;
  lastIndex: number;
  points: number;
  fitted: boolean;
};

export type Calibration = {
  models: FairModel[];
  pooledRho: number;
  pooledSigma: number;
  fittedAssets: number;
  realFairDailyVol: number | null;
  realFairAutocorr: number | null;
};

const MIN_POINTS = 10;
const FULL_WEIGHT_POINTS = 60;
const MAX_TREND_PER_DAY = 0.002;
const FALLBACK = { rho: 0.92, sigma: 0.14 };

type RawFit = { anchor: number; rho: number; sigma: number; momentum: number; points: number };

function fitOne(fair: (number | null)[]): RawFit | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let t = 1; t < fair.length; t += 1) {
    const previous = fair[t - 1];
    const current = fair[t];
    if (previous === null || current === null || !(previous > 0) || !(current > 0)) continue;
    // A move at the daily cap hides the raw value behind it.
    if (Math.abs(Math.log(current / previous)) >= Math.log(FAIR_MOVE_CAP_MAX) - 1e-6) continue;
    const raw = (current - SMOOTHING_PREVIOUS_WEIGHT * previous) / SMOOTHING_RAW_WEIGHT;
    if (!(raw > 0)) continue;
    xs.push(t);
    ys.push(Math.log(raw));
  }
  if (xs.length < MIN_POINTS) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = Math.max(-MAX_TREND_PER_DAY, Math.min(MAX_TREND_PER_DAY, sxx > 0 ? sxy / sxx : 0));
  const trend = (t: number) => my + slope * (t - mx);
  const momentum = ys.map((y, i) => (y - trend(xs[i])) / MOMENTUM_WEIGHT);
  const lagged: number[] = [];
  const next: number[] = [];
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i] === xs[i - 1] + 1) {
      lagged.push(momentum[i - 1]);
      next.push(momentum[i]);
    }
  }
  const rawRho = correlation(lagged, next);
  const rho = Math.min(0.98, Math.max(0, Number.isFinite(rawRho) ? rawRho : FALLBACK.rho));
  const spread = stdev(momentum);
  const sigma = Math.max(0.01, (Number.isFinite(spread) ? spread : 0.5) * Math.sqrt(1 - rho * rho));
  const last = xs.length - 1;
  return { anchor: Math.exp(trend(xs[last])), rho, sigma, momentum: momentum[last], points: xs.length };
}

export function calibrate(inputs: SimInputs): Calibration {
  const fits = inputs.assets.map((asset) => fitOne(asset.fair));
  const solid = fits.filter((fit): fit is RawFit => fit !== null && fit.points >= 30);
  const pooledRho = solid.length ? median(solid.map((fit) => fit.rho)) : FALLBACK.rho;
  const pooledSigma = solid.length ? median(solid.map((fit) => fit.sigma)) : FALLBACK.sigma;

  const models = inputs.assets.map((asset, index): FairModel => {
    let lastIndex = -1;
    for (let t = asset.fair.length - 1; t >= 0; t -= 1) {
      if (asset.fair[t] !== null && (asset.fair[t] as number) > 0) {
        lastIndex = t;
        break;
      }
    }
    // A stock with no revealed fair value at all starts from its price.
    const fair = lastIndex >= 0 ? (asset.fair[lastIndex] as number) : asset.mid;
    const fit = fits[index];
    if (!fit) return { anchor: fair, rho: pooledRho, sigma: pooledSigma, momentum: 0, fair, lastIndex, points: 0, fitted: false };
    const weight = Math.min(1, fit.points / FULL_WEIGHT_POINTS);
    return {
      anchor: fit.anchor,
      rho: weight * fit.rho + (1 - weight) * pooledRho,
      sigma: weight * fit.sigma + (1 - weight) * pooledSigma,
      momentum: fit.momentum,
      fair,
      lastIndex,
      points: fit.points,
      fitted: true,
    };
  });

  const changes: number[] = [];
  const pairs: [number, number][] = [];
  for (const asset of inputs.assets) {
    const series = dailyChanges(asset.fair);
    changes.push(...series.changes);
    pairs.push(...series.pairs);
  }
  const vol = stdev(changes);
  const autocorr = correlation(
    pairs.map((pair) => pair[0]),
    pairs.map((pair) => pair[1]),
  );
  return {
    models,
    pooledRho,
    pooledSigma,
    fittedAssets: models.filter((model) => model.fitted).length,
    realFairDailyVol: Number.isFinite(vol) ? vol : null,
    realFairAutocorr: Number.isFinite(autocorr) ? autocorr : null,
  };
}
