// Runs a scenario next to the baseline (today's settings) on the same seeds and puts the two side
// by side. Pure and synchronous: the page calls it from a Web Worker (sim.worker.ts), tests call it
// directly.

import { calibrate } from "./calibrate";
import { runForward } from "./forward";
import { sanitizeParams, todayParams } from "./params";
import { runReplay } from "./replay";
import { mean, quantile } from "./stats";
import type { SimComparison, SimInputs, SimMetrics, SimParams, SimRun } from "./types";

export type SimMode = "replay" | "forward";
export type Progress = (done: number, total: number) => void;

const METRIC_KEYS: (keyof SimMetrics)[] = [
  "positionsRed",
  "playersRed",
  "medianBagReturn",
  "medianAllInReturn",
  "playersLosing",
  "greenDays",
  "buysGreen1d",
  "buysGreen7d",
  "brokerTake",
  "tiltPrinted",
  "dividendsNet",
  "growthLift",
  "buyShare",
  "buyFillShare",
  "fillsPerDay",
  "volume",
  "players",
  "positions",
];

/** The seed average of each metric, every player's return from every seed, and the average red share by day. */
function combine(runs: SimRun[]): { run: SimRun; range: Partial<Record<keyof SimMetrics, [number, number]>> } {
  const metrics = {} as SimMetrics;
  const range: Partial<Record<keyof SimMetrics, [number, number]>> = {};
  for (const key of METRIC_KEYS) {
    const values = runs.map((run) => run.metrics[key]).filter((value) => Number.isFinite(value));
    metrics[key] = values.length ? mean(values) : NaN;
    if (values.length > 1) range[key] = [quantile(values, 0.1), quantile(values, 0.9)];
  }
  const length = Math.max(...runs.map((run) => run.redByDay.length));
  const redByDay = Array.from({ length }, (_, day) => mean(runs.map((run) => run.redByDay[day]).filter((value) => Number.isFinite(value))));
  return { run: { metrics, returns: runs.flatMap((run) => run.returns), redByDay, dayLabels: runs[0]?.dayLabels ?? [] }, range };
}

export function runComparison(inputs: SimInputs, mode: SimMode, rawParams: SimParams, onProgress?: Progress): SimComparison {
  const started = Date.now();
  const today = todayParams(inputs.settings, rawParams);
  const params = sanitizeParams(rawParams, today);
  const baselineParams: SimParams = { ...today, days: params.days, seeds: params.seeds, seed: params.seed };

  if (mode === "replay") {
    const baseline = runReplay(inputs, baselineParams, params.seed);
    onProgress?.(1, 2);
    const scenario = runReplay(inputs, params, params.seed);
    onProgress?.(2, 2);
    return { mode, scenario: scenario.run, baseline: baseline.run, replayCheck: baseline.check, elapsedMs: Date.now() - started };
  }

  const calibration = calibrate(inputs);
  const scenarioRuns: SimRun[] = [];
  const baselineRuns: SimRun[] = [];
  const fairVols: number[] = [];
  const fairAutocorrs: number[] = [];
  for (let i = 0; i < params.seeds; i += 1) {
    const seed = params.seed + i;
    const baseline = runForward(inputs, baselineParams, seed, calibration);
    baselineRuns.push(baseline.run);
    fairVols.push(baseline.fairVol);
    fairAutocorrs.push(baseline.fairAutocorr);
    scenarioRuns.push(runForward(inputs, params, seed, calibration).run);
    onProgress?.(i + 1, params.seeds);
  }
  const scenario = combine(scenarioRuns);
  const baseline = combine(baselineRuns);

  const active = inputs.players.filter((player) => player.profile.active_day_rate > 0);
  const realFillsPerDay = active.reduce((sum, player) => sum + player.profile.active_day_rate * player.profile.fills_per_active_day, 0);
  const weighted = active.filter((player) => player.profile.buy_share !== null);
  const fillWeight = (player: (typeof active)[number]) => player.profile.active_day_rate * player.profile.fills_per_active_day;
  const totalWeight = weighted.reduce((sum, player) => sum + fillWeight(player), 0);
  const finite = (values: number[]) => values.filter((value) => Number.isFinite(value));
  return {
    mode,
    scenario: scenario.run,
    baseline: baseline.run,
    scenarioRange: scenario.range,
    baselineRange: baseline.range,
    modelCheck: {
      realFairDailyVol: calibration.realFairDailyVol,
      simFairDailyVol: finite(fairVols).length ? mean(finite(fairVols)) : null,
      realFairAutocorr: calibration.realFairAutocorr,
      simFairAutocorr: finite(fairAutocorrs).length ? mean(finite(fairAutocorrs)) : null,
      realFillsPerDay: active.length ? realFillsPerDay : null,
      realBuyShare: totalWeight > 0 ? weighted.reduce((sum, player) => sum + fillWeight(player) * (player.profile.buy_share as number), 0) / totalWeight : null,
      fittedAssets: calibration.fittedAssets,
      pooledRho: calibration.pooledRho,
      pooledSigma: calibration.pooledSigma,
    },
    elapsedMs: Date.now() - started,
  };
}
