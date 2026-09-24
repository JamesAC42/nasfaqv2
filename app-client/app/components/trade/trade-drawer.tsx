"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { n2, TradeTicket } from "@/app/components/trade/trade-ticket";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, toneOf } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/trade/trade-drawer.module.scss";

/** The trade ticket as a side drawer (bottom sheet on phones). Mounted once in the shell. */
export function TradeDrawer() {
  const symbol = useTradeStore((state) => state.symbol);
  const initialSide = useTradeStore((state) => state.side);
  const closeTrade = useTradeStore((state) => state.closeTrade);
  const asset = useMarketStore((state) => (symbol ? state.assets.find((entry) => entry.symbol.toUpperCase() === symbol) ?? null : null));
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const { user } = useAuth();
  const { theme } = useTheme();
  const returnFocus = useRef<HTMLElement | null>(null);
  const [session, setSession] = useState(0);

  const open = Boolean(symbol && asset);

  useEffect(() => {
    if (!symbol) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setSession((value) => value + 1);
  }, [initialSide, symbol]);

  useEffect(() => {
    if (symbol && user) void fetchPortfolio();
  }, [fetchPortfolio, symbol, user]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const holding = useMemo(() => (symbol ? portfolio?.holdings.find((item) => item.symbol.toUpperCase() === symbol) ?? null : null), [portfolio, symbol]);

  if (!open || !asset) return null;

  function close() {
    closeTrade();
    returnFocus.current?.focus?.();
  }

  const accent = talentAccent(asset.color, theme);
  const series = asset.sparkline_candles.map((candle) => candle.close).filter((value): value is number => typeof value === "number");
  const move = asset.move_24h_pct;
  const openPx = asset.previous_settlement_mid_price;
  const sinceOpen = openPx && asset.current_mid_price ? (asset.current_mid_price - openPx) / openPx : null;

  return (
    <>
      <div className={styles.scrim} onClick={close} aria-hidden="true" />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="trade-title" style={{ "--tal": accent } as React.CSSProperties}>
        <header className={styles.head}>
          <Oshimark icon={asset.icon} symbol={asset.symbol} size={38} />
          <div className={styles.id}>
            <h2 id="trade-title">{asset.symbol}</h2>
            <span>
              {asset.display_name} · {unitLabel(asset.unit)}
            </span>
          </div>
          <div className={styles.px}>
            <b>{n2(asset.current_mid_price)}</b>
            <span className={styles[toneOf(move)]}>{signedPct(move)}</span>
          </div>
          <button type="button" className={styles.close} onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        <div className={styles.spark}>
          <Sparkline values={series} tone={toneOf(move) === "down" ? "down" : "up"} width={320} height={56} fill dot />
        </div>
        <div className={styles.stats}>
          <div>
            <span>BID</span>
            <b>{n2(asset.current_bid_price)}</b>
          </div>
          <div>
            <span>ASK</span>
            <b>{n2(asset.current_ask_price)}</b>
          </div>
          <div>
            <span>09:00 OPEN</span>
            <b>
              {n2(openPx)} <small className={styles[toneOf(sinceOpen)]}>{signedPct(sinceOpen, 1)}</small>
            </b>
          </div>
        </div>
        {holding && holding.quantity > 0 ? (
          <div className={styles.pos}>
            You hold <b>{holding.quantity.toLocaleString("en-US")}</b> sh · avg {n2(holding.avg_cost_basis)} ·{" "}
            <span className={styles[toneOf(holding.unrealized_pnl)]}>
              {holding.unrealized_pnl >= 0 ? "+" : "−"}
              {money(Math.abs(holding.unrealized_pnl))}
            </span>
          </div>
        ) : null}

        <TradeTicket key={`${symbol}:${session}`} asset={asset} initialSide={initialSide} autoFocus onClose={close} onFilled={closeTrade} />
        <footer className={styles.foot}>
          <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} onClick={close}>
            Open the {asset.symbol} dossier →
          </Link>
          <span>Esc to close</span>
        </footer>
      </aside>
    </>
  );
}
