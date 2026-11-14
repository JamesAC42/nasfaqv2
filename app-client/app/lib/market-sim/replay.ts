// Replay mode: the real fills of the last few days, re-priced under other costs against the real
// price path. The most trustworthy view, because nothing about players or prices is modeled: the
// same people make the same trades at the same moments; only what each trade costs changes.
//
// - Each fill's mid is worked back from its real price (spread, slippage and depth as they are now),
//   then priced again with the scenario's spread, slippage and fee.
// - Positions start where they stood when the window opened, worked back from today's holdings
//   through the window's fills at their real cost.
// - A limit user's buy fills at the better price if a later fill or close on that stock shows the
//   price reaching it within a day; otherwise it doesn't happen (and later sells can only sell what's held).
// - Weekly evaluations in the window pay again on the real rank scores and bases with the scenario's
//   dividend settings and tilt.
// - Impact, ticks, growth and the run length don't apply here: the price path is the real one.

import { Book, newAccount } from "./ledger";
import { dividendRate, fillPrice, midFromFillPrice, sellCredit } from "./mechanics";
import { mulberry32, seedFor } from "./rng";
import type { ReplayCheck, SimFill, SimInputs, SimParams, SimRun } from "./types";

const DAY_MS = 86_400_000;

export type ReplayResult = { run: SimRun; check: ReplayCheck };

/** Each player's positions when the window opened: today's holdings with the window's fills undone. */
export function startingPositions(inputs: SimInputs) {
  const positions = inputs.players.map((player) => new Map(player.holdings.map(([asset, quantity, basis]) => [asset, { quantity, basis }])));
  let unknown = 0;
  for (let i = inputs.fills.length - 1; i >= 0; i -= 1) {
    const fill = inputs.fills[i];
    const held = positions[fill.player];
    if (!held) continue;
    const now = held.get(fill.asset) ?? { quantity: 0, basis: 0 };
    if (fill.side === "buy") {
      const before = now.quantity - fill.quantity;
      if (before > 1e-9) {
        let basis = (now.basis * now.quantity - (fill.price * fill.quantity + fill.fee)) / before;
        if (!(basis > 0)) {
          basis = now.basis > 0 ? now.basis : fill.price;
          unknown += 1;
        }
        held.set(fill.asset, { quantity: before, basis });
      } else {
        // Shares that left some other way (a forced buyback) don't reconcile; start from nothing.
        if (before < -1e-6) unknown += 1;
        held.delete(fill.asset);
      }
    } else {
      // Selling doesn't move the average cost, unless the sale emptied the position.
      const known = now.quantity > 1e-9 && now.basis > 0;
      if (!known) unknown += 1;
      held.set(fill.asset, { quantity: now.quantity + fill.quantity, basis: known ? now.basis : fill.price });
    }
  }
  return {
    holdings: positions.map((held) =>
      [...held.entries()].filter(([, position]) => position.quantity > 1e-9).map(([asset, position]): [number, number, number] => [asset, position.quantity, position.basis]),
    ),
    unknown,
  };
}

