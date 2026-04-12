export type AuthUser = {
  id: number;
  username: string;
  profile_picture_url: string | null;
  profile_color: string | null;
  is_admin: boolean;
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

export type ReportRow = {
  asset_id?: number;
  symbol: string;
  display_name: string;
  fair_value?: number | null;
  fair_value_change_pct?: number | null;
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
  biggest_fair_value_increases?: ReportRow[];
  biggest_fair_value_decreases?: ReportRow[];
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

export type LivestreamItem = {
  id: string;
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
  } | null;
  best_asset: {
    asset_id: number | null;
    symbol: string;
    unrealized_pnl: number;
  } | null;
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

export type ProfileBundle = {
  profile: {
    id: number;
    username: string;
    created_at: string;
    bio: string | null;
    profile_picture_url: string | null;
    profile_color: string | null;
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
    networth_history: ProfileNetworthPoint[];
    friends: ProfileRelationUser[];
    rivals: ProfileRelationUser[];
    pending_friend_requests: {
      incoming: ProfileRelationUser[];
      outgoing: ProfileRelationUser[];
    } | null;
    holdings: PortfolioHolding[];
  };
  viewer_context: ProfileViewerContext;
  articles: ArticleListResponse;
  trades: {
    items: ProfileTrade[];
    pagination: NewsFeedPagination;
  };
};
