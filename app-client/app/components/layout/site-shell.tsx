"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiMoon, FiSun } from "react-icons/fi";
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Time } from "lightweight-charts";
import type { MarketIndexBundle } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/layout/site-shell.module.scss";

const CATEGORY_ITEMS = [
  {
    key: "news",
    label: "News",
    links: [
      { href: "/news", label: "News" },
      { href: "/livestreams", label: "Livestreams" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    links: [
      { href: "/market", label: "Reports" },
      { href: "/finance/activity", label: "Activity" },
      { href: "/indexes", label: "Indexes" },
      { href: "/stocks", label: "Stocks" },
      { href: "/finance/rankings", label: "Rankings" },
    ],
  },
  {
    key: "community",
    label: "Community",
    links: [
      { href: "/chat", label: "Chat" },
      { href: "/articles", label: "Articles" },
      { href: "/predictions", label: "Predictions" },
      { href: "/threads", label: "/vt/" },
      { href: "/leaderboard", label: "Leaderboard" },
    ],
  },
  {
    key: "games",
    label: "Games",
    links: [
      { href: "/games", label: "Games Hub" },
    ],
  },
] as const;

const RIBBON_SCROLL_DURATION_SECONDS = 95;
const RIBBON_SCROLL_DURATION_MS = RIBBON_SCROLL_DURATION_SECONDS * 1000;
const RIBBON_EPOCH_STORAGE_KEY = "nasfaq.ribbonAnimationEpoch";

function getRibbonAnimationEpoch() {
  if (typeof window === "undefined") return Date.now();

  const existing = window.sessionStorage.getItem(RIBBON_EPOCH_STORAGE_KEY);
  if (existing) {
    const parsed = Number(existing);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const epoch = Date.now();
  window.sessionStorage.setItem(RIBBON_EPOCH_STORAGE_KEY, String(epoch));
  return epoch;
}

function toChartTime(value: string): Time | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value as Time;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000) as Time;
}

function formatSignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatSignedValue(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;
}

function formatValue(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatIndexName(value: string) {
  return value.replace(/^hololive\s+/i, "");
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <path
        d="M12 3.75a4.5 4.5 0 0 0-4.5 4.5v2.26c0 .54-.16 1.08-.46 1.53l-1.12 1.67a2.25 2.25 0 0 0 1.87 3.5h8.42a2.25 2.25 0 0 0 1.87-3.5l-1.12-1.67a2.74 2.74 0 0 1-.46-1.53V8.25a4.5 4.5 0 0 0-4.5-4.5Zm0 16.5a2.63 2.63 0 0 0 2.46-1.75H9.54A2.63 2.63 0 0 0 12 20.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function toTimestamp(value: string) {
  return new Date(value).getTime();
}

function buildRibbonPoints(bundle: MarketIndexBundle) {
  const normalized = bundle.series
    .map((point) => {
      const time = toChartTime(point.bucket);
      const timestamp = toTimestamp(point.bucket);
      if (!time || !Number.isFinite(timestamp) || point.value === null || point.value === undefined || !Number.isFinite(point.value)) return null;
      return { time, value: point.value, timestamp };
    })
    .filter(Boolean) as Array<{ time: Time; value: number; timestamp: number }>;

  if (!normalized.length) return [];
  const latestTimestamp = normalized[normalized.length - 1].timestamp;
  const monthAgo = latestTimestamp - 31 * 24 * 60 * 60 * 1000;
  return normalized.filter((point) => point.timestamp >= monthAgo);
}

const RibbonSparkline = memo(function RibbonSparkline({
  points,
  tone,
}: {
  points: Array<{ time: Time; value: number }>;
  tone: "up" | "down";
}) {
  const geometry = useMemo(() => {
    if (!points.length) return null;

    const width = 66;
    const height = 28;
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const linePath = points
      .map((point, index) => {
        const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
        const y = height - ((point.value - min) / range) * (height - 4) - 2;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
    return { width, height, linePath, areaPath };
  }, [points]);

  if (!geometry) return <div className={styles.ribbonChartEmpty} />;

  const palette =
    tone === "up"
      ? { line: "#14b8a6", fill: "rgba(20, 184, 166, 0.12)" }
      : { line: "#ef4444", fill: "rgba(239, 68, 68, 0.12)" };

  return (
    <svg
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      className={styles.ribbonChart}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path d={geometry.areaPath} fill={palette.fill} />
      <path
        d={geometry.linePath}
        fill="none"
        stroke={palette.line}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});

type RibbonEntry = {
  key: string;
  group: string;
  currentValue: number | null;
  changeValue: number | null;
  dayReturn: number | null;
  tone: "up" | "down";
  points: Array<{ time: Time; value: number }>;
};

const MarketRibbon = memo(function MarketRibbon({
  marketIndexes,
  isLoadingIndex,
}: {
  marketIndexes: MarketIndexBundle[];
  isLoadingIndex: boolean;
}) {
  const [animationEpoch] = useState(getRibbonAnimationEpoch);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const ribbonEntries = useMemo<RibbonEntry[]>(() => {
    return marketIndexes.map((bundle) => {
      const ribbonPoints = buildRibbonPoints(bundle);
      const latestPoint = ribbonPoints[ribbonPoints.length - 1] || null;
      const previousPoint = ribbonPoints[ribbonPoints.length - 2] || null;
      const currentValue = latestPoint?.value ?? bundle.summary?.index_value ?? null;
      const changeValue = latestPoint && previousPoint ? latestPoint.value - previousPoint.value : null;
      const dayReturn = bundle.summary?.day_return_pct ?? null;
      const tone = changeValue !== null ? (changeValue < 0 ? "down" : "up") : dayReturn !== null && dayReturn < 0 ? "down" : "up";

      return {
        key: `${bundle.group_by}:${bundle.group}`,
        group: bundle.group,
        currentValue,
        changeValue,
        dayReturn,
        tone,
        points: ribbonPoints.map(({ time, value }) => ({ time, value })),
      };
    });
  }, [marketIndexes]);

  const shouldAnimateRibbon = ribbonEntries.length > 1;

  useLayoutEffect(() => {
    if (!marqueeRef.current) return;
    if (!shouldAnimateRibbon) {
      marqueeRef.current.style.removeProperty("animation-delay");
      return;
    }

    const elapsed = (Date.now() - animationEpoch) % RIBBON_SCROLL_DURATION_MS;
    marqueeRef.current.style.animationDelay = `${-(elapsed / 1000)}s`;
  }, [animationEpoch, shouldAnimateRibbon]);

  return (
    <div className={styles.ribbon}>
      <div
        ref={marqueeRef}
        className={`${styles.ribbonMarquee} ${shouldAnimateRibbon ? styles.ribbonMarqueeAnimated : ""}`.trim()}
      >
        {[0, ...(shouldAnimateRibbon ? [1] : [])].map((loopIndex) => (
          <Fragment key={`loop:${loopIndex}`}>
            <div key={`track:${loopIndex}`} className={styles.ribbonTrack} aria-hidden={loopIndex === 1}>
              {ribbonEntries.map((entry) => {
                const toneClass = entry.tone === "down" ? styles.ribbonItemDown : styles.ribbonItemUp;
                return (
                  <div key={`${loopIndex}:${entry.key}`} className={`${styles.ribbonItem} ${toneClass}`.trim()}>
                    <div className={styles.ribbonInfo}>
                      <span className={styles.ribbonName}>{formatIndexName(entry.group)}</span>
                      <span className={styles.ribbonValue}>{formatValue(entry.currentValue)}</span>
                      <div className={styles.ribbonChangeRow}>
                        <span className={styles.ribbonChange}>{formatSignedValue(entry.changeValue)}</span>
                        <span className={styles.ribbonChange}>{formatSignedPercent(entry.dayReturn)}</span>
                      </div>
                    </div>
                    <div className={styles.ribbonChartWrap}>
                      <RibbonSparkline points={entry.points} tone={entry.tone} />
                    </div>
                  </div>
                );
              })}
            </div>
            {shouldAnimateRibbon ? (
              <div key="gura-divider" className={styles.ribbonDivider} aria-hidden="true">
                <Image src="/gura-ticker.png" alt="" width={250} height={205} className={styles.ribbonDividerImage} />
              </div>
            ) : null}
          </Fragment>
        ))}
      </div>
      {!ribbonEntries.length && !isLoadingIndex ? <div className={styles.ribbonFallback}>Index ribbon unavailable.</div> : null}
      {isLoadingIndex ? <div className={styles.ribbonFallback}>Loading indexes…</div> : null}
    </div>
  );
});

export function SiteShell({
  children,
  fullBleed = false,
  hideFooter = false,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
  hideFooter?: boolean;
}) {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const assets = useMarketStore((state) => state.assets);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const isLoadingIndex = useMarketStore((state) => state.isLoadingIndex);
  const fetchMarketIndexes = useMarketStore((state) => state.fetchMarketIndexes);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [lastCategory, setLastCategory] = useState<string | null>(null);
  const hasRequestedOverviewRef = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const ribbonShellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (assets.length || hasRequestedOverviewRef.current) return;
    hasRequestedOverviewRef.current = true;
    void refreshOverview();
  }, [assets.length, refreshOverview]);

  useEffect(() => {
    if (marketIndexes.length || isLoadingIndex) return;
    void fetchMarketIndexes();
  }, [fetchMarketIndexes, isLoadingIndex, marketIndexes.length]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    const ribbonShell = ribbonShellRef.current;
    if (!shell || !header || !ribbonShell || typeof ResizeObserver === "undefined") return;

    function updateShellChromeHeight() {
      if (!shell || !header || !ribbonShell) return;
      const chromeHeight = header.offsetHeight + ribbonShell.offsetHeight;
      shell.style.setProperty("--site-shell-chrome-height", `${chromeHeight}px`);
    }

    updateShellChromeHeight();

    const observer = new ResizeObserver(() => {
      updateShellChromeHeight();
    });
    observer.observe(header);
    observer.observe(ribbonShell);
    window.addEventListener("resize", updateShellChromeHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateShellChromeHeight);
      shell.style.removeProperty("--site-shell-chrome-height");
    };
  }, []);

  const profileHref = user ? "/profile" : "/login";
  const profileInitial = user?.username?.trim()?.charAt(0)?.toUpperCase() || "N";
  const profileImageUrl = user?.profile_picture_url?.trim() || null;
  const activeDropdownKey = openCategory || lastCategory;
  const activeDropdownItem = activeDropdownKey ? CATEGORY_ITEMS.find((entry) => entry.key === activeDropdownKey) ?? null : null;
  const currentYear = new Date().getFullYear();

  return (
    <div ref={shellRef} className={styles.shell}>
      <header ref={headerRef} className={styles.header}>
        <div className={styles.navbarRow}>
          <div className={styles.navbarStart}>
            <Link href="/" className={styles.brand} aria-label="NASFAQ home">
              <Image src="/favicon-32x32.png" alt="" width={18} height={18} className={styles.brandLogo} />
              <span className={styles.title}>nasfaq</span>
            </Link>
            <div className={styles.categoryRail}>
              {CATEGORY_ITEMS.map((item) => {
                const isOpen = openCategory === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`${styles.categoryTrigger} ${isOpen ? styles.categoryTriggerActive : ""}`.trim()}
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenCategory((current) => {
                        if (current === item.key) return null;
                        setLastCategory(item.key);
                        return item.key;
                      })
                    }
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.navbarEnd}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <FiSun className={styles.icon} /> : <FiMoon className={styles.icon} />}
            </button>

            <button type="button" className={styles.iconButton} aria-label="Notifications">
              <BellIcon />
            </button>

            <Link
              href={profileHref}
              className={[styles.profileLink, !user ? styles.profileLinkSignedOut : ""].filter(Boolean).join(" ")}
            >
              {user ? (
                <span className={styles.profileAvatar} aria-hidden="true">
                  {profileImageUrl ? (
                    <img src={profileImageUrl} alt="" className={styles.profileAvatarImage} />
                  ) : (
                    profileInitial
                  )}
                </span>
              ) : null}
              <span>{user ? "Profile" : isLoading ? "Loading" : "Sign In"}</span>
            </Link>
          </div>
        </div>

        <div className={`${styles.dropdownPanel} ${openCategory ? styles.dropdownPanelOpen : ""}`.trim()}>
          {activeDropdownItem ? (
            <div className={`${styles.dropdownSection} ${openCategory ? styles.dropdownSectionVisible : ""}`.trim()}>
              <div className={styles.dropdownInner}>
                <div className={styles.dropdownLabel}>{activeDropdownItem.label}</div>
                <div className={styles.dropdownLinks}>
                  {activeDropdownItem.links.map((link) => {
                    const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={`${styles.dropdownLink} ${isActive ? styles.dropdownLinkActive : ""}`.trim()}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>

      </header>

      <div ref={ribbonShellRef} className={styles.ribbonShell}>
        <MarketRibbon marketIndexes={marketIndexes} isLoadingIndex={isLoadingIndex} />
      </div>

      <main className={[styles.main, fullBleed ? styles.mainFullBleed : ""].filter(Boolean).join(" ")}>{children}</main>

      {!hideFooter ? (
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <h2 className={styles.footerTitle}>NASFAQ</h2>
            <nav className={styles.footerLinks} aria-label="Footer">
              <Link href="/">Home</Link>
              <Link href="/news">News</Link>
              <Link href="/stocks">Stocks</Link>
              <Link href="/chat">Chat</Link>
              <Link href="/games">Games</Link>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Usage Policy</Link>
            </nav>
            <p className={styles.footerMeta}>© {currentYear} NASFAQ. All rights reserved.</p>
            <p className={styles.footerMeta}>
              Contact:{" "}
              <a href="mailto:nasfaqsite@gmail.com" className={styles.footerContact}>
                nasfaqsite@gmail.com
              </a>
            </p>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
