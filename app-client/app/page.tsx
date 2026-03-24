"use client";

import { FormEvent, useEffect, useState } from "react";
import { CandleChartCard, SparklineChart, TrendChartCard } from "./components/market-charts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4001";

type AuthUser = {
  id: number;
  username: string;
  created_at: string;
};

type MarketAsset = {
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

type MarketStatPoint = {
  snapshot_date: string;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
  fundamental_value_raw: number | null;
  fundamental_value_smoothed: number | null;
};

type CandlePoint = {
  bucket: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  close_mark?: number | null;
};

type TradeRow = {
  id: number;
  ts: string;
  side: string;
  price: number;
  quantity: number;
  gross_cash: number;
};

type AssetDetailBundle = {
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

type ChannelOverviewRow = {
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

type PortfolioSummary = {
  cash_balance: number;
  total_market_value: number;
  total_unrealized_pnl: number;
  total_equity: number;
  holdings: Array<{
    asset_id: number;
    symbol: string;
    display_name: string;
    quantity: number;
    avg_cost_basis: number;
    current_mid_price: number | null;
    market_value: number;
    unrealized_pnl: number;
  }>;
};

type DailyReport = {
  market_date: string;
  asset_count: number;
  largest_premiums?: Array<ReportRow>;
  largest_discounts?: Array<ReportRow>;
  top_price_movers?: Array<ReportRow>;
  top_volume?: Array<ReportRow>;
};

type ReportRow = {
  symbol: string;
  display_name: string;
  premium_pct?: number | null;
  move_pct?: number | null;
  volume_cash?: number | null;
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const intf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return nf.format(value);
}

function fmtInteger(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return intf.format(value);
}

function fmtPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }

  return (await response.json()) as T;
}

function normalizeAsset(asset: Record<string, unknown>): MarketAsset {
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
    sparkline_candles: normalizeCandles(((asset.sparkline_candles as Array<Record<string, unknown>> | undefined) || [])),
  };
}

function computeHeatmapMarketCap(asset: MarketAsset) {
  const price = asset.current_mid_price ?? 0;
  const volume = asset.volume_24h ?? 0;
  return price * Math.max(volume, 1);
}

function getIconUrl(iconName: string | null | undefined) {
  if (!iconName) return null;
  return `https://images.nasfaq.biz/icons/${iconName}.svg`;
}

function AssetHeatmap({
  assets,
  onSelect,
}: {
  assets: MarketAsset[];
  onSelect: (symbol: string) => void;
}) {
  const ranked = [...assets]
    .map((asset) => {
      const marketCap = computeHeatmapMarketCap(asset);
      return {
        asset,
        marketCap,
      };
    })
    .sort((a, b) => b.marketCap - a.marketCap);

  const maxMarketCap = ranked[0]?.marketCap || 1;

  return (
    <div className="heatmapWrap">
      {ranked.map(({ asset, marketCap }) => {
        const strength = Math.max(0, Math.min(1, marketCap / maxMarketCap));
        const span = strength > 0.65 ? 3 : strength > 0.3 ? 2 : 1;
        const change = asset.move_24h_pct ?? 0;
        const tone = change >= 0 ? "up" : "down";

        return (
          <button
            key={asset.symbol}
            type="button"
            className={`heatmapTile heatmapTile-${tone} heatmapSpan-${span}`}
            onClick={() => onSelect(asset.symbol)}
            title={`${asset.symbol} ${fmtNumber(asset.current_mid_price)} ${fmtPct(asset.move_24h_pct)}`}
          >
            <div className="heatmapTileHeader">
              {getIconUrl(asset.icon) ? (
                <img src={getIconUrl(asset.icon) || ""} alt="" className="heatmapIcon" />
              ) : (
                <div className="heatmapIconFallback">{asset.symbol.slice(0, 1)}</div>
              )}
              <strong>{asset.symbol}</strong>
            </div>
            <div className="heatmapTilePrice">{fmtNumber(asset.current_mid_price)}</div>
            <div className="heatmapTileChange">{fmtPct(asset.move_24h_pct)}</div>
          </button>
        );
      })}
    </div>
  );
}

