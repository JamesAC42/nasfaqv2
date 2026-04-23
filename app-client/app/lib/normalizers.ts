import {
  ARTICLE_COMMENT_MOODS,
  type ArticleAsset,
  type ArticleAuthor,
  type ArticleComment,
  type ArticleDetail,
  type ArticleListResponse,
  type ArticleProposal,
  type ArticleSummary,
  type AssetComment,
  type AssetCommentAuthor,
  type AssetCommentListResponse,
  type AssetDetailBundle,
  type AssetSuperchatSummaryBundle,
  type ChatChannel,
  type ChatMessage,
  type DailyReport,
  type GameCatalogEntry,
  type GameCatalogResponse,
  type GameCosmetic,
  type GameEquippedCosmetic,
  type GameInventoryResponse,
  type GameSessionSummary,
  type GamesSummary,
  type GachaPullResult,
  type AssetSuperchatTimeseriesBundle,
  type CandlePoint,
  type ChannelOverviewRow,
  type LeaderboardEntry,
  type LeaderboardMe,
  type LeaderboardNeighbor,
  type LeaderboardResponse,
  type LeaderboardStats,
  type LivestreamItem,
  type MarketAsset,
  type MarketActivity,
  type MarketActivityTrader,
  type MarketActivityWindow,
  type MarketHubResponse,
  type MarketHubTrade,
  type MarketHubVolumeLeader,
  type MarketIndexBundle,
  type MarketIndexPoint,
  type MarketIndexSummary,
  type MarketStatus,
  type MarketStatPoint,
  type NewsCharacter,
  type NewsFeedResponse,
  type NewsItem,
  type PortfolioSummary,
  type PredictionCandlesResponse,
  type PredictionCandlePoint,
  type PredictionMarket,
  type PredictionMarketDetailResponse,
  type PredictionMarketListResponse,
  type PredictionOpenOrder,
  type PredictionOpenOrdersResponse,
  type PredictionOrderBook,
  type PredictionOrderBookLevel,
  type PredictionOrderBookResponse,
  type PredictionTrade,
  type PredictionTradeResponse,
  type ProfileBundle,
  type ProfileNetworthPoint,
  type ProfileRelationUser,
  type ProfileTrade,
  type SuperchatCurrencySummary,
  type TickerTapLeaderboardEntry,
  type TickerTapLeaderboardResponse,
  type TickerTapSessionConfig,
  type TickerTapSessionCreateResponse,
  type TickerTapSessionResponse,
  type TickerTapSessionResult,
  type TickerTapSubmitResponse,
  type TradeRow,
} from "@/app/lib/types";
import { toNumber } from "@/app/lib/format";

export function normalizeCandles(candles: Array<Record<string, unknown>>): CandlePoint[] {
  return candles.map((item) => ({
    bucket: String(item.bucket || ""),
    open: toNumber(item.open),
    high: toNumber(item.high),
    low: toNumber(item.low),
    close: toNumber(item.close),
    close_mark: toNumber(item.close_mark),
    volume_shares: toNumber(item.volume_shares),
  }));
}

function normalizePredictionOrderBookLevels(value: unknown): PredictionOrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((level) => {
      const row = level && typeof level === "object" ? level as Record<string, unknown> : null;
      if (!row) return null;
      return {
        price: Number(toNumber(row.price) || 0),
        quantity: Number(toNumber(row.quantity) || 0),
      };
    })
    .filter((level): level is PredictionOrderBookLevel => level !== null);
}

function normalizePredictionMarket(value: unknown): PredictionMarket {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const category = row?.category && typeof row.category === "object" ? row.category as Record<string, unknown> : null;
  const creator = row?.creator && typeof row.creator === "object" ? row.creator as Record<string, unknown> : null;
  const approver = row?.approver && typeof row.approver === "object" ? row.approver as Record<string, unknown> : null;
  const resolver = row?.resolver && typeof row.resolver === "object" ? row.resolver as Record<string, unknown> : null;
  const viewerPermissions = row?.viewer_permissions && typeof row.viewer_permissions === "object"
    ? row.viewer_permissions as Record<string, unknown>
    : null;

  return {
    id: Number(row?.id || 0),
    slug: String(row?.slug || ""),
    title: String(row?.title || ""),
    subtitle: row?.subtitle ? String(row.subtitle) : null,
    description: row?.description ? String(row.description) : null,
    rules_text: String(row?.rules_text || ""),
    resolution_source_text: String(row?.resolution_source_text || ""),
    status: String(row?.status || "draft"),
    trading_status: String(row?.trading_status || "pending_open"),
    visibility: String(row?.visibility || "public"),
    market_type: String(row?.market_type || "binary"),
    resolution_outcome: row?.resolution_outcome ? String(row.resolution_outcome) : null,
    resolution_notes: row?.resolution_notes ? String(row.resolution_notes) : null,
    featured_image_url: row?.featured_image_url ? String(row.featured_image_url) : null,
    metadata_json: row?.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json as Record<string, unknown> : {},
    opens_at: String(row?.opens_at || ""),
    closes_at: String(row?.closes_at || ""),
    resolves_after: row?.resolves_after ? String(row.resolves_after) : null,
    approved_at: row?.approved_at ? String(row.approved_at) : null,
    trading_opened_at: row?.trading_opened_at ? String(row.trading_opened_at) : null,
    trading_closed_at: row?.trading_closed_at ? String(row.trading_closed_at) : null,
    resolved_at: row?.resolved_at ? String(row.resolved_at) : null,
    voided_at: row?.voided_at ? String(row.voided_at) : null,
    last_traded_probability: toNumber(row?.last_traded_probability),
    last_trade_at: row?.last_trade_at ? String(row.last_trade_at) : null,
    total_volume_cash: Number(toNumber(row?.total_volume_cash) || 0),
    open_interest_shares: Number(toNumber(row?.open_interest_shares) || 0),
    created_at: String(row?.created_at || ""),
    updated_at: String(row?.updated_at || ""),
    category: category
      ? {
          id: Number(category.id || 0),
          slug: category.slug ? String(category.slug) : null,
          display_name: category.display_name ? String(category.display_name) : null,
        }
      : null,
    creator: creator
      ? {
          id: Number(creator.id || 0),
          username: creator.username ? String(creator.username) : null,
          profile_color: creator.profile_color ? String(creator.profile_color) : null,
        }
      : null,
    approver: approver
      ? {
          id: Number(approver.id || 0),
          username: approver.username ? String(approver.username) : null,
          profile_color: approver.profile_color ? String(approver.profile_color) : null,
        }
      : null,
    resolver: resolver
      ? {
          id: Number(resolver.id || 0),
          username: resolver.username ? String(resolver.username) : null,
          profile_color: resolver.profile_color ? String(resolver.profile_color) : null,
        }
      : null,
    outcomes: Array.isArray(row?.outcomes)
      ? row.outcomes
        .map((outcome) => {
          const outcomeRow = outcome && typeof outcome === "object" ? outcome as Record<string, unknown> : null;
          if (!outcomeRow) return null;
          return {
            id: Number(outcomeRow.id || 0),
            outcome_code: String(outcomeRow.outcome_code || ""),
            label: String(outcomeRow.label || ""),
            sort_order: Number(outcomeRow.sort_order || 0),
            is_winner: Boolean(outcomeRow.is_winner),
          };
        })
        .filter((outcome): outcome is PredictionMarket["outcomes"][number] => outcome !== null)
      : [],
    viewer_permissions: viewerPermissions
      ? {
          can_submit_for_approval: Boolean(viewerPermissions.can_submit_for_approval),
          can_approve: Boolean(viewerPermissions.can_approve),
          can_resolve: Boolean(viewerPermissions.can_resolve),
          can_void: Boolean(viewerPermissions.can_void),
          is_creator: Boolean(viewerPermissions.is_creator),
        }
      : undefined,
  };
}

export function normalizePredictionMarketListResponse(value: Record<string, unknown>): PredictionMarketListResponse {
  const pagination = value.pagination && typeof value.pagination === "object"
    ? value.pagination as Record<string, unknown>
    : null;
  return {
    items: Array.isArray(value.items) ? value.items.map((item) => normalizePredictionMarket(item)) : [],
    pagination: {
      total: Number(pagination?.total || 0),
      page: Number(pagination?.page || 1),
      limit: Number(pagination?.limit || 20),
      page_count: Number(pagination?.page_count || 1),
      has_previous_page: Boolean(pagination?.has_previous_page),
      has_next_page: Boolean(pagination?.has_next_page),
    },
  };
}

export function normalizePredictionMarketDetailResponse(value: Record<string, unknown>): PredictionMarketDetailResponse {
  return {
    market: normalizePredictionMarket(value.market),
  };
}

