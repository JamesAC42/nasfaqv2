"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { useAuth } from "@/app/providers/auth-provider";
import { useExchangeStore } from "@/app/stores/exchange-store";
import styles from "@/app/components/games/exchange/exchange.module.scss";

const TABS = [
  { href: "/games/exchange", label: "Market", exact: true },
  { href: "/games/exchange/desk", label: "My desk" },
  { href: "/games/exchange/trades", label: "Trades" },
];

/** The exchange's pages share this header: title, a line, and Market / My desk / Trades. */
export function ExchangeFrame({ title = "Card Exchange", blurb, children }: { title?: string; blurb?: ReactNode; children: ReactNode }) {
  const pathname = usePathname() || "/games/exchange";
  const { user } = useAuth();
  const incoming = useExchangeStore((state) => state.desk?.incoming_offers ?? 0);
  const loadDesk = useExchangeStore((state) => state.loadDesk);
  const loadPrices = useExchangeStore((state) => state.loadPrices);

  useEffect(() => {
    void loadPrices();
    if (user) void loadDesk();
  }, [user, loadDesk, loadPrices]);

  const aside = (
    <nav className={styles.subnav} aria-label="Exchange">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href || pathname.startsWith("/games/exchange/card/") : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={styles.subtab} aria-current={active ? "page" : undefined}>
            {tab.label}
            {tab.label === "Trades" && incoming > 0 ? <span className={styles.badge}>{incoming}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <GamesFrame
      kicker="Talent cards"
      title={title}
      live
      blurb={blurb ?? <>Buy, sell and auction cards for cash, or trade straight with another player. Every sale sets the price.</>}
      aside={aside}
    >
      {children}
    </GamesFrame>
  );
}
