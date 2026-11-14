// The engine's formulas against numbers the API's own functions produced
// (api/test/fixtures/market-sim-parity.json; api/test/market-sim.test.js checks the API side).

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTradeShock,
  computeAdjustedPrice,
  computeExecutionPrice,
  computeLiveMidPrice,
  computeOpeningState,
  computeQuotes,
  creditConversion,
  decayTransientOffset,
  dividendRate,
  feasibleStrengthBounds,
  fillPrice,
  generateStrengths,
  midFromFillPrice,
  rankScores,
} from "../mechanics";
import { parity } from "./helpers";

const close = (actual: number, expected: number, message: string, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);

const { settings } = parity;
const weights = { persistent: settings.persistent_weight, transient: settings.transient_weight };
const dividends = { ratePerSigma: settings.dividend.rate_per_sigma, deadzoneSigma: settings.dividend.deadzone_sigma, cap: settings.dividend.cap };

test("quotes: half the spread either side of the mid", () => {
  for (const row of parity.quotes) {
    const quotes = computeQuotes(row.mid, row.spread_bps);
    close(quotes.bid, row.bid, `bid at ${row.mid}/${row.spread_bps}`);
    close(quotes.ask, row.ask, `ask at ${row.mid}/${row.spread_bps}`);
  }
});

test("execution price: slippage on the order's share of depth", () => {
  for (const row of parity.execution) {
    close(computeExecutionPrice(row.side, row.bid, row.ask, row.quantity, row.depth, settings.slippage_weight), row.price, `${row.side} ${row.quantity}`);
  }
});

test("trade shock: persistent and transient offsets move by their weights", () => {
  for (const row of parity.shock) {
    const next = applyTradeShock(row.side, row.quantity, row.depth, row.persistent, row.transient, weights);
    close(next.persistent, row.next_persistent, "persistent");
    close(next.transient, row.next_transient, "transient");
  }
});

test("the transient offset halves every half-life, and the live mid uses both offsets", () => {
  for (const row of parity.decay) close(decayTransientOffset(row.transient, row.minutes, settings.transient_half_life_minutes), row.value, `${row.minutes} minutes`, 1e-9);
  for (const row of parity.live) close(computeLiveMidPrice(row.fair, row.persistent, row.transient), row.mid, "live mid");
});

test("a tick moves the price its strength of the way to the base rate", () => {
  for (const row of parity.adjusted) close(computeAdjustedPrice(row.mid, row.base, row.strength), row.price, `${row.strength}%`);
});

test("tick strengths: same draws, same strengths as the API", () => {
  for (const row of parity.strengths) {
    let i = 0;
    const strengths = generateStrengths(() => row.uniforms[i++], { total: row.total, minPct: row.min_pct, maxPct: row.max_pct });
    assert.deepEqual(strengths, row.strengths);
    assert.equal(i, row.uniforms.length, "draws as many numbers as the API");
    assert.equal(
      strengths.reduce((sum, value) => sum + value, 0),
      row.total,
    );
  }
  // Bounds a new total can't meet are widened rather than refused.
  assert.deepEqual(feasibleStrengthBounds(100, 30, 90), { min: 25, max: 90 });
  assert.deepEqual(feasibleStrengthBounds(300, 0, 60), { min: 1, max: 75 });
});

test("settlement opens at the carried close with the persistent offset faded", () => {
  for (const row of parity.opening) {
    const opening = computeOpeningState(
      { previousPersistent: row.prev_persistent, previousTransient: row.prev_transient, fairValue: row.fair, carriedPrice: row.carried },
      { persistentDecay: settings.persistent_daily_decay, transientDecay: settings.transient_settlement_decay },
    );
    close(opening.persistent, row.persistent, "persistent");
    close(opening.transient, row.transient, "transient");
    close(opening.midOpen, row.mid_open, "mid open");
  }
});

test("dividend rates, rank scores and the Credit conversion", () => {
  for (const row of parity.dividend) close(dividendRate(row.z, dividends), row.rate, `z ${row.z}`);
  for (const row of parity.rank) {
    rankScores(row.values).forEach((score, i) => {
      if (row.scores[i] === null) assert.equal(score, null);
      else close(score as number, row.scores[i] as number, "rank score", 1e-12);
    });
  }
  for (const row of parity.conversion) close(creditConversion(row.credit, settings.credit_conversion), row.converted, `${row.credit} Credit`, 1e-9);
});

test("a run of fills: each fill's price, fee and the mid it leaves match the API", () => {
  const { asset, fills } = parity.fill_sequence;
  let persistent = 0;
  let transient = 0;
  for (const fill of fills) {
    const mid = computeLiveMidPrice(asset.fair, persistent, transient);
    close(mid, fill.mid_before, "mid before");
    const price = fillPrice(fill.side, mid, asset.spread_bps, fill.quantity, asset.depth, settings.slippage_weight);
    close(price, fill.price, `${fill.side} ${fill.quantity} price`);
    close(price * fill.quantity * settings.fee_rate, fill.fee, "fee");
    // And the replay's inverse: the fill price gives back the mid it came from.
    close(midFromFillPrice(fill.side, fill.price, asset.spread_bps, fill.quantity, asset.depth, settings.slippage_weight), fill.mid_before, "mid from price");
    ({ persistent, transient } = applyTradeShock(fill.side, fill.quantity, asset.depth, persistent, transient, weights));
    close(computeLiveMidPrice(asset.fair, persistent, transient), fill.mid_after, "mid after");
  }
});
