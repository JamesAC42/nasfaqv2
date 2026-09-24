"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { formatCountdown, formatEtTime, getMarketClock } from "@/app/lib/market-clock";
import { signedPct, toneOf } from "@/app/lib/time";
import { useNow } from "@/app/lib/use-now";
import { useHubStore, useMarketHub } from "@/app/stores/hub-store";
import { useMarketStore } from "@/app/stores/market-store";
import ui from "@/app/components/market/market.module.scss";

export type MarketTab = "floor" | "activity" | "report" | "indexes";

const TABS: Array<{ key: MarketTab; label: string; href: string }> = [
  { key: "floor", label: "Floor", href: "/market" },
  { key: "activity", label: "Activity", href: "/market/activity" },
  { key: "report", label: "Report", href: "/market/report" },
  { key: "indexes", label: "Indexes", href: "/market/indexes" },
];

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

/** The Market page: one live hub, four tabs (Floor · Activity · Report · Indexes). */
export function MarketHub({ tab, children }: { tab: MarketTab; children: ReactNode }) {
  useMarketHub();
  const router = useRouter();
  const now = useNow();
  const assets = useMarketStore((state) => state.assets);
  const report = useMarketStore((state) => state.report);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const fetchMarketIndexes = useMarketStore((state) => state.fetchMarketIndexes);
  const hub = useHubStore((state) => state.hub);

  useEffect(() => {
    void fetchMarketIndexes();
  }, [fetchMarketIndexes]);

  // 1-4 switch tabs, like function keys on a terminal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
      const index = ["1", "2", "3", "4"].indexOf(event.key);
      if (index >= 0) router.push(TABS[index].href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const asset of assets) {
      const move = asset.move_24h_pct ?? 0;
      if (move > 0.00005) up += 1;
      else if (move < -0.00005) down += 1;
    }
    return { up, down };
  }, [assets]);

  const allIndex = marketIndexes.find((index) => index.group === "all")?.summary ?? null;
  const clock = now ? getMarketClock(now) : null;
  const fills = hub?.activity.windows["24h"].trade_count ?? null;

  const sub: Record<MarketTab, ReactNode> = {
    floor: assets.length ? (
      <>
        <span className={ui.up}>{breadth.up}▲</span> <span className={ui.down}>{breadth.down}▼</span>
      </>
    ) : (
      "live board"
    ),
    activity: (
      <>
        <i className={ui.liveDot} aria-hidden="true" />
        {fills !== null ? `${fills.toLocaleString("en-US")} fills · 24h` : "live fills"}
      </>
    ),
    report: `${shortDate(report?.market_date)} · 09:00`,
    indexes: allIndex?.index_value ? (
      <>
        ALL {allIndex.index_value.toFixed(1)} <span className={ui[toneOf(allIndex.day_return_pct)]}>{signedPct(allIndex.day_return_pct)}</span>
      </>
    ) : (
      "all-talent"
    ),
  };

  return (
    <SiteShell>
      <div className={ui.page}>
        <nav className={ui.tabs} aria-label="Market sections">
          <div className={ui.tabList}>
            {TABS.map((entry, index) => (
              <Link key={entry.key} href={entry.href} className={ui.tab} aria-current={entry.key === tab ? "page" : undefined} prefetch={false}>
                <kbd>{index + 1}</kbd>
                <b>{entry.label}</b>
                <small suppressHydrationWarning>{sub[entry.key]}</small>
              </Link>
            ))}
          </div>
          <div className={ui.tabState} suppressHydrationWarning>
            {hub?.status?.current_market_date ? <span>MARKET DAY <b>{shortDate(hub.status.current_market_date)}</b></span> : null}
            {clock ? (
              <span className={ui.batch}>
                NEXT BATCH <b>{formatEtTime(clock.nextBatchAt)} · {formatCountdown(clock.secondsToNextBatch, { withHours: false })}</b>
              </span>
            ) : null}
          </div>
        </nav>
        <div className={ui.pane}>{children}</div>
      </div>
    </SiteShell>
  );
}
