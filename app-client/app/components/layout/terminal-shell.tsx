"use client";

import Link from "next/link";
import { memo, useMemo, type ReactNode } from "react";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { SiteShell } from "@/app/components/layout/site-shell";
import styles from "@/app/components/layout/terminal-shell.module.scss";

function fmtCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function useMarketTime() {
  const now = new Date();
  return {
    localTime: fmtTime(now),
    utcTime: fmtTime(new Date(now.toISOString())),
  };
}

type MarketState = "open" | "closed" | "settlement";

function getMarketStateLabel(state: MarketState): string {
  switch (state) {
    case "open": return "MARKET OPEN";
    case "closed": return "MARKET CLOSED";
    case "settlement": return "SETTLEMENT";
    default: return "UNKNOWN";
  }
}

const StatusBar = memo(function StatusBar() {
  const { user } = useAuth();
  const marketStatus = useMarketStore((s) => s.marketStatus);
  const portfolio = useProfileStore((s) => s.portfolio);
  const { localTime } = useMarketTime();

  const marketState: MarketState = useMemo(() => {
    if (!marketStatus) return "closed";
    if (marketStatus.active_phase === "settlement" || marketStatus.trading_status === "settling") return "settlement";
    return marketStatus.is_trading_open ? "open" : "closed";
  }, [marketStatus]);

  const cashBalance = portfolio?.cash_balance ?? null;
  const totalEquity = portfolio?.total_equity ?? null;

  return (
    <div className={styles.statusBar}>
      <div className={styles.statusLeft}>
        <div className={styles.statusItem}>
          <span
            className={`${styles.statusDot} ${
              marketState === "open"
                ? styles.statusDotLive
                : marketState === "closed"
                ? styles.statusDotClosed
                : ""
            }`}
          />
          <span className={styles.statusValue}>{getMarketStateLabel(marketState)}</span>
        </div>
        {marketStatus?.current_market_date && (
          <div className={styles.statusItem}>
            <span className={styles.statusLabel}>Session</span>
            <span className={styles.statusValue}>{marketStatus.current_market_date}</span>
          </div>
        )}
      </div>

      <div className={styles.statusCenter}>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>Local</span>
          <span className={styles.statusValue}>{localTime}</span>
        </div>
      </div>

      <div className={styles.statusRight}>
        {user && (
          <>
            <div className={styles.statusItem}>
              <span className={styles.statusLabel}>Cash</span>
              <span className={`${styles.statusValue} ${styles.statusValueAccent}`}>
                {fmtCurrency(cashBalance)} CR
              </span>
            </div>
            {totalEquity !== null && (
              <div className={styles.statusItem}>
                <span className={styles.statusLabel}>Equity</span>
                <span className={styles.statusValue}>{fmtCurrency(totalEquity)} CR</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

type RoomHeaderProps = {
  title: string;
  icon?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  meta?: ReactNode;
};

export const RoomHeader = memo(function RoomHeader({
  title,
  icon,
  breadcrumbs,
  meta,
}: RoomHeaderProps) {
  return (
    <div className={styles.roomHeader}>
      {icon && <span className={styles.roomIcon}>{icon}</span>}
      <h1 className={styles.roomTitle}>{title}</h1>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className={styles.roomBreadcrumb} aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.label}>
              {index > 0 && <span className={styles.roomBreadcrumbSeparator}>/</span>}
              {crumb.href ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      {meta && <div className={styles.roomMeta}>{meta}</div>}
    </div>
  );
});

type TerminalShellProps = {
  children: ReactNode;
  fullBleed?: boolean;
  hideFooter?: boolean;
  hideRibbon?: boolean;
  hideStatusBar?: boolean;
};

export function TerminalShell({
  children,
  fullBleed = false,
  hideFooter = false,
  hideRibbon = false,
  hideStatusBar = false,
}: TerminalShellProps) {
  return (
    <SiteShell fullBleed={fullBleed} hideFooter={hideFooter} hideRibbon={hideRibbon}>
      <div className={styles.terminalWrapper}>
        <div
          className={`${styles.terminalContent} ${
            fullBleed ? styles.terminalContentFullBleed : ""
          }`}
        >
          {children}
        </div>
      </div>
      {!hideStatusBar && <StatusBar />}
    </SiteShell>
  );
}

export default TerminalShell;
