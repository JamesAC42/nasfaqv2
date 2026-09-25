"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { StaffActions } from "@/app/components/predictions/admin/staff-actions";
import { Activity } from "@/app/components/predictions/market/activity";
import { Comments } from "@/app/components/predictions/market/comments";
import { MarketCall, MarketHeader, type Flash, type Talent } from "@/app/components/predictions/market/market-header";
import { YourPosition } from "@/app/components/predictions/market/position";
import { ProbabilityChart, type LiveTick } from "@/app/components/predictions/market/probability-chart";
import { RulesAndResolution } from "@/app/components/predictions/market/resolution";
import { findOutcome, fillToTrade, inkOn, isTradeable, statusOf, useCompact } from "@/app/components/predictions/market/shared";
import { Ticket, type TicketIntent, type TicketTab } from "@/app/components/predictions/market/ticket";
import { PredictionsFrame, useStaff } from "@/app/components/predictions/shell/predictions-frame";
import { fetchMarket, fetchTrades } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { cents, leader, outcomeColor, percent } from "@/app/lib/predictions/format";
import type { Fill, PredictionMarketDetail, Trade } from "@/app/lib/predictions/types";
import { usePredictionFeed } from "@/app/lib/predictions/use-prediction-feed";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/predictions/market/market.module.scss";

const byPrice = (market: PredictionMarketDetail) => [...market.outcomes].sort((a, b) => b.price - a.price).map((outcome) => outcome.outcome_code);

function patchPrices(market: PredictionMarketDetail, fill: Fill): PredictionMarketDetail {
  const prices = new Map(fill.prices.map((entry) => [entry.outcome_code, entry.price]));
  return {
    ...market,
    outcomes: market.outcomes.map((outcome) => (prices.has(outcome.outcome_code) ? { ...outcome, price: prices.get(outcome.outcome_code) as number } : outcome)),
    total_volume_cash: market.total_volume_cash + fill.cash,
    volume_24h: market.volume_24h + fill.cash,
    last_trade_at: fill.at,
  };
}

