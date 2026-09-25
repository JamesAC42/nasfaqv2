"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { usePredictionCash } from "@/app/components/predictions/shell/predictions-frame";
import { centsFine, inkOn, isTradeable, signedMoney, tone, useNow } from "@/app/components/predictions/market/shared";
import { fetchQuote, placeLimitOrder, trade, type PredictionApiError } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { cents, centsDelta, money, outcomeColor, shares as fmtShares, timeLeft } from "@/app/lib/predictions/format";
import type { Outcome, PredictionMarketDetail, Quote } from "@/app/lib/predictions/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/predictions/market/ticket.module.scss";

export type TicketTab = "buy" | "sell" | "limit";
/** What the page asks the ticket to show (a row's Buy, a position's Sell). A new `n` re-mounts it. */
export type TicketIntent = { outcome: string; tab: TicketTab; sellAll?: boolean; n: number };

type QuoteBody = NonNullable<Quote["quote"]>;
type Done =
  | { kind: "buy"; label: string; shares: number; avg: number; cash: number }
  | { kind: "sell"; label: string; shares: number; avg: number; cash: number }
  | { kind: "limit"; label: string; side: "buy" | "sell"; limit: number; filled: number; resting: boolean };

const BUY_PRESETS = [10, 50, 100, 500];
const SELL_PRESETS = [25, 50, 100];
const MAX_TRADE = 25_000;