export function runReplay(inputs: SimInputs, params: SimParams, seed: number): ReplayResult {
  const { settings, assets } = inputs;
  const dividends = { ratePerSigma: params.dividendPerSigma, deadzoneSigma: params.deadzoneSigma, cap: params.dividendCap };
  const firstDay = Math.max(
    1,
    inputs.dates.findIndex((date) => date >= inputs.window.replay_from_date),
  );
  const days = inputs.dates.slice(firstDay);
  const lastIndex = inputs.dates.length - 1;
  const closeOn = (asset: number, index: number) => {
    // Today isn't over: its close is the price now.
    if (index >= lastIndex) return assets[asset].mid;
    for (let i = index; i >= 0; i -= 1) {
      const close = assets[asset].close[i];
      if (close !== null && close > 0) return close;
    }
    return assets[asset].mid;
  };
  const closesFor = (index: number) => assets.map((_, asset) => closeOn(asset, index));

  const start = startingPositions(inputs);
  const book = new Book(
    start.holdings.map((holdings) => newAccount(holdings)),
    closesFor(firstDay - 1),
  );
  const limitUsers = inputs.players.map((_, player) => mulberry32(seedFor(seed, 3, player))() < params.limitShare);

  // The real mid behind every fill, and each stock's fills in time order (the price path).
  const mids = inputs.fills.map((fill) =>
    midFromFillPrice(fill.side, fill.price, assets[fill.asset].spread_bps, fill.quantity, assets[fill.asset].depth, settings.slippage_weight),
  );
  const path = assets.map((): { at: number; mid: number }[] => []);
  inputs.fills.forEach((fill, i) => path[fill.asset].push({ at: fill.at, mid: mids[i] }));
  // Each day's close too, about when the next settlement opens (09:00 ET).
  days.forEach((date, i) => {
    const next = inputs.dates[firstDay + i + 1];
    if (!next) return;
    const at = Date.parse(`${next}T13:00:00Z`);
    assets.forEach((_, asset) => path[asset].push({ at, mid: closeOn(asset, firstDay + i) }));
  });
  for (const points of path) points.sort((a, b) => a.at - b.at);

  const check: ReplayCheck = { fills: 0, maxPriceError: 0, maxFeeError: 0, startUnknown: start.unknown };
  const record = (fill: SimFill, price: number, fee: number) => {
    check.fills += 1;
    check.maxPriceError = Math.max(check.maxPriceError, Math.abs(price - fill.price));
    check.maxFeeError = Math.max(check.maxFeeError, Math.abs(fee - fill.fee));
  };

  const events = [...inputs.fills.map((fill, i) => ({ at: fill.at, fill, i })), ...inputs.evaluations.map((evaluation) => ({ at: evaluation.at, evaluation }))].sort(
    (a, b) => a.at - b.at,
  );

  let day = 0;
  const closeUntil = (date: string) => {
    while (day < days.length && days[day] < date) {
      book.closeDay(closesFor(firstDay + day));
      day += 1;
    }
  };

  for (const event of events) {
    if ("evaluation" in event && event.evaluation) {
      const scores = new Map(event.evaluation.assets.map(([asset, z, basis]) => [asset, { z, basis }]));
      book.accounts.forEach((account, player) => {
        for (const [asset, position] of account.positions) {
          const score = scores.get(asset);
          if (!score || !(score.basis > 0)) continue;
          const amount = Math.round(position.quantity * (dividendRate(score.z, dividends) + params.dividendTiltPerWeek) * score.basis * 100) / 100;
          if (amount) book.dividend(player, amount, position.quantity * params.dividendTiltPerWeek * score.basis);
        }
      });
      continue;
    }
    if (!("fill" in event) || !event.fill) continue;
    const { fill, i } = event;
    closeUntil(fill.date);
    const asset = assets[fill.asset];
    const spread = params.spreadBps ?? asset.spread_bps;
    const mid = mids[i];
    const dayIndex = day + 1;
    if (fill.side === "buy") {
      let price = fillPrice("buy", mid, spread, fill.quantity, asset.depth, params.slippageWeight);
      let paidMid = mid;
      if (limitUsers[fill.player]) {
        const limit = mid * (1 - params.limitOffsetPct);
        const reached = path[fill.asset].find(
          (point) => point.at > fill.at && point.at <= fill.at + DAY_MS && fillPrice("buy", point.mid, spread, fill.quantity, asset.depth, params.slippageWeight) <= limit,
        );
        if (!reached) continue;
        paidMid = reached.mid;
        price = fillPrice("buy", reached.mid, spread, fill.quantity, asset.depth, params.slippageWeight);
      }
      const fee = params.feeOnlyOnQuickSells ? 0 : price * fill.quantity * params.feeRate;
      if (!limitUsers[fill.player]) record(fill, price, fee);
      book.buy(fill.player, fill.asset, fill.quantity, { price, fee, mid: paidMid, at: fill.at, day: dayIndex });
    } else {
      const position = book.accounts[fill.player]?.positions.get(fill.asset);
      const quantity = Math.min(fill.quantity, position?.quantity ?? 0);
      if (!position || !(quantity > 0)) continue;
      const price = fillPrice("sell", mid, spread, quantity, asset.depth, params.slippageWeight);
      const feeApplies = !params.feeOnlyOnQuickSells || fill.at - position.lastBuyAt < params.quickSellHours * 3_600_000;
      const gross = price * quantity;
      const fee = feeApplies ? gross * params.feeRate : 0;
      if (quantity === fill.quantity) record(fill, price, fee);
      book.sell(fill.player, fill.asset, quantity, { price, fee, mid, credit: sellCredit(gross, settings.sell_credit_rate) });
    }
  }
  closeUntil("9999-12-31");

  const run = book.finish(
    assets.map((asset) => asset.mid),
    { days: days.length, growthLift: 0 },
    [inputs.dates[firstDay - 1], ...days],
  );
  return { run, check };
}
