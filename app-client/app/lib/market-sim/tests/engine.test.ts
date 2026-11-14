// The engine end to end: the same seed gives the same run, the replay at today's settings
// reproduces real fills, cheaper costs help players, and the calibration finds the model it's fed.

import assert from "node:assert/strict";
import test from "node:test";
import { calibrate } from "../calibrate";
import { runForward } from "../forward";
import { PRESETS, sanitizeParams, todayParams } from "../params";
import { runReplay, startingPositions } from "../replay";
import { runComparison } from "../runner";
import { fixtureReplayInputs, parity, syntheticInputs } from "./helpers";

const short = (inputs: ReturnType<typeof syntheticInputs>) => todayParams(inputs.settings, { days: 21, seeds: 3, seed: 11 });

test("forward: the same seed gives the same run, a different seed a different one", () => {
  const inputs = syntheticInputs();
  const params = short(inputs);
  const a = runForward(inputs, params, 5);
  const b = runForward(inputs, params, 5);
  assert.deepEqual(a, b);
  const c = runForward(inputs, params, 6);
  assert.notDeepEqual(a.run.returns, c.run.returns);
  // The whole comparison too, through the runner the worker calls.
  assert.deepEqual(stripTime(runComparison(inputs, "forward", params)), stripTime(runComparison(inputs, "forward", params)));
});

test("forward: day 0 is today, and a run trades, closes every day and stays finite", () => {
  const inputs = syntheticInputs();
  const params = short(inputs);
  const { run } = runForward(inputs, params, 3);
  assert.equal(run.redByDay.length, params.days + 1);
  assert.equal(run.dayLabels[0], inputs.today);
  // Day 0's red share is the real one: holdings against today's prices.
  let red = 0;
  let total = 0;
  for (const player of inputs.players) {
    for (const [asset, , basis] of player.holdings) {
      total += 1;
      if (inputs.assets[asset].mid < basis) red += 1;
    }
  }
  assert.equal(run.redByDay[0], red / total);
  assert.ok(run.metrics.fillsPerDay > 0, "players trade");
  for (const [key, value] of Object.entries(run.metrics)) assert.ok(Number.isFinite(value), `${key} is a number`);
  assert.ok(run.metrics.brokerTake > 0 && run.metrics.brokerTake < 0.1);
});

test("forward: the scenario and its baseline share the market's draws", () => {
  const inputs = syntheticInputs();
  const today = short(inputs);
  // Only a cost differs, so the fair value paths (and so their volatility) are identical.
  const cheaper = { ...today, spreadBps: 100, feeRate: 0.0025 };
  assert.equal(runForward(inputs, today, 9).fairVol, runForward(inputs, cheaper, 9).fairVol);
});

test("forward: cheaper trading leaves players better off and takes less", () => {
  const inputs = syntheticInputs({ players: 30 });
  const today = todayParams(inputs.settings, { days: 30, seeds: 6, seed: 21 });
  const comparison = runComparison(inputs, "forward", { ...today, spreadBps: 100, feeRate: 0.0025 });
  assert.ok(comparison.scenario.metrics.brokerTake < comparison.baseline.metrics.brokerTake);
  assert.ok(comparison.scenario.metrics.medianAllInReturn > comparison.baseline.metrics.medianAllInReturn);
  assert.ok(comparison.modelCheck && comparison.modelCheck.fittedAssets === inputs.assets.length);
});

test("forward: a dividend tilt prints money and growth lifts fair values", () => {
  const inputs = syntheticInputs();
  const today = short(inputs);
  const tilted = runForward(inputs, { ...today, dividendTiltPerWeek: 0.0025, driftPerDay: 0.0005 }, 4).run.metrics;
  assert.ok(tilted.tiltPrinted > 0);
  assert.ok(Math.abs(tilted.growthLift - (Math.exp(0.0005 * 21) - 1)) < 1e-12);
  assert.equal(runForward(inputs, today, 4).run.metrics.tiltPrinted, 0);
});

test("forward: outside income keeps players buying", () => {
  const broke = syntheticInputs({ players: 20 });
  broke.players = broke.players.map((player) => ({ ...player, cash: 0, credit: 0 }));
  const paid = { ...broke, players: broke.players.map((player) => ({ ...player, profile: { ...player.profile, outside_cash_per_day: 300 } })) };
  const params = short(broke);
  const without = runForward(broke, params, 8).run.metrics;
  const withIncome = runForward(paid, params, 8).run.metrics;
  assert.ok(withIncome.buyFillShare > without.buyFillShare, `${withIncome.buyFillShare} vs ${without.buyFillShare}`);
  assert.ok(withIncome.volume > without.volume);
});