const parse = (text: string) => {
  const value = Number(String(text).replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? value : NaN;
};
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
/** Share counts in the input: two decimals, rounded down so "All" never asks for more than you hold. */
const floor2 = (value: number) => Math.floor(value * 100 + 1e-6) / 100;
const wholeMoney = (value: number) => money(value, Number.isInteger(value) ? 0 : 2);
const upper = (text: string) => text.toUpperCase();

export function Ticket({ market, intent, onTraded }: { market: PredictionMarketDetail; intent: TicketIntent; onTraded: () => void }) {
  const { user } = useAuth();
  const { cash: frameCash, refreshCash } = usePredictionCash();
  const signedIn = Boolean(user);
  const tradeable = isTradeable(market);
  const cash = frameCash ?? market.mine?.cash_balance ?? null;

  const [tab, setTab] = useState<TicketTab>(intent.tab);
  const [code, setCode] = useState(intent.outcome);
  const heldOf = (outcomeCode: string) => market.mine?.positions.find((position) => position.outcome_code === outcomeCode)?.shares ?? 0;
  const [amount, setAmount] = useState("");
  const [sharesText, setSharesText] = useState(() => (intent.sellAll ? String(floor2(heldOf(intent.outcome))) : ""));
  const outcome = market.outcomes.find((entry) => entry.outcome_code === code) ?? market.outcomes[0];
  const [limitSide, setLimitSide] = useState<"buy" | "sell">("buy");
  const [limitCents, setLimitCents] = useState(() => Math.max(1, Math.min(99, Math.round(outcome.price * 100) - 5)));
  const [limitAmount, setLimitAmount] = useState("");
  const [limitShares, setLimitShares] = useState("");

  const [quote, setQuote] = useState<{ key: string; data: QuoteBody | null; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ key: string; quote: QuoteBody } | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const color = outcomeColor(market, outcome);
  const held = heldOf(outcome.outcome_code);
  const position = market.mine?.positions.find((entry) => entry.outcome_code === outcome.outcome_code) ?? null;

  // ── Live quote (debounced) ──────────────────────────────────────────────
  const buyValue = parse(amount);
  const sellValue = parse(sharesText);
  const request = useMemo(() => {
    if (!tradeable) return null;
    if (tab === "buy" && buyValue >= 1 && buyValue <= MAX_TRADE) return { key: `buy:${code}:${buyValue}`, params: { outcome: code, side: "buy" as const, amount: buyValue } };
    if (tab === "sell" && sellValue > 0) return { key: `sell:${code}:${sellValue}`, params: { outcome: code, side: "sell" as const, shares: sellValue } };
    return null;
  }, [tab, code, buyValue, sellValue, tradeable]);
  // Re-quote when the price moves under the ticket.
  const priceKey = Math.round(outcome.price * 10_000);

  useEffect(() => {
    if (!request) return;
    let alive = true;
    const id = setTimeout(() => {
      fetchQuote(market.slug, request.params)
        .then((result) => alive && setQuote({ key: request.key, data: result.quote, error: result.quote ? null : "Nothing fills at this size: the price is at its limit." }))
        .catch((reason) => alive && setQuote({ key: request.key, data: null, error: predictionErrorText(reason) }));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [market.slug, request, priceKey, nonce]);

  const live = request && quote?.key === request.key ? quote : null;
  const quoting = Boolean(request) && !live;
  const q = live?.data ?? null;
  const movedQuote = moved && request && moved.key === request.key ? moved.quote : null;

  // ── Validation ──────────────────────────────────────────────────────────
  let problem: string | null = null;
  if (tab === "buy" && amount) {
    if (!(buyValue >= 1)) problem = "Minimum is $1.";
    else if (buyValue > MAX_TRADE) problem = "Max is $25,000 per trade.";
    else if (signedIn && cash !== null && buyValue > cash + 0.001) problem = `You have ${money(cash)}.`;
  }
  if (tab === "sell" && sharesText) {
    if (!(sellValue > 0)) problem = "Enter a share count.";
    else if (sellValue > held + 0.005) problem = `You hold ${fmtShares(held)}.`;
  }
  const limitAmountValue = parse(limitAmount);
  const limitSharesValue = parse(limitShares);
  if (tab === "limit") {
    if (limitSide === "buy" && limitAmount) {
      if (!(limitAmountValue >= 1)) problem = "Minimum is $1.";
      else if (limitAmountValue > MAX_TRADE) problem = "Max is $25,000 per order.";
      else if (signedIn && cash !== null && limitAmountValue > cash + 0.001) problem = `You have ${money(cash)}.`;
    }
    if (limitSide === "sell" && limitShares) {
      if (!(limitSharesValue > 0)) problem = "Enter a share count.";
      else if (limitSharesValue > held + 0.005) problem = `You hold ${fmtShares(held)}.`;
    }
  }

  const reset = () => {
    setError(null);
    setMoved(null);
    setDone(null);
  };

  const pick = (next: Outcome) => {
    setCode(next.outcome_code);
    reset();
    if (tab === "sell") setSharesText("");
    if (tab === "limit") {
      setLimitCents(Math.max(1, Math.min(99, Math.round(next.price * 100) + (limitSide === "buy" ? -5 : 5))));
      setLimitShares("");
    }
  };

  const switchTab = (next: TicketTab) => {
    setTab(next);
    reset();
    if (next === "limit") setLimitCents(Math.max(1, Math.min(99, Math.round(outcome.price * 100) + (limitSide === "buy" ? -5 : 5))));
  };

  // ── Submit ──────────────────────────────────────────────────────────────
  const submitMarket = async () => {
    if (!request || busy) return;
    const guide = movedQuote ?? q;
    if (!guide) return;
    setBusy(true);
    setError(null);
    try {
      const sellAll = tab === "sell" && sellValue >= held - 0.01;
      const body =
        tab === "buy"
          ? { outcome: code, side: "buy" as const, amount: buyValue, max_avg_price: round6(guide.avg_price * 1.02) }
          : { outcome: code, side: "sell" as const, shares: sellAll ? held : sellValue, min_avg_price: round6(guide.avg_price * 0.98) };
      const result = await trade(market.slug, body);
      const fill = result.fill;
      setDone({ kind: fill.side, label: fill.outcome_label, shares: fill.shares, avg: fill.avg_price, cash: fill.cash });
      setMoved(null);
      if (tab === "buy") setAmount("");
      else setSharesText("");
      void refreshCash();
      onTraded();
    } catch (reason) {
      const apiError = reason as PredictionApiError;
      if (apiError.message === "price_moved" && apiError.body?.quote) {
        // The error's quote has the new fill but not the after-price or payout; fill those in.
        const fresh = apiError.body.quote as Partial<QuoteBody> & { shares: number; avg_price: number };
        setMoved({
          key: request.key,
          quote: {
            side: tab === "sell" ? "sell" : "buy",
            fee: 0,
            capped: null,
            ...fresh,
            price_after: fresh.price_after ?? q?.price_after ?? outcome.price,
            payout_if_right: fresh.payout_if_right ?? (tab === "buy" ? Math.round(fresh.shares * 100) / 100 : null),
          },
        });
        setNonce((value) => value + 1);
      } else {
        setError(predictionErrorText(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitLimit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const sellAll = limitSide === "sell" && limitSharesValue >= held - 0.01;
      const result = await placeLimitOrder(market.slug, {
        outcome: code,
        side: limitSide,
        limit_price: limitCents / 100,
        ...(limitSide === "buy" ? { amount: limitAmountValue } : { shares: sellAll ? held : limitSharesValue }),
      });
      const filled = result.fills.reduce((sum, fill) => sum + fill.shares, 0);
      setDone({ kind: "limit", label: outcome.label, side: limitSide, limit: limitCents / 100, filled, resting: result.order.status === "open" });
      setLimitAmount("");
      setLimitShares("");
      void refreshCash();
      onTraded();
    } catch (reason) {
      setError(predictionErrorText(reason));
    } finally {
      setBusy(false);
    }
  };

  // ── Views ───────────────────────────────────────────────────────────────
  if (!tradeable) return <ClosedTicket market={market} />;

  const style = { "--oc": color, "--oc-ink": inkOn(color) } as CSSProperties;
  const label = upper(outcome.label);
  const sellSide = tab === "sell" || (tab === "limit" && limitSide === "sell");

  let action = "";
  let ready = false;
  if (tab === "buy") {
    action = buyValue >= 1 ? `BUY ${label} · ${wholeMoney(buyValue)}` : `BUY ${label}`;
    ready = Boolean(q) && !problem && !quoting;
  } else if (tab === "sell") {
    const payout = (movedQuote ?? q)?.payout;
    action = sellValue > 0 ? `SELL ${fmtShares(sellValue)} ${label}${payout !== undefined ? ` · ${money(payout)}` : ""}` : `SELL ${label}`;
    ready = Boolean(q) && !problem && !quoting;
  } else {
    action =
      limitSide === "buy"
        ? `BUY ${label} ≤ ${limitCents}¢${limitAmountValue >= 1 ? ` · ${wholeMoney(limitAmountValue)}` : ""}`
        : `SELL ${limitSharesValue > 0 ? `${fmtShares(limitSharesValue)} ` : ""}${label} ≥ ${limitCents}¢`;
    ready = !problem && (limitSide === "buy" ? limitAmountValue >= 1 : limitSharesValue > 0);
  }
  if (movedQuote && tab !== "limit") action = `${action} · NEW PRICE`;

  return (
    <div className={styles.ticket} style={style}>
      <div className={styles.tabs} role="tablist" aria-label="Order type">
        {(["buy", "sell", "limit"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={styles.tab} onClick={() => switchTab(key)}>
            {key === "buy" ? "Buy" : key === "sell" ? "Sell" : "Limit"}
          </button>
        ))}
        {signedIn && cash !== null ? (
          <span className={styles.cash}>
            <small>Cash</small> {money(cash)}
          </span>
        ) : null}
      </div>

      {tab === "limit" ? (
        <div className={styles.sideToggle} role="group" aria-label="Limit side">
          {(["buy", "sell"] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-pressed={limitSide === side}
              onClick={() => {
                setLimitSide(side);
                setLimitCents(Math.max(1, Math.min(99, Math.round(outcome.price * 100) + (side === "buy" ? -5 : 5))));
                reset();
              }}
            >
              {side === "buy" ? "Buy when it drops" : "Sell when it rises"}
            </button>
          ))}
        </div>
      ) : null}

      <OutcomePicker market={market} value={outcome.outcome_code} onPick={pick} showHeld={sellSide} heldOf={heldOf} />

      {tab === "buy" ? (
        <AmountField label="Amount" prefix="$" value={amount} onChange={(value) => { setAmount(value); reset(); }} placeholder="0" id={`amt-${market.id}`}>
          {BUY_PRESETS.map((preset) => (
            <button key={preset} type="button" onClick={() => { setAmount(String(preset)); reset(); }}>
              ${preset}
            </button>
          ))}
          {signedIn && cash !== null && cash >= 1 ? (
            <button type="button" onClick={() => { setAmount(String(Math.floor(Math.min(cash, MAX_TRADE) * 100) / 100)); reset(); }}>
              Max
            </button>
          ) : null}
        </AmountField>
      ) : null}

      {tab === "sell" ? (
        held > 0 ? (
          <AmountField label={`Shares · you hold ${fmtShares(held)}`} value={sharesText} onChange={(value) => { setSharesText(value); reset(); }} placeholder="0" id={`sh-${market.id}`}>
            {SELL_PRESETS.map((pct) => (
              <button key={pct} type="button" onClick={() => { setSharesText(String(pct === 100 ? floor2(held) : Math.floor(held * pct) / 100)); reset(); }}>
                {pct === 100 ? "All" : `${pct}%`}
              </button>
            ))}
          </AmountField>
        ) : (
          <p className={styles.note}>
            {signedIn ? `You don't hold any ${outcome.label}.` : "Sign in to see your shares."}{" "}
            <button type="button" className={styles.linkish} onClick={() => switchTab("buy")}>
              Buy some
            </button>
          </p>
        )
      ) : null}

      {tab === "limit" ? (
        <LimitFields
          market={market}
          outcome={outcome}
          side={limitSide}
          cents={limitCents}
          onCents={(value) => { setLimitCents(value); reset(); }}
          amount={limitAmount}
          onAmount={(value) => { setLimitAmount(value); reset(); }}
          sharesText={limitShares}
          onShares={(value) => { setLimitShares(value); reset(); }}
          held={held}
          cash={signedIn ? cash : null}
        />
      ) : null}

      {tab !== "limit" ? <QuoteView tab={tab} outcome={outcome} quote={movedQuote ?? q} quoting={quoting} error={live?.error ?? null} position={position} amount={buyValue} /> : null}

      {movedQuote ? (
        <p className={styles.moved} role="status">
          <b>Price moved.</b> Now {fmtShares(movedQuote.shares)} shares at {centsFine(movedQuote.avg_price)} avg. Hit it again to take it.
        </p>
      ) : null}

      {problem ? <p className={styles.problem}>{problem}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {signedIn ? (
        <button type="button" className={styles.go} disabled={!ready || busy} onClick={tab === "limit" ? submitLimit : submitMarket}>
          {busy ? "Sending…" : tab === "limit" ? `PLACE · ${action}` : action}
        </button>
      ) : (
        <Link href="/login" className={styles.go}>
          Sign in to trade
        </Link>
      )}

      <p className={styles.small}>
        {market.fee_bps / 100}% fee · {tab === "limit" ? "cancel any time" : "fills instantly against the market maker"}
      </p>

      <div aria-live="polite" className={styles.doneSlot}>
        {done ? <DoneMoment done={done} onClose={() => setDone(null)} /> : null}
      </div>
    </div>
  );
}

function OutcomePicker({ market, value, onPick, showHeld, heldOf }: { market: PredictionMarketDetail; value: string; onPick: (outcome: Outcome) => void; showHeld: boolean; heldOf: (code: string) => number }) {
  if (market.market_type === "binary") {
    return (
      <div className={styles.binary} role="radiogroup" aria-label="Outcome">
        {market.outcomes.map((outcome) => {
          const color = outcomeColor(market, outcome);
          const held = heldOf(outcome.outcome_code);
          return (
            <button
              key={outcome.outcome_code}
              type="button"
              role="radio"
              aria-checked={value === outcome.outcome_code}
              className={styles.big}
              style={{ "--oc": color, "--oc-ink": inkOn(color) } as CSSProperties}
              onClick={() => onPick(outcome)}
            >
              <span>{outcome.label}</span>
              <b>{cents(outcome.price)}</b>
              {showHeld && held > 0 ? <small>{fmtShares(held)} held</small> : null}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className={styles.multi} role="radiogroup" aria-label="Outcome">
      {market.outcomes.map((outcome) => {
        const color = outcomeColor(market, outcome);
        const held = heldOf(outcome.outcome_code);
        return (
          <button
            key={outcome.outcome_code}
            type="button"
            role="radio"
            aria-checked={value === outcome.outcome_code}
            className={styles.row}
            style={{ "--oc": color } as CSSProperties}
            onClick={() => onPick(outcome)}
          >
            {outcome.asset ? <Oshimark icon={outcome.asset.icon} symbol={outcome.asset.symbol} size={18} /> : <i aria-hidden="true" />}
            <span>{outcome.label}</span>
            {showHeld && held > 0 ? <small>{fmtShares(held)}</small> : null}
            <b>{cents(outcome.price)}</b>
          </button>
        );
      })}
    </div>
  );
}

function AmountField({ label, prefix, value, onChange, placeholder, id, children }: { label: string; prefix?: string; value: string; onChange: (value: string) => void; placeholder: string; id: string; children?: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.input}>
        {prefix ? <span aria-hidden="true">{prefix}</span> : null}
        <input id={id} inputMode="decimal" autoComplete="off" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ""))} />
      </div>
      {children ? <div className={styles.presets}>{children}</div> : null}
    </div>
  );
}

function QuoteView({ tab, outcome, quote, quoting, error, position, amount }: { tab: "buy" | "sell"; outcome: Outcome; quote: QuoteBody | null; quoting: boolean; error: string | null; position: { avg_price: number } | null; amount: number }) {
  if (error && !quoting) return <p className={styles.problem}>{error}</p>;
  const empty = !quote;
  const move = quote ? quote.price_after - outcome.price : 0;
  return (
    <dl className={`${styles.quote} ${quoting ? styles.quoting : ""} ${empty ? styles.blank : ""}`} aria-busy={quoting}>
      {tab === "buy" ? (
        <>
          <div>
            <dt>Shares</dt>
            <dd>{quote ? fmtShares(quote.shares) : "—"}</dd>
          </div>
          <div>
            <dt>Avg price</dt>
            <dd>{quote ? centsFine(quote.avg_price) : "—"}</dd>
          </div>
          <div>
            <dt>Price after</dt>
            <dd>
              {quote ? (
                <>
                  {cents(outcome.price)} → {cents(quote.price_after)} <em data-tone={tone(move, 0.004)}>{centsDelta(move)}</em>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>{quote ? money(quote.fee) : "—"}</dd>
          </div>
          <div className={styles.payout}>
            <dt>Payout if {outcome.label}</dt>
            <dd>{quote?.payout_if_right !== null && quote?.payout_if_right !== undefined ? money(quote.payout_if_right) : "—"}</dd>
          </div>
          <div className={styles.profit}>
            <dt>Profit</dt>
            <dd data-tone={quote ? "up" : undefined}>
              {quote && quote.payout_if_right !== null ? (
                <>
                  {signedMoney(quote.payout_if_right - (quote.total ?? amount))} <small>({Math.round(((quote.payout_if_right - (quote.total ?? amount)) / (quote.total ?? amount)) * 100)}%)</small>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          {quote?.capped === "price" ? <p className={styles.cap}>Hits the 99¢ rail: only {money(quote.total ?? 0)} of it fills.</p> : null}
          {quote?.capped === "position" ? <p className={styles.cap}>Position cap is 25,000 shares: this fills up to it.</p> : null}
        </>
      ) : (
        <>
          <div>
            <dt>Avg price</dt>
            <dd>{quote ? centsFine(quote.avg_price) : "—"}</dd>
          </div>
          <div>
            <dt>Price after</dt>
            <dd>
              {quote ? (
                <>
                  {cents(outcome.price)} → {cents(quote.price_after)} <em data-tone={tone(move, 0.004)}>{centsDelta(move)}</em>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>{quote ? money(quote.fee) : "—"}</dd>
          </div>
          <div className={styles.payout}>
            <dt>You get</dt>
            <dd>{quote?.payout !== undefined ? money(quote.payout) : "—"}</dd>
          </div>
          {position && quote?.payout !== undefined ? (
            <div className={styles.profit}>
              <dt>P&amp;L on these</dt>
              <dd data-tone={tone(quote.payout - position.avg_price * quote.shares, 0.005)}>{signedMoney(quote.payout - position.avg_price * quote.shares)}</dd>
            </div>
          ) : null}
          {quote?.capped === "price" ? <p className={styles.cap}>Hits the 1¢ rail: only {fmtShares(quote.shares)} shares sell.</p> : null}
        </>
      )}
    </dl>
  );
}

function LimitFields({
  market,
  outcome,
  side,
  cents: limit,
  onCents,
  amount,
  onAmount,
  sharesText,
  onShares,
  held,
  cash,
}: {
  market: PredictionMarketDetail;
  outcome: Outcome;
  side: "buy" | "sell";
  cents: number;
  onCents: (value: number) => void;
  amount: string;
  onAmount: (value: string) => void;
  sharesText: string;
  onShares: (value: string) => void;
  held: number;
  cash: number | null;
}) {
  const now = Math.round(outcome.price * 100);
  const amountValue = parse(amount);
  const sharesValue = parse(sharesText);
  const crosses = side === "buy" ? limit >= now : limit <= now;
  const clamp = (value: number) => Math.max(1, Math.min(99, Math.round(value) || 1));
  return (
    <>
      <div className={styles.field}>
        <label htmlFor={`lp-${market.id}`}>
          Limit price <span>now {now}¢</span>
        </label>
        <div className={styles.limitRow}>
          <input
            type="range"
            min={1}
            max={99}
            step={1}
            value={limit}
            onChange={(event) => onCents(clamp(Number(event.target.value)))}
            aria-label="Limit price slider"
            style={{ "--fill": `${((limit - 1) / 98) * 100}%`, "--now": `${((now - 1) / 98) * 100}%` } as CSSProperties}
          />
          <div className={styles.input}>
            <input id={`lp-${market.id}`} inputMode="numeric" value={String(limit)} onChange={(event) => onCents(clamp(Number(event.target.value.replace(/\D/g, ""))))} />
            <span aria-hidden="true">¢</span>
          </div>
        </div>
      </div>
      {side === "buy" ? (
        <AmountField label="Spend up to" prefix="$" value={amount} onChange={onAmount} placeholder="0" id={`la-${market.id}`}>
          {BUY_PRESETS.map((preset) => (
            <button key={preset} type="button" onClick={() => onAmount(String(preset))}>
              ${preset}
            </button>
          ))}
          {cash !== null && cash >= 1 ? (
            <button type="button" onClick={() => onAmount(String(Math.floor(Math.min(cash, MAX_TRADE) * 100) / 100))}>
              Max
            </button>
          ) : null}
        </AmountField>
      ) : held > 0 ? (
        <AmountField label={`Shares · you hold ${fmtShares(held)}`} value={sharesText} onChange={onShares} placeholder="0" id={`ls-${market.id}`}>
          {SELL_PRESETS.map((pct) => (
            <button key={pct} type="button" onClick={() => onShares(String(pct === 100 ? floor2(held) : Math.floor(held * pct) / 100))}>
              {pct === 100 ? "All" : `${pct}%`}
            </button>
          ))}
        </AmountField>
      ) : (
        <p className={styles.note}>You need {outcome.label} shares to place a sell limit.</p>
      )}
      <p className={styles.explain}>
        {side === "buy" ? (
          crosses ? (
            <>
              {outcome.label} is {now}¢ now, so this <b>starts filling right away</b> and keeps buying until the price reaches {limit}¢. Whatever&apos;s left rests.
            </>
          ) : (
            <>
              Fills when {outcome.label} <b>drops to {limit}¢ or less</b>, buying until the price climbs back to {limit}¢.
              {amountValue >= 1 ? <> About {fmtShares(Math.floor((amountValue * 0.99) / (limit / 100)))} shares if it all fills.</> : null} The cash is set aside now.
            </>
          )
        ) : crosses ? (
          <>
            {outcome.label} is {now}¢ now, so this <b>starts selling right away</b> down to {limit}¢. Whatever&apos;s left rests.
          </>
        ) : (
          <>
            Sells when {outcome.label} <b>rises to {limit}¢ or more</b>.{sharesValue > 0 ? <> About {money(sharesValue * (limit / 100) * 0.99)} if it all fills.</> : null} The shares are locked until it fills or you cancel.
          </>
        )}
      </p>
    </>
  );
}

function DoneMoment({ done, onClose }: { done: Done; onClose: () => void }) {
  return (
    <div className={styles.done}>
      <strong>{done.kind === "buy" ? "FILLED" : done.kind === "sell" ? "SOLD" : done.filled > 0 ? "FILLING" : "ORDER RESTING"}</strong>
      {done.kind === "buy" ? (
        <p>
          <b>+{fmtShares(done.shares)} {done.label}</b> at {centsFine(done.avg)} avg for {money(done.cash)}. Pays {money(done.shares)} if {done.label}.
        </p>
      ) : done.kind === "sell" ? (
        <p>
          <b>{fmtShares(done.shares)} {done.label}</b> sold at {centsFine(done.avg)} avg. {money(done.cash)} to your cash.
        </p>
      ) : (
        <p>
          {done.side === "buy" ? "Buy" : "Sell"} {done.label} {done.side === "buy" ? "≤" : "≥"} {cents(done.limit)}
          {done.filled > 0 ? <>: <b>{fmtShares(done.filled)} shares filled</b> right away{done.resting ? ", the rest is resting." : "."}</> : ". It's in your open orders."}
        </p>
      )}
      <button type="button" onClick={onClose}>
        OK
      </button>
    </div>
  );
}

function ClosedTicket({ market }: { market: PredictionMarketDetail }) {
  const now = useNow(1000);
  const proposal = market.proposals.find((entry) => entry.status === "proposed" || entry.status === "disputed") ?? null;
  const winner = market.outcomes.find((outcome) => outcome.is_winner) ?? null;
  let head = "Trading's closed";
  let body: React.ReactNode = "Waiting for the result.";
  if (market.status === "draft" || market.status === "pending_approval") {
    head = market.status === "draft" ? "Draft" : "Awaiting approval";
    body = "Trading opens once staff approve this market.";
  } else if (market.status === "rejected") {
    head = "Rejected";
    body = "Staff didn't approve this market, so it never opened.";
  } else if (market.status === "open" && market.trading_status === "halted") {
    head = "Trading's paused";
    body = "Staff halted this market. It picks back up when they resume it.";
  } else if (market.status === "open" && market.trading_status === "pending_open") {
    head = "Not open yet";
    body = <>Opens in {timeLeft(market.opens_at, now)}.</>;
  } else if (market.status === "resolving") {
    head = "Awaiting a call";
    body = <>A resolver posts the result with a source. Then there&apos;s a {market.dispute_hours}h window to dispute it.</>;
  } else if (proposal) {
    head = `Call: ${proposal.is_void ? "VOID" : proposal.outcome_label ?? "?"}`;
    body = new Date(proposal.window_ends_at).getTime() > now ? <>Dispute window ends in {timeLeft(proposal.window_ends_at, now)}.</> : <>Window&apos;s over. Settling soon.</>;
    if (market.status === "disputed") head = `Disputed: ${proposal.is_void ? "VOID" : proposal.outcome_label ?? "?"}`;
  } else if (market.status === "resolved") {
    head = `Resolved: ${winner?.label ?? market.resolution_outcome ?? "?"}`;
    body = "Winning shares paid $1 each.";
  } else if (market.status === "voided") {
    head = "Voided";
    body = "Everyone got back what they put in.";
  }
  const color = winner ? outcomeColor(market, winner) : undefined;
  return (
    <div className={styles.closed} style={color ? ({ "--oc": color } as CSSProperties) : undefined}>
      <strong>{head}</strong>
      <p>{body}</p>
    </div>
  );
}
