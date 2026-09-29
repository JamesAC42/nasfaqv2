"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { TICKS } from "@/app/lib/market-clock";
import { useMarketStore } from "@/app/stores/market-store";
import { useMomentStore, type TickMove } from "@/app/stores/moment-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/moments/tick-moment.module.scss";

function pct(value: number) {
  const p = value * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function money(value: number) {
  return `${value < 0 ? "-" : "+"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The tick landing: every stock just repriced. Shows the biggest movers each
 * way and what it did to the player's book. Appears when the market socket
 * reports a batch of adjustments; if the tab was hidden, it waits until the
 * player comes back.
 */
export function TickMomentLayer() {
  const tick = useMomentStore((state) => state.tick);
  const dismiss = useMomentStore((state) => state.dismissTick);
  const revealMissed = useMomentStore((state) => state.revealMissed);
  const assets = useMarketStore((state) => state.assets);
  const portfolio = useProfileStore((state) => state.portfolio);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && revealMissed();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [revealMissed]);

  useEffect(() => {
    if (!tick) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && dismiss();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismiss, tick]);

  const view = useMemo(() => {
    if (!tick) return null;
    const icons = new Map(assets.map((asset) => [asset.symbol, asset.icon]));
    const sorted = [...tick.moves].sort((a, b) => b.pct - a.pct);
    const up = sorted.filter((move) => move.pct > 0).slice(0, 3);
    const down = sorted.filter((move) => move.pct < 0).reverse().slice(0, 3);
    const moves = new Map(tick.moves.map((move) => [move.symbol, move]));
    const bookDelta = portfolio
      ? portfolio.holdings.reduce((sum, holding) => {
          const move = moves.get(holding.symbol);
          return move ? sum + (move.after - move.before) * holding.quantity : sum;
        }, 0)
      : null;
    const label = TICKS.find((entry) => entry.key === tick.intervalKey)?.label ?? "Market";
    return { icons, up, down, bookDelta, label };
  }, [assets, portfolio, tick]);

  if (!tick || !view) return null;

  const row = (move: TickMove, index: number) => (
    <Link
      key={move.symbol}
      href={`/stocks/${encodeURIComponent(move.symbol)}`}
      className={styles.row}
      style={{ animationDelay: `${0.35 + index * 0.08}s` }}
      onClick={dismiss}
    >
      <Oshimark icon={view.icons.get(move.symbol)} symbol={move.symbol} size={22} />
      <b>{move.symbol}</b>
      <span className={styles.name}>{move.name}</span>
      <b className={move.pct >= 0 ? styles.up : styles.down}>{pct(move.pct)}</b>
    </Link>
  );

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="tick-moment-title" onClick={dismiss}>
      <div className={styles.card} onClick={(event) => event.stopPropagation()}>
        <div className={styles.stamp}>
          <h2 id="tick-moment-title">{view.label.toUpperCase()} TICK</h2>
          <p>
            {tick.moves.length} stocks repriced{tick.forced ? " (manual tick)" : ""}. Nobody knows a tick&apos;s strength until it lands.
          </p>
        </div>
        <div className={styles.results}>
          <div>
            <div className={`${styles.label} ${styles.up}`}>Mooning</div>
            {view.up.length ? view.up.map(row) : <p className={styles.none}>Nothing went up. Grim.</p>}
          </div>
          <div>
            <div className={`${styles.label} ${styles.down}`}>Bleeding</div>
            {view.down.length ? view.down.map(row) : <p className={styles.none}>Nothing went down. Suspicious.</p>}
          </div>
        </div>
        <div className={styles.foot}>
          {view.bookDelta !== null ? (
            <span>
              YOUR BOOK <b className={view.bookDelta >= 0 ? styles.up : styles.down}>{money(view.bookDelta)}</b> on this tick
            </span>
          ) : (
            <span>
              <Link href="/login" onClick={dismiss} className={styles.link}>
                Sign in
              </Link>{" "}
              to see what the tick did to your book
            </span>
          )}
          <button ref={closeRef} type="button" className={styles.close} onClick={dismiss}>
            BACK TO THE FLOOR
          </button>
        </div>
      </div>
    </div>
  );
}