export function normalizePredictionOrderBookResponse(value: Record<string, unknown>): PredictionOrderBookResponse {
  const bookValue = value.orderbook && typeof value.orderbook === "object"
    ? value.orderbook as Record<string, unknown>
    : null;
  const yes = bookValue?.yes && typeof bookValue.yes === "object" ? bookValue.yes as Record<string, unknown> : null;
  const no = bookValue?.no && typeof bookValue.no === "object" ? bookValue.no as Record<string, unknown> : null;
  const orderbook: PredictionOrderBook = {
    yes: {
      buy: normalizePredictionOrderBookLevels(yes?.buy),
      sell: normalizePredictionOrderBookLevels(yes?.sell),
    },
    no: {
      buy: normalizePredictionOrderBookLevels(no?.buy),
      sell: normalizePredictionOrderBookLevels(no?.sell),
    },
  };
  return {
    slug: String(value.slug || ""),
    orderbook,
  };
}

export function normalizePredictionTradeResponse(value: Record<string, unknown>): PredictionTradeResponse {
  return {
    slug: String(value.slug || ""),
    trades: Array.isArray(value.trades)
      ? value.trades
        .map((trade) => {
          const row = trade && typeof trade === "object" ? trade as Record<string, unknown> : null;
          if (!row) return null;
          return {
            id: Number(row.id || 0),
            market_id: Number(row.market_id || 0),
            outcome_id: Number(row.outcome_id || 0),
            outcome_code: String(row.outcome_code || ""),
            outcome_label: String(row.outcome_label || ""),
            trade_kind: String(row.trade_kind || "secondary"),
            maker_order_id: toNumber(row.maker_order_id),
            taker_order_id: toNumber(row.taker_order_id),
            maker_user_id: toNumber(row.maker_user_id),
            maker_username: row.maker_username ? String(row.maker_username) : null,
            taker_user_id: toNumber(row.taker_user_id),
            taker_username: row.taker_username ? String(row.taker_username) : null,
            maker_outcome_id: toNumber(row.maker_outcome_id),
            maker_outcome_code: row.maker_outcome_code ? String(row.maker_outcome_code) : null,
            taker_outcome_id: toNumber(row.taker_outcome_id),
            taker_outcome_code: row.taker_outcome_code ? String(row.taker_outcome_code) : null,
            maker_side: row.maker_side ? String(row.maker_side) : null,
            taker_side: row.taker_side ? String(row.taker_side) : null,
            buy_order_id: toNumber(row.buy_order_id),
            sell_order_id: toNumber(row.sell_order_id),
            buy_user_id: toNumber(row.buy_user_id),
            buy_username: row.buy_username ? String(row.buy_username) : null,
            sell_user_id: toNumber(row.sell_user_id),
            sell_username: row.sell_username ? String(row.sell_username) : null,
            price: Number(toNumber(row.price) || 0),
            quantity: Number(toNumber(row.quantity) || 0),
            notional_cash: Number(toNumber(row.notional_cash) || 0),
            fee_cash_buy: Number(toNumber(row.fee_cash_buy) || 0),
            fee_cash_sell: Number(toNumber(row.fee_cash_sell) || 0),
            matched_at: String(row.matched_at || ""),
          };
        })
        .filter((trade): trade is PredictionTrade => trade !== null)
      : [],
  };
}

export function normalizePredictionOpenOrdersResponse(value: Record<string, unknown>): PredictionOpenOrdersResponse {
  return {
    slug: String(value.slug || ""),
    orders: Array.isArray(value.orders)
      ? value.orders
        .map((order) => {
          const row = order && typeof order === "object" ? order as Record<string, unknown> : null;
          if (!row) return null;
          return {
            id: Number(row.id || 0),
            market_id: Number(row.market_id || 0),
            outcome_id: Number(row.outcome_id || 0),
            outcome_code: String(row.outcome_code || ""),
            outcome_label: String(row.outcome_label || ""),
            user_id: Number(row.user_id || 0),
            side: String(row.side || "buy"),
            price: Number(toNumber(row.price) || 0),
            quantity: Number(toNumber(row.quantity) || 0),
            open_quantity: Number(toNumber(row.open_quantity) || 0),
            matched_quantity: Number(toNumber(row.matched_quantity) || 0),
            cash_reserved: Number(toNumber(row.cash_reserved) || 0),
            status: String(row.status || "open"),
            created_at: String(row.created_at || ""),
            updated_at: String(row.updated_at || ""),
          };
        })
        .filter((order): order is PredictionOpenOrder => order !== null)
      : [],
  };
}

export function normalizePredictionCandlesResponse(value: Record<string, unknown>): PredictionCandlesResponse {
  return {
    slug: String(value.slug || ""),
    interval: String(value.interval || "1h"),
    outcome: String(value.outcome || "yes"),
    candles: Array.isArray(value.candles)
      ? value.candles
        .map((candle) => {
          const row = candle && typeof candle === "object" ? candle as Record<string, unknown> : null;
          if (!row) return null;
          const normalized: PredictionCandlePoint = {
            bucket: String(row.bucket || ""),
            open: toNumber(row.open),
            high: toNumber(row.high),
            low: toNumber(row.low),
            close: toNumber(row.close),
            close_mark: toNumber(row.close_mark),
            volume_shares: toNumber(row.volume_shares),
            last: toNumber(row.last),
            volume_cash: toNumber(row.volume_cash),
            trade_count: toNumber(row.trade_count),
            best_bid: toNumber(row.best_bid),
            best_ask: toNumber(row.best_ask),
          };
          return normalized;
        })
        .filter((candle): candle is PredictionCandlePoint => candle !== null)
      : [],
  };
}

export function normalizeAsset(asset: Record<string, unknown>): MarketAsset {
  return {
    id: Number(asset.id),
    symbol: String(asset.symbol || ""),
    display_name: String(asset.display_name || ""),
    youtube_channel_id: String(asset.youtube_channel_id || ""),
    unit: asset.unit ? String(asset.unit) : null,
    icon: asset.icon ? String(asset.icon) : null,
    color: asset.color ? String(asset.color) : null,
    current_fair_value: toNumber(asset.current_fair_value),
    current_mid_price: toNumber(asset.current_mid_price),
    current_bid_price: toNumber(asset.current_bid_price),
    current_ask_price: toNumber(asset.current_ask_price),
    current_premium_pct: toNumber(asset.current_premium_pct),
    current_daily_emission: toNumber(asset.current_daily_emission),
    treasury_supply: toNumber(asset.treasury_supply),
    circulating_supply: toNumber(asset.circulating_supply),
    latest_snapshot_date: asset.latest_snapshot_date ? String(asset.latest_snapshot_date) : null,
    volume_24h: toNumber(asset.volume_24h),
    move_24h_pct: toNumber(asset.move_24h_pct),
    sparkline_candles: normalizeCandles(
      (asset.sparkline_candles as Array<Record<string, unknown>> | undefined) || []
    ),
  };
}

export function normalizeStats(stats: Array<Record<string, unknown>>): MarketStatPoint[] {
  return stats.map((item) => ({
    snapshot_date: String(item.snapshot_date || ""),
    subscriber_count: toNumber(item.subscriber_count),
    view_count: toNumber(item.view_count),
    video_count: toNumber(item.video_count),
    fundamental_value_raw: toNumber(item.fundamental_value_raw),
    fundamental_value_smoothed: toNumber(item.fundamental_value_smoothed),
  }));
}

export function normalizeMarketIndexPoint(value: Record<string, unknown>): MarketIndexPoint {
  return {
    bucket: String(value.bucket || ""),
    value: toNumber(value.value),
    day_return_pct: toNumber(value.day_return_pct),
    total_volume_cash: toNumber(value.total_volume_cash),
    avg_premium_pct: toNumber(value.avg_premium_pct),
    constituent_count: toNumber(value.constituent_count),
  };
}

export function normalizeMarketIndexSummary(value: Record<string, unknown> | null): MarketIndexSummary | null {
  if (!value) return null;
  return {
    market_date: value.market_date ? String(value.market_date) : null,
    index_value: toNumber(value.index_value),
    day_return_pct: toNumber(value.day_return_pct),
    total_return_pct: toNumber(value.total_return_pct),
    total_volume_cash: toNumber(value.total_volume_cash),
    avg_premium_pct: toNumber(value.avg_premium_pct),
    constituent_count: toNumber(value.constituent_count),
    advancers: toNumber(value.advancers),
    decliners: toNumber(value.decliners),
    unchanged: toNumber(value.unchanged),
  };
}

export function normalizeMarketIndex(value: Record<string, unknown>): MarketIndexBundle {
  return {
    group_by: String(value.group_by || "unit"),
    group: String(value.group || "all"),
    range: String(value.range || "1y"),
    weighting: String(value.weighting || "equal"),
    summary: normalizeMarketIndexSummary((value.summary as Record<string, unknown> | null) || null),
    series: ((value.series || []) as Array<Record<string, unknown>>).map(normalizeMarketIndexPoint),
  };
}

