"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { HeroCast, type HeroTalent } from "@/app/components/common/hero-cast";
import { SceneArt } from "@/app/components/common/scene-art";
import { SiteShell } from "@/app/components/layout/site-shell";
import { money } from "@/app/lib/predictions/format";
import { sideModeFunds, sideModesUseCash } from "@/app/lib/economy";
import { useAuth } from "@/app/providers/auth-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/predictions/shell/predictions-frame.module.scss";

/** Who can see the staff pages. Mirrors the API's permission flags. */
export function useStaff() {
  const { user } = useAuth();
  const u = user as (typeof user & Record<string, unknown>) | null;
  const isStaff = Boolean(u && (u.is_admin || u.can_approve_prediction_markets || u.can_resolve_prediction_markets || u.can_void_prediction_markets));
  const canCreate = Boolean(u && (u.is_admin || u.can_create_prediction_markets));
  return { user, isStaff, canCreate, isAdmin: Boolean(u?.is_admin) };
}

/** What the signed-in player can bet (Credit: lib/economy.ts), fetched once; refresh after trades with refreshCash(). */
export function usePredictionCash() {
  const { user } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  useEffect(() => {
    if (user && !portfolio) void fetchPortfolio();
    // Load once per sign-in; trades refresh explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  return {
    signedIn: Boolean(user),
    cash: sideModeFunds(portfolio),
    credit: portfolio?.credit_balance ?? null,
    /** Cash itself, when bets dip into it once Credit runs out. */
    liquid: sideModesUseCash(portfolio) ? (portfolio?.cash_balance ?? null) : null,
    refreshCash: fetchPortfolio,
  };
}

type FrameProps = {
  kicker: string;
  title: string;
  blurb?: ReactNode;
  aside?: ReactNode;
  live?: boolean;
  /** The market page renders its own header. */
  bare?: boolean;
  /** Talents to stand in the header (HeroCast), e.g. the ones the live markets are about. */
  cast?: HeroTalent[];
  children: ReactNode;
};

export function PredictionsFrame({ kicker, title, blurb, aside, live = false, bare = false, cast, children }: FrameProps) {
  const pathname = usePathname() || "/predictions";
  const { isStaff, canCreate } = useStaff();
  const { signedIn, credit, liquid } = usePredictionCash();
  const items = [
    { href: "/predictions", label: "Floor", exact: true },
    { href: "/predictions/portfolio", label: "My bets", show: signedIn },
    { href: "/predictions/create", label: "New market", show: canCreate },
    { href: "/predictions/manage", label: "Admin", show: isStaff },
  ].filter((item) => item.show !== false);

  return (
    <SiteShell>
      <div className={styles.page}>
        <nav className={styles.nav} aria-label="Predictions">
          <div className={styles.navScroll}>
            {items.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={styles.navItem} aria-current={active ? "page" : undefined}>
                  {item.label}
                </Link>
              );
            })}
          </div>
          {signedIn ? (
            <span className={styles.cash} title="Credit: what predictions spend first">
              <small>CREDIT</small>
              <b>{credit === null ? "…" : money(credit)}</b>
            </span>
          ) : null}
          {signedIn && liquid !== null ? (
            <span className={styles.cash} title="Cash: bets use it once your Credit runs out">
              <small>CASH</small>
              <b>{money(liquid)}</b>
            </span>
          ) : null}
        </nav>
        {bare ? null : (
          <header className={styles.head}>
            {pathname.startsWith("/predictions/manage") ? null : <SceneArt slot="predictions-hero" fill position="80% 50%" width={1440} className={styles.headArt} />}
            {cast?.length ? <HeroCast talents={cast} className={styles.headCast} /> : null}
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
        )}
        {children}
      </div>
    </SiteShell>
  );
}
