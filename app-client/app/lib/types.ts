export type AuthUser = {
  id: number;
  username: string;
  email: string | null;
  email_verified: boolean;
  profile_picture_url: string | null;
  profile_color: string | null;
  is_admin: boolean;
  can_manage_assets: boolean;
  can_create_prediction_markets: boolean;
  can_approve_prediction_markets: boolean;
  can_resolve_prediction_markets: boolean;
  can_void_prediction_markets: boolean;
  created_at: string;
};

export type ChatChannel = {
  id: number;
  channel_key: string;
  scope_type: "asset" | "unit" | "market" | "meta";
  scope_key: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  posting_policy: "authenticated" | "admins_only" | "read_only";
  metadata: {
    asset_id?: number;
    symbol?: string | null;
    display_name?: string | null;
    asset_status?: string | null;
    youtube_channel_id?: string | null;
    channel_name?: string | null;
    unit?: string | null;
    icon?: string | null;
    color?: string | null;
    asset_count?: number | null;
  };
  last_message_id: number | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  message_count: number;
  last_read_message_id: number | null;
  unread_count: number;
  muted_until: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: number;
  channel_id: number;
  channel_key: string;
  body: string;
  status: "active" | "deleted" | "moderated";
  reply_to_message_id: number | null;
  created_at: string;
  edited_at: string | null;
  moderated_at: string | null;
  author: {
    id: number;
    username: string;
    profile_picture_url: string | null;
    profile_color: string | null;
    oshi_coin: {
      id: number;
      symbol: string;
      display_name: string;
      icon: string | null;
      color: string | null;
    } | null;
  } | null;
  is_mine: boolean;
};

export type CandlePoint = {
  bucket: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  close_mark?: number | null;
  volume_shares?: number | null;
};

export type PredictionMarketScope = "public" | "mine" | "review_queue";

export type PredictionMarketPagination = {
  total: number;
  page: number;
  limit: number;
  page_count: number;
  has_previous_page: boolean;
  has_next_page: boolean;
};

export type PredictionMarketCategory = {
  id: number;
  slug: string | null;
  display_name: string | null;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export type PredictionMarketUserRef = {
  id: number;
  username: string | null;
  profile_color?: string | null;
};

export type PredictionMarketOutcome = {
  id: number;
  outcome_code: "yes" | "no" | string;
  label: string;
  sort_order: number;
  is_winner: boolean;
};

export type PredictionMarketViewerPermissions = {
  can_submit_for_approval: boolean;
  can_approve: boolean;
  can_resolve: boolean;
  can_void: boolean;
  is_creator: boolean;
};

export type PredictionMarket = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  rules_text: string;
  resolution_source_text: string;
  status: "draft" | "pending_approval" | "open" | "closed" | "resolving" | "resolved" | "voided" | "rejected" | string;
  trading_status: "pending_open" | "open" | "closed" | string;
  visibility: "public" | "unlisted" | "private" | string;
  market_type: string;
  resolution_outcome: string | null;
  resolution_notes: string | null;
  featured_image_url: string | null;
  metadata_json: Record<string, unknown>;
  opens_at: string;
  closes_at: string;
  resolves_after: string | null;
  approved_at: string | null;
  trading_opened_at: string | null;
  trading_closed_at: string | null;
  resolved_at: string | null;
  voided_at: string | null;
  last_traded_probability: number | null;
  last_trade_at: string | null;
  total_volume_cash: number;
  open_interest_shares: number;
  created_at: string;
  updated_at: string;
  category: PredictionMarketCategory | null;
  creator: PredictionMarketUserRef | null;
  approver: PredictionMarketUserRef | null;
  resolver: PredictionMarketUserRef | null;
  outcomes: PredictionMarketOutcome[];
  viewer_permissions?: PredictionMarketViewerPermissions;
};

export type PredictionMarketListResponse = {
  items: PredictionMarket[];
  pagination: PredictionMarketPagination;
};

export type PredictionMarketDetailResponse = {
  market: PredictionMarket;
};

export type PredictionOrderBookLevel = {
  price: number;
  quantity: number;
};

export type PredictionOrderBook = {
  yes: {
    buy: PredictionOrderBookLevel[];
    sell: PredictionOrderBookLevel[];
  };
  no: {
    buy: PredictionOrderBookLevel[];
    sell: PredictionOrderBookLevel[];
  };
};

