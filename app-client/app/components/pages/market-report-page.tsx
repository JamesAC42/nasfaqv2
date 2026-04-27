"use client";

import Link from "next/link";
import { useEffect, useMemo, type ReactNode } from "react";
import {
  FaArrowTrendDown,
  FaArrowTrendUp,
  FaChartLine,
  FaCircleNodes,
  FaGaugeHigh,
  FaLayerGroup,
  FaMagnifyingGlassChart,
  FaMoneyBillTrendUp,
  FaRegCalendar,
  FaScaleBalanced,
  FaSignal,
  FaWallet,
} from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import type { DailyReport, MarketAsset, MarketIndexBundle, PortfolioSummary, ReportRow } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/pages/market-report-page.module.scss";

const MARKET_REPORT_INDEX_START_DATE = "2025-10-06";

function toneClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return styles.neutral;
  if (value > 0) return styles.positive;
  if (value < 0) return styles.negative;
  return styles.neutral;
}

function findAsset(assets: MarketAsset[], symbol: string) {
  return assets.find((asset) => asset.symbol === symbol) || null;
}

function rowMetric(row: ReportRow, kind: "premium" | "move" | "volume" | "fair") {
  if (kind === "premium") return row.premium_discount_pct ?? row.premium_pct;
  if (kind === "move") return row.move_pct;
  if (kind === "fair") return row.base_rate_change_pct ?? row.fair_value_change_pct;
  return row.volume_change_pct;
}

function formatIntervalLabel(value: string | null | undefined) {
  switch (value) {
    case "open":
      return "Open";
    case "lunch":
      return "Lunch";
    case "late":
      return "Late";
    case "overnight":
      return "Overnight";
    default:
      return value || "N/A";
  }
}

