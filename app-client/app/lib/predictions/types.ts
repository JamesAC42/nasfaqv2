// Shapes returned by the predictions v2 API (api/src/routes/predictions.js).
// Spec: docs/predictions/PREDICTIONS_DESIGN.md.

export type MarketStatus = "draft" | "pending_approval" | "rejected" | "open" | "closed" | "resolving" | "proposed" | "disputed" | "resolved" | "voided";

export type Outcome = {
  id: number;
  outcome_code: string; // "yes" | "no" | "o1".."o12"
  label: string;
  sort_order: number;
  price: number; // 0..1
  change_24h: number; // price points, e.g. 0.04 = +4¢
  sparkline: number[]; // hourly closes, last 24 h
  is_winner: boolean;
  asset: { symbol: string; icon: string | null; color: string | null } | null;
};

export type PredictionMarket = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  kind: "event" | "auto";
  market_type: "binary" | "multi";
  status: MarketStatus;
  trading_status: "pending_open" | "open" | "halted" | "closed" | "resolved" | "voided";
  visibility: string;
  category: { slug: string; display_name: string } | null;
  featured_image_url: string | null;
  opens_at: string;
  closes_at: string;
  resolves_after: string | null;
  created_at: string;
  resolved_at: string | null;
  voided_at: string | null;
  resolution_outcome: string | null;
  winning_outcome_id: number | null;
  total_volume_cash: number;
  liquidity_b: number;
  fee_bps: number;
  dispute_hours?: number;
  auto_template: "tick-direction" | "tick-top-gainer" | "stream-peak" | null;
  last_traded_probability: number;
  last_trade_at: string | null;
  outcomes: Outcome[];
  volume_24h: number;
  trades_24h: number;
  traders_24h: number;
};

export type Dispute = { id: number; username: string; reason: string; created_at: string };

export type Proposal = {
  id: number;
  status: "proposed" | "disputed" | "finalized" | "withdrawn" | "overturned";
  is_void: boolean;
  outcome_code: string | null;
  outcome_label: string | null;
  source_url: string | null;
  note: string | null;
  evidence: Record<string, unknown>;
  window_ends_at: string;
  proposer: { username: string } | null; // null = the system (auto markets)
  confirmer: { username: string } | null;
  self_confirmed: boolean;
  finalized_at: string | null;
  created_at: string;
  disputes: Dispute[];
};

export type TimelineEvent = { id: number; type: string; data: Record<string, unknown>; actor: string | null; at: string };

export type LimitOrder = {
  id: number;
  market_id: number;
  outcome_id: number;
  outcome_code?: string;
  outcome_label?: string;
  slug?: string;
  title?: string;
  side: "buy" | "sell";
  limit_price: number;
  cash_budget: number;
  cash_reserved: number;
  shares_total: number;
  shares_reserved: number;
  filled_shares: number;
  spent_cash: number;
  received_cash: number;
  status: "open" | "filled" | "cancelled" | "released";
  close_reason: string | null;
  created_at: string;
};

export type MyPosition = { outcome_id: number; outcome_code: string; shares: number; avg_price: number; net_cost: number; realized_pnl: number };

export type PredictionMarketDetail = PredictionMarket & {
  description: string | null;
  rules_text: string;
  resolution_source_text: string;
  dispute_hours: number;
  auto_data: Record<string, unknown>;
  creator: { username: string } | null;
  approver: { username: string } | null;
  resolver: { username: string } | null;
  proposals: Proposal[];
  timeline: TimelineEvent[];
  holders: Record<string, { username: string; profile_color: string | null; shares: number }[]>;
  max_house_loss: number;
  admin?: { house_net_cash: number; auto_key: string | null };
  mine?: { cash_balance: number; positions: MyPosition[]; orders: LimitOrder[] };
};

export type Trade = {
  id: number;
  market_id: number;
  slug: string;
  market_title: string;
  outcome_code: string;
  outcome_label: string;
  side: "buy" | "sell";
  shares: number;
  cash: number;
  avg_price: number;
  price_after: number | null;
  via_limit: boolean;
  username: string | null;
  profile_color: string | null;
  at: string;
};

