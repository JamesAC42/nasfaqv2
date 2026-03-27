import type {
  AssetDetailBundle,
  CandlePoint,
  ChannelOverviewRow,
  LeaderboardEntry,
  LivestreamItem,
  MarketAsset,
  MarketIndexBundle,
  MarketIndexPoint,
  MarketIndexSummary,
  MarketStatus,
  MarketStatPoint,
  NewsItem,
  PortfolioSummary,
  TradeRow,
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
    thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
    url: row.url ? String(row.url) : null,
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

export function normalizeNews(rows: Array<Record<string, unknown>>): NewsItem[] {
  return rows.map((row, index) => ({
    id: String(row.id || row.url || index),
    headline: String(row.headline || row.title || "Untitled story"),
    source: String(row.source || row.publisher || "Unknown source"),
    published_at: row.published_at ? String(row.published_at) : null,
    thumbnail_url: row.thumbnail_url ? String(row.thumbnail_url) : null,
    url: row.url ? String(row.url) : null,
    summary: row.summary ? String(row.summary) : null,
    related_names: Array.isArray(row.related_names) ? row.related_names.map((item) => String(item)) : [],
  }));
}

export function normalizeHoloNewsFeed(value: Record<string, unknown>): NewsItem[] {
  const updatedAt = value.updated_at ? String(value.updated_at) : null;
  const items = Array.isArray(value.items) ? (value.items as Array<Record<string, unknown>>) : [];

  return items.map((item, index) => {
    const characters = Array.isArray(item.characters) ? item.characters as Array<Record<string, unknown>> : [];
    const summary = characters.length
      ? characters
          .map((character) => String(character.name || "").trim())
          .filter(Boolean)
          .join(", ")
      : null;

    return {
      id: String(item.headline || index),
      headline: String(item.headline || "Untitled story"),
      source: "HoloNews",
      published_at: updatedAt,
      thumbnail_url: item.thumbnail_url ? String(item.thumbnail_url) : null,
      summary,
      url: null,
      related_names: characters
        .map((character) => String(character.name || "").trim())
        .filter(Boolean),
    };
  });
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