export function normalizeMarketStatus(value: Record<string, unknown> | null): MarketStatus | null {
  if (!value) return null;
  return {
    trading_status: String(value.trading_status || "open") as MarketStatus["trading_status"],
    is_trading_open: Boolean(value.is_trading_open),
    active_phase: String(value.active_phase || "idle") as MarketStatus["active_phase"],
    trading_message: value.trading_message ? String(value.trading_message) : null,
    current_market_date: value.current_market_date ? String(value.current_market_date) : null,
    current_cycle_started_at: value.current_cycle_started_at ? String(value.current_cycle_started_at) : null,
    current_cycle_updated_at: value.current_cycle_updated_at ? String(value.current_cycle_updated_at) : null,
    last_settlement_market_date: value.last_settlement_market_date ? String(value.last_settlement_market_date) : null,
    last_settlement_completed_at: value.last_settlement_completed_at ? String(value.last_settlement_completed_at) : null,
    next_scheduled_settlement_at: value.next_scheduled_settlement_at ? String(value.next_scheduled_settlement_at) : null,
    last_cycle_error: value.last_cycle_error ? String(value.last_cycle_error) : null,
    updated_at: value.updated_at ? String(value.updated_at) : null,
  };
}

export function normalizeMarketHubTrade(value: Record<string, unknown>): MarketHubTrade {
  return {
    id: Number(value.id || 0),
    order_id: toNumber(value.order_id),
    user_id: Number(value.user_id || 0),
    username: value.username ? String(value.username) : null,
    profile_color: value.profile_color ? String(value.profile_color) : null,
    asset_id: Number(value.asset_id || 0),
    symbol: String(value.symbol || ""),
    display_name: String(value.display_name || ""),
    ts: String(value.ts || ""),
    side: String(value.side || ""),
    price: Number(toNumber(value.price) || 0),
    quantity: Number(toNumber(value.quantity) || 0),
    gross_cash: Number(toNumber(value.gross_cash) || 0),
    fee_cash: Number(toNumber(value.fee_cash) || 0),
    net_cash: Number(toNumber(value.net_cash) || 0),
    counterparty_type: value.counterparty_type ? String(value.counterparty_type) : null,
  };
}

function normalizeMarketHubVolumeLeader(value: Record<string, unknown>): MarketHubVolumeLeader {
  return {
    asset_id: Number(value.asset_id || 0),
    symbol: String(value.symbol || ""),
    display_name: String(value.display_name || ""),
    volume_shares: Number(toNumber(value.volume_shares) || 0),
    volume_cash: Number(toNumber(value.volume_cash) || 0),
    volume_change_pct: toNumber(value.volume_change_pct),
  };
}

function normalizeMarketActivityWindow(value: Record<string, unknown> | null): MarketActivityWindow {
  return {
    trade_count: Number(toNumber(value?.trade_count) || 0),
    trader_count: Number(toNumber(value?.trader_count) || 0),
    asset_count: Number(toNumber(value?.asset_count) || 0),
    volume_shares: Number(toNumber(value?.volume_shares) || 0),
    volume_cash: Number(toNumber(value?.volume_cash) || 0),
    latest_trade_at: value?.latest_trade_at ? String(value.latest_trade_at) : null,
  };
}

function normalizeMarketActivityTrader(value: Record<string, unknown>): MarketActivityTrader {
  return {
    user_id: Number(value.user_id || 0),
    username: String(value.username || ""),
    profile_color: value.profile_color ? String(value.profile_color) : null,
    trade_count: Number(toNumber(value.trade_count) || 0),
    distinct_assets: Number(toNumber(value.distinct_assets) || 0),
    volume_cash: Number(toNumber(value.volume_cash) || 0),
    volume_shares: Number(toNumber(value.volume_shares) || 0),
    latest_trade_at: value.latest_trade_at ? String(value.latest_trade_at) : null,
  };
}

function normalizeMarketActivity(value: Record<string, unknown> | null): MarketActivity {
  const windows = (value?.windows || null) as Record<string, unknown> | null;
  return {
    windows: {
      "5m": normalizeMarketActivityWindow((windows?.["5m"] as Record<string, unknown> | null) || null),
      "1h": normalizeMarketActivityWindow((windows?.["1h"] as Record<string, unknown> | null) || null),
      "24h": normalizeMarketActivityWindow((windows?.["24h"] as Record<string, unknown> | null) || null),
    },
    most_active_traders_24h: Array.isArray(value?.most_active_traders_24h)
      ? (value?.most_active_traders_24h as Array<Record<string, unknown>>).map(normalizeMarketActivityTrader)
      : [],
  };
}

export function normalizeMarketHubResponse(value: Record<string, unknown>): MarketHubResponse {
  const leaders = (value.leaders || null) as Record<string, unknown> | null;
  const recentTrades = (value.recent_trades || null) as Record<string, unknown> | null;

  return {
    generated_at: String(value.generated_at || ""),
    status: normalizeMarketStatus((value.status as Record<string, unknown> | null) || null),
    report: value.report ? value.report as DailyReport : null,
    indexes: Array.isArray(value.indexes)
      ? (value.indexes as Array<Record<string, unknown>>).map(normalizeMarketIndex)
      : [],
    activity: normalizeMarketActivity((value.activity as Record<string, unknown> | null) || null),
    leaders: {
      top_price: Array.isArray(leaders?.top_price) ? (leaders.top_price as Array<Record<string, unknown>>).map(normalizeAsset) : [],
      top_volume: Array.isArray(leaders?.top_volume) ? (leaders.top_volume as Array<Record<string, unknown>>).map(normalizeAsset) : [],
      top_movers: Array.isArray(leaders?.top_movers) ? (leaders.top_movers as Array<Record<string, unknown>>).map(normalizeAsset) : [],
      top_losers: Array.isArray(leaders?.top_losers) ? (leaders.top_losers as Array<Record<string, unknown>>).map(normalizeAsset) : [],
      top_premiums: Array.isArray(leaders?.top_premiums) ? (leaders.top_premiums as Array<Record<string, unknown>>).map(normalizeAsset) : [],
      top_discounts: Array.isArray(leaders?.top_discounts) ? (leaders.top_discounts as Array<Record<string, unknown>>).map(normalizeAsset) : [],
      volume_winners: Array.isArray(leaders?.volume_winners)
        ? (leaders.volume_winners as Array<Record<string, unknown>>).map(normalizeMarketHubVolumeLeader)
        : [],
      volume_losers: Array.isArray(leaders?.volume_losers)
        ? (leaders.volume_losers as Array<Record<string, unknown>>).map(normalizeMarketHubVolumeLeader)
        : [],
    },
    recent_trades: {
      items: Array.isArray(recentTrades?.items)
        ? (recentTrades.items as Array<Record<string, unknown>>).map(normalizeMarketHubTrade)
        : [],
      next_cursor: recentTrades?.next_cursor ? String(recentTrades.next_cursor) : null,
    },
  };
}

export function normalizeTrades(trades: Array<Record<string, unknown>>): TradeRow[] {
  return trades.map((item) => ({
    id: Number(item.id),
    ts: String(item.ts || ""),
    side: String(item.side || ""),
    price: Number(toNumber(item.price) || 0),
    quantity: Number(toNumber(item.quantity) || 0),
    gross_cash: Number(toNumber(item.gross_cash) || 0),
  }));
}

export function normalizeTreasury(treasury: Record<string, unknown> | null): AssetDetailBundle["treasury"] {
  if (!treasury) return null;
  return {
    max_supply: toNumber(treasury.max_supply),
    circulating_supply: toNumber(treasury.circulating_supply),
    treasury_supply: toNumber(treasury.treasury_supply),
    current_daily_emission: toNumber(treasury.current_daily_emission),
    current_premium_pct: toNumber(treasury.current_premium_pct),
  };
}

function normalizeAssetCommentAuthor(value: unknown): AssetCommentAuthor | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = toNumber(row.id);
  const username = String(row.username || "").trim();
  if (!id || !username) return null;
  return {
    id,
    username,
    profile_picture_url: row.profile_picture_url ? String(row.profile_picture_url) : null,
    profile_color: row.profile_color ? String(row.profile_color) : null,
  };
}

function normalizeAssetComments(value: unknown): AssetComment[] {
  if (!Array.isArray(value)) return [];
  const moodSet = new Set<string>(ARTICLE_COMMENT_MOODS);
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = toNumber(row.id);
      const body = String(row.body || "").trim();
      const mood = row.mood ? String(row.mood).trim() : null;
      const author = normalizeAssetCommentAuthor(row.author);
      if (!id || !body || !author) return null;
      return {
        id,
        body,
        mood: mood && moodSet.has(mood) ? mood : null,
        created_at: String(row.created_at || ""),
        updated_at: String(row.updated_at || ""),
        upvotes: Number(toNumber(row.upvotes) || 0),
        downvotes: Number(toNumber(row.downvotes) || 0),
        viewer_vote: (
          toNumber(row.viewer_vote) === 1
            ? 1
            : toNumber(row.viewer_vote) === -1
              ? -1
              : 0
        ) as AssetComment["viewer_vote"],
        author_share_quantity: Number(toNumber(row.author_share_quantity) || 0),
        author,
      };
    })
    .filter((item): item is AssetComment => item !== null);
}

