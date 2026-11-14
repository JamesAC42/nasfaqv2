// Forward mode: the market from where it stands, day by day, with every player trading the way their
// recent fills say they trade.
//
// Each day, as in the API: settlement at 09:00 sets a new fair value (from the calibrated model, so
// today's real secret one is never used) and opens at yesterday's close with the persistent offset
// faded; four ticks (09:00, 15:00, 21:00, 03:00) each pull the price their strength of the way to fair
// value; orders between ticks fill at the live price (the transient offset fading by its half-life),
// pay the spread, slippage and fee, and push the offsets; Saturday 00:00 pays dividends and charges
// share fees on revealed values, then turns part of every Credit balance into Cash.
//
// Players: each day a player trades with their real active-day rate, about as many fills as they
// make on such a day. A fill sells as often as they sell (the bag most likely one at their usual
// take-profit or stop-loss level, or held longer than they usually hold), otherwise buys: one of
// their favorite stocks, or one picked by recent moves the way they pick (chasing risers or buying
// dips), at their usual size, within the 180-share limit per tick window and their Cash. Limit users post a bid under the price instead, good for a day. Their
// outside income (games, check-ins, at their recent daily rate) lands every morning.
//
// Left out: new players, sell-outs and buybacks (frozen stocks
// just don't trade), rookie and oshi exemptions, and the auto-bailout.

import { calibrate, type Calibration } from "./calibrate";
import { Book, newAccount } from "./ledger";
import {
  applyTradeShock,
  computeAdjustedPrice,
  computeLiveMidPrice,
  computeOpeningState,
  creditConversion,
  decayTransientOffset,
  dividendRate,
  feasibleStrengthBounds,
  fillPrice,
  generateStrengths,
  MIN_PRICE,
  MOMENTUM_CLAMP,
  MOMENTUM_WEIGHT,
  rankScores,
  sellCredit,
  smoothFairValue,
  TICKS_PER_DAY,
} from "./mechanics";
import { gaussian, mulberry32, seedFor, type Rng } from "./rng";
import { correlation, mean, stdev } from "./stats";
import type { SimInputs, SimParams, SimRun, Side } from "./types";

const DAY = 1440;
const WINDOW = DAY / TICKS_PER_DAY;
/** Saturday 00:00 ET is 15 hours after Friday's 09:00 settlement. */
const EVALUATION_OFFSET = 15 * 60;
const FRIDAY = 5;
const LIMIT_LIFETIME = DAY;
const DEFAULT_SIZE = { logMean: Math.log(20), logSd: 0.9 };

export type ForwardResult = { run: SimRun; fairVol: number; fairAutocorr: number };

type Limit = { player: number; quantity: number; limit: number; postedAt: number };

