"use client";

import Link from "next/link";
import { OrderAllowanceMeter } from "@/app/components/trade/order-allowance";
import { ArtSlot } from "@/app/components/common/art-slot";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { apiFetch } from "@/app/lib/api";
import { formatEtTime, getMarketClock } from "@/app/lib/market-clock";
import { money } from "@/app/lib/time";
import { buildTradeConfirmation, getTradeFailureNotice, type TradeConfirmation, type TradeExecutionResult, type TradeFailureNotice, type TradeSide } from "@/app/lib/trade";
import type { MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMotion } from "@/app/providers/motion-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useMomentStore } from "@/app/stores/moment-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/trade/trade-drawer.module.scss";
import { Term } from "@/app/components/common/tip";

const PRESETS = [1, 10, 25, 50, 100];
export const FEE_RATE = 0.01;

/**
 * What you can spend on a buy: Cash with every hold already taken out, what's held and for what
 * (queued buys, IPO subscriptions), and what's left once this order holds its share. A queued buy
 * holds its estimate plus a margin for the price moving before the batch (the API's
 * order_hold_margin); whatever the fill doesn't use comes back.
 */
function CashToSpend({ cash, held, margin, total, qty, tooMuch }: { cash: number; held: number; margin: number; total: number; qty: number; tooMuch: boolean }) {
  const pending = useProfileStore((state) => state.pendingLiveOrders);
  const buys = pending.filter((order) => order.side === "buy" && order.held_cash > 0);
  // The orders list can lag the balance by a moment; never claim more for orders than is held.
  const forOrders = Math.min(held, buys.reduce((sum, order) => sum + order.held_cash, 0));
  const forIpo = held - forOrders;
  const hold = Math.min(Math.max(cash, 0), total * (1 + margin));
  const after = cash - hold;
  return (
    <dl className={styles.cash}>
      <dt>Cash to spend</dt>
      <dd className={cash < 0 ? styles.warn : undefined}>{money(cash)}</dd>
      {forOrders >= 0.005 ? (
        <>
          <dt className={styles.held}>
            held for {buys.length} queued buy{buys.length === 1 ? "" : "s"}
          </dt>
          <dd className={styles.held}>{money(forOrders)}</dd>
        </>
      ) : null}
      {forIpo >= 0.005 ? (
        <>
          <dt className={styles.held}>held for IPO subscriptions</dt>
          <dd className={styles.held}>{money(forIpo)}</dd>
        </>
      ) : null}
      {cash < 0 ? (
        <dd className={`${styles.after} ${styles.red}`}>In the red: sell something first</dd>
      ) : qty > 0 ? (
        <>
          <dt className={styles.after} title={`A queued buy holds ${Math.round(margin * 100)}% over its estimate in case the price moves before the batch; what the fill doesn't use comes back.`}>
            Left after this order
          </dt>
          <dd className={`${styles.after} ${tooMuch ? styles.warn : ""}`}>{tooMuch ? "not enough cash" : `≈ ${money(after)}`}</dd>
        </>
      ) : null}
    </dl>
  );
}

/** What the order runs into on the supply side: sold out, the last shares, or a buyback. */
function SupplyNote({ asset, side, qty }: { asset: MarketAsset; side: TradeSide; qty: number }) {
  const forSale = asset.shares_for_sale ?? null;
  const max = asset.max_supply ?? null;
  if (asset.trading_state === "buyback" && asset.buyback) {
    const bb = asset.buyback;
    const next = bb.next_step_at ? new Date(bb.next_step_at) : null;
    return (
      <p className={styles.supplyNote} data-tone="buyback">
        <b>
          <Term k="buyback">Buyback</Term>
        </b>{" "}
        The broker pays <b>{n2(bb.price)}</b> a share ({Math.round(bb.multiplier * 100)}% of the frozen {n2(bb.frozen_price)}) for the{" "}
        {Math.ceil(bb.shares_over).toLocaleString("en-US")} shares still over the max
        {next ? `, ${Math.round(Math.max(bb.floor, bb.multiplier - bb.daily_step) * 100)}% from ${next.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" })} ${formatEtTime(next)} ET` : ""}. Past that, sells get the frozen price. No buys until it ends.
      </p>
    );
  }
  if (side !== "buy" || forSale === null) return null;
  if (asset.sold_out) {
    return (
      <p className={styles.supplyNote} data-tone="soldout">
        <b>
          <Term k="sold-out">Sold out</Term>
        </b>{" "}
        Every share for sale is taken. Buys open again when someone sells.
      </p>
    );
  }
  const low = max !== null && max > 0 ? forSale / max < 0.1 : false;
  if (!low && qty <= forSale) return null;
  return (
    <p className={styles.supplyNote} data-tone="low">
      <b>{Math.floor(forSale).toLocaleString("en-US")}</b> <Term k="max-supply">shares left for sale</Term>
      {qty > forSale ? ". Your batch fills what's left when it runs." : "."}
    </p>
  );
}