export function normalizeAssetCommentListResponse(value: Record<string, unknown>): AssetCommentListResponse {
  const pagination = (value.pagination || null) as Record<string, unknown> | null;
  const viewerContext = (value.viewer_context || null) as Record<string, unknown> | null;
  return {
    symbol: String(value.symbol || ""),
    comments: normalizeAssetComments(value.comments),
    pagination: {
      total: Number(pagination?.total || 0),
      page: Number(pagination?.page || 1),
      limit: Number(pagination?.limit || 6),
      page_count: Number(pagination?.page_count || 1),
      has_previous_page: Boolean(pagination?.has_previous_page),
      has_next_page: Boolean(pagination?.has_next_page),
    },
    viewer_context: {
      is_authenticated: Boolean(viewerContext?.is_authenticated),
      owned_shares: Number(toNumber(viewerContext?.owned_shares) || 0),
      can_post: Boolean(viewerContext?.can_post),
    },
  };
}

export function normalizeAssetSuperchatSummary(value: Record<string, unknown>): AssetSuperchatSummaryBundle {
  return {
    symbol: String(value.symbol || ""),
    youtube_channel_id: String(value.youtube_channel_id || ""),
    range: String(value.range || "7d"),
    week_start: value.week_start ? String(value.week_start) : null,
    week_end: value.week_end ? String(value.week_end) : null,
    currencies: ((value.currencies || []) as Array<Record<string, unknown>>).map((item): SuperchatCurrencySummary => ({
      currency_name: String(item.currency_name || ""),
      donation_count: toNumber(item.donation_count),
      total_in_currency: toNumber(item.total_in_currency),
      total_in_yen: toNumber(item.total_in_yen),
    })),
  };
}

export function normalizeAssetSuperchatTimeseries(value: Record<string, unknown>): AssetSuperchatTimeseriesBundle {
  return {
    symbol: String(value.symbol || ""),
    youtube_channel_id: String(value.youtube_channel_id || ""),
    range: String(value.range || "7d"),
    bucket_unit: String(value.bucket_unit || "day") as AssetSuperchatTimeseriesBundle["bucket_unit"],
    start_date: value.start_date ? String(value.start_date) : null,
    end_date: value.end_date ? String(value.end_date) : null,
    points: ((value.points || []) as Array<Record<string, unknown>>).map((item) => ({
      bucket: String(item.bucket || ""),
      currency_name: String(item.currency_name || ""),
      total_in_yen: toNumber(item.total_in_yen),
    })),
  };
}

export function normalizeChannels(rows: Array<Record<string, unknown>>): ChannelOverviewRow[] {
  return rows.map((row) => {
    const channel = row.channel as Record<string, unknown>;
    const latest = (row.latest || null) as Record<string, unknown> | null;
    return {
      channel: {
        youtube_channel_id: String(channel.youtube_channel_id || ""),
        name: String(channel.name || channel.name_short || ""),
        name_short: channel.name_short ? String(channel.name_short) : undefined,
        symbol: channel.symbol ? String(channel.symbol) : null,
        unit: channel.unit ? String(channel.unit) : null,
        channel_asset_icon_url: channel.channel_asset_icon_url
          ? String(channel.channel_asset_icon_url)
          : channel.youtube_channel_icon_url
            ? String(channel.youtube_channel_icon_url)
            : null,
        channel_asset_banner_url: channel.channel_asset_banner_url
          ? String(channel.channel_asset_banner_url)
          : channel.youtube_channel_banner_url
            ? String(channel.youtube_channel_banner_url)
            : null,
        youtube_channel_description: channel.youtube_channel_description ? String(channel.youtube_channel_description) : null,
      },
      latest: latest
        ? {
            subscriber_count: toNumber(latest.subscriber_count),
            view_count: toNumber(latest.view_count),
            video_count: toNumber(latest.video_count),
            time: String(latest.time || ""),
          }
        : null,
    };
  });
}

export function normalizeChatChannel(value: Record<string, unknown>): ChatChannel {
  const metadata = (value.metadata || {}) as Record<string, unknown>;
  return {
    id: Number(value.id || 0),
    channel_key: String(value.channel_key || ""),
    scope_type: String(value.scope_type || "market") as ChatChannel["scope_type"],
    scope_key: String(value.scope_key || ""),
    display_name: String(value.display_name || ""),
    description: value.description ? String(value.description) : null,
    is_active: Boolean(value.is_active),
    posting_policy: String(value.posting_policy || "authenticated") as ChatChannel["posting_policy"],
    metadata: {
      asset_id: toNumber(metadata.asset_id) ?? undefined,
      symbol: metadata.symbol ? String(metadata.symbol) : null,
      display_name: metadata.display_name ? String(metadata.display_name) : null,
      asset_status: metadata.asset_status ? String(metadata.asset_status) : null,
      youtube_channel_id: metadata.youtube_channel_id ? String(metadata.youtube_channel_id) : null,
      channel_name: metadata.channel_name ? String(metadata.channel_name) : null,
      unit: metadata.unit ? String(metadata.unit) : null,
      icon: metadata.icon ? String(metadata.icon) : null,
      color: metadata.color ? String(metadata.color) : null,
      asset_count: toNumber(metadata.asset_count),
    },
    last_message_id: toNumber(value.last_message_id),
    last_message_at: value.last_message_at ? String(value.last_message_at) : null,
    last_message_preview: value.last_message_preview ? String(value.last_message_preview) : null,
    message_count: Number(value.message_count || 0),
    last_read_message_id: toNumber(value.last_read_message_id),
    unread_count: Number(value.unread_count || 0),
    muted_until: value.muted_until ? String(value.muted_until) : null,
    created_at: String(value.created_at || ""),
    updated_at: String(value.updated_at || ""),
  };
}

export function normalizeChatMessage(value: Record<string, unknown>): ChatMessage {
  const author = (value.author || null) as Record<string, unknown> | null;
  return {
    id: Number(value.id || 0),
    channel_id: Number(value.channel_id || 0),
    channel_key: String(value.channel_key || ""),
    body: String(value.body || ""),
    status: String(value.status || "active") as ChatMessage["status"],
    reply_to_message_id: toNumber(value.reply_to_message_id),
    created_at: String(value.created_at || ""),
    edited_at: value.edited_at ? String(value.edited_at) : null,
    moderated_at: value.moderated_at ? String(value.moderated_at) : null,
    author: author
      ? {
          id: Number(author.id || 0),
          username: String(author.username || ""),
          profile_picture_url: author.profile_picture_url ? String(author.profile_picture_url) : null,
          profile_color: author.profile_color ? String(author.profile_color) : null,
          oshi_coin:
            author.oshi_coin && typeof author.oshi_coin === "object"
              ? {
                  id: Number((author.oshi_coin as Record<string, unknown>).id || 0),
                  symbol: String((author.oshi_coin as Record<string, unknown>).symbol || ""),
                  display_name: String((author.oshi_coin as Record<string, unknown>).display_name || ""),
                  icon: (author.oshi_coin as Record<string, unknown>).icon ? String((author.oshi_coin as Record<string, unknown>).icon) : null,
                  color: (author.oshi_coin as Record<string, unknown>).color ? String((author.oshi_coin as Record<string, unknown>).color) : null,
                }
              : null,
        }
      : null,
    is_mine: Boolean(value.is_mine),
  };
}

export function normalizePortfolio(value: Record<string, unknown>): PortfolioSummary {
  return {
    cash_balance: Number(toNumber(value.cash_balance) || 0),
    total_market_value: Number(toNumber(value.total_market_value) || 0),
    total_unrealized_pnl: Number(toNumber(value.total_unrealized_pnl) || 0),
    total_equity: Number(toNumber(value.total_equity) || 0),
    holdings: ((value.holdings || []) as Array<Record<string, unknown>>).map((item) => ({
      asset_id: Number(item.asset_id),
      symbol: String(item.symbol || ""),
      display_name: String(item.display_name || ""),
      quantity: Number(toNumber(item.quantity) || 0),
      avg_cost_basis: Number(toNumber(item.avg_cost_basis) || 0),
      current_mid_price: toNumber(item.current_mid_price),
      market_value: Number(toNumber(item.market_value) || 0),
      unrealized_pnl: Number(toNumber(item.unrealized_pnl) || 0),
    })),
  };
}

function normalizeGamesConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function normalizeGameCatalogEntry(value: Record<string, unknown>): GameCatalogEntry {
  return {
    id: Number(value.id || 0),
    key: String(value.key || ""),
    name: String(value.name || ""),
    description: String(value.description || ""),
    game_type: String(value.game_type || "single_player") as GameCatalogEntry["game_type"],
    status: String(value.status || "draft") as GameCatalogEntry["status"],
    entry_fee_cash: Number(toNumber(value.entry_fee_cash) || 0),
    min_stake_cash: toNumber(value.min_stake_cash),
    max_stake_cash: toNumber(value.max_stake_cash),
    sort_order: Number(value.sort_order || 0),
    icon_key: value.icon_key ? String(value.icon_key) : null,
    banner_key: value.banner_key ? String(value.banner_key) : null,
    config: normalizeGamesConfig(value.config),
  };
}

export function normalizeGameCatalogResponse(value: Record<string, unknown>): GameCatalogResponse {
  return {
    games: Array.isArray(value.games)
      ? (value.games as Array<Record<string, unknown>>).map(normalizeGameCatalogEntry)
      : [],
  };
}

export function normalizeGameCosmetic(value: Record<string, unknown>): GameCosmetic {
  return {
    id: Number(value.id || 0),
    user_id: Number(value.user_id || 0),
    cosmetic_key: String(value.cosmetic_key || ""),
    cosmetic_type: String(value.cosmetic_type || ""),
    rarity: String(value.rarity || "common"),
    source_type: String(value.source_type || ""),
    source_reference_id: value.source_reference_id === null ? null : Number(toNumber(value.source_reference_id) || 0),
    metadata: normalizeGamesConfig(value.metadata),
    granted_at: String(value.granted_at || ""),
  };
}

export function normalizeGameEquippedCosmetic(value: Record<string, unknown>): GameEquippedCosmetic {
  return {
    slot_key: String(value.slot_key || ""),
    cosmetic: normalizeGameCosmetic(((value.cosmetic || {}) as Record<string, unknown>)),
    updated_at: String(value.updated_at || ""),
  };
}

function normalizeGameSessionSummary(value: Record<string, unknown>): GameSessionSummary {
  return {
    id: Number(value.id || 0),
    game_id: Number(value.game_id || 0),
    game_key: String(value.game_key || ""),
    game_name: String(value.game_name || ""),
    game_type: String(value.game_type || "single_player") as GameSessionSummary["game_type"],
    status: String(value.status || ""),
    entry_fee_cash: Number(toNumber(value.entry_fee_cash) || 0),
    payout_cash: Number(toNumber(value.payout_cash) || 0),
    score: toNumber(value.score),
    started_at: String(value.started_at || ""),
    completed_at: value.completed_at ? String(value.completed_at) : null,
    created_at: String(value.created_at || ""),
  };
}

export function normalizeGamesSummary(value: Record<string, unknown>): GamesSummary {
  const inventory = (value.inventory || {}) as Record<string, unknown>;
  const countsByType = inventory.counts_by_type && typeof inventory.counts_by_type === "object"
    ? Object.fromEntries(
        Object.entries(inventory.counts_by_type as Record<string, unknown>).map(([key, itemValue]) => [
          key,
          Number(toNumber(itemValue) || 0),
        ])
      )
    : {};

  return {
    user_id: Number(value.user_id || 0),
    cash_balance: Number(toNumber(value.cash_balance) || 0),
    inventory: {
      total_cosmetics: Number(toNumber(inventory.total_cosmetics) || 0),
      counts_by_type: countsByType,
      equipped: Array.isArray(inventory.equipped)
        ? (inventory.equipped as Array<Record<string, unknown>>).map(normalizeGameEquippedCosmetic)
        : [],
    },
    recent_sessions: Array.isArray(value.recent_sessions)
      ? (value.recent_sessions as Array<Record<string, unknown>>).map(normalizeGameSessionSummary)
      : [],
  };
}

export function normalizeGameInventoryResponse(value: Record<string, unknown>): GameInventoryResponse {
  const summary = (value.summary || {}) as Record<string, unknown>;
  const countsByType = summary.counts_by_type && typeof summary.counts_by_type === "object"
    ? Object.fromEntries(
        Object.entries(summary.counts_by_type as Record<string, unknown>).map(([key, itemValue]) => [
          key,
          Number(toNumber(itemValue) || 0),
        ])
      )
    : {};

  return {
    user_id: Number(value.user_id || 0),
    cosmetics: Array.isArray(value.cosmetics)
      ? (value.cosmetics as Array<Record<string, unknown>>).map(normalizeGameCosmetic)
      : [],
    equipped: Array.isArray(value.equipped)
      ? (value.equipped as Array<Record<string, unknown>>).map(normalizeGameEquippedCosmetic)
      : [],
    summary: {
      total_cosmetics: Number(toNumber(summary.total_cosmetics) || 0),
      counts_by_type: countsByType,
    },
  };
}

export function normalizeGachaPullResult(value: Record<string, unknown>): GachaPullResult {
  const session = (value.session || {}) as Record<string, unknown>;
  const wallet = (value.wallet || {}) as Record<string, unknown>;
  const pull = (value.pull || {}) as Record<string, unknown>;
  const reward = (pull.reward || {}) as Record<string, unknown>;

  return {
    game: normalizeGameCatalogEntry(((value.game || {}) as Record<string, unknown>)),
    session: {
      id: Number(session.id || 0),
      entry_fee_cash: Number(toNumber(session.entry_fee_cash) || 0),
      payout_cash: Number(toNumber(session.payout_cash) || 0),
      created_at: String(session.created_at || ""),
    },
    wallet: {
      debited_cash: Number(toNumber(wallet.debited_cash) || 0),
      duplicate_compensation_cash: Number(toNumber(wallet.duplicate_compensation_cash) || 0),
      cash_balance_after: Number(toNumber(wallet.cash_balance_after) || 0),
    },
    pull: {
      id: Number(pull.id || 0),
      created_at: String(pull.created_at || ""),
      reward: {
        key: String(reward.key || ""),
        type: String(reward.type || ""),
        rarity: String(reward.rarity || "common"),
        display_name: String(reward.display_name || ""),
        slot_key: reward.slot_key ? String(reward.slot_key) : null,
        metadata: normalizeGamesConfig(reward.metadata),
      },
      duplicate: Boolean(pull.duplicate),
      granted_cosmetic:
        pull.granted_cosmetic && typeof pull.granted_cosmetic === "object"
          ? normalizeGameCosmetic(pull.granted_cosmetic as Record<string, unknown>)
          : null,
    },
  };
}

function normalizeTickerTapSessionConfig(value: Record<string, unknown>): TickerTapSessionConfig {
  return {
    run_duration_seconds: Number(toNumber(value.run_duration_seconds) || 0),
    lane_count: Number(toNumber(value.lane_count) || 0),
    target_lifetime_ms: Number(toNumber(value.target_lifetime_ms) || 0),
    spawn_interval_ms: Number(toNumber(value.spawn_interval_ms) || 0),
    max_targets: Number(toNumber(value.max_targets) || 0),
    leaderboard_window_days: toNumber(value.leaderboard_window_days) ?? undefined,
    leaderboard_limit: toNumber(value.leaderboard_limit) ?? undefined,
    seed_hint: String(value.seed_hint || ""),
    timeline: Array.isArray(value.timeline)
      ? value.timeline
        .map((target) => {
          const row = target && typeof target === "object" ? target as Record<string, unknown> : null;
          if (!row) return null;
          return {
            index: Number(row.index || 0),
            lane: Number(row.lane || 0),
            start_ms: Number(toNumber(row.start_ms) || 0),
          };
        })
        .filter((target): target is TickerTapSessionConfig["timeline"][number] => target !== null)
      : [],
  };
}

function normalizeTickerTapSessionResult(value: Record<string, unknown>): TickerTapSessionResult {
  const submission = value.submission && typeof value.submission === "object"
    ? value.submission as Record<string, unknown>
    : {};

  return {
    type: String(value.type || ""),
    phase: String(value.phase || ""),
    config: normalizeTickerTapSessionConfig(((value.config || {}) as Record<string, unknown>)),
    submission: {
      hits: Number(toNumber(submission.hits) || 0),
      misses: Number(toNumber(submission.misses) || 0),
      max_streak: Number(toNumber(submission.max_streak) || 0),
      duration_ms: Number(toNumber(submission.duration_ms) || 0),
      taps: Number(toNumber(submission.taps) || 0),
      accuracy: Number(toNumber(submission.accuracy) || 0),
    },
    score: Number(toNumber(value.score) || 0),
  };
}

