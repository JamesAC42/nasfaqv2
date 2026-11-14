// Shared test data: the API's own numbers (api/test/fixtures/market-sim-parity.json) and a small,
// made-up market built the way the API's inputs endpoint shapes a real one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays } from "../forward";
import { MOMENTUM_WEIGHT, smoothFairValue } from "../mechanics";
import { gaussian, mulberry32 } from "../rng";
import type { PlayerProfile, SimFill, SimInputs, SimSettings, Side } from "../types";

type Parity = {
  settings: {
    fee_rate: number;
    slippage_weight: number;
    transient_weight: number;
    persistent_weight: number;
    transient_half_life_minutes: number;
    persistent_daily_decay: number;
    transient_settlement_decay: number;
    strength_total_pct: number;
    dividend: { rate_per_sigma: number; deadzone_sigma: number; cap: number };
    credit_conversion: { rate: number; minimum: number };
  };
  quotes: { mid: number; spread_bps: number; bid: number; ask: number }[];
  execution: { side: Side; bid: number; ask: number; quantity: number; depth: number; price: number }[];
  shock: { side: Side; quantity: number; depth: number; persistent: number; transient: number; next_persistent: number; next_transient: number }[];
  decay: { transient: number; minutes: number; value: number }[];
  live: { fair: number; persistent: number; transient: number; mid: number }[];
  adjusted: { mid: number; base: number; strength: number; price: number }[];
  opening: { prev_persistent: number; prev_transient: number; fair: number; carried: number | null; persistent: number; transient: number; mid_open: number }[];
  strengths: { uniforms: number[]; total: number; min_pct: number; max_pct: number; strengths: number[] }[];
  dividend: { z: number; rate: number }[];
  rank: { values: number[]; scores: (number | null)[] }[];
  conversion: { credit: number; converted: number }[];
  fill_sequence: {
    asset: { fair: number; depth: number; spread_bps: number };
    fills: { side: Side; quantity: number; mid_before: number; price: number; fee: number; mid_after: number }[];
  };
};

// npm test runs from app-client/.
export const parity: Parity = JSON.parse(readFileSync(join(process.cwd(), "..", "api", "test", "fixtures", "market-sim-parity.json"), "utf8"));

export function settingsFromParity(): SimSettings {
  const s = parity.settings;
  return {
    fee_rate: s.fee_rate,
    sell_credit_rate: 0.01,
    slippage_weight: s.slippage_weight,
    transient_weight: s.transient_weight,
    persistent_weight: s.persistent_weight,
    transient_half_life_minutes: s.transient_half_life_minutes,
    live_order_share_limit: 180,
    persistent_daily_decay: s.persistent_daily_decay,
    transient_settlement_decay: s.transient_settlement_decay,
    strength_total_pct: s.strength_total_pct,
    intervals: [
      { key: "open", label: "Open", hour: 9, day_offset: 0 },
      { key: "lunch", label: "Lunch", hour: 15, day_offset: 0 },
      { key: "late", label: "Late", hour: 21, day_offset: 0 },
      { key: "overnight", label: "Overnight", hour: 3, day_offset: 1 },
    ],
    dividend: s.dividend,
    credit_conversion: s.credit_conversion,
    reference_supply: 10000,
  };
}

const TODAY = "2026-11-14";

export function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    active_day_rate: 0.4,
    fills_per_active_day: 4,
    size_log_mean: Math.log(25),
    size_log_sd: 0.8,
    buy_share: 0.85,
    after_rise_share: 0.6,
    hold_hours_median: 48,
    take_profit: 0.05,
    stop_loss: -0.2,
    sell_all_share: 0.7,
    favorites: [],
    favorite_share: 0,
    outside_cash_per_day: 0,
    outside_credit_per_day: 0,
    ...overrides,
  };
}

/** A small market with 90 days of model-made fair values (ρ and σ known) and players holding some of it. */
export function syntheticInputs({ assets = 12, players = 20, rho = 0.9, sigma = 0.15, seed = 7 } = {}): SimInputs {
  const rng = mulberry32(seed);
  const dates = Array.from({ length: 90 }, (_, i) => addDays(TODAY, i - 89));
  const assetList = Array.from({ length: assets }, (_, index) => {
    const anchor = 8 + index;
    let momentum = 0;
    let fair = anchor;
    const fairs: (number | null)[] = [];
    const closes: (number | null)[] = [];
    for (let day = 0; day < dates.length; day += 1) {
      momentum = rho * momentum + sigma * gaussian(rng);
      fair = smoothFairValue(fair, anchor * Math.exp(MOMENTUM_WEIGHT * Math.max(-1.35, Math.min(1.35, momentum))));
      // Today's is still secret.
      fairs.push(day === dates.length - 1 ? null : fair);
      closes.push(fair * (1 + 0.02 * gaussian(rng)));
    }
    return {
      symbol: `T${index}`,
      depth: 2000,
      spread_bps: 400,
      mid: closes[closes.length - 1] as number,
      held: 0,
      max_shares: 18000,
      strength_min_pct: 0,
      strength_max_pct: 200,
      ticks_enabled: true,
      frozen: false,
      close: closes,
      fair: fairs,
    };
  });
  const playerList = Array.from({ length: players }, (_, index) => ({
    cash: 2000 + 100 * index,
    credit: 500,
    holdings: [
      [index % assets, 40, assetList[index % assets].mid * 1.05],
      [(index + 3) % assets, 20, assetList[(index + 3) % assets].mid * 0.97],
    ] as [number, number, number][],
    profile: profile({
      favorites: [
        [index % assets, 0.6],
        [(index + 5) % assets, 0.4],
      ],
      favorite_share: 0.5,
      after_rise_share: index % 2 ? 0.7 : 0.3,
    }),
  }));
  return {
    generated_at: `${TODAY}T18:00:00.000Z`,
    today: TODAY,
    window: {
      replay_days: 14,
      replay_from: `${addDays(TODAY, -14)}T18:00:00.000Z`,
      replay_from_date: addDays(TODAY, -14),
      profile_days: 45,
      history_days: 90,
      fills_truncated: false,
    },
    settings: settingsFromParity(),
    dates,
    assets: assetList,
    players: playerList,
    fills: [],
    evaluations: [],
  };
}

/** The fixture's fill run as replay inputs: one stock, players taking turns, holdings as the fills leave them. */
export function fixtureReplayInputs(): SimInputs {
  const base = syntheticInputs({ assets: 1, players: 3 });
  const { asset, fills } = parity.fill_sequence;
  const start = Date.parse(`${base.today}T15:00:00Z`);
  const simFills: SimFill[] = fills.map((fill, i) => ({
    at: start + i * 60_000,
    date: base.today,
    player: i % 3,
    asset: 0,
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
  }));
  const holdings = base.players.map(() => ({ quantity: 300, cost: 300 * asset.fair }));
  for (const fill of simFills) {
    const held = holdings[fill.player];
    if (fill.side === "buy") {
      held.quantity += fill.quantity;
      held.cost += fill.price * fill.quantity + fill.fee;
    } else {
      held.cost -= (held.cost / held.quantity) * fill.quantity;
      held.quantity -= fill.quantity;
    }
  }
  return {
    ...base,
    assets: [{ ...base.assets[0], depth: asset.depth, spread_bps: asset.spread_bps, mid: fills[fills.length - 1].mid_after }],
    players: base.players.map((player, i) => ({ ...player, holdings: [[0, holdings[i].quantity, holdings[i].cost / holdings[i].quantity]] })),
    fills: simFills,
  };
}
