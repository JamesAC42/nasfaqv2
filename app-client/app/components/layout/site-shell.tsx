"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaDiscord } from "react-icons/fa6";
import { FiMoon, FiSun } from "react-icons/fi";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MarketTape } from "@/app/components/layout/market-tape";
import { MobileNav } from "@/app/components/layout/mobile-nav";
import { FillMomentLayer } from "@/app/components/moments/fill-moment";
import { TickMomentLayer } from "@/app/components/moments/tick-moment";
import { TradeDrawer } from "@/app/components/trade/trade-drawer";
import { PeekLayer } from "@/app/components/peek/peek-layer";
import { isActivePath, isGroupActive, NAV } from "@/app/components/layout/nav-config";
import { RailStatus, RailWorth } from "@/app/components/layout/rail-status";
import { useAuth } from "@/app/providers/auth-provider";
import { useMotion } from "@/app/providers/motion-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/layout/site-shell.module.scss";

function formatQuantity(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function OrdersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <path
        d="M5.75 4.5A2.25 2.25 0 0 0 3.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25h12.5a2.25 2.25 0 0 0 2.25-2.25V8.5a1 1 0 0 0-.29-.71l-3-3a1 1 0 0 0-.71-.29H5.75Zm0 2h10.34l2.41 2.41v8.34a.25.25 0 0 1-.25.25H5.75a.25.25 0 0 1-.25-.25V6.75a.25.25 0 0 1 .25-.25Zm2 4.25a1 1 0 1 1 0-2h6.5a1 1 0 1 1 0 2h-6.5Zm0 4a1 1 0 1 1 0-2h8.5a1 1 0 1 1 0 2h-8.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SiteShell({
  children,
  fullBleed = false,
  hideFooter = false,
  hideRibbon = false,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
  hideFooter?: boolean;
  /** Hides the price tape (kept under its old name for existing callers). */
  hideRibbon?: boolean;
}) {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { calm, toggleCalm } = useMotion();
  const assets = useMarketStore((state) => state.assets);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const pendingOrders = useProfileStore((state) => state.pendingLiveOrders);
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const fetchPortfolioOrders = useProfileStore((state) => state.fetchPortfolioOrders);
  const clearPendingLiveOrders = useProfileStore((state) => state.clearPendingLiveOrders);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isOrdersOpen, setIsOrdersOpen] = useState(false);
  const [liveOrderNotice, setLiveOrderNotice] = useState<string | null>(null);
  const hasRequestedOverviewRef = useRef(false);
  const hasRequestedPortfolioRef = useRef<number | null>(null);
  const pendingOrderIdsRef = useRef<Set<number> | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const ordersRef = useRef<HTMLDivElement | null>(null);

  // Remember the last page outside the account screens, so signing in returns there.
  useEffect(() => {
    if (/^\/(login|register|verify-email|dev)(\/|$)/.test(pathname)) return;
    try {
      window.sessionStorage.setItem("nasfaq.returnTo", `${pathname}${window.location.search}`);
    } catch {
      /* storage blocked */
    }
  }, [pathname]);

  // ── Data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (assets.length || hasRequestedOverviewRef.current) return;
    hasRequestedOverviewRef.current = true;
    void refreshOverview();
  }, [assets.length, refreshOverview]);

  // Net worth in the rail needs the portfolio once per signed-in user.
  useEffect(() => {
    if (!user || portfolio || hasRequestedPortfolioRef.current === user.id) return;
    hasRequestedPortfolioRef.current = user.id;
    void fetchPortfolio();
  }, [fetchPortfolio, portfolio, user]);

  useEffect(() => {
    if (!user) {
      clearPendingLiveOrders();
      return;
    }
    void fetchPortfolioOrders();
    const interval = window.setInterval(fetchPortfolioOrders, 10_000);
    return () => window.clearInterval(interval);
  }, [clearPendingLiveOrders, fetchPortfolioOrders, user]);

  useEffect(() => {
    if (!user || !pendingOrders.length) return;
    const nextDueAt = pendingOrders
      .map((order) => (order.execute_after ? new Date(order.execute_after).getTime() : Number.NaN))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)[0];
    if (!nextDueAt) return;
    const delayMs = Math.max(1_000, nextDueAt - Date.now() + 1_500);
    const timer = window.setTimeout(fetchPortfolioOrders, delayMs);
    return () => window.clearTimeout(timer);
  }, [fetchPortfolioOrders, pendingOrders, user]);

  useEffect(() => {
    if (!user) {
      pendingOrderIdsRef.current = null;
      const timer = window.setTimeout(() => setLiveOrderNotice(null), 0);
      return () => window.clearTimeout(timer);
    }
    const nextIds = new Set(pendingOrders.map((order) => order.id));
    const previousIds = pendingOrderIdsRef.current;
    pendingOrderIdsRef.current = nextIds;
    if (!previousIds) return;
    const completedCount = Array.from(previousIds).filter((id) => !nextIds.has(id)).length;
    if (!completedCount) return;
    const timer = window.setTimeout(() => {
      setLiveOrderNotice(`${completedCount} order${completedCount === 1 ? "" : "s"} filled or closed in the last batch.`);
      setIsOrdersOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingOrders, user]);

  useEffect(() => {
    if (!liveOrderNotice) return;
    const timer = window.setTimeout(() => setLiveOrderNotice(null), 6200);
    return () => window.clearTimeout(timer);
  }, [liveOrderNotice]);

  // ── Menus close on outside click and Escape ──────────────────────────────
  useEffect(() => {
    if (!openMenu && !isOrdersOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (openMenu && !navRef.current?.contains(target)) setOpenMenu(null);
      if (isOrdersOpen && !ordersRef.current?.contains(target)) setIsOrdersOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenMenu(null);
      setIsOrdersOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOrdersOpen, openMenu]);

  // Pages use --site-shell-chrome-height to offset sticky elements below the header.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    if (!shell || !header || typeof ResizeObserver === "undefined") return;
    const update = () => shell.style.setProperty("--site-shell-chrome-height", `${header.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--site-shell-chrome-height");
    };
  }, []);

  const visiblePendingOrders = user ? pendingOrders : [];
  const profileHref = user ? "/profile" : "/login";
  const profileInitial = user?.username?.trim()?.charAt(0)?.toUpperCase() || "N";
  const profileImageUrl = user?.profile_picture_url?.trim() || null;
  const currentYear = new Date().getFullYear();

  return (
    <div ref={shellRef} className={styles.shell}>
      {liveOrderNotice ? (
        <div className={styles.toast} role="status">
          <strong>Batch settled</strong>
          <span>{liveOrderNotice}</span>
          <Link href="/profile" onClick={() => setLiveOrderNotice(null)}>
            View orders
          </Link>
        </div>
      ) : null}

      <header ref={headerRef} className={styles.header}>
        <div className={styles.rail}>
          <Link href="/" className={styles.logo} aria-label="NASFAQ home">
            <i aria-hidden="true" />
            nasfaq
          </Link>

          <nav ref={navRef} className={styles.nav} aria-label="Main">
            {NAV.map((group) => {
              const active = isGroupActive(pathname, group);
              if (group.href) {
                return (
                  <Link
                    key={group.key}
                    href={group.href}
                    className={styles.navItem}
                    aria-current={active ? "page" : undefined}
                  >
                    {group.label}
                  </Link>
                );
              }
              const open = openMenu === group.key;
              return (
                <div key={group.key} className={styles.navGroup}>
                  <button
                    type="button"
                    className={styles.navItem}
                    aria-expanded={open}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpenMenu(open ? null : group.key)}
                  >
                    {group.label}
                    <span className={styles.caret} aria-hidden="true" />
                  </button>
                  {open ? (
                    <div className={styles.menu}>
                      {(group.links ?? []).map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={styles.menuLink}
                          aria-current={isActivePath(pathname, link.href) ? "page" : undefined}
                          onClick={() => setOpenMenu(null)}
                        >
                          <b>{link.label}</b>
                          {link.hint ? <span>{link.hint}</span> : null}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>

          <div className={styles.spacer} />

          <div className={styles.statusWide}>
            <RailStatus />
          </div>
          <div className={styles.statusCompact}>
            <RailStatus compact />
          </div>

          <div className={styles.worthWrap}>
            <RailWorth />
          </div>

          {user ? (
            <div ref={ordersRef} className={styles.ordersWrap}>
              <button
                type="button"
                className={[styles.iconButton, visiblePendingOrders.length ? styles.iconButtonHot : ""].filter(Boolean).join(" ")}
                aria-label={`Pending orders: ${visiblePendingOrders.length}`}
                aria-expanded={isOrdersOpen}
                onClick={() => setIsOrdersOpen((current) => !current)}
              >
                <OrdersIcon />
                {visiblePendingOrders.length ? <span className={styles.badge}>{visiblePendingOrders.length}</span> : null}
              </button>
              {isOrdersOpen ? (
                <div className={styles.orders}>
                  <div className={styles.ordersHead}>
                    <strong>Queued orders</strong>
                    <span>{visiblePendingOrders.length} waiting</span>
                  </div>
                  <p className={styles.ordersCopy}>
                    Orders fill at the next 10-minute batch. Price, cash and holdings are rechecked then, so an order can still be rejected.
                  </p>
                  {visiblePendingOrders.length ? (
                    <div className={styles.ordersList}>
                      {visiblePendingOrders.slice(0, 5).map((order) => (
                        <Link
                          key={order.id}
                          href={`/stocks/${encodeURIComponent(order.symbol)}`}
                          className={styles.ordersItem}
                          onClick={() => setIsOrdersOpen(false)}
                        >
                          <span className={order.side === "buy" ? styles.buy : styles.sell}>
                            {order.side.toUpperCase()} {formatQuantity(order.requested_quantity)} {order.symbol}
                          </span>
                          <small>fills after {formatDateTime(order.execute_after)}</small>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.ordersEmpty}>Nothing queued.</div>
                  )}
                  <Link href="/profile" className={styles.ordersLink} onClick={() => setIsOrdersOpen(false)}>
                    All orders →
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={styles.prefs}>
            <button
              type="button"
              className={styles.textButton}
              aria-pressed={calm}
              onClick={toggleCalm}
              title="Turn off price flashes, the scrolling tape and big animations"
            >
              CALM
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <FiSun className={styles.icon} /> : <FiMoon className={styles.icon} />}
            </button>
          </div>

          <Link href={profileHref} className={user ? styles.profile : styles.signIn}>
            {user ? (
              <>
                <span className={styles.avatar} aria-hidden="true">
                  {profileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profileImageUrl} alt="" />
                  ) : (
                    profileInitial
                  )}
                </span>
                <span className={styles.profileName}>{user.username}</span>
              </>
            ) : isLoading ? (
              "…"
            ) : (
              "Sign in"
            )}
          </Link>
        </div>

        {!hideRibbon ? <MarketTape /> : null}
      </header>

      <main className={[styles.main, fullBleed ? styles.mainFullBleed : ""].filter(Boolean).join(" ")}>{children}</main>

      {!hideFooter ? (
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <Link href="/" className={styles.footerLogo}>
              <i aria-hidden="true" />
              nasfaq
            </Link>
            <nav className={styles.footerLinks} aria-label="Footer">
              <Link href="/how-to-play">How to play</Link>
              <Link href="/articles">Articles</Link>
              <Link href="/stocks">Stocks</Link>
              <Link href="/chat">Chat</Link>
              <Link href="/games">Games</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Usage policy</Link>
            </nav>
            <div className={styles.footerSocial}>
              <a href="https://ko-fi.com/L3L446W4T" target="_blank" rel="noopener noreferrer" className={styles.kofi}>
                Support on Ko-fi
              </a>
              <a
                href="https://discord.gg/Bw4S6EbBNW"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.iconButton}
                aria-label="Join NASFAQ on Discord"
              >
                <FaDiscord aria-hidden className={styles.icon} />
              </a>
            </div>
            <p className={styles.footerMeta}>
              © {currentYear} NASFAQ · Fan-made, not affiliated with COVER Corp. · Contact{" "}
              <a href="mailto:nasfaqsite@gmail.com" className={styles.footerContact}>
                nasfaqsite@gmail.com
              </a>
            </p>
          </div>
        </footer>
      ) : null}

      <MobileNav />
      <PeekLayer />
      <TickMomentLayer />
      <FillMomentLayer />
      <TradeDrawer />
    </div>
  );
}