export function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function runForward(inputs: SimInputs, params: SimParams, seed: number, calibration: Calibration = calibrate(inputs)): ForwardResult {
  const { settings, assets } = inputs;
  const count = assets.length;
  const marketRng = mulberry32(seedFor(seed, 1));
  const weights = { persistent: params.persistentWeight, transient: params.transientWeight };
  const dividends = { ratePerSigma: params.dividendPerSigma, deadzoneSigma: params.deadzoneSigma, cap: params.dividendCap };
  const shareLimit = settings.live_order_share_limit;
  const spread = assets.map((asset) => params.spreadBps ?? asset.spread_bps);
  const bounds = assets.map((asset) => feasibleStrengthBounds(params.strengthTotalPct, asset.strength_min_pct, asset.strength_max_pct));

  // ── Stocks ──
  const models = calibration.models;
  const fair = models.map((model) => model.fair);
  const anchor = models.map((model) => model.anchor);
  const momentum = models.map((model) => model.momentum);
  const persistent = assets.map(() => 0);
  const transient = assets.map(() => 0);
  const updatedAt = assets.map(() => 0);
  const mid = assets.map((asset) => asset.mid);
  const revealed = assets.map((asset) => asset.fair.filter((value): value is number => value !== null && value > 0));
  const simFair: number[][] = assets.map(() => []);
  let strengths: number[][] = assets.map(() => []);

  const advanceFair = (index: number, drift: number) => {
    const model = models[index];
    momentum[index] = model.rho * momentum[index] + model.sigma * gaussian(marketRng);
    const clamped = Math.max(-MOMENTUM_CLAMP, Math.min(MOMENTUM_CLAMP, momentum[index]));
    fair[index] = smoothFairValue(fair[index], anchor[index] * Math.exp(MOMENTUM_WEIGHT * clamped));
    anchor[index] *= Math.exp(drift);
  };
  // Days between the last revealed fair value and the first simulated one (today's is still secret).
  const lastDay = inputs.dates.length - 1;
  assets.forEach((_, index) => {
    const behind = models[index].lastIndex >= 0 ? lastDay - models[index].lastIndex : 0;
    for (let day = 0; day < behind; day += 1) {
      advanceFair(index, 0);
      revealed[index].push(fair[index]);
    }
  });

  const liveTransient = (index: number, at: number) => decayTransientOffset(transient[index], at - updatedAt[index], params.transientHalfLifeMinutes);
  const liveMid = (index: number, at: number) => computeLiveMidPrice(fair[index], persistent[index], liveTransient(index, at));
  const quote = (index: number, side: Side, quantity: number, at: number) => {
    const before = liveMid(index, at);
    return { mid: before, price: fillPrice(side, before, spread[index], quantity, assets[index].depth, params.slippageWeight) };
  };
  const commit = (index: number, side: Side, quantity: number, at: number) => {
    const next = applyTradeShock(side, quantity, assets[index].depth, persistent[index], liveTransient(index, at), weights);
    persistent[index] = next.persistent;
    transient[index] = next.transient;
    updatedAt[index] = at;
    mid[index] = computeLiveMidPrice(fair[index], next.persistent, next.transient);
  };

  // ── Players ──
  const players = inputs.players.map((player, index) => {
    const rng = mulberry32(seedFor(seed, 2, index));
    // Always drawn, so a scenario and its baseline keep the same stream whatever the share.
    const limitUser = rng() < params.limitShare;
    return { rng, limitUser, cash: player.cash, credit: player.credit, profile: player.profile, windowShares: 0 };
  });
  const book = new Book(
    inputs.players.map((player) => newAccount(player.holdings)),
    mid.slice(),
  );
  const limits: Limit[][] = assets.map(() => []);
  let checkingLimits = false;
  let day = 0;

  const sampleSize = (player: (typeof players)[number]) => {
    const logMean = player.profile.size_log_mean ?? DEFAULT_SIZE.logMean;
    const logSd = player.profile.size_log_sd ?? DEFAULT_SIZE.logSd;
    return Math.max(1, Math.round(Math.exp(logMean + logSd * gaussian(player.rng))));
  };

  const buy = (playerIndex: number, index: number, wanted: number, at: number, limit?: number) => {
    const player = players[playerIndex];
    if (assets[index].frozen) return false;
    let quantity = Math.floor(Math.min(wanted, shareLimit - player.windowShares));
    if (quantity < 1) return false;
    const feeRate = params.feeOnlyOnQuickSells ? 0 : params.feeRate;
    let priced = quote(index, "buy", quantity, at);
    if (limit !== undefined && priced.price > limit) return false;
    const cost = (q: number, price: number) => {
      const fee = price * q * feeRate;
      const fromCredit = Math.min(Math.max(player.credit, 0), fee);
      return { fee, fromCredit, cash: price * q + fee - fromCredit };
    };
    if (player.cash < cost(quantity, priced.price).cash) {
      quantity = Math.floor(player.cash / (priced.price * (1 + feeRate)));
      if (quantity < 1) return false;
      priced = quote(index, "buy", quantity, at);
    }
    const paid = cost(quantity, priced.price);
    if (player.cash < paid.cash) return false;
    player.cash -= paid.cash;
    player.credit -= paid.fromCredit;
    player.windowShares += quantity;
    commit(index, "buy", quantity, at);
    book.buy(playerIndex, index, quantity, { price: priced.price, fee: paid.fee, mid: priced.mid, at, day: day + 1 });
    checkLimits(index, at);
    return true;
  };

  const sell = (playerIndex: number, index: number, wanted: number, at: number) => {
    const player = players[playerIndex];
    const position = book.accounts[playerIndex].positions.get(index);
    if (!position || assets[index].frozen) return false;
    const quantity = Math.min(wanted, position.quantity, shareLimit - player.windowShares);
    if (!(quantity > 0)) return false;
    const feeApplies = !params.feeOnlyOnQuickSells || at - position.lastBuyAt < params.quickSellHours * 60;
    const priced = quote(index, "sell", quantity, at);
    const gross = priced.price * quantity;
    const fee = feeApplies ? gross * params.feeRate : 0;
    const fromCredit = Math.min(Math.max(player.credit, 0), fee);
    const credit = sellCredit(gross, settings.sell_credit_rate);
    player.cash += gross - (fee - fromCredit);
    player.credit += credit - fromCredit;
    player.windowShares += quantity;
    commit(index, "sell", quantity, at);
    book.sell(playerIndex, index, quantity, { price: priced.price, fee, mid: priced.mid, credit });
    checkLimits(index, at);
    return true;
  };

  /** Fills the limit bids on a stock that its price now reaches, and drops expired ones. */
  function checkLimits(index: number, at: number) {
    if (checkingLimits || !limits[index].length) return;
    checkingLimits = true;
    limits[index] = limits[index].filter((order) => at - order.postedAt <= LIMIT_LIFETIME && !buy(order.player, index, order.quantity, at, order.limit));
    checkingLimits = false;
  }

  const pickWeighted = (rng: Rng, odds: number[]) => {
    const total = odds.reduce((sum, weight) => sum + weight, 0);
    let roll = rng() * total;
    for (let i = 0; i < odds.length; i += 1) {
      roll -= odds[i];
      if (roll < 0) return i;
    }
    return odds.length - 1;
  };

  let recentMove: number[] = assets.map(() => 0);
  const tradable = assets.flatMap((asset, index) => (asset.frozen ? [] : [index]));

  const pickStock = (player: (typeof players)[number]) => {
    const { profile, rng } = player;
    const favorites = profile.favorites.filter(([index]) => !assets[index]?.frozen);
    if (favorites.length && rng() < profile.favorite_share)
      return favorites[
        pickWeighted(
          rng,
          favorites.map(([, weight]) => weight),
        )
      ][0];
    if (!tradable.length) return null;
    // Above one half chases risers, below buys dips.
    const tilt = profile.after_rise_share === null ? 0 : 2 * (profile.after_rise_share - 0.5);
    const ranked = tradable.map((index) => ({ index, score: tilt * recentMove[index] + 0.03 * gaussian(rng) })).sort((a, b) => b.score - a.score);
    return ranked[Math.floor(Math.pow(rng(), 2.5) * Math.min(12, ranked.length))].index;
  };

  const act = (playerIndex: number, at: number) => {
    const player = players[playerIndex];
    const { profile, rng } = player;
    const positions = book.accounts[playerIndex].positions;
    // A sell as often as the player sells; which bag goes is weighted toward ones at their profit
    // or loss level, and ones held longer than they usually hold.
    if (positions.size && rng() >= (profile.buy_share ?? 1)) {
      const held = [...positions.entries()].filter(([index]) => !assets[index].frozen);
      if (held.length) {
        const holdMinutes = profile.hold_hours_median === null ? null : profile.hold_hours_median * 60;
        const odds = held.map(([index, position]) => {
          const feeApplies = !params.feeOnlyOnQuickSells || at - position.lastBuyAt < params.quickSellHours * 60;
          const bid = liveMid(index, at) * (1 - spread[index] / 20000);
          const gain = position.basis > 0 ? (bid * (1 - (feeApplies ? params.feeRate : 0))) / position.basis - 1 : 0;
          const atLevel = (profile.take_profit !== null && gain >= profile.take_profit) || (profile.stop_loss !== null && gain <= profile.stop_loss);
          return (atLevel ? 4 : 1) * (holdMinutes !== null && at - position.lastBuyAt >= holdMinutes ? 3 : 1);
        });
        const [index, position] = held[pickWeighted(rng, odds)];
        const all = rng() < (profile.sell_all_share ?? 0.5);
        sell(playerIndex, index, all ? position.quantity : Math.min(position.quantity, sampleSize(player)), at);
        return;
      }
    }
    const index = pickStock(player);
    if (index === null) return;
    const quantity = sampleSize(player);
    if (player.limitUser) {
      limits[index].push({ player: playerIndex, quantity, limit: liveMid(index, at) * (1 - params.limitOffsetPct), postedAt: at });
      return;
    }
    buy(playerIndex, index, quantity, at);
  };

  const tick = (window: number, at: number) => {
    for (const player of players) player.windowShares = 0;
    for (let index = 0; index < count; index += 1) {
      if (!assets[index].ticks_enabled || assets[index].frozen) continue;
      const after = Math.max(MIN_PRICE, computeAdjustedPrice(mid[index], fair[index], strengths[index][window]));
      transient[index] = Math.log(after / fair[index]) - persistent[index];
      updatedAt[index] = at;
      mid[index] = after;
    }
    for (let index = 0; index < count; index += 1) checkLimits(index, at);
  };

  const evaluate = () => {
    const shifts = revealed.map((history) => (history.length >= 8 ? Math.log(history[history.length - 1] / history[history.length - 8]) : NaN));
    const scores = rankScores(shifts);
    const basis = revealed.map((history) => (history.length ? mean(history.slice(-7)) : 0));
    players.forEach((player, playerIndex) => {
      for (const [index, position] of book.accounts[playerIndex].positions) {
        const perShare = (dividendRate(scores[index], dividends) + params.dividendTiltPerWeek) * basis[index];
        const amount = Math.round(position.quantity * perShare * 100) / 100;
        if (!amount) continue;
        if (amount > 0) player.credit += amount;
        else {
          const fromCredit = Math.min(Math.max(player.credit, 0), -amount);
          player.credit -= fromCredit;
          player.cash -= -amount - fromCredit;
        }
        book.dividend(playerIndex, amount, position.quantity * params.dividendTiltPerWeek * basis[index]);
      }
      const converted = creditConversion(player.credit, settings.credit_conversion);
      player.credit -= converted;
      player.cash += converted;
    });
  };

  const firstDate = addDays(inputs.today, 1);
  const firstWeekday = new Date(`${firstDate}T12:00:00Z`).getUTCDay();
  const labels = [inputs.today];

  for (day = 0; day < params.days; day += 1) {
    const start = day * DAY;
    // Settlement: yesterday's fair value is revealed (its ticks have landed), today's is new.
    for (let index = 0; index < count; index += 1) {
      if (day > 0) revealed[index].push(fair[index]);
      advanceFair(index, params.driftPerDay);
      simFair[index].push(fair[index]);
      const opening = computeOpeningState(
        { previousPersistent: persistent[index], previousTransient: transient[index], fairValue: fair[index], carriedPrice: mid[index] },
        { persistentDecay: params.persistentDecay, transientDecay: settings.transient_settlement_decay },
      );
      persistent[index] = opening.persistent;
      transient[index] = opening.transient;
      updatedAt[index] = start;
      mid[index] = opening.midOpen;
    }
    // Outside income (games, check-ins…) lands; spending it can empty a balance but not overdraw it.
    for (const player of players) {
      player.cash = Math.max(player.cash + (player.profile.outside_cash_per_day || 0), Math.min(player.cash, 0));
      player.credit = Math.max(player.credit + (player.profile.outside_credit_per_day || 0), Math.min(player.credit, 0));
    }
    // Always drawn for every stock, so the market's stream doesn't depend on which ones tick.
    strengths = bounds.map((bound) => generateStrengths(marketRng, { total: params.strengthTotalPct, minPct: bound.min, maxPct: bound.max }));
    recentMove = book.closes.map((closes) => {
      const now = closes[closes.length - 1];
      const before = closes[Math.max(0, closes.length - 4)];
      return now > 0 && before > 0 ? Math.log(now / before) : 0;
    });

    const orders: { at: number; player: number }[] = [];
    players.forEach((player, playerIndex) => {
      const { profile, rng } = player;
      if (!(profile.active_day_rate > 0) || rng() >= profile.active_day_rate) return;
      const fills = Math.max(1, Math.round(profile.fills_per_active_day * (0.5 + rng())));
      for (let k = 0; k < fills; k += 1) orders.push({ at: start + rng() * DAY, player: playerIndex });
    });
    orders.sort((a, b) => a.at - b.at || a.player - b.player);

    const events: { at: number; run: () => void }[] = [];
    for (let window = 0; window < TICKS_PER_DAY; window += 1) events.push({ at: start + window * WINDOW, run: () => tick(window, start + window * WINDOW) });
    if ((firstWeekday + day) % 7 === FRIDAY) events.push({ at: start + EVALUATION_OFFSET, run: evaluate });
    events.sort((a, b) => a.at - b.at);
    let next = 0;
    for (const order of orders) {
      while (next < events.length && events[next].at <= order.at) events[next++].run();
      act(order.player, order.at);
    }
    while (next < events.length) events[next++].run();

    for (let index = 0; index < count; index += 1) limits[index] = limits[index].filter((order) => start + DAY - order.postedAt <= LIMIT_LIFETIME);
    book.closeDay(mid.slice());
    labels.push(addDays(firstDate, day));
  }

  const changes: number[] = [];
  const lagged: number[] = [];
  const following: number[] = [];
  for (const series of simFair) {
    for (let i = 1; i < series.length; i += 1) {
      const change = Math.log(series[i] / series[i - 1]);
      changes.push(change);
      if (i > 1) {
        lagged.push(Math.log(series[i - 1] / series[i - 2]));
        following.push(change);
      }
    }
  }
  const run = book.finish(mid.slice(), { days: params.days, growthLift: Math.exp(params.driftPerDay * params.days) - 1 }, labels);
  return { run, fairVol: stdev(changes), fairAutocorr: correlation(lagged, following) };
}
