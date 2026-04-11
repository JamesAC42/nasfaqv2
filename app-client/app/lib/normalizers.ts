import {
  ARTICLE_COMMENT_MOODS,
  type ArticleAsset,
  type ArticleAuthor,
  type ArticleComment,
  type ArticleDetail,
  type ArticleListResponse,
  type ArticleProposal,
  type ArticleSummary,
  type AssetDetailBundle,
  type AssetSuperchatSummaryBundle,
  type ChatChannel,
  type ChatMessage,
  type AssetSuperchatTimeseriesBundle,
  type CandlePoint,
  type ChannelOverviewRow,
  type LeaderboardEntry,
  type LivestreamItem,
  type MarketAsset,
  type MarketIndexBundle,
  type MarketIndexPoint,
  type MarketIndexSummary,
  type MarketStatus,
  type MarketStatPoint,
  type NewsCharacter,
  type NewsFeedResponse,
  type NewsItem,
  type PortfolioSummary,
  type ProfileBundle,
  type ProfileNetworthPoint,
  type ProfileRelationUser,
  type ProfileTrade,
  type SuperchatCurrencySummary,
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
    id: String(row.id || row.symbol || row.username || index),
    rank: Number(row.rank || index + 1),
    label: String(row.label || row.username || row.symbol || "Entry"),
    value: toNumber(row.value || row.total_equity || row.score),
    change_pct: toNumber(row.change_pct),
  }));
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
      created_at: String(profile?.created_at || ""),
      bio: profile?.bio ? String(profile.bio) : null,
      profile_picture_url: profile?.profile_picture_url ? String(profile.profile_picture_url) : null,
      profile_color: profile?.profile_color ? String(profile.profile_color) : null,
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