export function normalizeTickerTapSessionCreateResponse(value: Record<string, unknown>): TickerTapSessionCreateResponse {
  const session = (value.session || {}) as Record<string, unknown>;
  const wallet = (value.wallet || {}) as Record<string, unknown>;

  return {
    game: normalizeGameCatalogEntry(((value.game || {}) as Record<string, unknown>)),
    session: {
      id: Number(session.id || 0),
      status: String(session.status || ""),
      entry_fee_cash: Number(toNumber(session.entry_fee_cash) || 0),
      started_at: String(session.started_at || ""),
      config: normalizeTickerTapSessionConfig(((session.config || {}) as Record<string, unknown>)),
    },
    wallet: {
      cash_balance_after: Number(toNumber(wallet.cash_balance_after) || 0),
    },
  };
}

export function normalizeTickerTapSessionResponse(value: Record<string, unknown>): TickerTapSessionResponse {
  const session = (value.session || {}) as Record<string, unknown>;
  const result = session.result && typeof session.result === "object"
    ? session.result as Record<string, unknown>
    : {};

  return {
    session: {
      id: Number(session.id || 0),
      status: String(session.status || ""),
      score: toNumber(session.score),
      entry_fee_cash: Number(toNumber(session.entry_fee_cash) || 0),
      payout_cash: Number(toNumber(session.payout_cash) || 0),
      started_at: String(session.started_at || ""),
      completed_at: session.completed_at ? String(session.completed_at) : null,
      result: Object.keys(result).length ? normalizeTickerTapSessionResult(result) : {},
    },
  };
}

export function normalizeTickerTapSubmitResponse(value: Record<string, unknown>): TickerTapSubmitResponse {
  const session = (value.session || {}) as Record<string, unknown>;
  return {
    session: {
      id: Number(session.id || 0),
      status: String(session.status || ""),
      score: Number(toNumber(session.score) || 0),
      payout_cash: Number(toNumber(session.payout_cash) || 0),
      completed_at: String(session.completed_at || ""),
    },
    result: normalizeTickerTapSessionResult(((value.result || {}) as Record<string, unknown>)),
  };
}

export function normalizeTickerTapLeaderboardResponse(value: Record<string, unknown>): TickerTapLeaderboardResponse {
  return {
    game:
      value.game && typeof value.game === "object"
        ? normalizeGameCatalogEntry(value.game as Record<string, unknown>)
        : null,
    leaderboard: Array.isArray(value.leaderboard)
      ? value.leaderboard
        .map((entry) => {
          const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
          const stats = row?.stats && typeof row.stats === "object" ? row.stats as Record<string, unknown> : null;
          if (!row) return null;
          const normalized: TickerTapLeaderboardEntry = {
            rank: Number(row.rank || 0),
            session_id: Number(row.session_id || 0),
            user_id: Number(row.user_id || 0),
            username: String(row.username || ""),
            profile_color: row.profile_color ? String(row.profile_color) : null,
            score: Number(toNumber(row.score) || 0),
            completed_at: String(row.completed_at || ""),
            stats: {
              hits: Number(toNumber(stats?.hits) || 0),
              misses: Number(toNumber(stats?.misses) || 0),
              max_streak: Number(toNumber(stats?.max_streak) || 0),
              duration_ms: Number(toNumber(stats?.duration_ms) || 0),
            },
          };
          return normalized;
        })
        .filter((entry): entry is TickerTapLeaderboardEntry => entry !== null)
      : [],
  };
}

export function normalizeLivestreams(rows: Array<Record<string, unknown>>): LivestreamItem[] {
  return rows.map((row, index) => ({
    id: String(row.id || row.video_id || row.stream_id || index),
    title: String(row.title || row.name || "Untitled livestream"),
    creator: String(row.creator || row.channel || row.channel_name || "Unknown creator"),
    viewer_count: toNumber(row.viewer_count || row.concurrent_viewers),
    started_at: row.started_at ? String(row.started_at) : row.actual_start_time ? String(row.actual_start_time) : row.scheduled_start_time ? String(row.scheduled_start_time) : null,
    status: String(row.status || "live"),
    creator_icon: row.creator_icon ? String(row.creator_icon) : row.channel_icon ? String(row.channel_icon) : null,
    channel_color: row.channel_color ? String(row.channel_color) : null,
    thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
    url: row.url ? String(row.url) : row.video_id ? `https://www.youtube.com/watch?v=${encodeURIComponent(String(row.video_id))}` : null,
  }));
}

export function normalizeLeaderboard(rows: Array<Record<string, unknown>>): LeaderboardEntry[] {
  return rows.map((row, index) => ({
    user_id: Number(row.user_id || row.id || 0),
    id: String(row.user_id || row.id || row.username || index),
    username: String(row.username || row.label || "user"),
    profile_picture_url: row.profile_picture_url ? String(row.profile_picture_url) : null,
    profile_color: row.profile_color ? String(row.profile_color) : null,
    rank: Number(row.rank || index + 1),
    label: String(row.label || row.username || "Entry"),
    value: Number(toNumber(row.total_equity || row.value || row.score) || 0),
    total_equity: Number(toNumber(row.total_equity || row.value || row.score) || 0),
    cash_balance: Number(toNumber(row.cash_balance) || 0),
    holdings_market_value: Number(toNumber(row.holdings_market_value || row.total_market_value) || 0),
    total_unrealized_pnl: Number(toNumber(row.total_unrealized_pnl) || 0),
    change_abs: toNumber(row.change_abs),
    change_pct: toNumber(row.change_pct),
    daily_change_abs: toNumber(row.daily_change_abs),
    daily_change_pct: toNumber(row.daily_change_pct),
    weekly_change_abs: toNumber(row.weekly_change_abs),
    weekly_change_pct: toNumber(row.weekly_change_pct),
    largest_position:
      row.largest_position && typeof row.largest_position === "object"
        ? {
            asset_id: toNumber((row.largest_position as Record<string, unknown>).asset_id),
            symbol: String((row.largest_position as Record<string, unknown>).symbol || ""),
            value: Number(toNumber((row.largest_position as Record<string, unknown>).value) || 0),
            quantity: toNumber((row.largest_position as Record<string, unknown>).quantity),
          }
        : null,
    best_asset:
      row.best_asset && typeof row.best_asset === "object"
        ? {
            asset_id: toNumber((row.best_asset as Record<string, unknown>).asset_id),
            symbol: String((row.best_asset as Record<string, unknown>).symbol || ""),
            unrealized_pnl: Number(toNumber((row.best_asset as Record<string, unknown>).unrealized_pnl) || 0),
            quantity: toNumber((row.best_asset as Record<string, unknown>).quantity),
          }
        : null,
    achievements: normalizeAchievementBadges(row.achievements),
    streaks: normalizeTradeStreak(row.streaks),
    badges: Array.isArray(row.badges) ? row.badges.map((badge) => String(badge)) : [],
    is_me: Boolean(row.is_me),
    is_friend: Boolean(row.is_friend),
    is_rival: Boolean(row.is_rival),
  }));
}

function normalizeLeaderboardNeighbor(value: Record<string, unknown>): LeaderboardNeighbor {
  return {
    user_id: Number(value.user_id || 0),
    username: String(value.username || ""),
    rank: Number(value.rank || 0),
    total_equity: Number(toNumber(value.total_equity) || 0),
    gap_abs: toNumber(value.gap_abs),
    profile_picture_url: value.profile_picture_url ? String(value.profile_picture_url) : null,
    profile_color: value.profile_color ? String(value.profile_color) : null,
  };
}

function normalizeLeaderboardMe(value: Record<string, unknown> | null): LeaderboardMe | null {
  if (!value) return null;
  const [entry] = normalizeLeaderboard([value]);
  return {
    ...entry,
    percentile: Number(toNumber(value.percentile) || 0),
    neighbors: Array.isArray(value.neighbors)
      ? (value.neighbors as Array<Record<string, unknown>>).map(normalizeLeaderboardNeighbor)
      : [],
  };
}

function normalizeLeaderboardStats(value: Record<string, unknown> | null): LeaderboardStats {
  return {
    user_count: Number(value?.user_count || 0),
    cutoff_equity_top_10: toNumber(value?.cutoff_equity_top_10),
    cutoff_equity_top_100: toNumber(value?.cutoff_equity_top_100),
    last_updated_at: value?.last_updated_at ? String(value.last_updated_at) : null,
  };
}

export function normalizeLeaderboardResponse(value: Record<string, unknown>): LeaderboardResponse {
  return {
    scope: String(value.scope || "global") as LeaderboardResponse["scope"],
    window: String(value.window || "1d") as LeaderboardResponse["window"],
    pagination: {
      total: Number((value.pagination as Record<string, unknown> | undefined)?.total || 0),
      page: Number((value.pagination as Record<string, unknown> | undefined)?.page || 1),
      limit: Number((value.pagination as Record<string, unknown> | undefined)?.limit || 25),
      page_count: Number((value.pagination as Record<string, unknown> | undefined)?.page_count || 1),
      has_previous_page: Boolean((value.pagination as Record<string, unknown> | undefined)?.has_previous_page),
      has_next_page: Boolean((value.pagination as Record<string, unknown> | undefined)?.has_next_page),
    },
    stats: normalizeLeaderboardStats((value.stats as Record<string, unknown> | null) || null),
    entries: normalizeLeaderboard(((value.entries || []) as Array<Record<string, unknown>>)),
    me: normalizeLeaderboardMe((value.me as Record<string, unknown> | null) || null),
  };
}