function normalizeStats(stats: Array<Record<string, unknown>>): MarketStatPoint[] {
  return stats.map((item) => ({
    snapshot_date: String(item.snapshot_date || ""),
    subscriber_count: toNumber(item.subscriber_count),
    view_count: toNumber(item.view_count),
    video_count: toNumber(item.video_count),
    fundamental_value_raw: toNumber(item.fundamental_value_raw),
    fundamental_value_smoothed: toNumber(item.fundamental_value_smoothed),
  }));
}

function normalizeCandles(candles: Array<Record<string, unknown>>): CandlePoint[] {
  return candles.map((item) => ({
    bucket: String(item.bucket || ""),
    open: toNumber(item.open),
    high: toNumber(item.high),
    low: toNumber(item.low),
    close: toNumber(item.close),
    close_mark: toNumber(item.close_mark),
  }));
}

function normalizeTrades(trades: Array<Record<string, unknown>>): TradeRow[] {
  return trades.map((item) => ({
    id: Number(item.id),
    ts: String(item.ts || ""),
    side: String(item.side || ""),
    price: Number(toNumber(item.price) || 0),
    quantity: Number(toNumber(item.quantity) || 0),
    gross_cash: Number(toNumber(item.gross_cash) || 0),
  }));
}

function normalizeTreasury(treasury: Record<string, unknown> | null): AssetDetailBundle["treasury"] {
  if (!treasury) return null;
  return {
    max_supply: toNumber(treasury.max_supply),
    circulating_supply: toNumber(treasury.circulating_supply),
    treasury_supply: toNumber(treasury.treasury_supply),
    current_daily_emission: toNumber(treasury.current_daily_emission),
    current_premium_pct: toNumber(treasury.current_premium_pct),
  };
}