test("replay at today's settings reproduces the real fills", () => {
  const inputs = fixtureReplayInputs();
  const { check, run } = runReplay(inputs, todayParams(inputs.settings), 1);
  assert.equal(check.fills, parity.fill_sequence.fills.length);
  assert.ok(check.maxPriceError < 1e-9, `prices within rounding (${check.maxPriceError})`);
  assert.ok(check.maxFeeError < 1e-9, `fees within rounding (${check.maxFeeError})`);
  assert.equal(check.startUnknown, 0);
  // Undoing the window's fills lands on the starting positions, and replaying them lands on today's.
  const start = startingPositions(inputs);
  start.holdings.forEach((holdings) => assert.ok(Math.abs(holdings[0][1] - 300) < 1e-9));
  const broker = parity.fill_sequence.fills.reduce((sum, fill) => sum + fill.fee + Math.abs(fill.price - fill.mid_before) * fill.quantity, 0);
  const volume = parity.fill_sequence.fills.reduce((sum, fill) => sum + fill.price * fill.quantity, 0);
  assert.ok(Math.abs(run.metrics.brokerTake - broker / volume) < 1e-12, "the broker's take is the spread, slippage and fees paid");
});

test("replay: a lower spread and a fee only on quick sells cost less on the same trades", () => {
  const inputs = fixtureReplayInputs();
  const today = todayParams(inputs.settings);
  const baseline = runReplay(inputs, today, 1).run.metrics;
  const scenario = runReplay(inputs, { ...today, spreadBps: 150, feeOnlyOnQuickSells: true, quickSellHours: 24 }, 1).run.metrics;
  assert.ok(scenario.brokerTake < baseline.brokerTake);
  assert.ok(scenario.medianAllInReturn > baseline.medianAllInReturn);
  assert.equal(scenario.fillsPerDay, baseline.fillsPerDay, "the same trades");
});

test("replay: limit buys are seeded and skip buys the price never reached", () => {
  const inputs = fixtureReplayInputs();
  const params = { ...todayParams(inputs.settings), limitShare: 1, limitOffsetPct: 0.05 };
  const a = runReplay(inputs, params, 2);
  assert.deepEqual(a, runReplay(inputs, params, 2));
  // Nothing in the fixture dips 5% under a buy within the day, so every buy is skipped; the sells still happen.
  assert.equal(a.run.metrics.buyFillShare, 0);
  assert.ok(a.run.metrics.fillsPerDay > 0);
});

test("calibration recovers the momentum model it's fed", () => {
  const inputs = syntheticInputs({ assets: 30, rho: 0.9, sigma: 0.15, seed: 3 });
  const calibration = calibrate(inputs);
  assert.equal(calibration.fittedAssets, 30);
  assert.ok(Math.abs(calibration.pooledRho - 0.9) < 0.15, `ρ ${calibration.pooledRho}`);
  assert.ok(calibration.pooledSigma > 0.05 && calibration.pooledSigma < 0.35, `σ ${calibration.pooledSigma}`);
  assert.ok(calibration.realFairDailyVol !== null && calibration.realFairDailyVol > 0);
  // Today's secret fair value isn't in the inputs, so no model starts from it.
  for (const model of calibration.models) assert.equal(model.lastIndex, inputs.dates.length - 2);
});

test("presets and guard rails", () => {
  const inputs = syntheticInputs();
  const today = todayParams(inputs.settings);
  assert.deepEqual(PRESETS[0].apply(today), today);
  const proposed = PRESETS.find((preset) => preset.key === "package")?.apply(today);
  assert.equal(proposed?.spreadBps, 150);
  assert.equal(proposed?.feeOnlyOnQuickSells, true);
  const wild = sanitizeParams({ ...today, days: 10_000, seeds: -3, feeRate: Number.NaN, transientHalfLifeMinutes: 0 }, today);
  assert.equal(wild.days, 180);
  assert.equal(wild.seeds, 1);
  assert.equal(wild.feeRate, today.feeRate);
  assert.equal(wild.transientHalfLifeMinutes, 1);
});

function stripTime<T extends { elapsedMs: number }>(value: T) {
  return { ...value, elapsedMs: 0 };
}
