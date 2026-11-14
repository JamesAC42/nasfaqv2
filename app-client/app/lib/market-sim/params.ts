// The simulator's knobs: today's settings read from the API, the presets, and the guard rails each
// value is held to before a run.

import type { SimParams, SimSettings } from "./types";

export const RUN_LIMITS = { days: { min: 7, max: 180 }, seeds: { min: 1, max: 60 } } as const;

/** The settings the market runs on now, from the inputs. A null spread keeps each stock's own. */
export function todayParams(settings: SimSettings, run: Pick<SimParams, "days" | "seeds" | "seed"> = { days: 60, seeds: 12, seed: 1 }): SimParams {
  return {
    spreadBps: null,
    feeRate: settings.fee_rate,
    feeOnlyOnQuickSells: false,
    quickSellHours: 24,
    slippageWeight: settings.slippage_weight,
    transientWeight: settings.transient_weight,
    persistentWeight: settings.persistent_weight,
    persistentDecay: settings.persistent_daily_decay,
    transientHalfLifeMinutes: settings.transient_half_life_minutes,
    strengthTotalPct: settings.strength_total_pct,
    driftPerDay: 0,
    dividendTiltPerWeek: 0,
    dividendPerSigma: settings.dividend.rate_per_sigma,
    deadzoneSigma: settings.dividend.deadzone_sigma,
    dividendCap: settings.dividend.cap,
    limitShare: 0,
    limitOffsetPct: 0.02,
    days: run.days,
    seeds: run.seeds,
    seed: run.seed,
  };
}

export type Preset = { key: string; label: string; line: string; apply: (today: SimParams) => SimParams };

export const PRESETS: Preset[] = [
  { key: "today", label: "Today", line: "The settings the market runs on now.", apply: (today) => ({ ...today }) },
  {
    key: "package",
    label: "Proposed package",
    line: "1.5% spread, the fee only on sells within 24 hours, limit buys 2% under the price, +0.05% growth a day, +0.25% a week to every holder.",
    apply: (today) => ({
      ...today,
      spreadBps: 150,
      feeOnlyOnQuickSells: true,
      quickSellHours: 24,
      limitShare: 0.9,
      limitOffsetPct: 0.02,
      driftPerDay: 0.0005,
      dividendTiltPerWeek: 0.0025,
    }),
  },
];

const clamp = (value: number, min: number, max: number, fallback: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);

/** Holds every knob to a sane range (a stray input can't hang the worker or divide by zero). */
export function sanitizeParams(params: SimParams, today: SimParams): SimParams {
  return {
    spreadBps: params.spreadBps === null ? null : clamp(params.spreadBps, 0, 5000, 400),
    feeRate: clamp(params.feeRate, 0, 0.2, today.feeRate),
    feeOnlyOnQuickSells: Boolean(params.feeOnlyOnQuickSells),
    quickSellHours: clamp(params.quickSellHours, 0, 24 * 30, 24),
    slippageWeight: clamp(params.slippageWeight, 0, 10, today.slippageWeight),
    transientWeight: clamp(params.transientWeight, 0, 10, today.transientWeight),
    persistentWeight: clamp(params.persistentWeight, 0, 10, today.persistentWeight),
    persistentDecay: clamp(params.persistentDecay, 0, 1, today.persistentDecay),
    transientHalfLifeMinutes: clamp(params.transientHalfLifeMinutes, 1, 24 * 60, today.transientHalfLifeMinutes),
    strengthTotalPct: Math.round(clamp(params.strengthTotalPct, 4, 400, today.strengthTotalPct)),
    driftPerDay: clamp(params.driftPerDay, -0.02, 0.02, 0),
    dividendTiltPerWeek: clamp(params.dividendTiltPerWeek, -0.05, 0.05, 0),
    dividendPerSigma: clamp(params.dividendPerSigma, 0, 0.5, today.dividendPerSigma),
    deadzoneSigma: clamp(params.deadzoneSigma, 0, 3, today.deadzoneSigma),
    dividendCap: clamp(params.dividendCap, 0, 1, today.dividendCap),
    limitShare: clamp(params.limitShare, 0, 1, 0),
    limitOffsetPct: clamp(params.limitOffsetPct, 0, 0.5, 0.02),
    days: Math.round(clamp(params.days, RUN_LIMITS.days.min, RUN_LIMITS.days.max, 60)),
    seeds: Math.round(clamp(params.seeds, RUN_LIMITS.seeds.min, RUN_LIMITS.seeds.max, 12)),
    seed: Math.round(clamp(params.seed, 1, 2 ** 31 - 1, 1)),
  };
}
