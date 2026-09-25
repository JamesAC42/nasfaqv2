"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/admin/admin-frame.module.scss";

// Chrome for every /admin page: the site shell, the admin sub-nav and a header. Mirrors
// PredictionsFrame so the back office reads like the rest of the site.

export type AdminAccess = {
  initialized: boolean;
  signedIn: boolean;
  username: string | null;
  userId: string | null;
  isAdmin: boolean;
  /** Admins and asset managers. */
  canAssets: boolean;
  /** Anyone who can work the predictions control room or create markets. */
  canPredictions: boolean;
  /** Holds any staff role at all. */
  isStaff: boolean;
};

export function useAdminAccess(): AdminAccess {
  const { user, initialized } = useAuth();
  const u = user as (typeof user & Record<string, unknown>) | null;
  const isAdmin = Boolean(u?.is_admin);
  const canAssets = Boolean(isAdmin || u?.can_manage_assets);
  const canPredictions = Boolean(
    isAdmin || u?.can_create_prediction_markets || u?.can_approve_prediction_markets || u?.can_resolve_prediction_markets || u?.can_void_prediction_markets,
  );
  return {
    initialized,
    signedIn: Boolean(u),
    username: u?.username ? String(u.username) : null,
    userId: u?.id !== undefined && u?.id !== null ? String(u.id) : null,
    isAdmin,
    canAssets,
    canPredictions,
    isStaff: isAdmin || canAssets || canPredictions,
  };
}

/** Where a predictions staffer should land: the control room, or the create form for creators only. */
export function predictionsHref(access: AdminAccess, user: Record<string, unknown> | null) {
  if (access.isAdmin) return "/predictions/manage";
  const mod = Boolean(user?.can_approve_prediction_markets || user?.can_resolve_prediction_markets || user?.can_void_prediction_markets);
  return mod ? "/predictions/manage" : "/predictions/create";
}

type NavItem = { href: string; label: string; show: boolean; exact?: boolean; external?: boolean };

/** Re-renders every `ms` so "synced 12s ago" and countdowns tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

type FrameProps = {
  kicker?: string;
  title: string;
  blurb?: ReactNode;
  aside?: ReactNode;
  live?: boolean;
  children: ReactNode;
};

export function AdminFrame({ kicker = "Back office", title, blurb, aside, live = false, children }: FrameProps) {
  const pathname = usePathname() || "/admin";
  const access = useAdminAccess();
  const { user } = useAuth();
  const items: NavItem[] = [
    { href: "/admin", label: "Overview", show: access.isStaff, exact: true },
    { href: "/admin/market-tuning", label: "Market tuning", show: access.isAdmin },
    { href: "/admin/assets", label: "Assets & prizes", show: access.canAssets },
    { href: predictionsHref(access, user as Record<string, unknown> | null), label: "Predictions", show: access.canPredictions, external: true },
    { href: "/admin/people", label: "People & roles", show: access.isAdmin },
  ];
  const visible = items.filter((item) => item.show);

  return (
    <SiteShell>
      <div className={styles.page}>
        {visible.length ? (
          <nav className={styles.nav} aria-label="Admin">
            <div className={styles.navScroll}>
              {visible.map((item) => {
                const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <Link key={item.label} href={item.href} className={styles.navItem} aria-current={active ? "page" : undefined}>
                    {item.label}
                    {item.external ? <span aria-hidden="true"> ↗</span> : null}
                  </Link>
                );
              })}
            </div>
            <span className={styles.who}>
              <small>{access.isAdmin ? "ADMIN" : "STAFF"}</small>
              <b>{access.username}</b>
            </span>
          </nav>
        ) : null}
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

/** The polite "not for you" message every admin page shows to non-staff. */
export function AdminGate({ title, signedIn, need, headline = "Staff only." }: { title: string; signedIn: boolean; need: string; headline?: string }) {
  return (
    <AdminFrame title={title}>
      <div className={styles.gate} role="status">
        <b>{headline}</b>
        <p>{signedIn ? `This corner's for ${need}. Your account doesn't have that role.` : `This corner's for ${need}. Sign in with a staff account to get in.`}</p>
        <p className={styles.gateLinks}>
          {signedIn ? null : <Link href="/login">Sign in →</Link>}
          <Link href="/">Back to the market →</Link>
        </p>
      </div>
    </AdminFrame>
  );
}

export function AdminLoading({ title }: { title: string }) {
  return (
    <AdminFrame title={title}>
      <p className={styles.loading}>Loading…</p>
    </AdminFrame>
  );
}
