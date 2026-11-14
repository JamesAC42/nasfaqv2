// The market simulator's data: what GET /api/admin/market-sim/inputs returns (api/src/services/marketSim.js),
// the knobs an admin turns, and what a run reports. Players are an anonymous index; stocks are an
// index into `assets`.

export type Side = "buy" | "sell";

export type SimSettings = {
  fee_rate: number;
  sell_credit_rate: number;
  slippage_weight: number;
  transient_weight: number;
  persistent_weight: number;
  transient_half_life_minutes: number;
  live_order_share_limit: number;
  persistent_daily_decay: number;
  transient_settlement_decay: number;
  strength_total_pct: number;
  intervals: { key: string; label: string; hour: number; day_offset: number }[];
  dividend: { rate_per_sigma: number; deadzone_sigma: number; cap: number };
  credit_conversion: { rate: number; minimum: number };
  reference_supply: number;
};

export type SimAsset = {
  symbol: string;
  depth: number;
  spread_bps: number;
  mid: number;
  held: number;
  max_shares: number;
  strength_min_pct: number;
  strength_max_pct: number;
  ticks_enabled: boolean;
  frozen: boolean;
  /** Daily closes and revealed fair values, aligned with SimInputs.dates (null when unknown or still secret). */
  close: (number | null)[];
  fair: (number | null)[];
};

export type PlayerProfile = {
  active_day_rate: number;
  fills_per_active_day: number;
  size_log_mean: number | null;
  size_log_sd: number | null;
  buy_share: number | null;
  after_rise_share: number | null;
  hold_hours_median: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  sell_all_share: number | null;
  /** [asset, share of the player's buy cash]. */
  favorites: [number, number][];
  favorite_share: number;
  /** Net Cash and Credit a day from outside the market: games, check-ins, referrals, predictions. */
  outside_cash_per_day: number;
  outside_credit_per_day: number;
};

export type SimPlayer = {
  cash: number;
  credit: number;
  /** [asset, shares, average cost per share (the fee included)]. */
  holdings: [number, number, number][];
  profile: PlayerProfile;
};

export type SimFill = { at: number; date: string; player: number; asset: number; side: Side; quantity: number; price: number; fee: number };

/** A weekly evaluation inside the replay window: [asset, rank score (null: left out), basis]. */
export type SimEvaluation = { eval_date: string; at: number; assets: [number, number | null, number][] };

export type SimInputs = {
  generated_at: string;
  today: string;
  window: { replay_days: number; replay_from: string; replay_from_date: string; profile_days: number; history_days: number; fills_truncated: boolean };
  settings: SimSettings;
  dates: string[];
  assets: SimAsset[];
  players: SimPlayer[];
  fills: SimFill[];
  evaluations: SimEvaluation[];
};

export type SimParams = {
  /** One spread for every stock, or null to keep each stock's own. */
  spreadBps: number | null;
  feeRate: number;
  /** Buys are free and only sells within quickSellHours of the last buy pay the fee. */
  feeOnlyOnQuickSells: boolean;
  quickSellHours: number;
  slippageWeight: number;
  transientWeight: number;
  persistentWeight: number;
  persistentDecay: number;
  transientHalfLifeMinutes: number;
  strengthTotalPct: number;
  /** Daily growth of every channel's size (a log rate: 0.0005 is about +0.05% a day). */
  driftPerDay: number;
  /** A flat weekly payout on every share held, as a share of its basis. */
  dividendTiltPerWeek: number;
  dividendPerSigma: number;
  deadzoneSigma: number;
  dividendCap: number;
  /** Share of players who post limit buys instead of buying at the ask, and how far under the price. */
  limitShare: number;
  limitOffsetPct: number;
  days: number;
  seeds: number;
  seed: number;
};

/** One run's (or the seed average's) numbers. Shares are 0-1; returns are fractions (0.05 = +5%). */
export type SimMetrics = {
  positionsRed: number;
  playersRed: number;
  medianBagReturn: number;
  medianAllInReturn: number;
  playersLosing: number;
  greenDays: number;
  buysGreen1d: number;
  buysGreen7d: number;
  brokerTake: number;
  /** Flat dividend tilt paid, all dividends and fees net, and growth's lift, each over the holdings' starting value. */
  tiltPrinted: number;
  dividendsNet: number;
  growthLift: number;
  /** Shares bought over shares traded, and buys over fills. */
  buyShare: number;
  buyFillShare: number;
  fillsPerDay: number;
  volume: number;
  players: number;
  positions: number;
};

export type SimRun = {
  metrics: SimMetrics;
  /** Every player's all-in return. */
  returns: number[];
  /** Share of positions in the red at each day's close (index 0 is the start). */
  redByDay: number[];
  dayLabels: string[];
};

/**
 * How closely the replay at today's settings reproduces the real fills: the largest price and fee
 * differences in dollars, and how many starting positions had to be estimated.
 */
export type ReplayCheck = { fills: number; maxPriceError: number; maxFeeError: number; startUnknown: number };

export type ModelCheck = {
  realFairDailyVol: number | null;
  simFairDailyVol: number | null;
  realFairAutocorr: number | null;
  simFairAutocorr: number | null;
  realFillsPerDay: number | null;
  realBuyShare: number | null;
  fittedAssets: number;
  pooledRho: number;
  pooledSigma: number;
};

export type SimComparison = {
  mode: "replay" | "forward";
  scenario: SimRun;
  baseline: SimRun;
  /** Seed-to-seed spread of each metric (forward only): [p10, p90]. */
  scenarioRange?: Partial<Record<keyof SimMetrics, [number, number]>>;
  baselineRange?: Partial<Record<keyof SimMetrics, [number, number]>>;
  replayCheck?: ReplayCheck;
  modelCheck?: ModelCheck;
  elapsedMs: number;
};
