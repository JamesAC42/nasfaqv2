"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { apiFetch } from "@/app/lib/api";
import { formatEtTime, getMarketClock } from "@/app/lib/market-clock";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, toneOf } from "@/app/lib/time";
import { buildTradeConfirmation, getTradeFailureNotice, type TradeConfirmation, type TradeExecutionResult, type TradeFailureNotice, type TradeSide } from "@/app/lib/trade";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useMomentStore } from "@/app/stores/moment-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/trade/trade-drawer.module.scss";

const PRESETS = [1, 10, 25, 50, 100];
const FEE_RATE = 0.01;

function n2(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

/** The trade ticket as a side drawer (bottom sheet on phones). Mounted once in the shell. */
export function TradeDrawer() {
  const symbol = useTradeStore((state) => state.symbol);
  const initialSide = useTradeStore((state) => state.side);
  const closeTrade = useTradeStore((state) => state.closeTrade);
  const trackOrder = useTradeStore((state) => state.trackOrder);
  const asset = useMarketStore((state) => (symbol ? state.assets.find((entry) => entry.symbol.toUpperCase() === symbol) ?? null : null));
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const refreshTradingState = useProfileStore((state) => state.refreshTradingState);
  const pushFill = useMomentStore((state) => state.pushFill);
  const { user } = useAuth();
  const { theme } = useTheme();
  const [side, setSide] = useState<TradeSide>("buy");
  const [quantity, setQuantity] = useState("25");
  const [lastPreset, setLastPreset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TradeFailureNotice | null>(null);
  const [queued, setQueued] = useState<TradeConfirmation | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const qtyInput = useRef<HTMLInputElement | null>(null);

  const open = Boolean(symbol && asset);

  useEffect(() => {
    if (!symbol) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setSide(initialSide);
    setQuantity("25");
    setLastPreset(null);
    setFailure(null);
    setQueued(null);
    if (user) void fetchPortfolio();
    window.setTimeout(() => qtyInput.current?.focus(), 60);
  }, [fetchPortfolio, initialSide, symbol, user]);

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
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const price = side === "buy" ? asset.current_ask_price ?? asset.current_mid_price : asset.current_bid_price ?? asset.current_mid_price;
  const gross = (price ?? 0) * qty;
  const fee = gross * FEE_RATE;
  const total = side === "buy" ? gross + fee : gross - fee;
  const tradingOpen = marketStatus?.is_trading_open ?? true;
  const clock = getMarketClock(Date.now());
  const batchAt = asset.next_live_order_execute_after ? new Date(asset.next_live_order_execute_after) : clock.nextBatchAt;
  const queuedAhead = asset.pending_live_order_count ?? 0;
  const series = asset.sparkline_candles.map((candle) => candle.close).filter((value): value is number => typeof value === "number");
  const move = asset.move_24h_pct;
  const openPx = asset.previous_settlement_mid_price;
  const sinceOpen = openPx && asset.current_mid_price ? (asset.current_mid_price - openPx) / openPx : null;
  const canSell = (holding?.quantity ?? 0) > 0;
  const tooMuch = side === "buy" ? (portfolio ? total > portfolio.cash_balance : false) : qty > (holding?.quantity ?? 0);

  const preset = (value: number) => {
    setQuantity(String(lastPreset === value ? qty + value : value));
    setLastPreset(value);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!asset) return;
    if (!user) {
      setFailure({ title: "Sign in to trade", message: "Make an account and you start with $10,000 of play money." });
      return;
    }
    if (userNeedsEmailVerification(user)) {
      setFailure({ title: "Verify your email", message: "Verify your email before you can trade." });
      return;
    }
    if (!tradingOpen) {
      setFailure({ title: "Market is closed", message: marketStatus?.trading_message || "Trading is paused while the market settles. Try again in a minute." });
      return;
    }
    if (!qty) return;
    setBusy(true);
    setFailure(null);
    try {
      const previous = holding ? { quantity: holding.quantity, avg_cost_basis: holding.avg_cost_basis } : null;
      const result = await apiFetch<TradeExecutionResult>(`/api/market/orders/${side}`, { method: "POST", body: JSON.stringify({ symbol: asset.symbol, quantity: qty }) });
      const confirmation = buildTradeConfirmation({ result: { ...result, side: result.side || side, symbol: result.symbol || asset.symbol }, currentMidPrice: asset.current_mid_price, previousHolding: previous });
      if (confirmation.mode === "queued") {
        setQueued(confirmation);
        if (confirmation.orderId !== null) trackOrder(confirmation.orderId);
      } else {
        pushFill({
          id: String(confirmation.orderId ?? Date.now()),
          side: confirmation.side,
          symbol: confirmation.symbol,
          name: asset.display_name,
          quantity: confirmation.filledQuantity,
          price: confirmation.executedPrice,
          fee: confirmation.fee,
          gross: confirmation.grossValue,
          realized: confirmation.realizedPnl,
          avgCost: confirmation.side === "buy" ? confirmation.nextAvgCost : confirmation.previousAvgCost,
          at: confirmation.filledAt ?? new Date().toISOString(),
        });
        closeTrade();
      }
      await refreshTradingState();
    } catch (error) {
      setFailure(getTradeFailureNotice(String((error as Error).message || error), side, asset.symbol));
    } finally {
      setBusy(false);
    }
  }

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

        {queued ? (
          <div className={styles.queued}>
            <div className={styles.qBand}>QUEUED</div>
            <p>
              <b className={queued.side === "buy" ? styles.up : styles.down}>
                {queued.side.toUpperCase()} {queued.requestedQuantity.toLocaleString("en-US")} {queued.symbol}
              </b>{" "}
              is in the {queued.executeAfter ? `${formatEtTime(new Date(queued.executeAfter))} ET` : "next"} batch.
              {queued.remainingIntervalShares !== null ? ` ${queued.remainingIntervalShares.toLocaleString("en-US")} more shares fit in this batch.` : ""}
            </p>
            <p className={styles.dim}>We&apos;ll show you the fill when it lands. You can cancel from the Activity tab until then.</p>
            <div className={styles.qActions}>
              <Link href="/market/activity" className={styles.ghost} onClick={close}>
                Pending orders
              </Link>
              <button type="button" className={styles.ghost} onClick={() => setQueued(null)}>
                Another order
              </button>
              <button type="button" className={styles.primary} onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <div className={styles.seg} role="group" aria-label="Side">
              <button type="button" data-side="buy" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
                BUY
              </button>
              <button type="button" data-side="sell" aria-pressed={side === "sell"} onClick={() => setSide("sell")} disabled={!canSell && Boolean(user)} title={!canSell ? "You don't hold any" : undefined}>
                SELL
              </button>
            </div>
            <label className={styles.qty}>
              <span>SHARES</span>
              <input ref={qtyInput} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/[^\d]/g, "").slice(0, 6))} aria-label="Shares" />
            </label>
            <div className={styles.presets}>
              {PRESETS.map((value) => (
                <button key={value} type="button" onClick={() => preset(value)}>
                  {lastPreset === value ? `+${value}` : value}
                </button>
              ))}
              {side === "sell" && canSell ? (
                <button type="button" onClick={() => setQuantity(String(holding?.quantity ?? 0))}>
                  ALL
                </button>
              ) : null}
            </div>
            <dl className={styles.est}>
              <dt>{side === "buy" ? "Ask" : "Bid"}</dt>
              <dd>{n2(price)}</dd>
              <dt>Shares</dt>
              <dd>{qty.toLocaleString("en-US")}</dd>
              <dt>Fee (~1%)</dt>
              <dd>{money(fee)}</dd>
              <dt className={styles.total}>{side === "buy" ? "You pay" : "You get"}</dt>
              <dd className={styles.total}>{money(total)}</dd>
            </dl>
            {portfolio ? (
              <p className={`${styles.note} ${tooMuch ? styles.warn : ""}`}>
                {side === "buy" ? `Cash ${money(portfolio.cash_balance)}` : `You hold ${(holding?.quantity ?? 0).toLocaleString("en-US")} sh`}
                {tooMuch ? (side === "buy" ? " · not enough cash" : " · you don't hold that many") : ""}
              </p>
            ) : null}
            <p className={styles.batch} suppressHydrationWarning>
              Fills in the <b>{formatEtTime(batchAt)} ET</b> batch
              {queuedAhead ? ` · ${queuedAhead} order${queuedAhead === 1 ? "" : "s"} queued on ${asset.symbol}` : ""}. The final price is set when the batch executes.
            </p>
            {failure ? (
              <div className={styles.fail} role="alert">
                <b>{failure.title}</b>
                <span>{failure.message}</span>
                {!user ? (
                  <span className={styles.failLinks}>
                    <Link href="/register" onClick={close}>
                      Make an account
                    </Link>{" "}
                    ·{" "}
                    <Link href="/login" onClick={close}>
                      Sign in
                    </Link>
                  </span>
                ) : null}
              </div>
            ) : null}
            <button type="submit" className={`${styles.submit} ${side === "sell" ? styles.sell : ""}`} disabled={busy || !qty || !tradingOpen}>
              {busy ? "SENDING…" : tradingOpen ? `${side.toUpperCase()} ${qty.toLocaleString("en-US")} ${asset.symbol}` : "MARKET CLOSED"}
            </button>
          </form>
        )}
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
