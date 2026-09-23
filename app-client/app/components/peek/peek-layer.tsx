"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { formatCountdown, getMarketClock } from "@/app/lib/market-clock";
import { talentAccent } from "@/app/lib/talent-color";
import { useNow } from "@/app/lib/use-now";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/peek/peek-layer.module.scss";

// Hover previews ("peeks") that follow the cursor. Mark any element with
// data-peek-stock="SYM" and hovering it for a moment shows the stock's price,
// 15-day fair value line and your position before you click through.
// Desktop only (fine pointer + hover); touch devices never see them.

const SHOW_DELAY_MS = 240;
const OFFSET = 18;

function pctText(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const p = value * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function tone(value: number | null) {
  if (value === null || Math.abs(value) < 0.00005) return "flat";
  return value > 0 ? "up" : "down";
}

function StockPeek({ symbol }: { symbol: string }) {
  const asset = useMarketStore((state) => state.assets.find((entry) => entry.symbol === symbol) ?? null);
  const holding = useProfileStore((state) => state.portfolio?.holdings.find((entry) => entry.symbol === symbol) ?? null);
  const { theme } = useTheme();
  const now = useNow();

  const series = useMemo(() => {
    if (!asset) return [];
    const marks = asset.sparkline_candles
      .map((candle) => candle.close_mark ?? candle.close)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return asset.current_mid_price !== null ? [...marks, asset.current_mid_price] : marks;
  }, [asset]);

  if (!asset) return null;
  const mid = asset.current_mid_price;
  const move = asset.move_24h_pct;
  const fair = asset.current_fair_value ?? (series.length > 1 ? series[series.length - 2] : null);
  const vsFair = mid !== null && fair ? (mid - fair) / fair : null;
  const float = asset.circulating_supply !== null ? asset.circulating_supply / 10_000 : null;
  const holdingPnl = holding && mid !== null && holding.avg_cost_basis ? (mid - holding.avg_cost_basis) / holding.avg_cost_basis : null;
  const clock = now ? getMarketClock(now) : null;

  return (
    <div className={styles.card} style={{ "--c": talentAccent(asset.color, theme) } as React.CSSProperties}>
      <div className={styles.head}>
        <Oshimark icon={asset.icon} symbol={asset.symbol} size={32} />
        <div className={styles.who}>
          <b>{asset.symbol}</b>
          <small>
            {asset.display_name}
            {asset.unit ? ` · ${asset.unit.replace(/^hololive\s+/i, "")}` : ""}
          </small>
        </div>
        <div className={styles.price}>
          <b>{mid !== null ? mid.toFixed(2) : "—"}</b>
          <span className={styles[tone(move)]}>{pctText(move)}</span>
        </div>
      </div>
      <Sparkline values={series} tone={tone(move) === "down" ? "down" : "up"} width={268} height={40} fill dot className={styles.spark} />
      <div className={styles.stats}>
        <div>
          <span>FAIR</span>
          <b>{fair !== null ? fair.toFixed(2) : "—"}</b>
        </div>
        <div>
          <span>VS FAIR</span>
          <b className={styles[tone(vsFair)]}>{pctText(vsFair)}</b>
        </div>
        <div>
          <span>FLOAT</span>
          <b>{float !== null ? `${Math.round(float * 100)}%` : "—"}</b>
        </div>
      </div>
      {holding && holding.quantity > 0 ? (
        <div className={styles.holding}>
          You hold {holding.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })} ·{" "}
          <span className={styles[tone(holdingPnl)]}>{pctText(holdingPnl)}</span>
        </div>
      ) : null}
      <div className={styles.foot}>
        <span>click to open</span>
        {clock ? (
          <span>
            {clock.nextTick.label.toUpperCase()} in <b>{formatCountdown(clock.secondsToNextTick).slice(0, 5)}</b>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function PeekLayer() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef(0);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let target: Element | null = null;

    const place = () => {
      frame.current = 0;
      const el = layerRef.current;
      if (!el) return;
      const { x, y } = pointer.current;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = x + OFFSET;
      let top = y + OFFSET;
      if (left + w > window.innerWidth - 8) left = x - OFFSET - w;
      if (top + h > window.innerHeight - 8) top = y - OFFSET - h;
      el.style.transform = `translate3d(${Math.max(8, left)}px, ${Math.max(8, top)}px, 0)`;
    };

    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      target = null;
      setSymbol(null);
    };

    const onOver = (event: PointerEvent) => {
      const next = (event.target as Element | null)?.closest?.("[data-peek-stock]") ?? null;
      if (next === target) return;
      if (timer) clearTimeout(timer);
      target = next;
      if (!next) {
        setSymbol(null);
        return;
      }
      setSymbol(null);
      timer = setTimeout(() => {
        setSymbol(next.getAttribute("data-peek-stock"));
        requestAnimationFrame(place);
      }, SHOW_DELAY_MS);
    };

    const onMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      if (!frame.current) frame.current = requestAnimationFrame(place);
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", hide);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide);
    };
  }, []);

  return (
    <div ref={layerRef} className={styles.layer} aria-hidden="true">
      {symbol ? <StockPeek symbol={symbol} /> : null}
    </div>
  );
}