export type PredictionOrderBookResponse = {
  slug: string;
  orderbook: PredictionOrderBook;
};

export type PredictionTrade = {
  id: number;
  market_id: number;
  outcome_id: number;
  outcome_code: "yes" | "no" | string;
  outcome_label: string;
  trade_kind: "secondary" | "mint" | "redeem" | string;
  maker_order_id: number | null;
  taker_order_id: number | null;
  maker_user_id: number | null;
  maker_username: string | null;
  taker_user_id: number | null;
  taker_username: string | null;
  maker_outcome_id: number | null;
  maker_outcome_code: string | null;
  taker_outcome_id: number | null;
  taker_outcome_code: string | null;
  maker_side: "buy" | "sell" | null | string;
  taker_side: "buy" | "sell" | null | string;
  buy_order_id: number | null;
  sell_order_id: number | null;
  buy_user_id: number | null;
  buy_username: string | null;
  sell_user_id: number | null;
  sell_username: string | null;
  price: number;
  quantity: number;
  notional_cash: number;
  fee_cash_buy: number;
  fee_cash_sell: number;
  matched_at: string;
};

export type PredictionTradeResponse = {
  slug: string;
  trades: PredictionTrade[];
};

export type PredictionOpenOrder = {
  id: number;
  market_id: number;
  outcome_id: number;
  outcome_code: "yes" | "no" | string;
  outcome_label: string;
  user_id: number;
  side: "buy" | "sell" | string;
  price: number;
  quantity: number;
  open_quantity: number;
  matched_quantity: number;
  cash_reserved: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PredictionOpenOrdersResponse = {
  slug: string;
  orders: PredictionOpenOrder[];
};

export type PredictionCandlePoint = CandlePoint & {
  last?: number | null;
  volume_cash?: number | null;
  trade_count?: number | null;
  best_bid?: number | null;
  best_ask?: number | null;
};

export type PredictionCandlesResponse = {
  slug: string;
  interval: string;
  outcome: "yes" | "no" | string;
  candles: PredictionCandlePoint[];
};

export type PredictionMarketEvent = {
  id: number;
  market_id: number;
  actor_user_id: number | null;
  actor_username: string | null;
  actor_profile_color: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
};

export type PredictionMarketEventResponse = {
  slug: string;
  events: PredictionMarketEvent[];
};

export type PredictionMarketCommentStake = {
  outcome_id: number;
  outcome_code: "yes" | "no" | string;
  outcome_label: string | null;
  shares: number;
  avg_entry_price: number;
};

export type PredictionMarketComment = {
  id: number;
  market_id: number;
  body: string;
  created_at: string;
  updated_at: string;
  author: AssetCommentAuthor & {
    total_equity: number | null;
    rank: number | null;
  };
  author_stakes: PredictionMarketCommentStake[];
};

export type PredictionMarketCommentListResponse = {
  slug: string;
  comments: PredictionMarketComment[];
  pagination: PredictionMarketPagination;
  viewer_context: {
    is_authenticated: boolean;
    can_post: boolean;
    positions: PredictionMarketCommentStake[];
  };
};

export type PredictionPosition = {
  user_id: number;
  market_id: number;
  slug: string;
  title: string;
  status: string;
  trading_status: string;
  resolution_outcome: string | null;
  last_traded_probability: number | null;
  closes_at: string;
  resolved_at: string | null;
  outcome_id: number;
  outcome_code: "yes" | "no" | string;
  outcome_label: string;
  is_winner: boolean;
  shares: number;
  avg_entry_price: number;
  realized_pnl_cash: number;
  updated_at: string;
};

export type PredictionPositionsResponse = {
  slug: string;
  positions: PredictionPosition[];
};

export type PredictionPortfolioResponse = {
  user_id: number;
  positions: PredictionPosition[];
  open_orders: Array<PredictionOpenOrder & {
    slug: string;
    title: string;
  }>;
};

export type MarketAsset = {
  id: number;
  symbol: string;
  display_name: string;
  youtube_channel_id: string;
  unit?: string | null;
  icon?: string | null;
  color?: string | null;
  current_fair_value: number | null;
  current_mid_price: number | null;
  previous_settlement_mid_price: number | null;
  pre_settlement_mid_price: number | null;
  current_bid_price: number | null;
  current_ask_price: number | null;
  current_premium_pct: number | null;
  current_daily_emission: number | null;
  treasury_supply: number | null;
  circulating_supply: number | null;
  latest_snapshot_date: string | null;
  volume_24h: number | null;
  move_24h_pct: number | null;
  pending_live_order_count?: number;
  pending_live_buy_count?: number;
  pending_live_sell_count?: number;
  pending_live_buy_quantity?: number;
  pending_live_sell_quantity?: number;
  next_live_order_execute_after?: string | null;
  oshicoin_users?: number;
  base_rate?: number | null;
  market_price?: number | null;
  premium_discount_pct?: number | null;
  adjustment_enabled?: boolean | null;
  adjustment_ready?: boolean | null;
  next_adjustment?: MarketAdjustment | null;
  latest_adjustment?: MarketAdjustment | null;
  sparkline_candles: CandlePoint[];
};

export type MarketAdjustment = {
  interval_key: string;
  scheduled_at: string | null;
  applied_at?: string | null;
  base_rate: number | null;
  price_before?: number | null;
  price_after?: number | null;
  market_date?: string | null;
};

export type MarketAdjustmentSessionSummary = {
  id: number;
  market_date: string;
  status: string;
  generated_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
  interval_count: number;
  scheduled_count: number;
  applied_count: number;
  skipped_count: number;
  cancelled_count: number;
};

export type MarketAdjustmentTickSummary = {
  session_id: number;
  market_date: string;
  interval_key: string;
  scheduled_at: string | null;
  applied_at?: string | null;
  asset_count?: number;
  applied_count?: number;
  skipped_count?: number;
  avg_abs_move_pct?: number | null;
  avg_gap_compression_pct?: number | null;
};

export type MarketAdjustmentOutcome = {
  id?: number;
  market_date?: string | null;
  symbol: string;
  display_name: string;
  icon?: string | null;
  color?: string | null;
  interval_key: string;
  scheduled_at?: string | null;
  applied_at?: string | null;
  status?: string;
  base_rate: number | null;
  price_before: number | null;
  price_after: number | null;
  move_pct: number | null;
  gap_compression_pct?: number | null;
  skip_reason?: string | null;
};

export type MarketAdjustmentHealth = {
  next_scheduled_at: string | null;
  last_applied_at: string | null;
  overdue_scheduled_count: number;
  scheduled_count: number;
  skipped_24h_count: number;
  applied_24h_count: number;
};

export type MarketAdjustmentSummary = {
  generated_at: string;
  timezone: string;
  sessions: MarketAdjustmentSessionSummary[];
  next_tick: MarketAdjustmentTickSummary | null;
  last_tick: MarketAdjustmentTickSummary | null;
  recaps: MarketAdjustmentTickSummary[];
  leaderboards: {
    movers: MarketAdjustmentOutcome[];
    gap_compression: MarketAdjustmentOutcome[];
  };
  feed: MarketAdjustmentOutcome[];
  health: MarketAdjustmentHealth | null;
};

export type MarketAssetAdjustmentHistory = {
  symbol: string;
  items: MarketAdjustmentOutcome[];
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

export type AssetCommentAuthor = {
  id: number;
  username: string;
  profile_picture_url: string | null;
  profile_color: string | null;
};

export type AssetComment = {
  id: number;
  body: string;
  mood: ArticleCommentMood | null;
  created_at: string;
  updated_at: string;
  upvotes: number;
  downvotes: number;
  viewer_vote: -1 | 0 | 1;
  author_share_quantity: number;
  author: AssetCommentAuthor;
};

export type AssetCommentListResponse = {
  symbol: string;
  comments: AssetComment[];
  pagination: NewsFeedPagination;
  viewer_context: {
    is_authenticated: boolean;
    owned_shares: number;
    can_post: boolean;
  };
};

export type SuperchatCurrencySummary = {
  currency_name: string;
  donation_count: number | null;
  total_in_currency: number | null;
  total_in_yen: number | null;
};

export type AssetSuperchatSummaryBundle = {
  symbol: string;
  youtube_channel_id: string;
  range: string;
  week_start: string | null;
  week_end: string | null;
  currencies: SuperchatCurrencySummary[];
};

export type SuperchatTimeseriesPoint = {
  bucket: string;
  currency_name: string;
  total_in_yen: number | null;
};

export type AssetSuperchatTimeseriesBundle = {
  symbol: string;
  youtube_channel_id: string;
  range: string;
  bucket_unit: "day" | "week" | "month";
  start_date: string | null;
  end_date: string | null;
  points: SuperchatTimeseriesPoint[];
};

export type ChannelOverviewRow = {
  channel: {
    youtube_channel_id: string;
    name: string;
    name_short?: string;
    symbol: string | null;
    unit?: string | null;
    channel_asset_icon_url?: string | null;
    channel_asset_banner_url?: string | null;
    youtube_channel_description?: string | null;
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

export type PortfolioOrder = {
  id: number;
  asset_id: number;
  symbol: string;
  display_name: string;
  side: "buy" | "sell" | string;
  order_type: string;
  requested_quantity: number;
  filled_quantity: number;
  status: string;
  quote_bid_at_submit: number | null;
  quote_ask_at_submit: number | null;
  rejection_reason: string | null;
  execute_after: string | null;
  live_order_batch_id: number | null;
  submitted_market_date: string | null;
  submitted_interval_key: string | null;
  requested_at: string | null;
  updated_at: string | null;
};

export type PortfolioOrdersResponse = {
  user_id: number;
  orders: PortfolioOrder[];
};

export type GameCatalogEntry = {
  id: number;
  key: string;
  name: string;
  description: string;
  game_type: "single_player" | "gacha" | "pvp" | "idle";
  status: "draft" | "active" | "disabled";
  entry_fee_cash: number;
  min_stake_cash: number | null;
  max_stake_cash: number | null;
  sort_order: number;
  icon_key: string | null;
  banner_key: string | null;
  config: Record<string, unknown>;
};

export type GameCatalogResponse = {
  games: GameCatalogEntry[];
};

export type GameCosmetic = {
  id: number;
  user_id: number;
  cosmetic_key: string;
  cosmetic_type: string;
  rarity: string;
  source_type: string;
  source_reference_id: number | null;
  metadata: Record<string, unknown>;
  granted_at: string;
};

export type GameEquippedCosmetic = {
  slot_key: string;
  cosmetic: GameCosmetic;
  updated_at: string;
};

export type GameInventoryResponse = {
  user_id: number;
  cosmetics: GameCosmetic[];
  equipped: GameEquippedCosmetic[];
  summary: {
    total_cosmetics: number;
    counts_by_type: Record<string, number>;
  };
};

export type GameItemLockerEntry = {
  id: number;
  game_id: number;
  game_session_id: number | null;
  cost_cash: number;
  reward_type: string;
  reward_key: string;
  duplicate_compensation_cash: number;
  metadata: Record<string, unknown>;
  created_at: string;
  reward: {
    key: string;
    type: string;
    rarity: string;
    display_name: string;
    image_key: string;
    image_url: string;
    duplicate: boolean;
  };
};

export type GameItemLockerResponse = {
  user_id: number;
  items: GameItemLockerEntry[];
  summary: {
    total_items: number;
    counts_by_type: Record<string, number>;
  };
};

export type GameSessionSummary = {
  id: number;
  game_id: number;
  game_key: string;
  game_name: string;
  game_type: "single_player" | "gacha" | "pvp" | "idle";
  status: string;
  entry_fee_cash: number;
  payout_cash: number;
  score: number | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

export type GamesSummary = {
  user_id: number;
  cash_balance: number;
  inventory: {
    total_cosmetics: number;
    counts_by_type: Record<string, number>;
    equipped: GameEquippedCosmetic[];
  };
  recent_sessions: GameSessionSummary[];
};

export type GachaPullResult = {
  game: GameCatalogEntry;
  session: {
    id: number;
    entry_fee_cash: number;
    payout_cash: number;
    created_at: string;
  };
  wallet: {
    debited_cash: number;
    duplicate_compensation_cash: number;
    cash_balance_after: number;
  };
  pull: {
    id: number;
    created_at: string;
    reward: {
      key: string;
      type: string;
      rarity: string;
      display_name: string;
      description: string;
      slot_key: string | null;
      image_key: string;
      image_url: string;
      pull_chance: number;
      metadata: Record<string, unknown>;
    };
    duplicate: boolean;
    granted_cosmetic: GameCosmetic | null;
  };
};

export type GachaCatalogReward = {
  key: string;
  type: string;
  rarity: string;
  display_name: string;
  description: string;
  slot_key: string | null;
  weight: number;
  pull_weight: number;
  pull_chance: number;
  image_key: string;
  filename: string;
  image_url: string;
  metadata: Record<string, unknown>;
  is_active?: boolean;
  is_deleted?: boolean;
  sort_order?: number;
};

export type GachaCatalogResponse = {
  game: GameCatalogEntry;
  rewards: GachaCatalogReward[];
};

export type TickerTapTimelineTarget = {
  index: number;
  lane: number;
  start_ms: number;
};

export type TickerTapSessionConfig = {
  run_duration_seconds: number;
  lane_count: number;
  target_lifetime_ms: number;
  spawn_interval_ms: number;
  max_targets: number;
  leaderboard_window_days?: number;
  leaderboard_limit?: number;
  seed_hint: string;
  timeline: TickerTapTimelineTarget[];
};

export type TickerTapSessionCreateResponse = {
  game: GameCatalogEntry;
  session: {
    id: number;
    status: string;
    entry_fee_cash: number;
    started_at: string;
    config: TickerTapSessionConfig;
  };
  wallet: {
    cash_balance_after: number;
  };
};

export type TickerTapSessionResult = {
  type: string;
  phase: string;
  config: TickerTapSessionConfig;
  submission: {
    hits: number;
    misses: number;
    max_streak: number;
    duration_ms: number;
    taps: number;
    accuracy: number;
  };
  score: number;
};

export type TickerTapSessionResponse = {
  session: {
    id: number;
    status: string;
    score: number | null;
    entry_fee_cash: number;
    payout_cash: number;
    started_at: string;
    completed_at: string | null;
    result: Record<string, unknown> | TickerTapSessionResult;
  };
};

export type TickerTapSubmitResponse = {
  session: {
    id: number;
    status: string;
    score: number;
    payout_cash: number;
    completed_at: string;
  };
  result: TickerTapSessionResult;
};

export type TickerTapLeaderboardEntry = {
  rank: number;
  session_id: number;
  user_id: number;
  username: string;
  profile_color: string | null;
  score: number;
  completed_at: string;
  stats: {
    hits: number;
    misses: number;
    max_streak: number;
    duration_ms: number;
  };
};

export type TickerTapLeaderboardResponse = {
  game: GameCatalogEntry | null;
  leaderboard: TickerTapLeaderboardEntry[];
};

export type GachaSpendingLeaderboardEntry = {
  rank: number;
  user_id: number;
  username: string;
  profile_color: string | null;
  pull_count: number;
  total_spent_cash: number;
  total_compensation_cash: number;
};

export type GachaSpendingLeaderboardResponse = {
  game_key: string;
  leaderboard: GachaSpendingLeaderboardEntry[];
};

export type ReportRow = {
  asset_id?: number;
  symbol: string;
  display_name: string;
  base_rate?: number | null;
  base_rate_change_pct?: number | null;
  fair_value?: number | null;
  fair_value_change_pct?: number | null;
  market_price?: number | null;
  premium_discount_pct?: number | null;
  premium_pct?: number | null;
  emission?: number | null;
  treasury_supply_end?: number | null;
  circulating_supply_end?: number | null;
  move_pct?: number | null;
  volume_change_pct?: number | null;
  volume_shares?: number | null;
  volume_cash?: number | null;
  volume_cash_change_pct?: number | null;
};

export type DailyReport = {
  market_date: string;
  generated_at?: string;
  asset_count: number;
  biggest_base_rate_increases?: ReportRow[];
  biggest_base_rate_decreases?: ReportRow[];
  biggest_fair_value_increases?: ReportRow[];
  biggest_fair_value_decreases?: ReportRow[];
  largest_market_premiums?: ReportRow[];
  largest_market_discounts?: ReportRow[];
  largest_premiums?: ReportRow[];
  largest_discounts?: ReportRow[];
  biggest_winners?: ReportRow[];
  biggest_losers?: ReportRow[];
  top_price_movers?: ReportRow[];
  volume_winners?: ReportRow[];
  volume_losers?: ReportRow[];
  top_volume?: ReportRow[];
  notable_treasury_emissions?: ReportRow[];
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

export type MarketHubTrade = {
  id: number;
  order_id: number | null;
  user_id: number;
  username: string | null;
  profile_color: string | null;
  asset_id: number;
  symbol: string;
  display_name: string;
  icon: string | null;
  color: string | null;
  ts: string;
  side: string;
  price: number;
  quantity: number;
  gross_cash: number;
  fee_cash: number;
  net_cash: number;
  counterparty_type: string | null;
};

export type MarketHubVolumeLeader = {
  asset_id: number;
  symbol: string;
  display_name: string;
  volume_shares: number;
  volume_cash: number;
  volume_change_pct: number | null;
};

export type MarketActivityWindow = {
  trade_count: number;
  trader_count: number;
  asset_count: number;
  volume_shares: number;
  volume_cash: number;
  latest_trade_at: string | null;
};

export type MarketActivityTrader = {
  user_id: number;
  username: string;
  profile_color: string | null;
  profile_picture_url: string | null;
  trade_count: number;
  distinct_assets: number;
  volume_cash: number;
  volume_shares: number;
  latest_trade_at: string | null;
};

export type MarketLiveOrderAssetSummary = {
  asset_id: number;
  symbol: string;
  display_name: string;
  icon: string | null;
  color: string | null;
  next_execute_after: string | null;
  pending_count: number;
  pending_buy_count: number;
  pending_sell_count: number;
  pending_buy_quantity: number;
  pending_sell_quantity: number;
};

export type MarketLiveOrderSummary = {
  generated_at: string;
  symbol: string | null;
  next_execute_after: string | null;
  pending_count: number;
  pending_buy_count: number;
  pending_sell_count: number;
  pending_buy_quantity: number;
  pending_sell_quantity: number;
  assets: MarketLiveOrderAssetSummary[];
};

export type MarketLiveOrderFlowPoint = {
  bucket: string;
  buy_count: number;
  sell_count: number;
  buy_quantity: number;
  sell_quantity: number;
};

export type MarketLiveOrderFlow = {
  generated_at: string;
  symbol: string | null;
  current_tick: MarketLiveOrderFlowPoint[];
  per_minute: MarketLiveOrderFlowPoint[];
  cycles_24h: MarketLiveOrderFlowPoint[];
};

export type MarketActivity = {
  windows: {
    "5m": MarketActivityWindow;
    "1h": MarketActivityWindow;
    "24h": MarketActivityWindow;
  };
  most_active_traders_24h: MarketActivityTrader[];
  live_orders: MarketLiveOrderSummary;
};

export type MarketHubLeaders = {
  top_price: MarketAsset[];
  top_volume: MarketAsset[];
  top_movers: MarketAsset[];
  top_losers: MarketAsset[];
  top_premiums: MarketAsset[];
  top_discounts: MarketAsset[];
  volume_winners: MarketHubVolumeLeader[];
  volume_losers: MarketHubVolumeLeader[];
};

export type MarketHubResponse = {
  generated_at: string;
  status: MarketStatus | null;
  report: DailyReport | null;
  indexes: MarketIndexBundle[];
  activity: MarketActivity;
  leaders: MarketHubLeaders;
  recent_trades: {
    items: MarketHubTrade[];
    next_cursor: string | null;
  };
};

export type MarketTradeEvent = {
  type: "market.trade_fill";
  trade: MarketHubTrade;
  quote: {
    asset_id: number;
    symbol: string;
    display_name: string;
    mid_price: number | null;
    bid_price: number | null;
    ask_price: number | null;
    premium_pct: number | null;
    updated_at: string | null;
  };
  market_status: {
    current_market_date: string | null;
    last_settlement_market_date: string | null;
    is_trading_open: boolean;
  };
};

export type LivestreamItem = {
  id: string;
  channel_id?: string | null;
  title: string;
  creator: string;
  viewer_count: number | null;
  started_at: string | null;
  status: string;
  creator_icon?: string | null;
  channel_color?: string | null;
  thumbnail_url?: string | null;
  url?: string | null;
};

export type ChannelLivestreamBundle = {
  channel_id: string;
  live: LivestreamItem[];
  upcoming: LivestreamItem[];
};

export type LeaderboardEntry = {
  user_id: number;
  id: string;
  username: string;
  profile_picture_url: string | null;
  profile_color: string | null;
  equipped_hat: {
    cosmetic_key: string;
    rarity: string;
    display_name: string;
    image_url: string | null;
  } | null;
  rank: number;
  label: string;
  value: number | null;
  total_equity: number;
  cash_balance: number;
  holdings_market_value: number;
  total_unrealized_pnl: number;
  change_abs: number | null;
  change_pct: number | null;
  daily_change_abs: number | null;
  daily_change_pct: number | null;
  weekly_change_abs: number | null;
  weekly_change_pct: number | null;
  largest_position: {
    asset_id: number | null;
    symbol: string;
    value: number;
    quantity: number | null;
  } | null;
  best_asset: {
    asset_id: number | null;
    symbol: string;
    unrealized_pnl: number;
    quantity: number | null;
  } | null;
  achievements: AchievementBadge[];
  streaks: TradeStreak;
  badges: string[];
  is_me: boolean;
  is_friend: boolean;
  is_rival: boolean;
};

export type LeaderboardPagination = {
  total: number;
  page: number;
  limit: number;
  page_count: number;
  has_previous_page: boolean;
  has_next_page: boolean;
};

export type LeaderboardScope = "global" | "friends" | "rivals";
export type LeaderboardWindow = "1d" | "7d" | "all";

export type LeaderboardNeighbor = {
  user_id: number;
  username: string;
  rank: number;
  total_equity: number;
  gap_abs: number | null;
  profile_picture_url: string | null;
  profile_color: string | null;
  equipped_hat: LeaderboardEntry["equipped_hat"];
};

export type LeaderboardMe = LeaderboardEntry & {
  percentile: number;
  neighbors: LeaderboardNeighbor[];
};

export type LeaderboardStats = {
  user_count: number;
  cutoff_equity_top_10: number | null;
  cutoff_equity_top_100: number | null;
  last_updated_at: string | null;
};

export type LeaderboardResponse = {
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  pagination: LeaderboardPagination;
  stats: LeaderboardStats;
  entries: LeaderboardEntry[];
  me: LeaderboardMe | null;
};

export type OshiboardAsset = {
  id: number;
  symbol: string;
  display_name: string;
  icon: string | null;
  color: string | null;
  current_mid_price?: number | null;
  current_premium_pct?: number | null;
  circulating_supply?: number | null;
};

export type OshiboardEntry = {
  user_id: number;
  username: string;
  profile_picture_url: string | null;
  profile_color: string | null;
  rank: number;
  coin_quantity: number;
  coin_market_value: number;
  total_equity: number;
  updated_at: string | null;
};

export type OshiboardStats = {
  member_count: number;
  total_shares: number;
  total_market_value: number;
  last_updated_at: string | null;
};

export type OshiboardResponse = {
  asset: OshiboardAsset;
  stats: OshiboardStats;
  entries: OshiboardEntry[];
};

export type OshiboardMembership = {
  asset: OshiboardAsset;
  rank: number;
  coin_quantity: number;
  coin_market_value: number;
  total_equity: number;
  member_count: number;
  total_shares: number;
  updated_at: string | null;
};

export type NewsCharacter = {
  name: string;
  icon: string | null;
  youtube_channel_id?: string;
  symbol?: string | null;
  unit?: string | null;
};

export type NewsItem = {
  id: string;
  headline: string;
  source: string;
  published_at: string | null;
  thumbnail_url?: string | null;
  url?: string | null;
  summary?: string | null;
  characters?: NewsCharacter[];
  related_names?: string[];
  channel_ids?: string[];
  stock_symbols?: string[];
  units?: string[];
  article_id?: number | null;
  article_slug?: string | null;
  is_news?: boolean;
  like_count?: number | null;
  save_count?: number | null;
  comment_count?: number | null;
  view_count?: number | null;
};

export type NewsFeedPagination = {
  total: number;
  page: number;
  limit: number;
  page_count: number;
  has_previous_page: boolean;
  has_next_page: boolean;
};

export type NewsFeedResponse = {
  items: NewsItem[];
  pagination: NewsFeedPagination;
};

export type ArticleAuthor = {
  id: number;
  username: string;
};

export type ArticleAsset = {
  id: number;
  symbol: string;
  display_name: string;
  icon: string | null;
  color: string | null;
};

export type ArticleSummary = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  tags: string[];
  thumbnail_url: string | null;
  preview: string | null;
  author: ArticleAuthor | null;
  likes: number;
  saves: number;
  views: number;
  is_news: boolean;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  comment_count: number;
  related_assets: ArticleAsset[];
  viewer_has_liked: boolean;
  viewer_has_saved: boolean;
  news_item?: {
    id: number;
    headline: string;
    published_at: string | null;
  } | null;
};

export const ARTICLE_COMMENT_MOODS = [
  "Bullish",
  "Bearish",
  "Neutral",
  "Hodling",
  "Dump Eet",
  "He Bought?",
  "He Sold?",
  "Diamond Hands",
  "Watching",
  "Accumulating",
] as const;

export type ArticleCommentMood = typeof ARTICLE_COMMENT_MOODS[number];

export type ArticleComment = {
  id: number;
  body: string;
  mood: ArticleCommentMood | null;
  created_at: string;
  updated_at: string;
  upvotes: number;
  downvotes: number;
  viewer_vote: -1 | 0 | 1;
  author: ArticleAuthor;
};

export type ArticleProposal = {
  id: number;
  title: string | null;
  subtitle: string | null;
  tags: string[];
  thumbnail_url: string | null;
  content: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  author: ArticleAuthor;
  reviewer: ArticleAuthor | null;
  upvotes: number;
  downvotes: number;
  viewer_vote: -1 | 0 | 1;
};

export type ArticleDetail = ArticleSummary & {
  content: string;
  comments: ArticleComment[];
  proposals: ArticleProposal[];
};

export type ArticleListResponse = {
  items: ArticleSummary[];
  pagination: NewsFeedPagination;
};

export type SiteStats = {
  user_count: number;
  channel_count: number;
};

export type ProfileRelationUser = {
  id: number;
  username: string;
  profile_picture_url: string | null;
  profile_color: string | null;
  created_at?: string;
};

export type ProfileOshiCoin = {
  id: number;
  symbol: string;
  display_name: string;
  icon: string | null;
  color: string | null;
};

export type ProfileViewerContext = {
  is_authenticated: boolean;
  is_self: boolean;
  friendship_status: "none" | "self" | "accepted" | "pending_outgoing" | "pending_incoming";
  can_send_friend_request: boolean;
  is_rival: boolean;
  is_rivaled_by_profile: boolean;
};

export type ProfileNetworthPoint = {
  recorded_at: string;
  cash_balance: number;
  total_market_value: number;
  total_equity: number;
};

export type ProfileTrade = {
  id: number;
  ts: string;
  side: string;
  price: number;
  quantity: number;
  gross_cash: number;
  fee_cash: number;
  net_cash: number;
  symbol: string;
  display_name: string;
};

export type AchievementBadge = {
  key: string;
  name: string;
  description: string | null;
  badge_icon: string | null;
  badge_color: string | null;
  earned_at: string | null;
  reward_cash: number;
};

export type TradeStreak = {
  current_streak_days: number;
  longest_streak_days: number;
  last_trade_day: string | null;
  streak_started_day?: string | null;
  longest_streak_started_day?: string | null;
  longest_streak_ended_day?: string | null;
};

export type ProfileBundle = {
  profile: {
    id: number;
    username: string;
    email_verified: boolean;
    created_at: string;
    bio: string | null;
    profile_picture_url: string | null;
    profile_color: string | null;
    is_admin: boolean;
    permissions: {
      can_manage_assets: boolean;
      can_create_prediction_markets: boolean;
      can_approve_prediction_markets: boolean;
      can_resolve_prediction_markets: boolean;
      can_void_prediction_markets: boolean;
    };
    rank: number;
    oshiboards: OshiboardMembership[];
    oshi_coin: ProfileOshiCoin | null;
    stats: {
      cash_balance: number;
      total_market_value: number;
      total_unrealized_pnl: number;
      total_equity: number;
      article_count: number;
      trade_count: number;
      friend_count: number;
      rival_count: number;
    };
    achievements: AchievementBadge[];
    streaks: TradeStreak;
    networth_history: ProfileNetworthPoint[];
    friends: ProfileRelationUser[];
    rivals: ProfileRelationUser[];
    pending_friend_requests: {
      incoming: ProfileRelationUser[];
      outgoing: ProfileRelationUser[];
    } | null;
    holdings: PortfolioHolding[];
    gacha_badges: GameItemLockerEntry[];
    gacha_total_spent_cash: number;
  };
  viewer_context: ProfileViewerContext;
  articles: ArticleListResponse;
  saved_articles: ArticleListResponse | null;
  trades: {
    items: ProfileTrade[];
    pagination: NewsFeedPagination;
  };
};
