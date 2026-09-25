"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { getMarketClock } from "@/app/lib/market-clock";
import { normalizeMarketHubTrade } from "@/app/lib/normalizers";
import { talentAccent } from "@/app/lib/talent-color";
import { money } from "@/app/lib/time";
import type { PortfolioOrder } from "@/app/lib/types";
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

/** Shows the fill moment for one of the player's fills (deduped by fill id in the store). */
export function announceFill(fill: { id: string; side: string; symbol: string; name: string; quantity: number; price: number; fee: number; gross: number; at: string }) {
  const holding = useProfileStore.getState().portfolio?.holdings.find((item) => item.symbol.toUpperCase() === fill.symbol.toUpperCase());
  const buy = fill.side.toLowerCase() === "buy";
  const avgCost = holding?.avg_cost_basis ?? null;
  useMomentStore.getState().pushFill({
    id: fill.id,
    side: buy ? "buy" : "sell",
    symbol: fill.symbol,
    name: fill.name,
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
    gross: fill.gross,
    realized: !buy && avgCost !== null ? (fill.price - avgCost) * fill.quantity - fill.fee : null,
    avgCost,
    at: fill.at,
  });
}

/** Fallback for a missed socket event: an order that left the pending list with a fill. */
export function announceOrderFill(order: PortfolioOrder) {
  if (order.status !== "filled" || !order.fill_id || order.fill_price === null || order.fill_price === undefined) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  announceFill({
    id: order.fill_id,
    side: order.side,
    symbol: order.symbol,
    name: order.display_name,
    quantity: order.filled_quantity,
    price: order.fill_price,
    fee: order.fill_fee_cash ?? 0,
    gross: order.fill_gross_cash ?? order.fill_price * order.filled_quantity,
    at: order.fill_ts ?? order.updated_at ?? new Date().toISOString(),
  });
}

/** Watches the market socket for the player's own fills (live orders landing in a batch). */
function useOwnFills() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    return onMarketEvent((payload) => {
      if (payload.type !== "market.trade_fill" || !payload.trade || typeof payload.trade !== "object") return;
      const trade = normalizeMarketHubTrade(payload.trade as Record<string, unknown>);
      if (trade.user_id !== user.id) return;
      const tracked = useTradeStore.getState().pendingOrderIds;
      if (trade.order_id !== null && tracked.some((id) => String(id) === String(trade.order_id))) useTradeStore.getState().untrackOrder(trade.order_id);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      announceFill({
        id: String(trade.id),
        side: trade.side,
        symbol: trade.symbol,
        name: trade.display_name,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee_cash,
        gross: trade.gross_cash,
        at: trade.ts,
      });
      void useProfileStore.getState().refreshTradingState();
    });
  }, [user]);
}

type Slide = FillMoment & { count: number };

/** One slide per stock and side: several fills of the same order side merge (shares add, price averages). */
function toSlides(fills: FillMoment[]): Slide[] {
  const by = new Map<string, Slide>();
  for (const fill of fills) {
    const key = `${fill.symbol}:${fill.side}`;
    const prev = by.get(key);
    if (!prev) {
      by.set(key, { ...fill, count: 1 });
      continue;
    }
    const quantity = prev.quantity + fill.quantity;
    by.set(key, {
      ...prev,
      quantity,
      price: (prev.price * prev.quantity + fill.price * fill.quantity) / quantity,
      gross: prev.gross + fill.gross,
      fee: prev.fee + fill.fee,
      realized: prev.realized === null && fill.realized === null ? null : (prev.realized ?? 0) + (fill.realized ?? 0),
      count: prev.count + 1,
    });
  }
  // Biggest first: the slideshow opens on the trade that matters most.
  return [...by.values()].sort((a, b) => b.gross - a.gross);
}

const AUTO_MS = 4200;

