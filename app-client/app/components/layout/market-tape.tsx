"use client";

import Image from "next/image";
import Link from "next/link";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/layout/market-tape.module.scss";

// Seconds per asset for one full loop of the tape. Slow enough to read.
const SECONDS_PER_ITEM = 2.3;
const EPOCH_KEY = "nasfaq.tapeEpoch";

// The tape remounts on every navigation (each page renders SiteShell), so we
// anchor the animation to a per-tab epoch and resume where it left off.
function getTapeEpoch() {
  try {
    const stored = Number(window.sessionStorage.getItem(EPOCH_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
    const epoch = Date.now();
    window.sessionStorage.setItem(EPOCH_KEY, String(epoch));
    return epoch;
  } catch {
    return Date.now();
  }
}

function formatPrice(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function formatMove(value: number | null) {
  if (value === null || !Number.isFinite(value)) return { text: "—", tone: "flat" as const, arrow: "■" };
  const pct = value * 100;
  if (Math.abs(pct) < 0.005) return { text: "±0.00%", tone: "flat" as const, arrow: "■" };
  return pct > 0
    ? { text: `+${pct.toFixed(2)}%`, tone: "up" as const, arrow: "▲" }
    : { text: `${pct.toFixed(2)}%`, tone: "down" as const, arrow: "▼" };
}

const TapeItem = memo(function TapeItem({
  symbol,
  icon,
  price,
  move,
  focusable,
}: {
  symbol: string;
  icon: string | null | undefined;
  price: number | null;
  move: number | null;
  focusable: boolean;
}) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const previous = useRef(price);

  // Flash the item when its price changes. DOM-only, so no re-render.
  useEffect(() => {
    const el = ref.current;
    const before = previous.current;
    previous.current = price;
    if (!el || before === null || price === null || before === price) return;
    el.classList.remove(styles.flashUp, styles.flashDown);
    void el.offsetWidth;
    el.classList.add(price > before ? styles.flashUp : styles.flashDown);
  }, [price]);

  const change = formatMove(move);
  return (
    <Link
      ref={ref}
      href={`/stocks/${encodeURIComponent(symbol)}`}
      prefetch={false}
      className={styles.item}
      data-peek-stock={symbol}
      tabIndex={focusable ? undefined : -1}
    >
      <Oshimark icon={icon} symbol={symbol} size={15} />
      <b>{symbol}</b>
      <span className={styles.price}>{formatPrice(price)}</span>
      <span className={styles[change.tone]}>
        {change.arrow} {change.text}
      </span>
    </Link>
  );
});

/** The scrolling price tape under the top bar: every stock, with its oshimark. */
export const MarketTape = memo(function MarketTape() {
  const assets = useMarketStore((state) => state.assets);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () =>
      [...assets]
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
        .map((asset) => ({
          symbol: asset.symbol,
          icon: asset.icon,
          price: asset.current_mid_price ?? asset.market_price ?? null,
          move: asset.move_24h_pct,
        })),
    [assets],
  );

  const durationSeconds = Math.max(60, rows.length * SECONDS_PER_ITEM);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || !rows.length) return;
    const elapsed = ((Date.now() - getTapeEpoch()) / 1000) % durationSeconds;
    track.style.animationDelay = `${-elapsed}s`;
  }, [durationSeconds, rows.length]);

  if (!rows.length) {
    return (
      <div className={styles.tape}>
        <span className={styles.empty}>Loading the tape…</span>
      </div>
    );
  }

  return (
    <div className={styles.tape} aria-label="Live prices">
      <div
        ref={trackRef}
        className={styles.track}
        style={{ "--tape-duration": `${durationSeconds}s` } as React.CSSProperties}
      >
        {[0, 1].map((loop) => (
          <div key={loop} className={styles.loop} aria-hidden={loop === 1 ? true : undefined}>
            {rows.map((row) => (
              <TapeItem key={row.symbol} {...row} focusable={loop === 0} />
            ))}
            <span className={styles.divider} aria-hidden="true">
              <Image src="/gura-ticker.png" alt="" width={34} height={28} className={styles.dividerImage} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