/** /predictions/[slug]: where people trade one market. */
export function MarketPage({ slug }: { slug: string }) {
  const search = useSearchParams();
  const wanted = search.get("outcome");
  const { isStaff } = useStaff();
  const compact = useCompact();
  const assets = useMarketStore((state) => state.assets);

  const [market, setMarket] = useState<PredictionMarketDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [flash, setFlash] = useState<Flash>({});
  const [live, setLive] = useState<LiveTick | null>(null);
  const [intent, setIntent] = useState<TicketIntent | null>(null);
  const [sheet, setSheet] = useState(false);
  const [order, setOrder] = useState<string[]>([]);

  const marketRef = useRef<PredictionMarketDetail | null>(null);
  useEffect(() => {
    marketRef.current = market;
  });

  const seq = useRef(0);
  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const { market: next } = await fetchMarket(slug);
      if (mine !== seq.current) return;
      setMarket(next);
      setOrder(byPrice(next));
      setLoadError(null);
    } catch (reason) {
      if (mine !== seq.current) return;
      setLoadError(predictionErrorText(reason));
    }
  }, [slug]);

  // Many socket events can land at once (a sweep fills several orders); refetch once.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(
    (delay = 600) => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        void refetch();
      }, delay);
    },
    [refetch],
  );

  useEffect(() => {
    let alive = true;
    const mine = ++seq.current;
    fetchMarket(slug)
      .then(({ market: next }) => {
        if (!alive || mine !== seq.current) return;
        setMarket(next);
        setOrder(byPrice(next));
        setLoadError(null);
        // A ?outcome= link means "open the ticket on that": on phones that's the sheet.
        if (wanted && isTradeable(next) && window.matchMedia("(max-width: 1020px)").matches) setSheet(true);
      })
      .catch((reason) => alive && setLoadError(predictionErrorText(reason)));
    fetchTrades(slug, 40)
      .then((result) => alive && setTrades(result.trades))
      .catch(() => alive && setTrades([]));
    return () => {
      alive = false;
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
    // Only on a new slug; ?outcome= is read once.
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const flashN = useRef(0);
  usePredictionFeed((message) => {
    if (message.type === "prediction.trade" && message.slug === slug) {
      const fill = message.trade;
      const before = marketRef.current;
      if (before) {
        const moved: Flash = {};
        for (const entry of fill.prices) {
          const previous = before.outcomes.find((outcome) => outcome.outcome_code === entry.outcome_code)?.price;
          if (previous === undefined || Math.abs(entry.price - previous) < 0.0005) continue;
          flashN.current += 1;
          moved[entry.outcome_code] = { dir: entry.price > previous ? "up" : "down", n: flashN.current };
        }
        setFlash((current) => ({ ...current, ...moved }));
        // A resting order of mine filled: my position and orders changed.
        if (fill.limit_order_id && before.mine?.orders.some((entry) => entry.id === fill.limit_order_id)) scheduleRefetch();
      }
      setMarket((current) => (current ? patchPrices(current, fill) : current));
      setTrades((current) => [fillToTrade(fill), ...(current ?? [])].slice(0, 60));
      setLive({ at: fill.at, prices: fill.prices, n: (flashN.current += 1) });
    } else if (message.type === "prediction.market.updated" && message.slug === slug) {
      scheduleRefetch(200);
    }
  });

  // The tab shows the live price.
  useEffect(() => {
    if (!market) return;
    const top = market.market_type === "binary" ? market.outcomes.find((outcome) => outcome.outcome_code === "yes") : leader(market.outcomes);
    document.title = `${top ? `${percent(top.price)} ` : ""}${market.title} · NASFAQ`;
  }, [market]);

  // Sheet: Escape closes, the page behind doesn't scroll.
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setSheet(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  if (!market) {
    return (
      <PredictionsFrame kicker="Predictions" title="Market" bare>
        {loadError ? (
          <div className={styles.missing}>
            <p>{loadError}</p>
            <Link href="/predictions">Back to the floor</Link>
          </div>
        ) : (
          <div className={styles.loading} aria-busy="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </PredictionsFrame>
    );
  }

  const defaultOutcome = findOutcome(market.outcomes, wanted)?.outcome_code ?? (market.market_type === "binary" ? "yes" : (leader(market.outcomes)?.outcome_code ?? market.outcomes[0].outcome_code));
  const activeIntent: TicketIntent = intent ?? { outcome: defaultOutcome, tab: "buy", n: 0 };
  const aim = (outcome: string, tab: TicketTab, sellAll = false) => {
    setIntent({ outcome, tab, sellAll, n: (intent?.n ?? 0) + 1 });
    if (compact) setSheet(true);
    else document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const symbol = typeof market.auto_data?.symbol === "string" ? market.auto_data.symbol : null;
  const asset = symbol ? assets.find((entry) => entry.symbol === symbol) : null;
  const talent: Talent = symbol ? { symbol, icon: asset?.icon ?? null, color: asset?.color ?? null, name: asset?.display_name ?? null } : null;
  const tradeable = isTradeable(market);
  const ticket = <Ticket key={activeIntent.n} market={market} intent={activeIntent} onTraded={() => void refetch()} />;

  return (
    <PredictionsFrame kicker="Predictions" title={market.title} bare>
      <div className={styles.page}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link href="/predictions">Floor</Link>
          <span aria-hidden="true">/</span>
          <span>{market.kind === "auto" ? "Auto" : (market.category?.display_name ?? "Event")}</span>
        </nav>
        <div className={styles.layout}>
          <div className={styles.main}>
            <MarketHeader market={market} talent={talent} />
            <MarketCall market={market} order={order} flash={flash} onBuy={(code) => aim(code, "buy")} />
            <ProbabilityChart key={market.id} market={market} live={live} />
            {isStaff ? <StaffActions market={market} onChanged={() => void refetch()} /> : null}
            <YourPosition market={market} onSell={(code) => aim(code, "sell", true)} onChanged={() => void refetch()} />
            <RulesAndResolution market={market} onChanged={() => void refetch()} />
            <Activity market={market} trades={trades} />
            <Comments market={market} />
          </div>
          {!compact ? (
            <aside className={styles.aside} id="ticket" aria-label="Trade">
              <div className={styles.sticky}>{ticket}</div>
            </aside>
          ) : null}
        </div>
      </div>

      {compact ? <MobileBar market={market} tradeable={tradeable} onOpen={(code) => aim(code, "buy")} onOpenClosed={() => setSheet(true)} /> : null}

      {compact && sheet ? (
        <div className={styles.scrim} onClick={() => setSheet(false)}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Trade" onClick={(event) => event.stopPropagation()}>
            <div className={styles.sheetHead}>
              <span>{market.title}</span>
              <button type="button" onClick={() => setSheet(false)} aria-label="Close ticket">
                ✕
              </button>
            </div>
            {ticket}
          </div>
        </div>
      ) : null}
    </PredictionsFrame>
  );
}

function MobileBar({ market, tradeable, onOpen, onOpenClosed }: { market: PredictionMarketDetail; tradeable: boolean; onOpen: (code: string) => void; onOpenClosed: () => void }) {
  const status = statusOf(market);
  if (!tradeable) {
    const winner = market.outcomes.find((outcome) => outcome.is_winner);
    return (
      <div className={styles.mobileBar} data-closed="true">
        <span className={styles.mobileStatus} data-tone={status.tone}>
          {status.label}
          {winner ? <b style={{ color: outcomeColor(market, winner) }}>{winner.label}</b> : null}
        </span>
        <button type="button" className={styles.mobileMore} onClick={onOpenClosed}>
          Details
        </button>
      </div>
    );
  }
  if (market.market_type === "binary") {
    return (
      <div className={styles.mobileBar}>
        {market.outcomes.map((outcome) => {
          const color = outcomeColor(market, outcome);
          return (
            <button key={outcome.outcome_code} type="button" className={styles.mobileBuy} style={{ "--oc": color, "--oc-ink": inkOn(color) } as CSSProperties} onClick={() => onOpen(outcome.outcome_code)}>
              <span>Buy {outcome.label}</span>
              <b>{cents(outcome.price)}</b>
            </button>
          );
        })}
      </div>
    );
  }
  const top = leader(market.outcomes);
  const color = top ? outcomeColor(market, top) : "var(--blue)";
  return (
    <div className={styles.mobileBar}>
      <span className={styles.mobileLeader} style={{ "--oc": color } as CSSProperties}>
        <small>Leading</small>
        <b>
          {top?.label} {percent(top?.price)}
        </b>
      </span>
      <button type="button" className={styles.mobileTrade} onClick={() => top && onOpen(top.outcome_code)}>
        Trade
      </button>
    </div>
  );
}