export function n2(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

/**
 * The order form: side, shares, estimate, submit, and the queued state. Used by
 * the global drawer and inline on the stock dossier.
 */
export function TradeTicket({
  asset,
  initialSide = "buy",
  autoFocus = false,
  onClose,
  onFilled,
  onPlaced,
  artSize = "large",
}: {
  asset: MarketAsset;
  /** Size of her reaction in the queued state: full width in the stock page sidebar, smaller in the drawer. */
  artSize?: "large" | "small";
  initialSide?: TradeSide;
  autoFocus?: boolean;
  /** Called when a link inside the ticket navigates away, or on Done. */
  onClose?: () => void;
  /** Called after an order fills immediately (the fill moment takes over). */
  onFilled?: () => void;
  /** Called once an order is accepted (queued or filled), e.g. to toss the stock page's coin. */
  onPlaced?: () => void;
}) {
  const trackOrder = useTradeStore((state) => state.trackOrder);
  const { calm } = useMotion();
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const portfolio = useProfileStore((state) => state.portfolio);
  const refreshTradingState = useProfileStore((state) => state.refreshTradingState);
  const pushFill = useMomentStore((state) => state.pushFill);
  const { user } = useAuth();
  // A stock frozen for a buyback can only be sold (to the broker), so the ticket opens on Sell.
  const startSide: TradeSide = asset.trading_state === "buyback" ? "sell" : initialSide;
  const [side, setSide] = useState<TradeSide>(startSide);
  const [quantity, setQuantity] = useState("25");
  const [lastPreset, setLastPreset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TradeFailureNotice | null>(null);
  const [queued, setQueued] = useState<TradeConfirmation | null>(null);
  const qtyInput = useRef<HTMLInputElement | null>(null);
  const symbol = asset.symbol.toUpperCase();

  useEffect(() => setSide(startSide), [startSide]);
  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => qtyInput.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [autoFocus]);

  const holding = useMemo(() => portfolio?.holdings.find((item) => item.symbol.toUpperCase() === symbol) ?? null, [portfolio, symbol]);
  const close = () => onClose?.();

  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  // Supply: a stock in a buyback takes no buys and the broker pays its buyback price for sells; a
  // sold-out stock takes no buys until someone sells.
  const frozen = asset.trading_state === "buyback";
  const forSale = asset.shares_for_sale ?? null;
  const soldOut = !frozen && Boolean(asset.sold_out);
  const buyBlocked = side === "buy" && (frozen || soldOut);
  const price = frozen && side === "sell" && asset.buyback ? asset.buyback.price : side === "buy" ? asset.current_ask_price ?? asset.current_mid_price : asset.current_bid_price ?? asset.current_mid_price;
  const gross = (price ?? 0) * qty;
  const fee = gross * FEE_RATE;
  // The fee comes out of Credit first; Cash pays the shares and whatever Credit doesn't cover. A
  // sale also earns a little Credit.
  const feeFromCredit = portfolio ? Math.min(Math.max(0, portfolio.credit_balance), fee) : 0;
  const total = side === "buy" ? gross + fee - feeFromCredit : gross - (fee - feeFromCredit);
  const creditEarned = side === "sell" ? gross * (portfolio?.economy?.sell_credit_rate ?? 0) : 0;
  const tradingOpen = marketStatus?.is_trading_open ?? true;
  const clock = getMarketClock(Date.now());
  const batchAt = asset.next_live_order_execute_after ? new Date(asset.next_live_order_execute_after) : clock.nextBatchAt;
  const queuedAhead = asset.pending_live_order_count ?? 0;
  const canSell = (holding?.quantity ?? 0) > 0;
  const tooMuch = side === "buy" ? (portfolio ? total > portfolio.cash_balance : false) : qty > (holding?.quantity ?? 0);

  const preset = (value: number) => {
    setQuantity(String(lastPreset === value ? qty + value : value));
    setLastPreset(value);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
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
      onPlaced?.();
      const confirmation = buildTradeConfirmation({ result: { ...result, side: result.side || side, symbol: result.symbol || asset.symbol }, currentMidPrice: asset.current_mid_price, previousHolding: previous });
      if (confirmation.mode === "queued") {
        setQueued(confirmation);
        if (confirmation.orderId !== null) trackOrder(confirmation.orderId);
      } else if (confirmation.filledQuantity > 0) {
        // Instant fills (no batch): only when the response really carries a fill.
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
        onFilled?.();
      }
      await refreshTradingState();
    } catch (error) {
      const code = String((error as Error).message || error);
      setFailure(getTradeFailureNotice(code, side, asset.symbol, (error as { body?: Record<string, unknown> | null }).body));
      // Over the share limit: the meter may be behind (an order placed in another tab), so catch it up.
      if (code.includes("live_order_limit_exceeded")) void useProfileStore.getState().fetchPortfolioOrders();
    } finally {
      setBusy(false);
    }
  }

  return (
    queued ? (
          <div key={queued.orderId ?? queued.requestedQuantity} className={`${styles.queued} ${calm ? "" : styles.qPlay}`} data-side={queued.side} data-art={artSize}>
            <div className={styles.qStage}>
              <ArtSlot kind="reaction" pose={queued.side === "buy" ? "moon" : "smug"} symbol={symbol} icon={asset.icon} width={artSize === "large" ? 520 : 260} vignette fadeLength={0.3} className={styles.qArt} />
              <div className={styles.qBand}>
                <span>QUEUED</span>
                <small>{queued.executeAfter ? `${formatEtTime(new Date(queued.executeAfter))} ET batch` : "next batch"}</small>
              </div>
            </div>
            <p>
              <b className={queued.side === "buy" ? styles.up : styles.down}>
                {queued.side.toUpperCase()} {queued.requestedQuantity.toLocaleString("en-US")} {queued.symbol}
              </b>{" "}
              is in the {queued.executeAfter ? `${formatEtTime(new Date(queued.executeAfter))} ET` : "next"} batch.
              {queued.remainingIntervalShares !== null ? ` You can queue ${queued.remainingIntervalShares.toLocaleString("en-US")} more shares before the next tick.` : ""}
            </p>
            <p className={styles.dim}>We&apos;ll show you the fill when it lands. You can cancel from the Activity tab until then.</p>
            <div className={styles.qActions}>
              <Link href="/market/activity" className={styles.ghost} onClick={close}>
                Pending orders
              </Link>
              <button type="button" className={styles.ghost} onClick={() => setQueued(null)}>
                Another order
              </button>
              <button type="button" className={styles.primary} onClick={() => (onClose ? onClose() : setQueued(null))}>
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
            <OrderAllowanceMeter order={qty} />
            <dl className={styles.est}>
              <dt>
                <Term k="spread">{side === "buy" ? "Ask" : "Bid"}</Term>
              </dt>
              <dd>{n2(price)}</dd>
              <dt>Shares</dt>
              <dd>{qty.toLocaleString("en-US")}</dd>
              <dt>
                <Term k="fee">Fee (~1%)</Term>
              </dt>
              <dd>
                {money(fee)}
                {feeFromCredit > 0 ? <small>{feeFromCredit >= fee - 0.005 ? " from Credit" : ` (${money(feeFromCredit)} from Credit)`}</small> : null}
              </dd>
              {creditEarned > 0.005 ? (
                <>
                  <dt>
                    <Term k="credit">Credit earned</Term>
                  </dt>
                  <dd>+{money(creditEarned)}</dd>
                </>
              ) : null}
              <dt className={styles.total}>{side === "buy" ? "You pay" : "You get"}</dt>
              <dd className={styles.total}>{money(total)}</dd>
            </dl>
            {portfolio && side === "buy" ? (
              <CashToSpend cash={portfolio.cash_balance} held={portfolio.held_cash} margin={portfolio.order_hold_margin} total={total} qty={qty} tooMuch={tooMuch} />
            ) : portfolio ? (
              <p className={`${styles.note} ${tooMuch ? styles.warn : ""}`}>
                You hold {(holding?.quantity ?? 0).toLocaleString("en-US")} sh{tooMuch ? " · you don't hold that many" : ""}
              </p>
            ) : null}
            <SupplyNote asset={asset} side={side} qty={qty} />
            <p className={styles.batch} suppressHydrationWarning>
              Fills in the <b>{formatEtTime(batchAt)} ET</b> <Term k="batch">batch</Term>
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
            <button type="submit" className={`${styles.submit} ${side === "sell" ? styles.sell : ""}`} disabled={busy || !qty || !tradingOpen || buyBlocked}>
              {busy
                ? "SENDING…"
                : !tradingOpen
                  ? "MARKET CLOSED"
                  : buyBlocked
                    ? frozen
                      ? "FROZEN FOR A BUYBACK"
                      : "SOLD OUT"
                    : frozen
                      ? `SELL ${qty.toLocaleString("en-US")} TO THE BROKER`
                      : `${side.toUpperCase()} ${qty.toLocaleString("en-US")} ${asset.symbol}${side === "buy" && forSale !== null && qty > forSale ? ` (${Math.floor(forSale).toLocaleString("en-US")} LEFT)` : ""}`}
            </button>
          </form>
        )
  );
}
