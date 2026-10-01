"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { FaArrowRightArrowLeft } from "react-icons/fa6";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { useOwnedCards } from "@/app/components/games/exchange/use-owned-cards";
import { SignInToPlay } from "@/app/components/games/shell/games-frame";
import { fetchTrades, respondTrade, sideValue, type PriceBook, type Trade, type TradeSide, type TradesResponse } from "@/app/lib/games/exchange";
import { gameErrorText } from "@/app/lib/games/errors";
import { fmtInteger } from "@/app/lib/format";
import { useGamesEvents } from "@/app/lib/games/use-games-socket";
import { money } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useExchangeStore } from "@/app/stores/exchange-store";
import { useGamesStore } from "@/app/stores/games-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { Countdown, ago } from "@/app/components/games/exchange/bits";
import { ExchangeFrame } from "@/app/components/games/exchange/exchange-frame";
import { ItemArt } from "@/app/components/games/exchange/item-art";
import styles from "@/app/components/games/exchange/exchange.module.scss";

const STATUS: Record<Trade["status"], string> = {
  pending: "Pending",
  accepted: "Done",
  declined: "Declined",
  cancelled: "Withdrawn",
  expired: "Expired",
  countered: "Countered",
};

/** Your trade offers: waiting on you, waiting on them, and what's happened. */
export function TradesPage() {
  const { user, initialized } = useAuth();
  const prices = useExchangeStore((state) => state.prices);
  const [trades, setTrades] = useState<TradesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchTrades()
      .then(setTrades)
      .catch((reason) => setError(gameErrorText(reason)));
    void useExchangeStore.getState().loadDesk();
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);
  useGamesEvents(user ? "me" : null, load);

  if (initialized && !user) {
    return (
      <ExchangeFrame title="Trades">
        <SignInToPlay what="trade cards with other players" />
      </ExchangeFrame>
    );
  }

  return (
    <ExchangeFrame title="Trades" blurb={<>Swap cards, cash and shards straight with another player. Offers hold your side in escrow for 48 hours.</>}>
      <div className={styles.tradeTop}>
        <Link href="/games/exchange/trades/new" className={styles.btnPrimary}>
          <FaArrowRightArrowLeft aria-hidden="true" /> New trade
        </Link>
        <p className={styles.note}>Find someone on the leaderboard or in chat and hit “Trade” on their profile, or start one here with their username.</p>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <TradeList title="Waiting on you" trades={trades?.incoming ?? null} prices={prices} empty="No offers waiting on you." onChange={load} />
      <TradeList title="Waiting on them" trades={trades?.outgoing ?? null} prices={prices} empty="You haven't sent any offers." onChange={load} />
      <TradeList title="History" trades={trades?.history ?? null} prices={prices} empty="Nothing yet." onChange={load} />
    </ExchangeFrame>
  );
}

function TradeList({ title, trades, prices, empty, onChange }: { title: string; trades: Trade[] | null; prices: PriceBook | null; empty: string; onChange: () => void }) {
  return (
    <section className={styles.tradeSection} aria-label={title}>
      <h2 className={styles.sectionTitle}>
        {title}
        {trades?.length ? <small>{trades.length}</small> : null}
      </h2>
      {trades === null ? (
        <p className={styles.note}>Loading…</p>
      ) : trades.length ? (
        <div className={styles.tradeList}>
          {trades.map((trade) => (
            <TradeCard key={trade.id} trade={trade} prices={prices} onChange={onChange} />
          ))}
        </div>
      ) : (
        <p className={styles.note}>{empty}</p>
      )}
    </section>
  );
}

