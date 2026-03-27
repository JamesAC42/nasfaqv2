export type AuthUser = {
  id: number;
  username: string;
  created_at: string;
};

export type CandlePoint = {
  bucket: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  close_mark?: number | null;
};

export type MarketAsset = {
  id: number;
  symbol: string;
  display_name: string;
  youtube_channel_id: string;
  unit?: string | null;
  icon?: string | null;
  current_fair_value: number | null;
  current_mid_price: number | null;
  current_bid_price: number | null;
  current_ask_price: number | null;
  current_premium_pct: number | null;
  current_daily_emission: number | null;
  treasury_supply: number | null;
  circulating_supply: number | null;
  latest_snapshot_date: string | null;
  volume_24h: number | null;
  move_24h_pct: number | null;
  sparkline_candles: CandlePoint[];
};

export type MarketStatPoint = {
  snapshot_date: string;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
  fundamental_value_raw: number | null;
  fundamental_value_smoothed: number | null;
};

export type MarketIndexPoint = {
  bucket: string;
  value: number | null;
  day_return_pct: number | null;
  total_volume_cash: number | null;
  avg_premium_pct: number | null;
  constituent_count: number | null;
};

export type MarketIndexSummary = {
  market_date: string | null;
  index_value: number | null;
  day_return_pct: number | null;
  total_return_pct: number | null;
  total_volume_cash: number | null;
  avg_premium_pct: number | null;
  constituent_count: number | null;
  advancers: number | null;
  decliners: number | null;
  unchanged: number | null;
};

export type MarketIndexBundle = {
  group_by: string;
  group: string;
  range: string;
  weighting: string;
  summary: MarketIndexSummary | null;
  series: MarketIndexPoint[];
};

export type TradeRow = {
  id: number;
  ts: string;
  side: string;
  price: number;
  quantity: number;
  gross_cash: number;
};

export type AssetDetailBundle = {
  stats: MarketStatPoint[];
  daily_candles: CandlePoint[];
  intraday_candles: CandlePoint[];
  trades: TradeRow[];
  treasury: {
    max_supply: number | null;
    circulating_supply: number | null;
    treasury_supply: number | null;
    current_daily_emission: number | null;
    current_premium_pct: number | null;
  } | null;
};

export type ChannelOverviewRow = {
  channel: {
    youtube_channel_id: string;
    name: string;
    name_short?: string;
    symbol: string | null;
  };
  latest: {
    subscriber_count: number | null;
    view_count: number | null;
    video_count: number | null;
    time: string;
  } | null;
};

export type PortfolioHolding = {
  asset_id: number;
  symbol: string;
  display_name: string;
  quantity: number;
  avg_cost_basis: number;
  current_mid_price: number | null;
  market_value: number;
  unrealized_pnl: number;
};

export type PortfolioSummary = {
  cash_balance: number;
  total_market_value: number;
  total_unrealized_pnl: number;
  total_equity: number;
  holdings: PortfolioHolding[];
};

export type ReportRow = {
  symbol: string;
  display_name: string;
  premium_pct?: number | null;
  move_pct?: number | null;
  volume_cash?: number | null;
};

export type DailyReport = {
  market_date: string;
  asset_count: number;
  largest_premiums?: ReportRow[];
  largest_discounts?: ReportRow[];
  top_price_movers?: ReportRow[];
  top_volume?: ReportRow[];
};

export type MarketStatus = {
  trading_status: "open" | "settling" | "manual_closed";
  is_trading_open: boolean;
  active_phase: "idle" | "fundamentals" | "settlement";
  trading_message: string | null;
  current_market_date: string | null;
  current_cycle_started_at: string | null;
  current_cycle_updated_at: string | null;
  last_settlement_market_date: string | null;
  last_settlement_completed_at: string | null;
  next_scheduled_settlement_at: string | null;
  last_cycle_error: string | null;
  updated_at: string | null;
};

export type LivestreamItem = {
  id: string;
  title: string;
  creator: string;
  viewer_count: number | null;
  started_at: string | null;
  status: string;
  creator_icon?: string | null;
  thumbnail_url?: string | null;
  url?: string | null;
};

export type LeaderboardEntry = {
  id: string;
  rank: number;
  label: string;
  value: number | null;
  change_pct?: number | null;
};

export type NewsItem = {
  id: string;
  headline: string;
  source: string;
  published_at: string | null;
  thumbnail_url?: string | null;
  url?: string | null;
  summary?: string | null;
  related_names?: string[];
};
