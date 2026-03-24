"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { CandleChartCard, TrendChartCard } from "@/app/components/charts/market-charts";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtNumber, fmtPct } from "@/app/lib/format";
import type { AssetDetailBundle, MarketAsset } from "@/app/lib/types";
import styles from "@/app/components/home/asset-detail-section.module.scss";

export function AssetDetailSection({
  asset,
  detail,
  canTrade,
  onTradeComplete,
}: {
  asset: MarketAsset | null;
  detail: AssetDetailBundle | null;
  canTrade: boolean;
  onTradeComplete: () => Promise<void>;
}) {
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeQuantity, setTradeQuantity] = useState("10");
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeResult, setTradeResult] = useState<string | null>(null);

  async function handleTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!asset) return;
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
            <select className={styles.select} value={tradeSide} onChange={(event) => setTradeSide(event.target.value as "buy" | "sell")}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label>
            <span className={styles.label}>Quantity</span>
            <input className={styles.input} value={tradeQuantity} onChange={(event) => setTradeQuantity(event.target.value)} />
          </label>
          <button type="submit" className={styles.submit}>Submit Trade</button>
        </form>
      ) : (
        <div className={styles.loginCta}>
          <Link href="/login">Sign in</Link> or <Link href="/register">create an account</Link> to test buy and sell flows.
        </div>
      )}

      {tradeError ? <div className="statusMessage statusMessageError">Trade error: {tradeError}</div> : null}
      {tradeResult ? <div className="statusMessage statusMessageSuccess">{tradeResult}</div> : null}

      <div className={styles.chartGrid}>
        <CandleChartCard title="24H Market" subtitle="Hourly candles from executed trades" candles={detail?.intraday_candles || []} />
        <CandleChartCard title="1Y Daily Price" subtitle="Daily candles with mark-close overlay" candles={detail?.daily_candles || []} showMarkClose />
        <TrendChartCard
          title="Fundamental Signal"
          subtitle="Smoothed anchor with raw signal overlay"
          series={[
            {
              name: "Smoothed",
              color: "#2563eb",
              kind: "area",
              values: detail?.stats.map((item) => ({ time: item.snapshot_date, value: item.fundamental_value_smoothed })) || [],
            },
            {
              name: "Raw",
              color: "#94a3b8",
              kind: "line",
              values: detail?.stats.map((item) => ({ time: item.snapshot_date, value: item.fundamental_value_raw })) || [],
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
              values: detail?.stats.map((item) => ({ time: item.snapshot_date, value: item.subscriber_count })) || [],
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
              values: detail?.stats.map((item) => ({ time: item.snapshot_date, value: item.view_count })) || [],
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