function normalizeNewsCharacters(value: unknown): NewsCharacter[] {
  if (!Array.isArray(value)) return [];

  const rows: Array<NewsCharacter | null> = value.map((item) => {
      if (typeof item === "string") {
        const name = item.trim();
        return name ? { name, icon: null } : null;
      }

      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const name = String(row.name || "").trim();
        if (!name) return null;
        return {
          name,
          icon: row.icon ? String(row.icon) : null,
          youtube_channel_id: row.youtube_channel_id ? String(row.youtube_channel_id) : undefined,
          symbol: row.symbol ? String(row.symbol) : null,
          unit: row.unit ? String(row.unit) : null,
        };
      }

      return null;
    });

  return rows.filter((item): item is NewsCharacter => item !== null);
}

export function normalizeNews(rows: Array<Record<string, unknown>>): NewsItem[] {
  return rows.map((row, index) => {
    const characters = normalizeNewsCharacters(row.characters);
    const relatedNames = Array.isArray(row.related_names)
      ? row.related_names.map((item) => String(item))
      : characters.map((item) => item.name);

    return {
      id: String(row.id || row.url || index),
      headline: String(row.headline || row.title || "Untitled story"),
      source: String(row.source || row.publisher || "Unknown source"),
      published_at: row.published_at ? String(row.published_at) : null,
      thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
      url: row.url ? String(row.url) : null,
      summary: row.summary ? String(row.summary) : null,
      characters,
      related_names: relatedNames,
      channel_ids: Array.isArray(row.channel_ids) ? row.channel_ids.map((item) => String(item)) : characters.map((item) => item.youtube_channel_id || "").filter(Boolean),
      stock_symbols: Array.isArray(row.stock_symbols) ? row.stock_symbols.map((item) => String(item)) : characters.map((item) => item.symbol || "").filter(Boolean),
      units: Array.isArray(row.units) ? row.units.map((item) => String(item)) : characters.map((item) => item.unit || "").filter(Boolean),
      article_id: toNumber(row.article_id),
      article_slug: row.article_slug ? String(row.article_slug) : null,
      is_news: Boolean(row.is_news ?? true),
      like_count: toNumber(row.like_count ?? row.likes ?? row.likeCount),
      save_count: toNumber(row.save_count ?? row.saves ?? row.saveCount),
      comment_count: toNumber(row.comment_count ?? row.comments ?? row.commentCount),
    };
  });
}

export function normalizeHoloNewsFeed(value: Record<string, unknown>): NewsItem[] {
  const updatedAt = value.updated_at ? String(value.updated_at) : null;
  const items = Array.isArray(value.items) ? (value.items as Array<Record<string, unknown>>) : [];

  return items.map((item, index) => {
    const characters = normalizeNewsCharacters(item.characters);

    return {
      id: String(item.headline || index),
      headline: String(item.headline || "Untitled story"),
      source: "HoloNews",
      published_at: updatedAt,
      thumbnail_url: item.thumbnail_url ? String(item.thumbnail_url) : null,
      summary: item.summary ? String(item.summary) : null,
      url: null,
      article_slug: item.article_slug ? String(item.article_slug) : null,
      characters,
      related_names: characters.map((character) => character.name),
      is_news: true,
      like_count: toNumber(item.like_count ?? item.likes ?? item.likeCount),
      comment_count: toNumber(item.comment_count ?? item.comments ?? item.commentCount),
    };
  });
}

export function normalizeNewsFeedResponse(value: Record<string, unknown>): NewsFeedResponse {
  const pagination = (value.pagination || null) as Record<string, unknown> | null;

  return {
    items: normalizeNews(Array.isArray(value.items) ? (value.items as Array<Record<string, unknown>>) : []),
    pagination: {
      total: Number(pagination?.total || 0),
      page: Number(pagination?.page || 1),
      limit: Number(pagination?.limit || 20),
      page_count: Number(pagination?.page_count || 1),
      has_previous_page: Boolean(pagination?.has_previous_page),
      has_next_page: Boolean(pagination?.has_next_page),
    },
  };
}

function normalizeArticleAuthor(value: unknown): ArticleAuthor | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = toNumber(row.id);
  const username = String(row.username || "").trim();
  if (!id || !username) return null;
  return {
    id,
    username,
  };
}

function normalizeArticleAssets(value: unknown): ArticleAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = toNumber(row.id);
      const symbol = String(row.symbol || "").trim();
      const displayName = String(row.display_name || "").trim();
      if (!id || !symbol || !displayName) return null;
      return {
        id,
        symbol,
        display_name: displayName,
        icon: row.icon ? String(row.icon) : null,
        color: row.color ? String(row.color) : null,
      };
    })
    .filter((item): item is ArticleAsset => item !== null);
}

export function normalizeArticleSummary(value: Record<string, unknown>): ArticleSummary {
  const newsItem = value.news_item && typeof value.news_item === "object"
    ? value.news_item as Record<string, unknown>
    : null;

  return {
    id: Number(value.id || 0),
    slug: String(value.slug || ""),
    title: String(value.title || "Untitled article"),
    subtitle: value.subtitle ? String(value.subtitle) : null,
    tags: Array.isArray(value.tags) ? value.tags.map((item) => String(item)) : [],
    thumbnail_url: value.thumbnail_url ? String(value.thumbnail_url) : null,
    preview: value.preview ? String(value.preview) : null,
    author: normalizeArticleAuthor(value.author),
    likes: Number(toNumber(value.likes) || 0),
    saves: Number(toNumber(value.saves) || 0),
    views: Number(toNumber(value.views) || 0),
    is_news: Boolean(value.is_news),
    status: String(value.status || "published"),
    published_at: value.published_at ? String(value.published_at) : null,
    created_at: String(value.created_at || ""),
    updated_at: String(value.updated_at || ""),
    comment_count: Number(toNumber(value.comment_count) || 0),
    related_assets: normalizeArticleAssets(value.related_assets),
    viewer_has_liked: Boolean(value.viewer_has_liked),
    viewer_has_saved: Boolean(value.viewer_has_saved),
    news_item: newsItem
      ? {
          id: Number(newsItem.id || 0),
          headline: String(newsItem.headline || ""),
          published_at: newsItem.published_at ? String(newsItem.published_at) : null,
        }
      : null,
  };
}

function normalizeArticleComments(value: unknown): ArticleComment[] {
  if (!Array.isArray(value)) return [];
  const moodSet = new Set<string>(ARTICLE_COMMENT_MOODS);
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = toNumber(row.id);
      const body = String(row.body || "").trim();
      const mood = row.mood ? String(row.mood).trim() : null;
      const author = normalizeArticleAuthor(row.author);
      if (!id || !body || !author) return null;
      return {
        id,
        body,
        mood: mood && moodSet.has(mood) ? mood : null,
        created_at: String(row.created_at || ""),
        updated_at: String(row.updated_at || ""),
        author,
      };
    })
    .filter((item): item is ArticleComment => item !== null);
}

function normalizeArticleProposals(value: unknown): ArticleProposal[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = toNumber(row.id);
      const author = normalizeArticleAuthor(row.author);
      if (!id || !author) return null;
      return {
        id,
        title: row.title ? String(row.title) : null,
        subtitle: row.subtitle ? String(row.subtitle) : null,
        tags: Array.isArray(row.tags) ? row.tags.map((entry) => String(entry)) : [],
        thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
        content: String(row.content || ""),
        status: String(row.status || "pending") as ArticleProposal["status"],
        created_at: String(row.created_at || ""),
        updated_at: String(row.updated_at || ""),
        reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
        author,
        reviewer: normalizeArticleAuthor(row.reviewer),
        upvotes: Number(toNumber(row.upvotes) || 0),
        downvotes: Number(toNumber(row.downvotes) || 0),
        viewer_vote: (
          toNumber(row.viewer_vote) === 1
            ? 1
            : toNumber(row.viewer_vote) === -1
              ? -1
              : 0
        ) as ArticleProposal["viewer_vote"],
      };
    })
    .filter((item): item is ArticleProposal => item !== null);
}

export function normalizeArticleDetail(value: Record<string, unknown>): ArticleDetail {
  return {
    ...normalizeArticleSummary(value),
    content: String(value.content || ""),
    comments: normalizeArticleComments(value.comments),
    proposals: normalizeArticleProposals(value.proposals),
  };
}

