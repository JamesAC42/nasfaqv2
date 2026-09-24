"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { getMarketClock } from "@/app/lib/market-clock";
import { normalizeMarketHubTrade } from "@/app/lib/normalizers";
import { talentAccent } from "@/app/lib/talent-color";
import { money } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useMotion } from "@/app/providers/motion-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { onMarketEvent, useMarketStore } from "@/app/stores/market-store";
import { useMomentStore, type FillMoment } from "@/app/stores/moment-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/moments/fill-moment.module.scss";

function greentext(fill: FillMoment, seed: number, tick: string, until: string) {
  const q = fill.quantity.toLocaleString("en-US");
  const S = fill.symbol;
  const px = fill.price.toFixed(2);
  const avg = fill.avgCost !== null ? fill.avgCost.toFixed(2) : "?";
  const pl = fill.realized ?? 0;
  const plAbs = Math.abs(pl).toFixed(2);
  const plp = fill.avgCost ? Math.abs(((fill.price - fill.avgCost) / fill.avgCost) * 100).toFixed(1) : "?";
  const first = fill.name.split(" ").pop() ?? fill.name;
  const lines =
    fill.side === "buy"
      ? [
          `>buy ${q} ${S} at ${px}\n>${tick} tick in ${until}\n>refreshing the page every 4 seconds like it helps`,
          `>buying ${S} at ${px}\n>(he bought)\n>(dump it)`,
          `>ask the thread if ${S} is a buy\n>everyone says no\n>buy ${q} anyway\n>I am built different (poor)`,
          `>tfw 1% fee\n>tfw still buying ${S}`,
          `>be me\n>see ${fill.name} on the news\n>don't read the article\n>buy ${q} ${S}\n>this is called research`,
          ...(fill.quantity >= 150 ? [`>market buy ${q} ${S}\n>my own order moves the chart\n>I am become whale, mover of charts`] : []),
        ]
      : pl >= 0
        ? [
            `>sold ${q} ${S} at ${px}\n>bought at ${avg}\n>+$${plAbs}\n>time to buy the top of something else`,
            `>take profits on ${S}, +${plp}%\n>financial literacy achieved\n>${tick} tick moons it anyway probably`,
            `>oshi money printer went brrr\n>+$${plAbs} on ${S}\n>thank you ${first}`,
          ]
        : [
            `>sold ${q} ${S} at ${px}\n>bought at ${avg}\n>it's fine, I was in it for the streams`,
            `>buy ${S} at ${avg}\n>sell at ${px}\n>buy high sell low\n>just like the pros`,
            `>sold my ${S} bags at ${px}\n>she'll moon at ${tick}\n>I know she will\n>I can feel it`,
            `>-$${plAbs} on ${S}\n>at least the chart is pretty`,
          ];
  return lines[Math.abs(seed) % lines.length];
}

/** Watches the market socket for the player's own fills (live orders landing in a batch). */
function useOwnFills() {
  const { user } = useAuth();
  const pushFill = useMomentStore((state) => state.pushFill);
  useEffect(() => {
    if (!user) return;
    return onMarketEvent((payload) => {
      if (payload.type !== "market.trade_fill" || !payload.trade || typeof payload.trade !== "object") return;
      const trade = normalizeMarketHubTrade(payload.trade as Record<string, unknown>);
      if (trade.user_id !== user.id) return;
      const tracked = useTradeStore.getState().pendingOrderIds;
      if (trade.order_id !== null && tracked.some((id) => String(id) === String(trade.order_id))) useTradeStore.getState().untrackOrder(trade.order_id);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const holding = useProfileStore.getState().portfolio?.holdings.find((item) => item.symbol.toUpperCase() === trade.symbol.toUpperCase());
      const buy = trade.side.toLowerCase() === "buy";
      const avgCost = holding?.avg_cost_basis ?? null;
      pushFill({
        id: String(trade.id),
        side: buy ? "buy" : "sell",
        symbol: trade.symbol,
        name: trade.display_name,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee_cash,
        gross: trade.gross_cash,
        realized: !buy && avgCost !== null ? (trade.price - avgCost) * trade.quantity - trade.fee_cash : null,
        avgCost,
        at: trade.ts,
      });
      void useProfileStore.getState().refreshTradingState();
    });
  }, [pushFill, user]);
}

export function FillMomentLayer() {
  useOwnFills();
  const fill = useMomentStore((state) => state.fill);
  const dismiss = useMomentStore((state) => state.dismissFill);
  const asset = useMarketStore((state) => (fill ? state.assets.find((entry) => entry.symbol === fill.symbol) ?? null : null));
  const { theme } = useTheme();
  const { calm } = useMotion();
  const [seed, setSeed] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!fill) return;
    setSeed(Math.floor(Math.random() * 1000));
    setCopied(null);
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && dismiss();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismiss, fill]);

  const text = useMemo(() => {
    if (!fill) return "";
    const clock = getMarketClock(Date.now());
    const hours = Math.floor(clock.secondsToNextTick / 3600);
    const minutes = Math.floor((clock.secondsToNextTick % 3600) / 60);
    return greentext(fill, seed, clock.nextTick.label.toLowerCase(), `${hours}h${String(minutes).padStart(2, "0")}m`);
  }, [fill, seed]);

  if (!fill) return null;
  const buy = fill.side === "buy";
  const total = buy ? fill.gross + fill.fee : fill.gross - fill.fee;
  const pose = buy ? "hype" : (fill.realized ?? 0) >= 0 ? "smug" : "cope";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("COPIED");
    } catch {
      setCopied("COPY FAILED");
    }
    window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="fill-title" onClick={(event) => event.target === event.currentTarget && dismiss()}>
      <div className={`${styles.card} ${calm ? "" : styles.play}`} style={{ "--side": buy ? "var(--up)" : "var(--down)", "--tal": talentAccent(asset?.color, theme) } as React.CSSProperties}>
        <div className={styles.band}>
          <h2 id="fill-title">{buy ? "FILLED" : "SOLD"}</h2>
          <span>{new Date(fill.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" })} ET</span>
        </div>
        <div className={styles.body}>
          <ArtSlot kind="chibi" pose={pose} symbol={fill.symbol} icon={asset?.icon} accent={talentAccent(asset?.color, theme)} width={170} className={styles.art} />
          <div className={styles.info}>
            <div className={styles.line}>
              <Oshimark icon={asset?.icon} symbol={fill.symbol} size={34} />
              <span>
                {buy ? "Bought" : "Sold"} {fill.quantity.toLocaleString("en-US")} {fill.symbol}
                <small>@ {fill.price.toFixed(2)}</small>
              </span>
            </div>
            <dl className={styles.est}>
              <dt>{buy ? "Paid" : "Received"}</dt>
              <dd>{money(total)}</dd>
              <dt>Fee</dt>
              <dd>{money(fill.fee)}</dd>
              {!buy && fill.realized !== null ? (
                <>
                  <dt>Realized</dt>
                  <dd className={fill.realized >= 0 ? styles.up : styles.down}>
                    {fill.realized >= 0 ? "+" : "−"}
                    {money(Math.abs(fill.realized))}
                  </dd>
                </>
              ) : null}
            </dl>
            <div className={styles.brag}>
              <span className={styles.hdr}>
                <b>Anonymous</b> No.{(Number(fill.id) || seed) % 100000000}
              </span>
              {text}
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => void copy()}>
                {copied ?? "COPY FOR /VT/"}
              </button>
              <button type="button" onClick={() => setSeed((current) => current + 1)}>
                REROLL
              </button>
              <button type="button" ref={closeRef} onClick={dismiss}>
                NICE
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
