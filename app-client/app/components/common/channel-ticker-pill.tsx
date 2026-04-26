"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FaArrowTrendDown, FaArrowTrendUp, FaXmark } from "react-icons/fa6";
import { CandleChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { apiFetch } from "@/app/lib/api";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { normalizeCandles, normalizeTrades } from "@/app/lib/normalizers";
import { computeDailyPriceChangePct } from "@/app/lib/market-metrics";
import type { CandlePoint, NewsCharacter, TradeRow } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/common/channel-ticker-pill.module.scss";

type TickerGlanceData = {
  intradayCandles: CandlePoint[];
  dailyCandles: CandlePoint[];
  trades: TradeRow[];
};

const tickerGlanceCache = new Map<string, TickerGlanceData>();
const tickerGlanceInflight = new Map<string, Promise<TickerGlanceData>>();

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function formatSignedPct(value: number | null) {
  if (value === null) return fmtPct(value);
  return value > 0 ? `+${fmtPct(value)}` : fmtPct(value);
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${fmtInteger(count)} ${count === 1 ? singular : plural}`;
}

async function loadTickerGlance(symbol: string) {
  const cacheKey = symbol.trim().toUpperCase();
  const cached = tickerGlanceCache.get(cacheKey);
  if (cached) return cached;

  const existing = tickerGlanceInflight.get(cacheKey);
  if (existing) return existing;

  const request = Promise.all([
    apiFetch<{ candles: Array<Record<string, unknown>> }>(`/api/market/assets/${cacheKey}/candles?interval=1h&range=24h`),
    apiFetch<{ candles: Array<Record<string, unknown>> }>(`/api/market/assets/${cacheKey}/candles?interval=1d&range=1y`),
    apiFetch<{ trades: Array<Record<string, unknown>> }>(`/api/market/assets/${cacheKey}/trades?limit=200`),
  ])
    .then(([intradayResult, dailyResult, tradesResult]) => {
      const nextData = {
        intradayCandles: normalizeCandles(intradayResult.candles),
        dailyCandles: normalizeCandles(dailyResult.candles),
        trades: normalizeTrades(tradesResult.trades),
      };
      tickerGlanceCache.set(cacheKey, nextData);
      return nextData;
    })
    .finally(() => {
      tickerGlanceInflight.delete(cacheKey);
    });

  tickerGlanceInflight.set(cacheKey, request);
  return request;
}

export function ChannelTickerPill({
  channel,
  onClick,
  tone = "default",
  className,
  disableLink = false,
  enablePopover = false,
  compact = false,
}: {
  channel: NewsCharacter;
  onClick?: () => void;
  tone?: "default" | "warning";
  className?: string;
  disableLink?: boolean;
  enablePopover?: boolean;
  compact?: boolean;
}) {
  const assets = useMarketStore((state) => state.assets);
  const normalizedChannelName = normalizeName(channel.name);
  const normalizedChannelId = channel.youtube_channel_id ? normalizeName(channel.youtube_channel_id) : null;
  const normalizedChannelSymbol = channel.symbol ? normalizeName(channel.symbol) : null;
  const asset = assets.find((item) => (
    (normalizedChannelId !== null && normalizeName(item.youtube_channel_id) === normalizedChannelId)
    || (normalizedChannelSymbol !== null && normalizeName(item.symbol) === normalizedChannelSymbol)
    || normalizeName(item.display_name) === normalizedChannelName
    || normalizeName(item.symbol) === normalizedChannelName
  ));
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [glanceData, setGlanceData] = useState<TickerGlanceData | null>(null);
  const [glanceError, setGlanceError] = useState<string | null>(null);
  const [isLoadingGlance, setIsLoadingGlance] = useState(false);
  const [glanceReferenceTime, setGlanceReferenceTime] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const loadRequestIdRef = useRef(0);
  const changePct = asset ? computeDailyPriceChangePct(asset.current_mid_price, asset.sparkline_candles) : null;
  const label = asset?.symbol || channel.name;
  const changeClassName = changePct === null
    ? styles.change
    : `${styles.change} ${changePct >= 0 ? styles.changeUp : styles.changeDown}`;
  const TrendIcon = changePct === null ? null : changePct >= 0 ? FaArrowTrendUp : FaArrowTrendDown;
  const href = asset ? `/stocks/${encodeURIComponent(asset.symbol)}` : null;
  const pillClassName = [styles.pill, tone === "warning" ? styles.warning : "", compact ? styles.pillCompact : "", className].filter(Boolean).join(" ");
  const pillStyle = (tone === "warning"
    ? {
        "--ticker-pill-accent": "var(--warning)",
        "--ticker-pill-accent-soft": "var(--warning-soft)",
      }
    : undefined) as CSSProperties | undefined;
  const lastHourSummary = useMemo(() => {
    if (!glanceData || glanceReferenceTime === null) return { boughtShares: 0, soldShares: 0 };
    const cutoff = glanceReferenceTime - (60 * 60 * 1000);
    return glanceData.trades.reduce((acc, trade) => {
      const tradeTime = new Date(trade.ts).getTime();
      if (!Number.isFinite(tradeTime) || tradeTime < cutoff) return acc;
      const quantity = Number.isFinite(trade.quantity) ? trade.quantity : 0;
      const side = String(trade.side || "").toLowerCase();
      if (side === "buy") acc.boughtShares += quantity;
      if (side === "sell") acc.soldShares += quantity;
      return acc;
    }, { boughtShares: 0, soldShares: 0 });
  }, [glanceData, glanceReferenceTime]);
  const recentDailyCandles = useMemo(() => {
    if (!glanceData?.dailyCandles.length) return [];
    const latestBucket = glanceData.dailyCandles[glanceData.dailyCandles.length - 1]?.bucket;
    const latestTime = latestBucket ? new Date(latestBucket).getTime() : Number.NaN;
    if (!Number.isFinite(latestTime)) {
      return glanceData.dailyCandles.slice(-92);
    }
    const cutoff = latestTime - (92 * 24 * 60 * 60 * 1000);
    return glanceData.dailyCandles.filter((candle) => {
      const candleTime = new Date(candle.bucket).getTime();
      return Number.isFinite(candleTime) && candleTime >= cutoff;
    });
  }, [glanceData?.dailyCandles]);

  useEffect(() => {
    if (!isPopoverOpen) return undefined;
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsPopoverOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPopoverOpen(false);
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPopoverOpen]);

  async function openPopover() {
    if (!asset?.symbol) return;
    setIsPopoverOpen(true);
    setGlanceReferenceTime(Date.now());

    if (glanceData) return;

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setIsLoadingGlance(true);
    setGlanceError(null);
    try {
      const result = await loadTickerGlance(asset.symbol);
      if (loadRequestIdRef.current !== requestId) return;
      setGlanceData(result);
      setGlanceReferenceTime(Date.now());
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) return;
      setGlanceError(String((error as Error).message || error));
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setIsLoadingGlance(false);
      }
    }
  }

  const content = (
    <span className={pillClassName} style={pillStyle}>
      <AssetCoin
        symbol={label}
        icon={asset?.icon ?? channel.icon ?? null}
        color={asset?.color ?? null}
        className={styles.iconCoin}
        shape="circle"
      />
      <span className={styles.symbol}>{label}</span>
      <span className={changeClassName}>
        <span>{formatSignedPct(changePct)}</span>
        {TrendIcon ? <TrendIcon className={styles.trendIcon} aria-hidden="true" /> : null}
      </span>
    </span>
  );

  if (enablePopover && asset && href) {
    return (
      <span className={styles.popoverWrap} ref={wrapperRef}>
        <button
          type="button"
          className={styles.triggerButton}
          onClick={() => {
            onClick?.();
            if (isPopoverOpen) {
              setIsPopoverOpen(false);
              return;
            }
            void openPopover();
          }}
          aria-expanded={isPopoverOpen}
          aria-haspopup="dialog"
        >
          {content}
        </button>
        {isPopoverOpen ? (
          <div className={styles.popoverPanel} role="dialog" aria-label={`${asset.symbol} market snapshot`}>
            <div className={styles.popoverHeader}>
              <div className={styles.popoverHeaderMain}>
                <AssetCoin
                  symbol={asset.symbol}
                  icon={asset.icon}
                  color={asset.color}
                  className={styles.popoverCoin}
                  shape="circle"
                />
                <div className={styles.popoverTitleBlock}>
                  <strong>{asset.symbol}</strong>
                  <span>{asset.display_name}</span>
                </div>
                <div className={styles.popoverActions}>
                  <Link href={href} className={styles.openButton}>
                    Open stock page
                  </Link>
                </div>
              </div>

              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setIsPopoverOpen(false)}
                aria-label="Close asset snapshot"
              >
                <FaXmark aria-hidden="true" />
              </button>
            </div>

            <div className={styles.statGrid}>
              <div className={styles.statCard}>
                <span>Mid price</span>
                <strong>{fmtNumber(asset.current_mid_price, "$")}</strong>
              </div>
              <div className={styles.statCard}>
                <span>24H volume</span>
                <strong>{formatCountLabel(Number(asset.volume_24h || 0), "share")}</strong>
              </div>
              <div className={styles.statCard}>
                <span>Bought in 1H</span>
                <strong>{formatCountLabel(lastHourSummary.boughtShares, "share")}</strong>
              </div>
              <div className={styles.statCard}>
                <span>Sold in 1H</span>
                <strong>{formatCountLabel(lastHourSummary.soldShares, "share")}</strong>
              </div>
            </div>

            <div className={styles.chartSurface}>
              {isLoadingGlance ? (
                <div className={styles.glanceEmpty}>Loading market snapshot…</div>
              ) : glanceError ? (
                <div className={styles.glanceEmpty}>Snapshot unavailable: {glanceError}</div>
              ) : (
                <>
                  {glanceData?.intradayCandles.length ? (
                    <CandleChartCard
                      title="24H Market"
                      candles={glanceData.intradayCandles}
                      height={136}
                      showSubtitle={false}
                      compact
                    />
                  ) : (
                    <div className={styles.glanceEmpty}>No 24H candle data</div>
                  )}
                  {recentDailyCandles.length ? (
                    <CandleChartCard
                      title="3M Daily Price"
                      candles={recentDailyCandles}
                      chartType="line"
                      height={136}
                      showSubtitle={false}
                      compact
                    />
                  ) : (
                    <div className={styles.glanceEmpty}>No 3M price history</div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : null}
      </span>
    );
  }

  if (!href || disableLink) return content;

  return (
    <Link href={href} className={styles.link} onClick={onClick}>
      {content}
    </Link>
  );
}