export function normalizeArticleListResponse(value: Record<string, unknown>): ArticleListResponse {
  const pagination = (value.pagination || null) as Record<string, unknown> | null;
  return {
    items: Array.isArray(value.items) ? (value.items as Array<Record<string, unknown>>).map(normalizeArticleSummary) : [],
    pagination: {
      total: Number(pagination?.total || 0),
      page: Number(pagination?.page || 1),
      limit: Number(pagination?.limit || 20),
      page_count: Number(pagination?.page_count || 1),
      has_previous_page: Boolean(pagination?.has_previous_page),
      has_next_page: Boolean(pagination?.has_next_page),
    },
  };
}

function normalizeProfileRelationUsers(value: unknown): ProfileRelationUser[] {
  if (!Array.isArray(value)) return [];
  const rows: ProfileRelationUser[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = toNumber(row.id);
    const username = String(row.username || "").trim();
    if (!id || !username) continue;
    rows.push({
      id,
      username,
      profile_picture_url: row.profile_picture_url ? String(row.profile_picture_url) : null,
      profile_color: row.profile_color ? String(row.profile_color) : null,
      created_at: row.created_at ? String(row.created_at) : undefined,
    });
  }
  return rows;
}

function normalizeProfileNetworth(value: unknown): ProfileNetworthPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const recordedAt = String(row.recorded_at || "").trim();
      if (!recordedAt) return null;
      return {
        recorded_at: recordedAt,
        cash_balance: Number(toNumber(row.cash_balance) || 0),
        total_market_value: Number(toNumber(row.total_market_value) || 0),
        total_equity: Number(toNumber(row.total_equity) || 0),
      };
    })
    .filter((item): item is ProfileNetworthPoint => item !== null);
}

function normalizeProfileTrades(value: unknown): ProfileTrade[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = toNumber(row.id);
      const ts = String(row.ts || "").trim();
      const symbol = String(row.symbol || "").trim();
      if (!id || !ts || !symbol) return null;
      return {
        id,
        ts,
        side: String(row.side || ""),
        price: Number(toNumber(row.price) || 0),
        quantity: Number(toNumber(row.quantity) || 0),
        gross_cash: Number(toNumber(row.gross_cash) || 0),
        fee_cash: Number(toNumber(row.fee_cash) || 0),
        net_cash: Number(toNumber(row.net_cash) || 0),
        symbol,
        display_name: String(row.display_name || symbol),
      };
    })
    .filter((item): item is ProfileTrade => item !== null);
}

function normalizeAchievementBadges(value: unknown): ProfileBundle["profile"]["achievements"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const key = String(row.key || "").trim();
      const name = String(row.name || key).trim();
      if (!key || !name) return null;
      return {
        key,
        name,
        description: row.description ? String(row.description) : null,
        badge_icon: row.badge_icon ? String(row.badge_icon) : null,
        badge_color: row.badge_color ? String(row.badge_color) : null,
        earned_at: row.earned_at ? String(row.earned_at) : null,
        reward_cash: Number(toNumber(row.reward_cash) || 0),
      };
    })
    .filter((item): item is ProfileBundle["profile"]["achievements"][number] => item !== null);
}

function normalizeTradeStreak(value: unknown): ProfileBundle["profile"]["streaks"] {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
  return {
    current_streak_days: Number(toNumber(row?.current_streak_days) || 0),
    longest_streak_days: Number(toNumber(row?.longest_streak_days) || 0),
    last_trade_day: row?.last_trade_day ? String(row.last_trade_day) : null,
    streak_started_day: row?.streak_started_day ? String(row.streak_started_day) : null,
    longest_streak_started_day: row?.longest_streak_started_day ? String(row.longest_streak_started_day) : null,
    longest_streak_ended_day: row?.longest_streak_ended_day ? String(row.longest_streak_ended_day) : null,
  };
}

export function normalizeProfileBundle(value: Record<string, unknown>): ProfileBundle {
  const profile = (value.profile || null) as Record<string, unknown> | null;
  const stats = (profile?.stats || null) as Record<string, unknown> | null;
  const viewer = (value.viewer_context || null) as Record<string, unknown> | null;
  const articles = (value.articles || null) as Record<string, unknown> | null;
  const trades = (value.trades || null) as Record<string, unknown> | null;
  const tradesPagination = (trades?.pagination || null) as Record<string, unknown> | null;
  const oshiCoin = profile?.oshi_coin && typeof profile.oshi_coin === "object"
    ? profile.oshi_coin as Record<string, unknown>
    : null;
  const pending = profile?.pending_friend_requests && typeof profile.pending_friend_requests === "object"
    ? profile.pending_friend_requests as Record<string, unknown>
    : null;

  return {
    profile: {
      id: Number(profile?.id || 0),
      username: String(profile?.username || ""),
      email_verified: Boolean(profile?.email_verified),
      created_at: String(profile?.created_at || ""),
      bio: profile?.bio ? String(profile.bio) : null,
      profile_picture_url: profile?.profile_picture_url ? String(profile.profile_picture_url) : null,
      profile_color: profile?.profile_color ? String(profile.profile_color) : null,
      permissions: {
        can_create_prediction_markets: Boolean(profile?.permissions && typeof profile.permissions === "object" && (profile.permissions as Record<string, unknown>).can_create_prediction_markets),
        can_approve_prediction_markets: Boolean(profile?.permissions && typeof profile.permissions === "object" && (profile.permissions as Record<string, unknown>).can_approve_prediction_markets),
        can_resolve_prediction_markets: Boolean(profile?.permissions && typeof profile.permissions === "object" && (profile.permissions as Record<string, unknown>).can_resolve_prediction_markets),
        can_void_prediction_markets: Boolean(profile?.permissions && typeof profile.permissions === "object" && (profile.permissions as Record<string, unknown>).can_void_prediction_markets),
      },
      rank: Number(toNumber(profile?.rank) || 0),
      oshi_coin: oshiCoin
        ? {
            id: Number(oshiCoin.id || 0),
            symbol: String(oshiCoin.symbol || ""),
            display_name: String(oshiCoin.display_name || ""),
            icon: oshiCoin.icon ? String(oshiCoin.icon) : null,
            color: oshiCoin.color ? String(oshiCoin.color) : null,
          }
        : null,
      stats: {
        cash_balance: Number(toNumber(stats?.cash_balance) || 0),
        total_market_value: Number(toNumber(stats?.total_market_value) || 0),
        total_unrealized_pnl: Number(toNumber(stats?.total_unrealized_pnl) || 0),
        total_equity: Number(toNumber(stats?.total_equity) || 0),
        article_count: Number(toNumber(stats?.article_count) || 0),
        trade_count: Number(toNumber(stats?.trade_count) || 0),
        friend_count: Number(toNumber(stats?.friend_count) || 0),
        rival_count: Number(toNumber(stats?.rival_count) || 0),
      },
      achievements: normalizeAchievementBadges(profile?.achievements),
      streaks: normalizeTradeStreak(profile?.streaks),
      networth_history: normalizeProfileNetworth(profile?.networth_history),
      friends: normalizeProfileRelationUsers(profile?.friends),
      rivals: normalizeProfileRelationUsers(profile?.rivals),
      pending_friend_requests: pending
        ? {
            incoming: normalizeProfileRelationUsers(pending.incoming),
            outgoing: normalizeProfileRelationUsers(pending.outgoing),
          }
        : null,
      holdings: Array.isArray(profile?.holdings)
        ? normalizePortfolio({
            cash_balance: 0,
            total_market_value: 0,
            total_unrealized_pnl: 0,
            total_equity: 0,
            holdings: profile.holdings,
          }).holdings
        : [],
    },
    viewer_context: {
      is_authenticated: Boolean(viewer?.is_authenticated),
      is_self: Boolean(viewer?.is_self),
      friendship_status: String(viewer?.friendship_status || "none") as ProfileBundle["viewer_context"]["friendship_status"],
      can_send_friend_request: Boolean(viewer?.can_send_friend_request),
      is_rival: Boolean(viewer?.is_rival),
      is_rivaled_by_profile: Boolean(viewer?.is_rivaled_by_profile),
    },
    articles: normalizeArticleListResponse(articles || {}),
    trades: {
      items: normalizeProfileTrades(trades?.items),
      pagination: {
        total: Number(tradesPagination?.total || 0),
        page: Number(tradesPagination?.page || 1),
        limit: Number(tradesPagination?.limit || 10),
        page_count: Number(tradesPagination?.page_count || 1),
        has_previous_page: Boolean(tradesPagination?.has_previous_page),
        has_next_page: Boolean(tradesPagination?.has_next_page),
      },
    },
  };
}

export function computeHeatmapMarketCap(asset: MarketAsset) {
  const price = asset.current_mid_price ?? 0;
  const volume = asset.volume_24h ?? 0;
  return price * Math.max(volume, 1);
}

export function getIconUrl(iconName: string | null | undefined) {
  if (!iconName) return null;
  return `https://images.nasfaq.biz/icons/${iconName}.svg`;
}