function normalizeChannels(rows: Array<Record<string, unknown>>): ChannelOverviewRow[] {
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

function normalizePortfolio(value: Record<string, unknown>): PortfolioSummary {
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

export default function Home() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [marketAssets, setMarketAssets] = useState<MarketAsset[]>([]);
  const [channels, setChannels] = useState<ChannelOverviewRow[]>([]);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [selectedAsset, setSelectedAsset] = useState<MarketAsset | null>(null);
  const [detail, setDetail] = useState<AssetDetailBundle | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [selectedUnit, setSelectedUnit] = useState("all");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeQuantity, setTradeQuantity] = useState("10");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeResult, setTradeResult] = useState<string | null>(null);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState<false | "reset" | "rebuild">(false);

  async function loadDashboard(preserveSelection?: string) {
    setLoading(true);
    setError(null);
    try {
      const [meResult, marketResult, channelsResult, reportResult] = await Promise.allSettled([
        apiFetch<{ user: AuthUser }>("/api/auth/me"),
        apiFetch<Record<string, unknown>[]>("/api/market/assets"),
        apiFetch<Record<string, unknown>[]>("/api/overview/latest"),
        apiFetch<DailyReport>("/api/market/report/daily/latest"),
      ]);

      const nextUser = meResult.status === "fulfilled" ? meResult.value.user : null;
      const nextAssets = marketResult.status === "fulfilled" ? marketResult.value.map(normalizeAsset) : [];
      const nextChannels = channelsResult.status === "fulfilled" ? normalizeChannels(channelsResult.value) : [];
      const nextReport = reportResult.status === "fulfilled" ? reportResult.value : null;
      const nextSymbol = preserveSelection || selectedSymbol || nextAssets[0]?.symbol || "";

      setUser(nextUser);
      setMarketAssets(nextAssets);
      setChannels(nextChannels);
      setReport(nextReport);
      setSelectedSymbol(nextSymbol);
      setSelectedAsset(nextAssets.find((item) => item.symbol === nextSymbol) || nextAssets[0] || null);

      if (nextUser) {
        const nextPortfolio = await apiFetch<Record<string, unknown>>("/api/portfolio/me");
        setPortfolio(normalizePortfolio(nextPortfolio));
      } else {
        setPortfolio(null);
      }
    } catch (fetchError) {
      setError(String((fetchError as Error).message || fetchError));
    } finally {
      setLoading(false);
    }
  }

  async function loadAssetDetail(symbol: string) {
    if (!symbol) {
      setDetail(null);
      return;
    }

    try {
      const [stats, candles, trades, treasury] = await Promise.all([
        apiFetch<{ symbol: string; stats: Array<Record<string, unknown>> }>(`/api/market/assets/${symbol}/stats?range=1y`),
        Promise.all([
          apiFetch<{ symbol: string; candles: Array<Record<string, unknown>> }>(`/api/market/assets/${symbol}/candles?interval=1d&range=1y`),
          apiFetch<{ symbol: string; candles: Array<Record<string, unknown>> }>(`/api/market/assets/${symbol}/candles?interval=1h&range=24h`),
        ]),
        apiFetch<{ symbol: string; trades: Array<Record<string, unknown>> }>(`/api/market/assets/${symbol}/trades?limit=10`),
        apiFetch<Record<string, unknown>>(`/api/market/assets/${symbol}/treasury`),
      ]);

      setDetail({
        stats: normalizeStats(stats.stats),
        daily_candles: normalizeCandles(candles[0].candles),
        intraday_candles: normalizeCandles(candles[1].candles),
        trades: normalizeTrades(trades.trades),
        treasury: normalizeTreasury(treasury),
      });
    } catch (fetchError) {
      setDetail(null);
      setError(String((fetchError as Error).message || fetchError));
    }
  }

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSymbol) return;
    void loadAssetDetail(selectedSymbol);
    setSelectedAsset(marketAssets.find((item) => item.symbol === selectedSymbol) || null);
  }, [selectedSymbol, marketAssets]);

  const unitOptions = Array.from(
    new Set(
      marketAssets
        .map((asset) => asset.unit)
        .filter((value): value is string => Boolean(value))
    )
  ).sort((a, b) => a.localeCompare(b));

  const heatmapAssets = [...marketAssets]
    .filter((asset) => selectedUnit === "all" || asset.unit === selectedUnit)
    .sort((a, b) => computeHeatmapMarketCap(b) - computeHeatmapMarketCap(a))
    .slice(0, 25);

  async function submitAuth(mode: "login" | "register") {
    setAuthError(null);

    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const result = await apiFetch<{ user: AuthUser }>(path, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setUser(result.user);
      setPassword("");
      await loadDashboard(selectedSymbol);
    } catch (submitError) {
      setAuthError(String((submitError as Error).message || submitError));
    }
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAuth("login");
  }

  async function handleRegisterClick() {
    await submitAuth("register");
  }

  async function handleLogout() {
    setAuthError(null);
    try {
      await apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" });
      setUser(null);
      setPortfolio(null);
      setTradeResult(null);
      await loadDashboard(selectedSymbol);
    } catch (submitError) {
      setAuthError(String((submitError as Error).message || submitError));
    }
  }

  async function handleTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTradeError(null);
    setTradeResult(null);

    try {
      const result = await apiFetch<{
        filled_quantity: number;
        executed_price: number;
        fee: number;
      }>(`/api/market/orders/${tradeSide}`, {
        method: "POST",
        body: JSON.stringify({ symbol: selectedSymbol, quantity: Number(tradeQuantity) }),
      });

      setTradeResult(
        `${tradeSide.toUpperCase()} ${fmtNumber(result.filled_quantity)} ${selectedSymbol} at ${fmtNumber(result.executed_price)} fee ${fmtNumber(result.fee)}`
      );
      await loadDashboard(selectedSymbol);
      await loadAssetDetail(selectedSymbol);
    } catch (submitError) {
      setTradeError(String((submitError as Error).message || submitError));
    }
  }

  async function handleResetMarket() {
    setAdminBusy("reset");
    setAdminError(null);
    setAdminStatus(null);

    try {
      const result = await apiFetch<{ starter_cash: number }>("/internal/market/reset", {
        method: "POST",
        body: "{}",
      });
      setTradeResult(null);
      setPortfolio(null);
      setDetail(null);
      setAdminStatus(`Market reset complete. All users now have starter cash ${fmtNumber(result.starter_cash)}.`);
      await loadDashboard();
    } catch (submitError) {
      setAdminError(String((submitError as Error).message || submitError));
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleRebuildMarket() {
    setAdminBusy("rebuild");
    setAdminError(null);
    setAdminStatus(null);

    try {
      const result = await apiFetch<{
        range: { from: string; to: string };
        fundamentals: { snapshots_processed: number; failed_snapshots: number };
        settlement: { settled_count: number };
      }>("/internal/market/rebuild-full", {
        method: "POST",
        body: JSON.stringify({
          active_only: true,
          fill_missing_dates: true,
          force: true,
          version: 1,
        }),
      });
      setAdminStatus(
        `Rebuild complete for ${result.range.from} to ${result.range.to}. Fundamentals: ${result.fundamentals.snapshots_processed} snapshots, failed ${result.fundamentals.failed_snapshots}. Settled days: ${result.settlement.settled_count}.`
      );
      await loadDashboard(selectedSymbol);
      if (selectedSymbol) {
        await loadAssetDetail(selectedSymbol);
      }
    } catch (submitError) {
      setAdminError(String((submitError as Error).message || submitError));
    } finally {
      setAdminBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="pageHeader">
        <div>
          <h1>NASFAQ App Test UI</h1>
          <p>API base: {API_BASE}</p>
        </div>
        <button type="button" onClick={() => void loadDashboard(selectedSymbol)}>
          Refresh
        </button>
      </header>

      {error ? <div className="message error">Request error: {error}</div> : null}
      {loading ? <div className="message">Loading dashboard data…</div> : null}

      <section className="panel">
        <h2>Market Admin</h2>
        <div className="formActions">
          <button type="button" onClick={() => void handleResetMarket()} disabled={adminBusy !== false}>
            {adminBusy === "reset" ? "Resetting…" : "Reset Market"}
          </button>
          <button type="button" onClick={() => void handleRebuildMarket()} disabled={adminBusy !== false}>
            {adminBusy === "rebuild" ? "Rebuilding…" : "Rebuild Full Market"}
          </button>
        </div>
        <p className="helperText">
          Reset wipes derived market/trade/portfolio state but preserves users and raw `yt.*` history. Rebuild bootstraps assets, recalculates
          fundamentals with missing-date fill, and settles the full historical range.
        </p>
        {adminError ? <div className="message error">Admin error: {adminError}</div> : null}
        {adminStatus ? <div className="message success">{adminStatus}</div> : null}
      </section>

      <section className="panel">
        <h2>Auth</h2>
        {user ? (
          <div className="authRow">
            <div>
              <p>Signed in as <strong>{user.username}</strong></p>
              <p>User id: {user.id}</p>
            </div>
            <button type="button" onClick={() => void handleLogout()}>
              Logout
            </button>
          </div>
        ) : (
          <form className="formGrid" onSubmit={(event) => void handleLoginSubmit(event)}>
            <label>
              Username
              <input value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <div className="formActions">
              <button type="submit">Sign In</button>
              <button type="button" onClick={() => void handleRegisterClick()}>
                Create User
              </button>
            </div>
            <p className="helperText">For now, registration requires a password at least 8 characters long.</p>
            {authError ? <div className="message error">Auth error: {authError}</div> : null}
          </form>
        )}
      </section>

      <p className="chartAttribution">Charts powered by TradingView Lightweight Charts.</p>

      <div className="twoColumn">
        <section className="panel">
          <h2>Market Assets</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Trend</th>
                  <th>Mid</th>
                  <th>Fair</th>
                  <th>Premium</th>
                  <th>24h Move</th>
                  <th>24h Volume</th>
                </tr>
              </thead>
              <tbody>
                {marketAssets.map((asset) => (
                  <tr
                    key={asset.symbol}
                    className={asset.symbol === selectedSymbol ? "selectedRow" : ""}
                    onClick={() => setSelectedSymbol(asset.symbol)}
                  >
                    <td>{asset.symbol}</td>
                    <td>{asset.display_name}</td>
                    <td>
                      <SparklineChart
                        candles={asset.sparkline_candles}
                      />
                    </td>
                    <td>{fmtNumber(asset.current_mid_price)}</td>
                    <td>{fmtNumber(asset.current_fair_value)}</td>
                    <td>{fmtPct(asset.current_premium_pct)}</td>
                    <td>{fmtPct(asset.move_24h_pct)}</td>
                    <td>{fmtNumber(asset.volume_24h)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="subPanel marketHeatmapPanel">
            <div className="chartTitleRow">
              <div>
                <h3>Asset Heatmap</h3>
                <span>Top 25 by price × max(24h volume, 1)</span>
              </div>
              <label className="heatmapFilter">
                <span>Generation</span>
                <select value={selectedUnit} onChange={(event) => setSelectedUnit(event.target.value)}>
                  <option value="all">All</option>
                  {unitOptions.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="helperText">Tile size uses price × max(24h volume, 1). Green means up versus yesterday, red means down.</p>
            <AssetHeatmap assets={heatmapAssets} onSelect={setSelectedSymbol} />
          </div>
        </section>

        <section className="panel">
          <h2>Selected Asset</h2>
          {selectedAsset ? (
            <>
              <div className="statsGrid">
                <div><span>Symbol</span><strong>{selectedAsset.symbol}</strong></div>
                <div><span>Mid</span><strong>{fmtNumber(selectedAsset.current_mid_price)}</strong></div>
                <div><span>Bid</span><strong>{fmtNumber(selectedAsset.current_bid_price)}</strong></div>
                <div><span>Ask</span><strong>{fmtNumber(selectedAsset.current_ask_price)}</strong></div>
                <div><span>Fair</span><strong>{fmtNumber(selectedAsset.current_fair_value)}</strong></div>
                <div><span>Premium</span><strong>{fmtPct(selectedAsset.current_premium_pct)}</strong></div>
                <div><span>Emission</span><strong>{fmtNumber(selectedAsset.current_daily_emission)}</strong></div>
                <div><span>Snapshot Date</span><strong>{selectedAsset.latest_snapshot_date || "—"}</strong></div>
              </div>

              {user ? (
                <form className="tradeForm" onSubmit={handleTrade}>
                  <label>
                    Side
                    <select value={tradeSide} onChange={(event) => setTradeSide(event.target.value as "buy" | "sell")}>
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </label>
                  <label>
                    Quantity
                    <input value={tradeQuantity} onChange={(event) => setTradeQuantity(event.target.value)} />
                  </label>
                  <button type="submit">Submit Trade</button>
                  {tradeError ? <div className="message error">Trade error: {tradeError}</div> : null}
                  {tradeResult ? <div className="message success">{tradeResult}</div> : null}
                </form>
              ) : (
                <p>Sign in to test buy/sell.</p>
              )}

              <div className="chartGrid">
                <CandleChartCard
                  title="24H Market"
                  subtitle="Hourly candles from executed trades"
                  candles={detail?.intraday_candles || []}
                />
                <CandleChartCard
                  title="1Y Daily Price"
                  subtitle="Daily candles with calmer mark-close overlay"
                  candles={detail?.daily_candles || []}
                  showMarkClose
                />
                <TrendChartCard
                  title="Fundamental Signal"
                  subtitle="Smoothed anchor with raw signal overlay"
                  series={[
                    {
                      name: "Smoothed",
                      color: "#2563eb",
                      kind: "area",
                      values: detail?.stats.map((item) => ({
                        time: item.snapshot_date,
                        value: item.fundamental_value_smoothed,
                      })) || [],
                    },
                    {
                      name: "Raw",
                      color: "#94a3b8",
                      kind: "line",
                      values: detail?.stats.map((item) => ({
                        time: item.snapshot_date,
                        value: item.fundamental_value_raw,
                      })) || [],
                    },
                  ]}
                />
                <TrendChartCard
                  title="Subscribers"
                  subtitle="One-year audience trajectory"
                  series={[
                    {
                      name: "Subscribers",
                      color: "#7c3aed",
                      kind: "area",
                      values: detail?.stats.map((item) => ({
                        time: item.snapshot_date,
                        value: item.subscriber_count,
                      })) || [],
                    },
                  ]}
                />
                <TrendChartCard
                  title="Views"
                  subtitle="Cumulative channel views"
                  series={[
                    {
                      name: "Views",
                      color: "#ea580c",
                      kind: "area",
                      values: detail?.stats.map((item) => ({
                        time: item.snapshot_date,
                        value: item.view_count,
                      })) || [],
                    },
                  ]}
                />
              </div>

              <div className="subPanel">
                <h3>Treasury</h3>
                <div className="statsGrid">
                  <div><span>Circulating</span><strong>{fmtNumber(detail?.treasury?.circulating_supply)}</strong></div>
                  <div><span>Treasury</span><strong>{fmtNumber(detail?.treasury?.treasury_supply)}</strong></div>
                  <div><span>Max</span><strong>{fmtNumber(detail?.treasury?.max_supply)}</strong></div>
                  <div><span>Premium</span><strong>{fmtPct(detail?.treasury?.current_premium_pct)}</strong></div>
                </div>
              </div>

              <div className="subPanel">
                <h3>Recent Trades</h3>
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Side</th>
                        <th>Price</th>
                        <th>Qty</th>
                        <th>Gross</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail?.trades || []).map((trade) => (
                        <tr key={trade.id}>
                          <td>{fmtDate(trade.ts)}</td>
                          <td>{trade.side}</td>
                          <td>{fmtNumber(trade.price)}</td>
                          <td>{fmtNumber(trade.quantity)}</td>
                          <td>{fmtNumber(trade.gross_cash)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p>No asset loaded.</p>
          )}
        </section>
      </div>

      <div className="twoColumn">
        <section className="panel">
          <h2>Portfolio</h2>
          {portfolio ? (
            <>
              <div className="statsGrid">
                <div><span>Cash</span><strong>{fmtNumber(portfolio.cash_balance)}</strong></div>
                <div><span>Market Value</span><strong>{fmtNumber(portfolio.total_market_value)}</strong></div>
                <div><span>Unrealized PnL</span><strong>{fmtNumber(portfolio.total_unrealized_pnl)}</strong></div>
                <div><span>Total Equity</span><strong>{fmtNumber(portfolio.total_equity)}</strong></div>
              </div>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Qty</th>
                      <th>Avg Cost</th>
                      <th>Mid</th>
                      <th>Value</th>
                      <th>PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.holdings.map((holding) => (
                      <tr key={holding.asset_id}>
                        <td>{holding.symbol}</td>
                        <td>{fmtNumber(holding.quantity)}</td>
                        <td>{fmtNumber(holding.avg_cost_basis)}</td>
                        <td>{fmtNumber(holding.current_mid_price)}</td>
                        <td>{fmtNumber(holding.market_value)}</td>
                        <td>{fmtNumber(holding.unrealized_pnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p>Sign in to load portfolio data.</p>
          )}
        </section>

        <section className="panel">
          <h2>Latest Market Report</h2>
          {report ? (
            <>
              <p>Market date: {report.market_date}</p>
              <p>Assets settled: {report.asset_count}</p>
              <div className="reportGrid">
                <ReportList title="Largest Premiums" rows={report.largest_premiums || []} mode="premium" />
                <ReportList title="Largest Discounts" rows={report.largest_discounts || []} mode="premium" />
                <ReportList title="Top Movers" rows={report.top_price_movers || []} mode="move" />
                <ReportList title="Top Volume" rows={report.top_volume || []} mode="volume" />
              </div>
            </>
          ) : (
            <p>No daily report found yet.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Channel Snapshot Overview</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>YT Channel ID</th>
                <th>Subscribers</th>
                <th>Views</th>
                <th>Videos</th>
                <th>Snapshot Time</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((row) => (
                <tr key={row.channel.youtube_channel_id}>
                  <td>{row.channel.name || row.channel.name_short || "—"}</td>
                  <td>{row.channel.youtube_channel_id}</td>
                  <td>{fmtInteger(row.latest?.subscriber_count)}</td>
                  <td>{fmtInteger(row.latest?.view_count)}</td>
                  <td>{fmtInteger(row.latest?.video_count)}</td>
                  <td>{fmtDate(row.latest?.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function ReportList({
  title,
  rows,
  mode,
}: {
  title: string;
  rows: ReportRow[];
  mode: "premium" | "move" | "volume";
}) {
  return (
    <div className="subPanel">
      <h3>{title}</h3>
      <ul className="plainList">
        {rows.map((row) => (
          <li key={`${title}-${row.symbol}`}>
            <strong>{row.symbol}</strong> {row.display_name}{" "}
            {mode === "premium" ? fmtPct(row.premium_pct) : mode === "move" ? fmtPct(row.move_pct) : fmtNumber(row.volume_cash)}
          </li>
        ))}
      </ul>
    </div>
  );
}
