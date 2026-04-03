export type AuthUser = {
  id: number;
  username: string;
  is_admin: boolean;
  created_at: string;
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
  id: string;
  rank: number;
  label: string;
  value: number | null;
  change_pct?: number | null;
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

export type ArticleComment = {
  id: number;
  body: string;
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
