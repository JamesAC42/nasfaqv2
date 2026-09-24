"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import { useAuth } from "@/app/providers/auth-provider";
import { useGamesStore } from "@/app/stores/games-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/shell/games-frame.module.scss";

export const GAMES_NAV = [
  { href: "/games", label: "Arcade", exact: true },
  { href: "/games/cards", label: "Card gacha" },
  { href: "/games/collection", label: "Collection" },
  { href: "/games/duel", label: "Oshi duel" },
  { href: "/games/blackjack", label: "Blackjack" },
  { href: "/games/high-low", label: "High-low" },
  { href: "/games/ticker-tap", label: "Ticker Tap" },
  { href: "/games/capsule", label: "Capsule" },
  { href: "/games/item-locker", label: "Locker" },
];

/** Cash and shards for the signed-in player, loaded once and kept fresh by game actions. */
export function useGamesWallet() {
  const { user } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const collection = useGamesStore((state) => state.collection);
  const loadCollection = useGamesStore((state) => state.loadCollection);

  useEffect(() => {
    if (!user) return;
    if (!portfolio) void fetchPortfolio();
    if (!collection) void loadCollection();
    // Load once per sign-in; actions refresh explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return {
    signedIn: Boolean(user),
    cash: portfolio?.cash_balance ?? null,
    shards: collection?.shards ?? null,
    refreshCash: fetchPortfolio,
  };
}

type GamesFrameProps = {
  kicker: string;
  title: string;
  /** One line under the title. Numbers inside <b> render mono. */
  blurb?: ReactNode;
  /** Right side of the header (tabs, a live count). */
  aside?: ReactNode;
  children: ReactNode;
  /** Live dot on the kicker (blue: live, never green/red). */
  live?: boolean;
};

export function GamesFrame({ kicker, title, blurb, aside, children, live = false }: GamesFrameProps) {
  const pathname = usePathname() || "/games";
  const wallet = useGamesWallet();

  return (
    <SiteShell>
      <div className={styles.page}>
        <nav className={styles.nav} aria-label="Games">
          <div className={styles.navScroll}>
            {GAMES_NAV.map((item) => {
              const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} className={styles.navItem} aria-current={active ? "page" : undefined}>
                  {item.label}
                </Link>
              );
            })}
          </div>
          {wallet.signedIn ? (
            <div className={styles.wallet} aria-label="Your wallet">
              <span title="Cash">
                <small>CASH</small>
                <b>{wallet.cash === null ? "…" : fmtNumber(wallet.cash, "$")}</b>
              </span>
              <span title="Shards: from duplicate cards and set rewards; spend them crafting cards">
                <small>SHARDS</small>
                <b className={styles.shards}>
                  <i aria-hidden="true" />
                  {wallet.shards === null ? "…" : fmtInteger(wallet.shards)}
                </b>
              </span>
            </div>
          ) : null}
        </nav>

        <header className={styles.head}>
          <div className={styles.title}>
            <span className={styles.kicker}>
              {live ? <i aria-hidden="true" /> : null}
              {kicker}
            </span>
            <h1>{title}</h1>
            {blurb ? <p>{blurb}</p> : null}
          </div>
          {aside ? <div className={styles.aside}>{aside}</div> : null}
        </header>

        {children}
      </div>
    </SiteShell>
  );
}

/** Inline sign-in prompt for games that need an account. */
export function SignInToPlay({ what = "play" }: { what?: string }) {
  return (
    <p className={styles.signIn}>
      <Link href="/login">Sign in</Link> or <Link href="/register">make an account</Link> to {what}. Every account starts with cash to spend.
    </p>
  );
}
