"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  FaSignal,
  FaWallet,
} from "react-icons/fa6";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { normalizeMarketAdjustmentSummary } from "@/app/lib/normalizers";
import type { DailyReport, MarketAdjustmentOutcome, MarketAdjustmentSummary, MarketAsset, MarketIndexBundle, PortfolioSummary, ReportRow } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/pages/market-report-page.module.scss";
import bijou from "@/public/bijou.png";
import scaredOkayu from "@/public/scaredokayu.png";
import shionSide from "@/public/shionside.png";

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

function rowMetric(row: ReportRow, kind: "move" | "volume") {
  if (kind === "move") return row.move_pct;
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

function formatAdjustmentTimeEt(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatReportDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = parsed.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${parsed.toLocaleString(undefined, { month: "long" })} ${day}${suffix}, ${parsed.getFullYear()}`;
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
    { key: "winners", title: "Breakouts", icon: <FaArrowTrendUp />, rows: report.biggest_winners || [], kind: "move" as const },
    { key: "losers", title: "Drawdowns", icon: <FaChartLine />, rows: report.biggest_losers || [], kind: "move" as const },
    { key: "volume", title: "Flow Acceleration", icon: <FaMoneyBillTrendUp />, rows: report.volume_winners || report.top_volume || [], kind: "volume" as const },
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
  const winner = report?.biggest_winners?.[0];
  const loser = report?.biggest_losers?.[0];
  const breadth = allMarketIndex?.summary;
  const netPnl = portfolio?.total_unrealized_pnl ?? null;

  return [
    winner && loser ? `Momentum dispersion is wide: ${winner.symbol} leads at ${fmtPct(winner.move_pct)} while ${loser.symbol} trails at ${fmtPct(loser.move_pct)}.` : null,
    breadth ? `Breadth is ${fmtInteger(breadth.advancers)} advancers against ${fmtInteger(breadth.decliners)} decliners across ${fmtInteger(breadth.constituent_count)} constituents.` : null,
    netPnl !== null ? `Your marked portfolio P/L is ${fmtNumber(netPnl, "$")}, so today's report can be read against your current exposure.` : null,
  ].filter((line): line is string => Boolean(line));
}