/** A fill as it comes back from POST /trade and over the socket. */
export type Fill = {
  market_id: number;
  slug: string;
  outcome_code: string;
  outcome_label: string;
  side: "buy" | "sell";
  shares: number;
  cash: number;
  fee: number;
  avg_price: number;
  price_after: number;
  prices: { outcome_id: number; outcome_code: string; price: number }[];
  limit_order_id: number | null;
  at: string;
  username?: string;
};

export type Quote = {
  slug: string;
  outcome_code: string;
  price: number;
  tradeable: boolean;
  quote: {
    side: "buy" | "sell";
    shares: number;
    avg_price: number;
    fee: number;
    total?: number;
    payout?: number;
    capped: "price" | "position" | null;
    price_after: number;
    payout_if_right: number | null;
  } | null;
};

export type ChartSeries = { outcome_id: number; outcome_code: string; label: string; points: { t: string; p: number; v: number }[] };
export type ChartRange = "1h" | "6h" | "24h" | "7d" | "30d" | "all";
export type Chart = { slug: string; range: ChartRange; interval: string; series: ChartSeries[] };

export type PortfolioPosition = {
  market_id: number;
  slug: string;
  title: string;
  status: MarketStatus;
  kind: "event" | "auto";
  market_type?: "binary" | "multi";
  closes_at: string;
  outcome_id: number;
  outcome_code: string;
  outcome_label: string;
  asset?: Outcome["asset"];
  shares: number;
  shares_in_orders: number;
  avg_price: number;
  price: number;
  value: number;
  cost: number;
  unrealized_pnl: number;
  realized_pnl: number;
  won: boolean | null;
  settled_at: string | null;
};

export type Portfolio = {
  positions: PortfolioPosition[];
  orders: LimitOrder[];
  settled: PortfolioPosition[];
  totals: { value: number; unrealized_pnl: number; realized_pnl: number; in_orders_cash: number };
};

export type Forecaster = { rank: number; username: string; profile_color: string | null; pnl: number; markets: number };

export type AdminMarket = PredictionMarket & {
  house_net_cash: number;
  max_house_loss: number;
  creator: string | null;
  proposal?: {
    id: number;
    status: string;
    is_void: boolean;
    outcome_code: string | null;
    outcome_label: string | null;
    source_url: string | null;
    note: string | null;
    window_ends_at: string;
    created_at?: string;
    proposer: string | null;
    disputes: { reason: string; created_at: string; username: string }[];
  } | null;
};

export type AutoTemplate = { key: string; enabled: boolean; params: Record<string, number>; last_run_at: string | null; last_result: Record<string, unknown> };

export type AdminOverview = {
  queue: AdminMarket[];
  needs_call: AdminMarket[];
  proposals: AdminMarket[];
  live: AdminMarket[];
  drafts: AdminMarket[];
  templates: AutoTemplate[];
  house: { open_markets: number; worst_case_loss: number };
};

export type Category = { slug: string; display_name: string; description: string | null };

export type FloorTab = "live" | "closing" | "auto" | "events" | "resolving" | "resolved";

export type SocketMessage =
  | { type: "prediction.trade"; slug: string; market_id: number; trade: Fill }
  | { type: "prediction.market.updated"; action: string; slug: string | null; market_id: number | null }
  | { type: "prediction.hello" };

export type CreateMarketInput = {
  title: string;
  subtitle?: string;
  description?: string;
  rules_text: string;
  resolution_source_text: string;
  category?: string;
  market_type: "binary" | "multi";
  probability?: number;
  yes_label?: string;
  no_label?: string;
  outcomes?: { label: string; asset_symbol?: string; probability?: number }[];
  opens_at?: string;
  closes_at: string;
  resolves_after?: string;
  liquidity_b?: number;
  fee_bps?: number;
  dispute_hours?: number;
  featured_image_url?: string;
  publish?: boolean;
  submit?: boolean;
};
