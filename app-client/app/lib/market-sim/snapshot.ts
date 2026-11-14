// The market as it stands, straight from the inputs (no simulation): what the page shows before a run.

import { midFromFillPrice } from "./mechanics";
import { median, share } from "./stats";
import type { SimInputs } from "./types";

export type MarketSnapshot = {
  stocks: number;
  players: number;
  holders: number;
  positions: number;
  positionsRed: number;
  playersRed: number;
  medianBagReturn: number;
  fills: number;
  buyShare: number;
  brokerTake: number;
  medianSpreadBps: number;
};

export function marketSnapshot(inputs: SimInputs): MarketSnapshot {
  const positions: number[] = [];
  const bags: number[] = [];
  for (const player of inputs.players) {
    let value = 0;
    let cost = 0;
    for (const [asset, quantity, basis] of player.holdings) {
      const mid = inputs.assets[asset]?.mid ?? 0;
      value += quantity * mid;
      cost += quantity * basis;
      if (basis > 0) positions.push(mid / basis - 1);
    }
    if (cost > 0) bags.push(value / cost - 1);
  }
  let broker = 0;
  let volume = 0;
  let bought = 0;
  let traded = 0;
  for (const fill of inputs.fills) {
    const asset = inputs.assets[fill.asset];
    const mid = midFromFillPrice(fill.side, fill.price, asset.spread_bps, fill.quantity, asset.depth, inputs.settings.slippage_weight);
    broker += fill.fee + Math.abs(fill.price - mid) * fill.quantity;
    volume += fill.price * fill.quantity;
    traded += fill.quantity;
    if (fill.side === "buy") bought += fill.quantity;
  }
  return {
    stocks: inputs.assets.length,
    players: inputs.players.length,
    holders: bags.length,
    positions: positions.length,
    positionsRed: share(positions, (value) => value < 0),
    playersRed: share(bags, (value) => value < 0),
    medianBagReturn: median(bags),
    fills: inputs.fills.length,
    buyShare: traded > 0 ? bought / traded : NaN,
    brokerTake: volume > 0 ? broker / volume : NaN,
    medianSpreadBps: median(inputs.assets.map((asset) => asset.spread_bps)),
  };
}