function StatCard({ label, value, meta, icon }: { label: string; value: ReactNode; meta: string; icon: ReactNode }) {
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
  kind: "move" | "volume";
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

function AdjustmentOutcomeRow({
  item,
  metric,
  index,
}: {
  item: MarketAdjustmentOutcome;
  metric: "move" | "compression";
  index: number;
}) {
  const value = metric === "compression" ? item.gap_compression_pct : item.move_pct;
  return (
    <Link href={`/stocks/${encodeURIComponent(item.symbol)}`} className={styles.adjustmentBoardRow}>
      <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
      <AssetCoin symbol={item.symbol} icon={item.icon ?? null} color={item.color ?? null} className={styles.assetIcon} />
      <span className={styles.assetCopy}>
        <strong>{item.symbol}</strong>
        <em>{formatIntervalLabel(item.interval_key)} · {formatAdjustmentTimeEt(item.applied_at)}</em>
      </span>
      <strong className={toneClass(value)}>{fmtPct(value)}</strong>
    </Link>
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
  const [adjustmentSummary, setAdjustmentSummary] = useState<MarketAdjustmentSummary | null>(null);
  const [adjustmentSummaryError, setAdjustmentSummaryError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.allSettled([refreshOverview(), fetchMarketIndexes(), fetchPortfolio()]);
  }, [fetchMarketIndexes, fetchPortfolio, refreshOverview]);

  useEffect(() => {
    let cancelled = false;
    async function loadAdjustmentSummary() {
      try {
        const result = await apiFetch<Record<string, unknown>>("/api/market/adjustments/summary?recent_limit=12", { cache: "no-store" });
        if (!cancelled) {
          setAdjustmentSummary(normalizeMarketAdjustmentSummary(result));
          setAdjustmentSummaryError(null);
        }
      } catch (nextError) {
        if (!cancelled) setAdjustmentSummaryError(String((nextError as Error).message || nextError));
      }
    }
    void loadAdjustmentSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  const allMarketIndex = useMemo(
    () => marketIndexes.find((index) => index.group === "all") || marketIndexes[0] || null,
    [marketIndexes]
  );
  const reportGroups = useMemo(() => getReportGroups(report), [report]);
  const insights = useMemo(() => buildInsightLines(report, allMarketIndex, portfolio), [allMarketIndex, portfolio, report]);
  const portfolioExposure = useMemo(() => buildPortfolioUnitExposure(portfolio, assets), [assets, portfolio]);
  const topMover = useMemo(() => topAssetBy(assets, (asset) => asset.move_24h_pct), [assets]);
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
  const readyAdjustmentCount = useMemo(() => assets.filter((asset) => asset.adjustment_ready).length, [assets]);
  const nextTick = adjustmentSummary?.next_tick || null;
  const lastTick = adjustmentSummary?.last_tick || null;
  const totalReportVolume = useMemo(
    () => (report?.top_volume || report?.volume_winners || []).reduce((sum, row) => sum + (row.volume_cash || 0), 0),
    [report]
  );
  const reportFlowLeader = report?.top_volume?.[0] || null;
  const reportFlowAsset = reportFlowLeader ? findAsset(assets, reportFlowLeader.symbol) : null;
  const largestTickMovesUp = useMemo(
    () =>
      (adjustmentSummary?.leaderboards.movers || [])
        .filter((item) => (item.move_pct ?? 0) > 0)
        .sort((left, right) => (right.move_pct ?? 0) - (left.move_pct ?? 0))
        .slice(0, 5),
    [adjustmentSummary]
  );
  const largestTickMovesDown = useMemo(
    () =>
      (adjustmentSummary?.leaderboards.movers || [])
        .filter((item) => (item.move_pct ?? 0) < 0)
        .sort((left, right) => (left.move_pct ?? 0) - (right.move_pct ?? 0))
        .slice(0, 5),
    [adjustmentSummary]
  );

  return (
    <SiteShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}><FaMagnifyingGlassChart /> Market intelligence</div>
            <h1>Market Report</h1>
            <p>Daily tape, valuation gaps, flow, and portfolio context.</p>
          </div>
          <div className={styles.heroVisual} aria-hidden="true" />
          <div className={styles.heroPanel}>
            <div>
              <span><FaRegCalendar /> Report date</span>
              <strong>{formatReportDate(report?.market_date || marketStatus?.last_settlement_market_date)}</strong>
              <p>{fmtInteger(report?.asset_count)} settled assets · {marketStatus?.is_trading_open ? "market open" : "market paused"}</p>
            </div>
            <div className={styles.heroMiniStats}>
              <span>{fmtPct(allMarketIndex?.summary?.day_return_pct)} tape</span>
              <span>{fmtInteger(allMarketIndex?.summary?.advancers)} up / {fmtInteger(allMarketIndex?.summary?.decliners)} down</span>
            </div>
          </div>
        </section>

        {error ? <div className="statusMessage statusMessageError">Market data error: {error}</div> : null}
        {adjustmentSummaryError ? <div className="statusMessage">Adjustment overlay unavailable: {adjustmentSummaryError}</div> : null}
        {portfolioError ? <div className="statusMessage">Portfolio overlay unavailable: {portfolioError}</div> : null}
        {isLoadingOverview || isLoadingIndex ? <div className={styles.loading}>Loading market report…</div> : null}

        <section className={styles.statGrid}>
          <StatCard label="All-market level" value={fmtNumber(allMarketIndex?.summary?.index_value)} meta={`${fmtPct(allMarketIndex?.summary?.day_return_pct)} 1D return`} icon={<FaGaugeHigh />} />
          <StatCard label="Breadth" value={`${fmtInteger(allMarketIndex?.summary?.advancers)} / ${fmtInteger(allMarketIndex?.summary?.decliners)}`} meta={`${fmtInteger(allMarketIndex?.summary?.constituent_count)} constituents`} icon={<FaCircleNodes />} />
          <StatCard
            label="Top mover"
            value={topMover ? (
              <span className={styles.statAssetValue}>
                <AssetCoin symbol={topMover.symbol} icon={topMover.icon ?? null} color={topMover.color ?? null} className={styles.statAssetIcon} shape="circle" />
                <span>{topMover.symbol}</span>
              </span>
            ) : "—"}
            meta={fmtPct(topMover?.move_24h_pct)}
            icon={<FaArrowTrendUp />}
          />
          <StatCard label="Report flow" value={fmtNumber(totalReportVolume || topVolume?.volume_24h, totalReportVolume ? "$" : "")} meta={topVolume ? `${topVolume.symbol} leads spot activity` : "Latest settled basket"} icon={<FaMoneyBillTrendUp />} />
        </section>

        <section className={styles.adjustmentBrief}>
          <div>
            <span className={styles.adjustmentEyebrow}><FaSignal /> Scheduled adjustment rhythm</span>
            <h2>The next price pulse is on deck.</h2>
            <p>
              Coins keep trading between pulses. When the next one lands, prices can jump and the day&apos;s leaders can reshuffle fast.
            </p>
          </div>
          <div className={styles.adjustmentBriefStats}>
            <div>
              <span>Next Tick</span>
              <strong>{nextTick ? formatIntervalLabel(nextTick.interval_key) : nextAdjustmentAsset ? formatIntervalLabel(nextAdjustmentAsset.next_adjustment?.interval_key) : "No scheduled tick"}</strong>
              <em>
                {nextTick
                  ? `${formatAdjustmentTimeEt(nextTick.scheduled_at)} · ${fmtInteger(nextTick.asset_count)} assets`
                  : nextAdjustmentAsset
                  ? formatAdjustmentTime(nextAdjustmentAsset.next_adjustment?.scheduled_at)
                  : "Waiting for generated intervals"}
              </em>
            </div>
            <div>
              <span>Last Tick</span>
              <strong>
                {lastTick
                  ? `${formatIntervalLabel(lastTick.interval_key)} recap`
                  : latestAdjustmentAsset
                  ? `${latestAdjustmentAsset.symbol} ${formatIntervalLabel(latestAdjustmentAsset.latest_adjustment?.interval_key)}`
                  : "No applied tick"}
              </strong>
              <em>
                {lastTick
                  ? `${fmtInteger(lastTick.applied_count)} applied · ${fmtPct(lastTick.avg_abs_move_pct)} avg move`
                  : latestAdjustmentAsset
                  ? `${fmtPct(adjustmentMovePct(latestAdjustmentAsset))} move at ${formatAdjustmentTime(latestAdjustmentAsset.latest_adjustment?.applied_at)}`
                  : "No adjustment has been applied yet"}
              </em>
            </div>
            <div>
              <span>Ready Assets</span>
              <strong>{fmtInteger(readyAdjustmentCount)} / {fmtInteger(assets.length)}</strong>
              <em>Have market data</em>
            </div>
          </div>
        </section>

        <section className={styles.tickStatement}>
          <FaSignal />
          <p>
            {nextTick
              ? `Next market adjustment tick is ${formatIntervalLabel(nextTick.interval_key)} on ${formatAdjustmentTimeEt(nextTick.scheduled_at)} for ${fmtInteger(nextTick.asset_count)} scheduled assets.`
              : "No upcoming adjustment tick is currently scheduled."}
            {" "}
            {lastTick
              ? `Last tick was ${formatIntervalLabel(lastTick.interval_key)} on ${formatAdjustmentTimeEt(lastTick.applied_at)} with ${fmtInteger(lastTick.applied_count)} applied intervals and ${fmtInteger(lastTick.skipped_count)} skips.`
              : "No completed tick has been recorded yet."}
          </p>
        </section>

        {adjustmentSummary ? (
          <section className={styles.adjustmentIntelligence}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Adjustment Outcomes</h2>
                <p>Recent tick summaries and rankings.</p>
              </div>
            </div>
            <div className={styles.tickRecapGrid}>
              {adjustmentSummary.recaps.slice(0, 3).map((recap) => (
                <article key={`${recap.session_id}-${recap.interval_key}-${recap.applied_at}`} className={styles.tickRecapCard}>
                  <span>{formatIntervalLabel(recap.interval_key)} · {new Date(recap.market_date).toLocaleDateString()}</span>
                  <strong>{fmtInteger(recap.applied_count)} applied</strong>
                  <p>{fmtPct(recap.avg_abs_move_pct)} avg move · {fmtPct(recap.avg_gap_compression_pct)} gap compression · {fmtInteger(recap.skipped_count)} skipped</p>
                </article>
              ))}
            </div>
            <div className={styles.adjustmentBoardGrid}>
              <section className={styles.adjustmentBoard}>
                <h3>Largest Moves Up</h3>
                <div className={styles.adjustmentBoardRows}>
                  {largestTickMovesUp.map((item, index) => (
                    <AdjustmentOutcomeRow key={`${item.symbol}-${item.applied_at}-up`} item={item} metric="move" index={index} />
                  ))}
                  {!largestTickMovesUp.length ? <div className={styles.empty}>No upward tick moves yet.</div> : null}
                </div>
              </section>
              <section className={styles.adjustmentBoard}>
                <h3>Largest Moves Down</h3>
                <div className={styles.adjustmentBoardRows}>
                  {largestTickMovesDown.map((item, index) => (
                    <AdjustmentOutcomeRow key={`${item.symbol}-${item.applied_at}-down`} item={item} metric="move" index={index} />
                  ))}
                  {!largestTickMovesDown.length ? <div className={styles.empty}>No downward tick moves yet.</div> : null}
                </div>
              </section>
              <section className={styles.adjustmentBoard}>
                <h3>Gap Compression</h3>
                <div className={styles.adjustmentBoardRows}>
                  {adjustmentSummary.leaderboards.gap_compression.slice(0, 5).map((item, index) => (
                    <AdjustmentOutcomeRow key={`${item.symbol}-${item.applied_at}-compression`} item={item} metric="compression" index={index} />
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {insights[0] ? (
          <section className={styles.tapeBand}>
            <span>Daily tape</span>
            <p>{insights[0]}</p>
            <Link href="/stocks" className={styles.panelLink}>Open market desk</Link>
          </section>
        ) : null}

        <section className={styles.commandGrid}>
          <div className={styles.indexSideMascot} aria-hidden="true">
            <Image src={shionSide} alt="" width={300} height={420} />
          </div>

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
            <h2>
              {topMover ? (
                <span className={styles.briefingHeadline}>
                  <AssetCoin symbol={topMover.symbol} icon={topMover.icon ?? null} color={topMover.color ?? null} className={styles.briefingCoin} shape="circle" />
                  <span><strong>{topMover.symbol}</strong> sets the tape.</span>
                </span>
              ) : "The tape is still forming."}
            </h2>
            <p>
              {insights[2] || insights[0] || "Once the settlement report fills in, this brief turns the raw table into a quick read on momentum, valuation pressure, and portfolio relevance."}
            </p>
          </article>
          <div className={styles.briefingStack}>
            <article>
              <span>Portfolio angle</span>
              <strong className={toneClass(portfolio?.total_unrealized_pnl)}>
                <span className={styles.portfolioAngleValue}>
                  <span>{portfolio ? fmtNumber(Math.abs(portfolio.total_unrealized_pnl), "$") : "-"}</span>
                  {portfolio ? (portfolio.total_unrealized_pnl >= 0 ? <FaArrowTrendUp aria-hidden="true" /> : <FaArrowTrendDown aria-hidden="true" />) : null}
                </span>
              </strong>
              <p>{portfolio ? "Your marked P/L is now part of the report context." : "Sign in to connect this read to your own book."}</p>
            </article>
          </div>
        </section>

        <section className={styles.portfolioGrid}>
          <div className={styles.portfolioPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Your Exposure</h2>
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
                <h2>Activity Radar</h2>
              </div>
              <FaLayerGroup className={styles.headerGlyph} />
            </div>
            <div className={styles.radarGrid}>
              <div>
                <span>Flow leader</span>
                <strong>
                  {topVolume ? (
                    <span className={styles.radarAssetValue}>
                      <AssetCoin symbol={topVolume.symbol} icon={topVolume.icon ?? null} color={topVolume.color ?? null} className={styles.radarCoin} shape="circle" />
                      <span>{topVolume.symbol}</span>
                    </span>
                  ) : reportFlowLeader ? (
                    <span className={styles.radarAssetValue}>
                      <AssetCoin symbol={reportFlowLeader.symbol} icon={reportFlowAsset?.icon ?? null} color={reportFlowAsset?.color ?? null} className={styles.radarCoin} shape="circle" />
                      <span>{reportFlowLeader.symbol}</span>
                    </span>
                  ) : "—"}
                </strong>
                <p>{fmtNumber(topVolume?.volume_24h ?? reportFlowLeader?.volume_shares)} shares</p>
              </div>
            </div>
          </div>

          <div className={styles.portfolioMascotColumn} aria-hidden="true">
            <Image src={scaredOkayu} alt="" width={260} height={360} />
          </div>
        </section>

        <section className={styles.leaderboardSection}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Report Boards</h2>
              <p>Leaderboards grouped by momentum and volume.</p>
            </div>
          </div>
          <div className={styles.reportGrid}>
            {reportGroups.flatMap((group, index) => {
              const board = <ReportList key={group.key} title={group.title} icon={group.icon} rows={group.rows} assets={assets} kind={group.kind} featured={index === 0} />;
              if (index !== 0) return [board];
              return [
                board,
                <div key="bijou-report-mascot" className={styles.reportMascotColumn} aria-hidden="true">
                  <Image src={bijou} alt="" width={252} height={252} />
                </div>,
              ];
            })}
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