function formatAdjustmentTime(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function baseGapPct(asset: MarketAsset) {
  const marketPrice = asset.market_price ?? asset.current_mid_price;
  const baseRate = asset.base_rate ?? asset.current_fair_value;
  if (!marketPrice || !baseRate) return null;
  return (marketPrice - baseRate) / baseRate;
}

function adjustmentMovePct(asset: MarketAsset) {
  const before = asset.latest_adjustment?.price_before;
  const after = asset.latest_adjustment?.price_after;
  if (!before || after === null || after === undefined) return null;
  return (after - before) / before;
}

function getReportGroups(report: DailyReport | null) {
  if (!report) return [];
  return [
    { key: "premiums", title: "Premium Heat", icon: <HiSparkles />, rows: report.largest_market_premiums || report.largest_premiums || [], kind: "premium" as const },
    { key: "discounts", title: "Discount Watch", icon: <FaArrowTrendDown />, rows: report.largest_market_discounts || report.largest_discounts || [], kind: "premium" as const },
    { key: "winners", title: "Breakouts", icon: <FaArrowTrendUp />, rows: report.biggest_winners || [], kind: "move" as const },
    { key: "losers", title: "Drawdowns", icon: <FaChartLine />, rows: report.biggest_losers || [], kind: "move" as const },
    { key: "volume", title: "Flow Acceleration", icon: <FaMoneyBillTrendUp />, rows: report.volume_winners || report.top_volume || [], kind: "volume" as const },
    { key: "fair", title: "Base Rate Shifts", icon: <FaScaleBalanced />, rows: report.biggest_base_rate_increases || report.biggest_fair_value_increases || [], kind: "fair" as const },
  ].filter((group) => group.rows.length > 0);
}

function topAssetBy(
  assets: MarketAsset[],
  selector: (asset: MarketAsset) => number | null | undefined,
  direction: "max" | "min" = "max"
) {
  return [...assets]
    .filter((asset) => {
      const value = selector(asset);
      return value !== null && value !== undefined && Number.isFinite(value);
    })
    .sort((left, right) => {
      const a = selector(left) ?? 0;
      const b = selector(right) ?? 0;
      return direction === "max" ? b - a : a - b;
    })[0] || null;
}

function latestIndexSeries(index: MarketIndexBundle | null) {
  if (!index) return [];
  return [
    {
      name: "All Market",
      color: "#5fdeec",
      kind: "area" as const,
      values: index.series
        .filter((point) => point.bucket >= MARKET_REPORT_INDEX_START_DATE)
        .map((point) => ({ time: point.bucket, value: point.value })),
    },
  ];
}

function buildPortfolioUnitExposure(portfolio: PortfolioSummary | null, assets: MarketAsset[]) {
  if (!portfolio) return [];
  const bySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  const totals = new Map<string, number>();
  for (const holding of portfolio.holdings) {
    const unit = bySymbol.get(holding.symbol)?.unit || "Unassigned";
    totals.set(unit, (totals.get(unit) || 0) + holding.market_value);
  }
  return [...totals.entries()]
    .map(([unit, value]) => ({
      unit,
      value,
      pct: portfolio.total_market_value > 0 ? value / portfolio.total_market_value : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

function buildInsightLines(report: DailyReport | null, allMarketIndex: MarketIndexBundle | null, portfolio: PortfolioSummary | null) {
  const premium = (report?.largest_market_premiums || report?.largest_premiums)?.[0];
  const discount = (report?.largest_market_discounts || report?.largest_discounts)?.[0];
  const winner = report?.biggest_winners?.[0];
  const loser = report?.biggest_losers?.[0];
  const breadth = allMarketIndex?.summary;
  const netPnl = portfolio?.total_unrealized_pnl ?? null;

  return [
    premium ? `${premium.symbol} is pricing the richest premium at ${fmtPct(premium.premium_discount_pct ?? premium.premium_pct)}, so the tape is paying up above its base rate.` : null,
    discount ? `${discount.symbol} is the deepest discount at ${fmtPct(discount.premium_discount_pct ?? discount.premium_pct)}, creating the clearest market-versus-base-rate gap in the report.` : null,
    winner && loser ? `Momentum dispersion is wide: ${winner.symbol} leads at ${fmtPct(winner.move_pct)} while ${loser.symbol} trails at ${fmtPct(loser.move_pct)}.` : null,
    breadth ? `Breadth is ${fmtInteger(breadth.advancers)} advancers against ${fmtInteger(breadth.decliners)} decliners across ${fmtInteger(breadth.constituent_count)} constituents.` : null,
    netPnl !== null ? `Your marked portfolio P/L is ${fmtNumber(netPnl, "$")}, so today's report can be read against your current exposure.` : null,
  ].filter((line): line is string => Boolean(line));
}

function StatCard({ label, value, meta, icon }: { label: string; value: string; meta: string; icon: ReactNode }) {
  return (
    <article className={styles.statCard}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
      <p>{meta}</p>
    </article>
  );
}

function ReportList({
  title,
  icon,
  rows,
  assets,
  kind,
  featured = false,
}: {
  title: string;
  icon: ReactNode;
  rows: ReportRow[];
  assets: MarketAsset[];
  kind: "premium" | "move" | "volume" | "fair";
  featured?: boolean;
}) {
  return (
    <section className={`${styles.reportCard} ${featured ? styles.reportCardFeatured : ""}`.trim()}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>Latest settled report leaders.</p>
        </div>
      </div>
      <div className={styles.reportRows}>
        {rows.slice(0, 6).map((row, index) => {
          const asset = findAsset(assets, row.symbol);
          const metric = rowMetric(row, kind);
          return (
            <Link key={`${title}-${row.symbol}`} href={`/stocks/${encodeURIComponent(row.symbol)}`} className={styles.reportRow}>
              <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
              <AssetCoin symbol={row.symbol} icon={asset?.icon ?? null} color={asset?.color ?? null} className={styles.assetIcon} />
              <span className={styles.assetCopy}>
                <strong>{row.symbol}</strong>
                <em>{row.display_name}</em>
              </span>
              <strong className={toneClass(metric)}>{fmtPct(metric)}</strong>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function MarketReportPage() {
  const assets = useMarketStore((state) => state.assets);
  const report = useMarketStore((state) => state.report);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const isLoadingIndex = useMarketStore((state) => state.isLoadingIndex);
  const error = useMarketStore((state) => state.error);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const fetchMarketIndexes = useMarketStore((state) => state.fetchMarketIndexes);
  const portfolio = useProfileStore((state) => state.portfolio);
  const portfolioError = useProfileStore((state) => state.portfolioError);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);

  useEffect(() => {
    void Promise.allSettled([refreshOverview(), fetchMarketIndexes(), fetchPortfolio()]);
  }, [fetchMarketIndexes, fetchPortfolio, refreshOverview]);

  const allMarketIndex = useMemo(
    () => marketIndexes.find((index) => index.group === "all") || marketIndexes[0] || null,
    [marketIndexes]
  );
  const reportGroups = useMemo(() => getReportGroups(report), [report]);
  const insights = useMemo(() => buildInsightLines(report, allMarketIndex, portfolio), [allMarketIndex, portfolio, report]);
  const portfolioExposure = useMemo(() => buildPortfolioUnitExposure(portfolio, assets), [assets, portfolio]);
  const topMover = useMemo(() => topAssetBy(assets, (asset) => asset.move_24h_pct), [assets]);
  const topDiscount = useMemo(() => topAssetBy(assets, (asset) => asset.current_premium_pct, "min"), [assets]);
  const topVolume = useMemo(() => topAssetBy(assets, (asset) => asset.volume_24h), [assets]);
  const nextAdjustmentAsset = useMemo(
    () =>
      [...assets]
        .filter((asset) => asset.next_adjustment?.scheduled_at)
        .sort((a, b) => String(a.next_adjustment?.scheduled_at || "").localeCompare(String(b.next_adjustment?.scheduled_at || "")))[0] || null,
    [assets]
  );
  const latestAdjustmentAsset = useMemo(
    () =>
      [...assets]
        .filter((asset) => asset.latest_adjustment?.applied_at || asset.latest_adjustment?.scheduled_at)
        .sort((a, b) =>
          String(b.latest_adjustment?.applied_at || b.latest_adjustment?.scheduled_at || "").localeCompare(
            String(a.latest_adjustment?.applied_at || a.latest_adjustment?.scheduled_at || "")
          )
        )[0] || null,
    [assets]
  );
  const widestBaseGap = useMemo(
    () =>
      [...assets]
        .map((asset) => ({ asset, gap: baseGapPct(asset) }))
        .filter((item): item is { asset: MarketAsset; gap: number } => item.gap !== null)
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0] || null,
    [assets]
  );
  const readyAdjustmentCount = useMemo(() => assets.filter((asset) => asset.adjustment_ready).length, [assets]);
  const totalReportVolume = useMemo(
    () => (report?.top_volume || report?.volume_winners || []).reduce((sum, row) => sum + (row.volume_cash || 0), 0),
    [report]
  );

  return (
    <SiteShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}><FaMagnifyingGlassChart /> Market intelligence</div>
            <h1>Market Report</h1>
            <p>
              The latest settlement report turned into a decision surface: leaders, valuation gaps, flow shifts,
              index context, and your portfolio exposure in one modern NASFAQ desk.
            </p>
          </div>
          <div className={styles.heroVisual} aria-hidden="true" />
          <div className={styles.heroPanel}>
            <div>
              <span><FaRegCalendar /> Report date</span>
              <strong>{report?.market_date || marketStatus?.last_settlement_market_date || "—"}</strong>
              <p>{fmtInteger(report?.asset_count)} settled assets · {marketStatus?.is_trading_open ? "market open" : "market paused"}</p>
            </div>
            <div className={styles.heroMiniStats}>
              <span>{fmtPct(allMarketIndex?.summary?.day_return_pct)} tape</span>
              <span>{fmtInteger(allMarketIndex?.summary?.advancers)} up / {fmtInteger(allMarketIndex?.summary?.decliners)} down</span>
            </div>
          </div>
        </section>

        {error ? <div className="statusMessage statusMessageError">Market data error: {error}</div> : null}
        {portfolioError ? <div className="statusMessage">Portfolio overlay unavailable: {portfolioError}</div> : null}
        {isLoadingOverview || isLoadingIndex ? <div className={styles.loading}>Loading market report…</div> : null}

        <section className={styles.statGrid}>
          <StatCard label="All-market level" value={fmtNumber(allMarketIndex?.summary?.index_value)} meta={`${fmtPct(allMarketIndex?.summary?.day_return_pct)} 1D return`} icon={<FaGaugeHigh />} />
          <StatCard label="Breadth" value={`${fmtInteger(allMarketIndex?.summary?.advancers)} / ${fmtInteger(allMarketIndex?.summary?.decliners)}`} meta={`${fmtInteger(allMarketIndex?.summary?.constituent_count)} constituents`} icon={<FaCircleNodes />} />
          <StatCard label="Top mover" value={topMover?.symbol || "—"} meta={fmtPct(topMover?.move_24h_pct)} icon={<FaArrowTrendUp />} />
          <StatCard label="Report flow" value={fmtNumber(totalReportVolume || topVolume?.volume_24h, totalReportVolume ? "$" : "")} meta={topVolume ? `${topVolume.symbol} leads spot activity` : "Latest settled basket"} icon={<FaMoneyBillTrendUp />} />
        </section>

        <section className={styles.adjustmentBrief}>
          <div>
            <span className={styles.adjustmentEyebrow}><FaSignal /> Scheduled adjustment rhythm</span>
            <h2>Trading stays open between base-rate ticks.</h2>
            <p>
              The report still summarizes settled activity, while live prices can now move at scheduled ticks toward each asset&apos;s base rate.
            </p>
          </div>
          <div className={styles.adjustmentBriefStats}>
            <div>
              <span>Next Tick</span>
              <strong>{nextAdjustmentAsset ? formatIntervalLabel(nextAdjustmentAsset.next_adjustment?.interval_key) : "No scheduled tick"}</strong>
              <em>
                {nextAdjustmentAsset
                  ? formatAdjustmentTime(nextAdjustmentAsset.next_adjustment?.scheduled_at)
                  : "Waiting for generated intervals"}
              </em>
            </div>
            <div>
              <span>Last Tick</span>
              <strong>
                {latestAdjustmentAsset
                  ? `${latestAdjustmentAsset.symbol} ${formatIntervalLabel(latestAdjustmentAsset.latest_adjustment?.interval_key)}`
                  : "No applied tick"}
              </strong>
              <em>
                {latestAdjustmentAsset
                  ? `${fmtPct(adjustmentMovePct(latestAdjustmentAsset))} move at ${formatAdjustmentTime(latestAdjustmentAsset.latest_adjustment?.applied_at)}`
                  : "No adjustment has been applied yet"}
              </em>
            </div>
            <div>
              <span>Ready Assets</span>
              <strong>{fmtInteger(readyAdjustmentCount)} / {fmtInteger(assets.length)}</strong>
              <em>Have base and market prices</em>
            </div>
            <div>
              <span>Widest Gap</span>
              <strong>{widestBaseGap?.asset.symbol || "N/A"}</strong>
              <em>{widestBaseGap ? fmtPct(widestBaseGap.gap) : "N/A"}</em>
            </div>
          </div>
        </section>

        {insights[0] ? (
          <section className={styles.tapeBand}>
            <span>Daily tape</span>
            <p>{insights[0]}</p>
            <Link href="/market" className={styles.panelLink}>Open market desk</Link>
          </section>
        ) : null}

        <section className={styles.commandGrid}>
          <div className={styles.chartPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Index Context</h2>
                <p>All-market trend behind the latest report moves.</p>
              </div>
              <Link href="/indexes" className={styles.panelLink}>Open indexes</Link>
            </div>
            <TrendChartCard title="All Market Index" subtitle={allMarketIndex?.summary?.market_date || "Latest"} series={latestIndexSeries(allMarketIndex)} bare />
          </div>

          <aside className={styles.insightPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Derived Insights</h2>
                <p>Signals calculated from report, index, and portfolio data.</p>
              </div>
            </div>
            <div className={styles.insightList}>
              {insights.length ? insights.map((line) => (
                <div key={line} className={styles.insightItem}>
                  <FaSignal />
                  <p>{line}</p>
                </div>
              )) : <div className={styles.empty}>No report insights are available yet.</div>}
            </div>
          </aside>
        </section>

        <section className={styles.briefingGrid}>
          <article className={styles.briefingLead}>
            <span className={styles.eyebrow}><FaChartLine /> Report read</span>
            <h2>{topMover?.symbol ? `${topMover.symbol} sets the tape.` : "The tape is still forming."}</h2>
            <p>
              {insights[2] || insights[0] || "Once the settlement report fills in, this brief turns the raw table into a quick read on momentum, valuation pressure, and portfolio relevance."}
            </p>
          </article>
          <div className={styles.briefingStack}>
            <article>
              <span>Valuation pressure</span>
              <strong>{topDiscount?.symbol || "—"}</strong>
              <p>{topDiscount ? `${topDiscount.symbol} screens as the deepest live discount at ${fmtPct(topDiscount.current_premium_pct)}.` : "No discount leader is available yet."}</p>
            </article>
            <article>
              <span>Portfolio angle</span>
              <strong className={toneClass(portfolio?.total_unrealized_pnl)}>{portfolio ? fmtNumber(portfolio.total_unrealized_pnl, "$") : "—"}</strong>
              <p>{portfolio ? "Your marked P/L is now part of the report context." : "Sign in to connect this read to your own book."}</p>
            </article>
          </div>
        </section>

        <section className={styles.portfolioGrid}>
          <div className={styles.portfolioPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Your Exposure</h2>
                <p>Portfolio market value by unit, read against current report themes.</p>
              </div>
              <FaWallet className={styles.headerGlyph} />
            </div>
            {portfolio ? (
              <>
                <div className={styles.portfolioStats}>
                  <div><span>Equity</span><strong>{fmtNumber(portfolio.total_equity, "$")}</strong></div>
                  <div><span>Market value</span><strong>{fmtNumber(portfolio.total_market_value, "$")}</strong></div>
                  <div><span>Unrealized P/L</span><strong className={toneClass(portfolio.total_unrealized_pnl)}>{fmtNumber(portfolio.total_unrealized_pnl, "$")}</strong></div>
                </div>
                <div className={styles.exposureBars}>
                  {portfolioExposure.map((item) => (
                    <div key={item.unit} className={styles.exposureRow}>
                      <span>{item.unit}</span>
                      <div className={styles.exposureTrack}><i style={{ width: `${Math.max(4, item.pct * 100)}%` }} /></div>
                      <strong>{fmtPct(item.pct)}</strong>
                    </div>
                  ))}
                </div>
              </>
            ) : <div className={styles.empty}>Sign in to layer portfolio exposure onto the report.</div>}
          </div>

          <div className={styles.portfolioPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Mispricing Radar</h2>
                <p>Spot valuation pressure from live asset data.</p>
              </div>
              <FaLayerGroup className={styles.headerGlyph} />
            </div>
            <div className={styles.radarGrid}>
              <div>
                <span>Deepest discount</span>
                <strong>{topDiscount?.symbol || "—"}</strong>
                <p className={toneClass(topDiscount?.current_premium_pct)}>{fmtPct(topDiscount?.current_premium_pct)}</p>
              </div>
              <div>
                <span>Richest report premium</span>
                <strong>{report?.largest_premiums?.[0]?.symbol || "—"}</strong>
                <p className={toneClass(report?.largest_premiums?.[0]?.premium_pct)}>{fmtPct(report?.largest_premiums?.[0]?.premium_pct)}</p>
              </div>
              <div>
                <span>Flow leader</span>
                <strong>{topVolume?.symbol || report?.top_volume?.[0]?.symbol || "—"}</strong>
                <p>{fmtNumber(topVolume?.volume_24h ?? report?.top_volume?.[0]?.volume_shares)} shares</p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.leaderboardSection}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Report Boards</h2>
              <p>Leaderboards grouped by premium, discount, momentum, volume, and fair-value changes.</p>
            </div>
          </div>
          <div className={styles.reportGrid}>
            {reportGroups.map((group, index) => (
              <ReportList key={group.key} title={group.title} icon={group.icon} rows={group.rows} assets={assets} kind={group.kind} featured={index === 0} />
            ))}
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
