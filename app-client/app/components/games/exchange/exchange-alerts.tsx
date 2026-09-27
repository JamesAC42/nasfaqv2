"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { cardPath, type Alert } from "@/app/lib/games/exchange";
import { useGamesEvents, type GamesPayload } from "@/app/lib/games/use-games-socket";
import { money } from "@/app/lib/time";
import { useExchangeStore } from "@/app/stores/exchange-store";
import { useGamesStore } from "@/app/stores/games-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/exchange/exchange-alerts.module.scss";

type Toast = { id: number; alert: Alert };

/** What an alert says and where it goes. */
function describe(alert: Alert): { title: string; line: string; href: string; tone: "win" | "warn" | "info" } {
  const card = alert.card ? `${alert.card.name} ${alert.card.rarity}` : "a card";
  const trader = alert.trade ? (alert.trade.direction === "incoming" ? alert.trade.from.username : alert.trade.to.username) : "";
  switch (alert.kind) {
    case "sold":
      return { title: "Sold!", line: `${card} went to ${alert.buyer?.username ?? "someone"} for ${money(alert.price)}. You got ${money(alert.proceeds)}.`, href: "/games/exchange/desk", tone: "win" };
    case "won":
      return { title: "You won the auction", line: `${card} is yours for ${money(alert.price)}.`, href: "/games/collection", tone: "win" };
    case "bought":
      return { title: "It's yours", line: `${card} for ${money(alert.price)}.`, href: "/games/collection", tone: "win" };
    case "outbid":
      return { title: "You've been outbid", line: `${card} is at ${money(alert.amount ?? null)}. Your ${money(alert.your_bid)} is back in your cash.`, href: alert.card ? cardPath(alert.card.key) : "/games/exchange/desk", tone: "warn" };
    case "auction_lost":
      return { title: "Bought out", line: `Someone paid the buy-now on ${card}. Your ${money(alert.your_bid)} is back.`, href: "/games/exchange/desk", tone: "info" };
    case "bid_received":
      return { title: "New bid", line: `${alert.bidder?.username ?? "Someone"} bid ${money(alert.amount ?? null)} on your ${card}.`, href: "/games/exchange/desk", tone: "info" };
    case "expired":
      return { title: "Listing ended", line: `${card} didn't sell. It's back in your binder.`, href: "/games/exchange/desk", tone: "info" };
    case "trade_offer":
      return { title: "Trade offer", line: `${trader} wants to trade with you.`, href: "/games/exchange/trades", tone: "win" };
    case "trade_countered":
      return { title: "Counter-offer", line: `${trader} countered your offer.`, href: "/games/exchange/trades", tone: "info" };
    case "trade_accepted":
      return { title: "Trade done", line: `${trader} accepted your offer.`, href: "/games/collection", tone: "win" };
    case "trade_declined":
      return { title: "Offer declined", line: `${trader} passed. Your side is back with you.`, href: "/games/exchange/trades", tone: "info" };
    case "trade_cancelled":
      return { title: "Offer withdrawn", line: `${trader} withdrew their offer.`, href: "/games/exchange/trades", tone: "info" };
    case "trade_expired":
      return { title: "Offer expired", line: `Your offer to ${trader} ran out. Your side is back with you.`, href: "/games/exchange/trades", tone: "info" };
    default:
      return { title: "Exchange", line: "Something changed.", href: "/games/exchange", tone: "info" };
  }
}

/**
 * Your exchange alerts, anywhere on the site: sold, won, outbid, trade offers. Also refreshes
 * cash, the binder and the desk so every page agrees after something moves.
 */
export function ExchangeAlerts({ signedIn }: { signedIn: boolean }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const onAlert = useCallback(
    (payload: GamesPayload) => {
      if (payload.type !== "exchange_alert") return;
      const alert = payload.alert as Alert;
      const id = ++seq.current;
      setToasts((current) => [{ id, alert }, ...current].slice(0, 3));
      timers.current.set(id, window.setTimeout(() => dismiss(id), alert.kind === "outbid" ? 12_000 : 8_000));
      if (["sold", "won", "bought", "outbid", "auction_lost", "trade_accepted", "trade_declined", "trade_expired", "trade_countered", "expired"].includes(alert.kind)) {
        void useProfileStore.getState().fetchPortfolio();
        void useGamesStore.getState().loadCollection({ quiet: true });
      }
      void useExchangeStore.getState().loadDesk();
    },
    [dismiss],
  );
  useGamesEvents(signedIn ? "me" : null, onAlert);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((timer) => window.clearTimeout(timer));
  }, []);

  if (!toasts.length) return null;
  return (
    <div className={styles.stack} aria-live="polite">
      {toasts.map(({ id, alert }) => {
        const text = describe(alert);
        return (
          <div key={id} className={styles.toast} data-tone={text.tone} role="status">
            {alert.card ? (
              <span className={styles.art}>
                <TalentCard card={alert.card} width={52} compact tilt={false} />
              </span>
            ) : null}
            <span className={styles.body}>
              <b>{text.title}</b>
              <span>{text.line}</span>
              <Link href={text.href} onClick={() => dismiss(id)}>
                {alert.kind === "outbid" ? "Bid again" : alert.kind.startsWith("trade_offer") || alert.kind === "trade_countered" ? "Review" : "View"} →
              </Link>
            </span>
            <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => dismiss(id)}>
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
