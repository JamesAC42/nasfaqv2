"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { CandleChartCard, TrendChartCard, VolumeChartCard } from "@/app/components/charts/market-charts";
import type { ChannelChartTheme } from "@/app/lib/chart-theme";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtNumber, fmtPct } from "@/app/lib/format";
import type { AssetDetailBundle, MarketAsset, MarketStatus } from "@/app/lib/types";
import styles from "@/app/components/home/asset-detail-section.module.scss";

const DETAIL_CHART_START_DATE = "2025-10-09";

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function AssetDetailSection({
  asset,
  detail,
  canTrade,
  marketStatus,
  onTradeComplete,
  chartTheme,
}: {
  asset: MarketAsset | null;
  detail: AssetDetailBundle | null;
  canTrade: boolean;
  marketStatus: MarketStatus | null;
  onTradeComplete: () => Promise<void>;
  chartTheme?: ChannelChartTheme | null;
}) {
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeQuantity, setTradeQuantity] = useState("10");
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeResult, setTradeResult] = useState<string | null>(null);

  async function handleTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!asset) return;
    if (marketStatus && !marketStatus.is_trading_open) {
      setTradeError(marketStatus.trading_message || "market_closed");
      setTradeResult(null);
      return;
    }
    setTradeError(null);
    setTradeResult(null);

    try {
      const result = await apiFetch<{
        filled_quantity: number;
        executed_price: number;
        fee: number;
      }>(`/api/market/orders/${tradeSide}`, {
        method: "POST",
        body: JSON.stringify({ symbol: asset.symbol, quantity: Number(tradeQuantity) }),
      });

      setTradeResult(
        `${tradeSide.toUpperCase()} ${fmtNumber(result.filled_quantity)} ${asset.symbol} at ${fmtNumber(result.executed_price)} fee ${fmtNumber(result.fee)}`
      );
      await onTradeComplete();
    } catch (error) {
      setTradeError(String((error as Error).message || error));
    }
  }

  if (!asset) {
    return <section className={styles.section}><div className={styles.empty}>No asset loaded.</div></section>;
  }

  const tradingOpen = marketStatus?.is_trading_open ?? true;
  const marketClosedMessage = marketStatus?.trading_message || "Trading is temporarily unavailable while the market settles.";
  const chartStartTs = toTimestamp(DETAIL_CHART_START_DATE);
  const filteredDailyCandles =
    detail?.daily_candles.filter((item) => {
      const ts = toTimestamp(item.bucket);
      return chartStartTs !== null && ts !== null && ts >= chartStartTs;
    }) || [];
  const filteredStats =
    detail?.stats.filter((item) => {
      const ts = toTimestamp(item.snapshot_date);
      return chartStartTs !== null && ts !== null && ts >= chartStartTs;
    }) || [];

  return (
    <section className={styles.section}>
      <div>
        <h2 className={styles.title}>{asset.display_name}</h2>
        <p className={styles.copy}>Detail charts, treasury, and trading UI are isolated from the overview table and consume the selected market slice.</p>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}><span className={styles.label}>Symbol</span><strong>{asset.symbol}</strong></div>
        <div className={styles.statCard}><span className={styles.label}>Mid</span><strong>{fmtNumber(asset.current_mid_price)}</strong></div>
        <div className={styles.statCard}><span className={styles.label}>Bid</span><strong>{fmtNumber(asset.current_bid_price)}</strong></div>
        <div className={styles.statCard}><span className={styles.label}>Ask</span><strong>{fmtNumber(asset.current_ask_price)}</strong></div>
        <div className={styles.statCard}><span className={styles.label}>Fair</span><strong>{fmtNumber(asset.current_fair_value)}</strong></div>
        <div className={styles.statCard}><span className={styles.label}>Premium</span><strong>{fmtPct(asset.current_premium_pct)}</strong></div>
        <div className={styles.statCard}><span className={styles.label}>Emission</span><strong>{fmtNumber(asset.current_daily_emission)}</strong></div>
        <div className={styles.statCard}><span className={styles.label}>Snapshot Date</span><strong>{asset.latest_snapshot_date || "—"}</strong></div>
      </div>

      {canTrade ? (
        <form className={styles.tradeForm} onSubmit={(event) => void handleTrade(event)}>
          <label>
            <span className={styles.label}>Side</span>
            <select
              className={styles.select}
              value={tradeSide}
              disabled={!tradingOpen}
              onChange={(event) => setTradeSide(event.target.value as "buy" | "sell")}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label>
            <span className={styles.label}>Quantity</span>
            <input className={styles.input} value={tradeQuantity} disabled={!tradingOpen} onChange={(event) => setTradeQuantity(event.target.value)} />
          </label>
          <button type="submit" className={styles.submit} disabled={!tradingOpen}>
            {tradingOpen ? "Submit Trade" : "Market Closed"}
          </button>
        </form>
      ) : (
        <div className={styles.loginCta}>
          <Link href="/login">Sign in</Link> or <Link href="/register">create an account</Link> to test buy and sell flows.
        </div>
      )}

      {canTrade && !tradingOpen ? (
        <div className="statusMessage statusMessageWarn">
          <strong>Trading paused.</strong> {marketClosedMessage}
        </div>
      ) : null}

      {tradeError ? <div className="statusMessage statusMessageError">Trade error: {tradeError}</div> : null}
      {tradeResult ? <div className="statusMessage statusMessageSuccess">{tradeResult}</div> : null}

      <div className={styles.chartGrid}>
        <CandleChartCard title="24H Market" subtitle="Hourly candles from executed trades" candles={detail?.intraday_candles || []} theme={chartTheme} />
        <CandleChartCard title="1Y Daily Price" subtitle="Daily candles with mark-close overlay" candles={filteredDailyCandles} showMarkClose theme={chartTheme} />
        <VolumeChartCard title="1Y Daily Volume" subtitle="Settled daily coin volume in shares" candles={filteredDailyCandles} theme={chartTheme} />
        <TrendChartCard
          title="Fundamental Signal"
          subtitle="Smoothed anchor with raw signal overlay"
          theme={chartTheme}
          series={[
            {
              name: "Smoothed",
              color: chartTheme?.baseDeep || "#2563eb",
              kind: "area",
              values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.fundamental_value_smoothed })),
            },
            {
              name: "Raw",
              color: chartTheme?.baseMuted || "#94a3b8",
              kind: "line",
              values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.fundamental_value_raw })),
            },
          ]}
        />
        <TrendChartCard
          title="Subscribers"
          subtitle="One-year audience trajectory"
          theme={chartTheme}
          series={[
            {
              name: "Subscribers",
              color: chartTheme?.base || "#7c3aed",
              kind: "area",
              values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.subscriber_count })),
            },
          ]}
        />
        <TrendChartCard
          title="Views"
          subtitle="Cumulative channel views"
          theme={chartTheme}
          series={[
            {
              name: "Views",
              color: chartTheme?.complement || "#ea580c",
              kind: "area",
              values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.view_count })),
            },
          ]}
        />
        <TrendChartCard
          title="Video Count"
          subtitle="Published video total over time"
          theme={chartTheme}
          series={[
            {
              name: "Videos",
              color: chartTheme?.complementSoft || "#f97316",
              kind: "area",
              values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.video_count })),
            },
          ]}
        />
      </div>

      <div className={styles.panel}>
        <h3 className={styles.title}>Treasury</h3>
        <div className={styles.treasuryGrid}>
          <div className={styles.statCard}><span className={styles.label}>Circulating</span><strong>{fmtNumber(detail?.treasury?.circulating_supply)}</strong></div>
          <div className={styles.statCard}><span className={styles.label}>Treasury</span><strong>{fmtNumber(detail?.treasury?.treasury_supply)}</strong></div>
          <div className={styles.statCard}><span className={styles.label}>Max</span><strong>{fmtNumber(detail?.treasury?.max_supply)}</strong></div>
          <div className={styles.statCard}><span className={styles.label}>Premium</span><strong>{fmtPct(detail?.treasury?.current_premium_pct)}</strong></div>
        </div>
      </div>

      <div className={styles.panel}>
        <h3 className={styles.title}>Recent Trades</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
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
    </section>
  );
}
