// The bookkeeping both modes share: each player's positions and money in and out, the broker's
// take, fresh buys, daily marks, and the numbers a run reports.

import { median, share } from "./stats";
import type { SimMetrics, SimRun } from "./types";

export type Position = { quantity: number; basis: number; lastBuyAt: number };

export type Account = {
  positions: Map<number, Position>;
  /** Money in: the starting positions' cost plus every buy, fees included. */
  spent: number;
  /** Money out: sale proceeds after the fee, plus the Credit sales earn. */
  received: number;
  /** Dividends less share fees. */
  dividends: number;
};

export function newAccount(holdings: [number, number, number][], since = -Infinity): Account {
  const positions = new Map<number, Position>();
  let spent = 0;
  for (const [asset, quantity, basis] of holdings) {
    if (!(quantity > 0)) continue;
    positions.set(asset, { quantity, basis, lastBuyAt: since });
    spent += quantity * basis;
  }
  return { positions, spent, received: 0, dividends: 0 };
}

type FreshBuy = { asset: number; day: number; cost: number };

export class Book {
  accounts: Account[];
  broker = 0;
  volume = 0;
  boughtShares = 0;
  soldShares = 0;
  fills = 0;
  buyFills = 0;
  tiltPaid = 0;
  dividendsNet = 0;
  playerDays = 0;
  greenDays = 0;
  redByDay: number[] = [];
  freshBuys: FreshBuy[] = [];
  /** Every stock's closes by day (index 0 is the start), filled in by the mode. */
  closes: number[][] = [];
  startValue = 0;
  private held: Map<number, number>[];

  constructor(accounts: Account[], startMarks: number[]) {
    this.accounts = accounts;
    this.held = accounts.map((account) => snapshot(account));
    for (const account of accounts) for (const [asset, position] of account.positions) this.startValue += position.quantity * (startMarks[asset] ?? 0);
    this.closes = startMarks.map((mark) => [mark]);
    this.redByDay.push(redShare(accounts, (asset) => startMarks[asset]));
  }

  /** `day` is the index in `closes` of the close that ends the day of the buy. */
  buy(player: number, asset: number, quantity: number, { price, fee, mid, at, day }: { price: number; fee: number; mid: number; at: number; day: number }) {
    const account = this.accounts[player];
    const gross = price * quantity;
    const position = account.positions.get(asset) ?? { quantity: 0, basis: 0, lastBuyAt: at };
    position.basis = (position.quantity * position.basis + gross + fee) / (position.quantity + quantity);
    position.quantity += quantity;
    position.lastBuyAt = at;
    account.positions.set(asset, position);
    account.spent += gross + fee;
    this.broker += fee + (price - mid) * quantity;
    this.volume += gross;
    this.boughtShares += quantity;
    this.fills += 1;
    this.buyFills += 1;
    this.freshBuys.push({ asset, day, cost: (gross + fee) / quantity });
  }

  sell(player: number, asset: number, quantity: number, { price, fee, mid, credit }: { price: number; fee: number; mid: number; credit: number }) {
    const account = this.accounts[player];
    const position = account.positions.get(asset);
    if (!position) return;
    const gross = price * quantity;
    position.quantity -= quantity;
    if (position.quantity <= 1e-9) account.positions.delete(asset);
    account.received += gross - fee + credit;
    this.broker += fee + (mid - price) * quantity;
    this.volume += gross;
    this.soldShares += quantity;
    this.fills += 1;
  }

  dividend(player: number, amount: number, tilt: number) {
    this.accounts[player].dividends += amount;
    this.dividendsNet += amount;
    this.tiltPaid += tilt;
  }

  /** Closes a day at these prices: today's P/L on what each player held at the last close, and the red share. */
  closeDay(closes: number[]) {
    closes.forEach((close, asset) => this.closes[asset].push(close));
    const day = (this.closes[0]?.length ?? 1) - 1;
    this.accounts.forEach((account, player) => {
      const held = this.held[player];
      if (held.size) {
        let change = 0;
        for (const [asset, quantity] of held) change += quantity * (this.closes[asset][day] - this.closes[asset][day - 1]);
        this.playerDays += 1;
        if (change > 0) this.greenDays += 1;
      }
      this.held[player] = snapshot(account);
    });
    this.redByDay.push(redShare(this.accounts, (asset) => closes[asset]));
  }

  /** The run's numbers, marking what's left at `marks`. */
  finish(marks: number[], { days, growthLift }: { days: number; growthLift: number }, dayLabels: string[]): SimRun {
    const positions: number[] = [];
    const bags: number[] = [];
    const returns: number[] = [];
    for (const account of this.accounts) {
      let value = 0;
      let cost = 0;
      for (const [asset, position] of account.positions) {
        const worth = position.quantity * marks[asset];
        value += worth;
        cost += position.quantity * position.basis;
        if (position.basis > 0) positions.push(worth / (position.quantity * position.basis) - 1);
      }
      if (cost > 0) bags.push(value / cost - 1);
      if (account.spent > 0) returns.push((value + account.received + account.dividends - account.spent) / account.spent);
    }
    const greenAfter = (k: number) => {
      const results: number[] = [];
      for (const buy of this.freshBuys) {
        const close = this.closes[buy.asset][buy.day + k];
        if (close !== undefined) results.push(close / buy.cost - 1);
      }
      return share(results, (value) => value > 0);
    };
    const metrics: SimMetrics = {
      positionsRed: share(positions, (value) => value < 0),
      playersRed: share(bags, (value) => value < 0),
      medianBagReturn: median(bags),
      medianAllInReturn: median(returns),
      playersLosing: share(returns, (value) => value < 0),
      greenDays: this.playerDays ? this.greenDays / this.playerDays : NaN,
      buysGreen1d: greenAfter(1),
      buysGreen7d: greenAfter(7),
      brokerTake: this.volume > 0 ? this.broker / this.volume : NaN,
      tiltPrinted: this.startValue > 0 ? this.tiltPaid / this.startValue : NaN,
      dividendsNet: this.startValue > 0 ? this.dividendsNet / this.startValue : NaN,
      growthLift,
      buyShare: this.boughtShares + this.soldShares > 0 ? this.boughtShares / (this.boughtShares + this.soldShares) : NaN,
      buyFillShare: this.fills > 0 ? this.buyFills / this.fills : NaN,
      fillsPerDay: days > 0 ? this.fills / days : NaN,
      volume: this.volume,
      players: bags.length,
      positions: positions.length,
    };
    return { metrics, returns, redByDay: this.redByDay, dayLabels };
  }
}

function snapshot(account: Account) {
  return new Map([...account.positions].map(([asset, position]) => [asset, position.quantity]));
}

function redShare(accounts: Account[], markOf: (asset: number) => number) {
  let red = 0;
  let total = 0;
  for (const account of accounts) {
    for (const [asset, position] of account.positions) {
      if (!(position.basis > 0)) continue;
      total += 1;
      if (markOf(asset) < position.basis) red += 1;
    }
  }
  return total ? red / total : NaN;
}