/** One offer, both sides, from your point of view: what you'd give, what you'd get, and whether it's fair. */
export function TradeCard({ trade, prices, onChange }: { trade: Trade; prices: PriceBook | null; onChange?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const incoming = trade.direction === "incoming";
  const other = incoming ? trade.from : trade.to;
  const mine = incoming ? trade.ask : trade.give;
  const theirs = incoming ? trade.give : trade.ask;

  const act = async (action: "accept" | "decline" | "cancel") => {
    setBusy(action);
    setError(null);
    try {
      await respondTrade(trade.id, action);
      if (action === "accept") {
        void useProfileStore.getState().fetchPortfolio();
        void useGamesStore.getState().loadCollection({ quiet: true });
      }
      onChange?.();
    } catch (reason) {
      setError(gameErrorText(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={styles.trade} data-status={trade.status}>
      <header className={styles.tradeHead}>
        <PlayerAvatar username={other.username} color={other.profile_color} size={28} />
        <span>
          {incoming ? (
            <>
              <Link href={`/profile/${encodeURIComponent(other.username)}`}>{other.username}</Link> offers you a trade
            </>
          ) : (
            <>
              Your offer to <Link href={`/profile/${encodeURIComponent(other.username)}`}>{other.username}</Link>
            </>
          )}
          {trade.counter_of ? <em> · counter-offer</em> : null}
        </span>
        <span className={styles.tradeStatus} data-status={trade.status}>
          {trade.status === "pending" ? <Countdown endsAt={trade.expires_at} /> : `${STATUS[trade.status]} · ${ago(trade.responded_at ?? trade.created_at)}`}
        </span>
      </header>
      {trade.message ? <p className={styles.tradeMessage}>“{trade.message}”</p> : null}
      <div className={styles.tradeSides}>
        <TradeSideView label="You give" side={mine} />
        <span className={styles.tradeSwap} aria-hidden="true">
          <FaArrowRightArrowLeft />
        </span>
        <TradeSideView label="You get" side={theirs} theirs />
      </div>
      <ValueMeter give={mine} get={theirs} prices={prices} />
      {trade.status === "pending" ? (
        <div className={styles.dealActions}>
          {incoming ? (
            <>
              <button type="button" className={styles.btnPrimary} disabled={busy !== null} onClick={() => void act("accept")}>
                {busy === "accept" ? "Trading…" : "Accept"}
              </button>
              <Link href={`/games/exchange/trades/new?counter=${trade.id}`} className={styles.btnSecondary}>
                Counter
              </Link>
              <button type="button" className={styles.btnGhost} disabled={busy !== null} onClick={() => void act("decline")}>
                {busy === "decline" ? "…" : "Decline"}
              </button>
            </>
          ) : (
            <button type="button" className={styles.btnGhost} disabled={busy !== null} onClick={() => void act("cancel")}>
              {busy === "cancel" ? "…" : "Withdraw offer"}
            </button>
          )}
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

/** `theirs`: the other player's side, whose cards show as locked unless you own them too. */
function TradeSideView({ label, side, theirs = false }: { label: string; side: TradeSide; theirs?: boolean }) {
  const owns = useOwnedCards();
  const items = side.items ?? [];
  const empty = !side.cards.length && !items.length && !side.cash && !side.shards;
  return (
    <div className={styles.tradeSide}>
      <small className={styles.sideLabel}>{label}</small>
      {empty ? <p className={styles.note}>Nothing</p> : null}
      <div className={styles.tradeCards}>
        {side.cards.map((card) => (
          <span key={card.key} className={styles.tradeCard}>
            <TalentCard card={card} owned={!theirs || owns(card.key)} width={76} compact tilt={false} />
            {card.qty && card.qty > 1 ? <b className={styles.qty}>×{card.qty}</b> : null}
          </span>
        ))}
        {items.map((item) => (
          <span key={`item-${item.key}`} className={styles.tradeCard}>
            <ItemArt item={item} width={76} compact />
          </span>
        ))}
      </div>
      {side.cash || side.shards ? (
        <p className={styles.sideExtras}>
          {side.cash ? <b className={styles.cash}>{money(side.cash)}</b> : null}
          {side.shards ? (
            <b className={styles.shardAmount}>
              <i aria-hidden="true" />
              {fmtInteger(side.shards)}
            </b>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** Market value of each side (last sales, else floors) and how lopsided it is. */
type MeterSide = { cards: { key?: string; card_key?: string; qty?: number }[]; items?: { key: string }[]; cash: number };

export function ValueMeter({ give, get, prices }: { give: MeterSide; get: MeterSide; prices: PriceBook | null }) {
  const out = sideValue(prices, give);
  const inn = sideValue(prices, get);
  const total = out.value + inn.value;
  const share = total > 0 ? inn.value / total : 0.5;
  const diff = inn.value - out.value;
  const unpriced = out.unpriced + inn.unpriced;
  const verdict =
    total === 0 ? "No market prices for these cards yet" : Math.abs(diff) <= total * 0.08 ? "About even" : diff > 0 ? `You come out ~${money(diff, { compact: true })} ahead` : `You pay ~${money(-diff, { compact: true })} over`;
  return (
    <div className={styles.meter}>
      <div className={styles.meterBar} data-empty={total === 0 || undefined} style={{ "--share": share } as CSSProperties} aria-hidden="true">
        <i />
      </div>
      <p>
        <span>
          give <b>{money(out.value, { compact: true })}</b>
        </span>
        <span className={styles.meterVerdict} data-tone={total === 0 ? "none" : Math.abs(diff) <= total * 0.08 ? "even" : diff > 0 ? "up" : "down"}>
          {verdict}
        </span>
        <span>
          get <b>{money(inn.value, { compact: true })}</b>
        </span>
      </p>
      {unpriced ? <small className={styles.note}>{unpriced} {unpriced === 1 ? "thing has" : "things have"} no sales yet and count as $0 here.</small> : null}
    </div>
  );
}