export function FillMomentLayer() {
  useOwnFills();
  const fills = useMomentStore((state) => state.fills);
  const dismiss = useMomentStore((state) => state.dismissFill);
  const setFillPopups = useMomentStore((state) => state.setFillPopups);
  const setNotice = useMomentStore((state) => state.setNotice);
  const slides = useMemo(() => toSlides(fills), [fills]);
  const multi = slides.length > 1;
  const pages = multi ? slides.length + 1 : 1; // + the summary page
  const batchKey = fills.map((fill) => fill.id).join(",");
  const [view, setView] = useState<{ key: string; index: number; dir: 1 | -1; auto: boolean }>({ key: "", index: 0, dir: 1, auto: true });
  const index = view.key === batchKey ? Math.min(view.index, pages - 1) : 0;
  const auto = view.key === batchKey ? view.auto : true;
  const dir = view.key === batchKey ? view.dir : 1;
  const onSummary = multi && index === slides.length;
  const fill = slides.length ? slides[onSummary ? 0 : index] : null;
  const assets = useMarketStore((state) => state.assets);
  const asset = fill ? assets.find((entry) => entry.symbol === fill.symbol) ?? null : null;
  const { theme } = useTheme();
  const { calm } = useMotion();
  const [roll, setRoll] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const [copiedState, setCopiedState] = useState<{ id: string; text: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const fillKey = fill ? `${fill.id}:${index}` : "";
  const seed = (Number(String(fill?.id ?? "").replace(/\D/g, "").slice(-6)) || fillKey.length * 97) + (roll.id === fillKey ? roll.n : 0);
  const copied = copiedState && copiedState.id === fillKey ? copiedState.text : null;

  const go = (next: number, manual = true) => {
    if (!pages) return;
    const target = (next + pages) % pages;
    setView({ key: batchKey, index: target, dir: target >= index ? 1 : -1, auto: manual ? false : auto });
  };

  // The slideshow advances on its own until the player touches it (not in calm mode, not on the summary).
  useEffect(() => {
    if (!multi || calm || !auto || onSummary) return;
    const timer = window.setTimeout(() => setView({ key: batchKey, index: index + 1, dir: 1, auto: true }), AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [auto, batchKey, calm, index, multi, onSummary]);

  useEffect(() => {
    if (!fills.length) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
      if (!multi) return;
      if (event.key === "ArrowRight") setView((current) => ({ key: batchKey, index: Math.min(pages - 1, (current.key === batchKey ? current.index : 0) + 1), dir: 1, auto: false }));
      if (event.key === "ArrowLeft") setView((current) => ({ key: batchKey, index: Math.max(0, (current.key === batchKey ? current.index : 0) - 1), dir: -1, auto: false }));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [batchKey, dismiss, fills.length, multi, pages]);

  const text = useMemo(() => {
    if (!fill) return "";
    const clock = getMarketClock(new Date(fill.at).getTime());
    const hours = Math.floor(clock.secondsToNextTick / 3600);
    const minutes = Math.floor((clock.secondsToNextTick % 3600) / 60);
    return greentext(fill, seed, clock.nextTick.label.toLowerCase(), `${hours}h${String(minutes).padStart(2, "0")}m`);
  }, [fill, seed]);

  if (!fill) return null;

  const buys = slides.filter((entry) => entry.side === "buy");
  const sells = slides.filter((entry) => entry.side === "sell");
  const spent = buys.reduce((sum, entry) => sum + entry.gross + entry.fee, 0);
  const received = sells.reduce((sum, entry) => sum + entry.gross - entry.fee, 0);
  const fees = slides.reduce((sum, entry) => sum + entry.fee, 0);
  const realizedKnown = sells.filter((entry) => entry.realized !== null);
  const realized = realizedKnown.length ? realizedKnown.reduce((sum, entry) => sum + (entry.realized ?? 0), 0) : null;

  const buy = fill.side === "buy";
  const pose = onSummary ? (realized !== null ? (realized >= 0 ? "smug" : "cope") : "hype") : buy ? "hype" : (fill.realized ?? 0) >= 0 ? "smug" : "cope";
  const total = buy ? fill.gross + fill.fee : fill.gross - fill.fee;
  const tone = onSummary
    ? buys.length && sells.length
      ? "var(--blue)"
      : buys.length
        ? "var(--up)"
        : realized !== null && realized < 0
          ? "var(--down)"
          : "var(--up)"
    : buy
      ? "var(--up)"
      : "var(--down)";
  const time = new Date(fill.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
  const title = onSummary ? `${fills.length} ORDERS FILLED` : buy ? "FILLED" : "SOLD";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedState({ id: fillKey, text: "COPIED" });
    } catch {
      setCopiedState({ id: fillKey, text: "COPY FAILED" });
    }
    window.setTimeout(() => setCopiedState(null), 1800);
  };

  const toastsOnly = () => {
    setFillPopups(false);
    dismiss();
    setNotice("Fill popups off. Fills show here instead; turn them back on from this toast.");
  };

  const onPointerDown = (event: React.PointerEvent) => {
    swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!multi || !start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y)) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="fill-title" onClick={(event) => event.target === event.currentTarget && dismiss()}>
      <div
        className={`${styles.card} ${calm ? "" : styles.play}`}
        style={{ "--side": tone, "--tal": talentAccent(asset?.color, theme) } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onMouseEnter={() => multi && auto && setView({ key: batchKey, index, dir, auto: false })}
      >
        <div className={styles.band}>
          <h2 id="fill-title" key={title}>
            {title}
          </h2>
          <span>
            {multi ? `${Math.min(index + 1, pages)}/${pages} · ` : ""}
            {time} ET
          </span>
        </div>
        {multi && !calm && auto && !onSummary ? <div key={`timer-${index}`} className={styles.timer} style={{ animationDuration: `${AUTO_MS}ms` }} /> : null}

        <div key={`${batchKey}:${index}`} className={`${styles.body} ${calm ? "" : dir > 0 ? styles.fromRight : styles.fromLeft}`}>
          <div className={styles.artCol}>
            <ArtSlot kind="reaction" pose={pose} symbol={fill.symbol} icon={asset?.icon} accent={talentAccent(asset?.color, theme)} width={340} vignette fadeLength={0.3} className={styles.art} />
          </div>
          <div className={styles.info}>
            {onSummary ? (
              <ul className={styles.rows}>
                {slides.map((entry, slideIndex) => {
                  const rowAsset = assets.find((item) => item.symbol === entry.symbol);
                  return (
                    <li key={`${entry.symbol}:${entry.side}`}>
                      <button type="button" onClick={() => go(slideIndex)} title={`Show ${entry.symbol}`}>
                        <Oshimark icon={rowAsset?.icon} symbol={entry.symbol} size={20} />
                        <b className={entry.side === "buy" ? styles.up : styles.down}>{entry.side === "buy" ? "BUY" : "SELL"}</b>
                        <span>
                          {entry.quantity.toLocaleString("en-US")} {entry.symbol}
                        </span>
                        <small>@ {entry.price.toFixed(2)}</small>
                        {entry.realized !== null && entry.side === "sell" ? (
                          <em className={entry.realized >= 0 ? styles.up : styles.down}>
                            {entry.realized >= 0 ? "+" : "−"}
                            {money(Math.abs(entry.realized))}
                          </em>
                        ) : (
                          <em>{money(entry.side === "buy" ? entry.gross + entry.fee : entry.gross - entry.fee)}</em>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className={styles.line}>
                <Oshimark icon={asset?.icon} symbol={fill.symbol} size={34} />
                <span>
                  {buy ? "Bought" : "Sold"} {fill.quantity.toLocaleString("en-US")} {fill.symbol}
                  <small>
                    @ {fill.price.toFixed(2)}
                    {fill.count > 1 ? ` avg · ${fill.count} orders` : ""}
                  </small>
                </span>
              </div>
            )}
            <dl className={styles.est}>
              {onSummary ? (
                <>
                  {buys.length ? (
                    <>
                      <dt>Paid · {buys.length} stock{buys.length === 1 ? "" : "s"}</dt>
                      <dd>{money(spent)}</dd>
                    </>
                  ) : null}
                  {sells.length ? (
                    <>
                      <dt>Received · {sells.length} stock{sells.length === 1 ? "" : "s"}</dt>
                      <dd>{money(received)}</dd>
                    </>
                  ) : null}
                  <dt>Fees</dt>
                  <dd>{money(fees)}</dd>
                  {realized !== null ? (
                    <>
                      <dt>Realized</dt>
                      <dd className={realized >= 0 ? styles.up : styles.down}>
                        {realized >= 0 ? "+" : "−"}
                        {money(Math.abs(realized))}
                      </dd>
                    </>
                  ) : null}
                </>
              ) : (
                <>
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
                </>
              )}
            </dl>
            {!onSummary ? (
              <div className={styles.brag}>
                <span className={styles.hdr}>
                  <b>Anonymous</b> No.{(Number(fill.id) || seed) % 100000000}
                </span>
                {text}
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.foot}>
          {multi ? (
            <div className={styles.pager}>
              <button type="button" className={styles.arrow} onClick={() => go(index - 1)} aria-label="Previous">
                ‹
              </button>
              <div className={styles.dots} role="tablist" aria-label="Fills">
                {Array.from({ length: pages }, (_, page) => (
                  <button
                    key={page}
                    type="button"
                    role="tab"
                    aria-selected={page === index}
                    aria-label={page === slides.length ? "Summary" : slides[page].symbol}
                    className={page === slides.length ? styles.dotSum : undefined}
                    onClick={() => go(page)}
                  />
                ))}
              </div>
              <button type="button" className={styles.arrow} onClick={() => go(index + 1)} aria-label="Next">
                ›
              </button>
            </div>
          ) : null}
          <div className={styles.actions}>
            {!onSummary ? (
              <>
                <button type="button" className={styles.primary} onClick={() => void copy()}>
                  {copied ?? "COPY FOR /VT/"}
                </button>
                <button type="button" onClick={() => setRoll({ id: fillKey, n: (roll.id === fillKey ? roll.n : 0) + 1 })}>
                  REROLL
                </button>
              </>
            ) : null}
            {multi && !onSummary ? (
              <button type="button" onClick={() => go(slides.length)}>
                SUMMARY
              </button>
            ) : null}
            <button type="button" ref={closeRef} onClick={dismiss}>
              NICE
            </button>
          </div>
          <button type="button" className={styles.quiet} onClick={toastsOnly}>
            Just toasts from now on
          </button>
        </div>
      </div>
    </div>
  );
}
