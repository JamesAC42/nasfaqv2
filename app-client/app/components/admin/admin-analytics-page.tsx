"use client";

import { useEffect, useState } from "react";
import { fetchSiteAnalytics, type AnalyticsSite, type SiteAnalytics } from "@/app/components/admin/admin-api";
import { ColumnChart, PRESETS, RankList, Stat, bucketLabel, changeText, percent, todayKey } from "@/app/components/admin/admin-analytics-parts";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess } from "@/app/components/admin/admin-frame";
import { PlayerAnalyticsView } from "@/app/components/admin/admin-player-analytics";
import { Notice, Section, Tabs, adminErrorText, adminUi as ui, fmtCount, useHashTab, type TabDef } from "@/app/components/admin/admin-ui";
import { AdminV1Players } from "@/app/components/admin/admin-v1-players";
import styles from "@/app/components/admin/admin-analytics-page.module.scss";

type View = "players" | "umami";
const VIEWS: readonly View[] = ["players", "umami"];
const VIEW_TABS: TabDef<View>[] = [
  { key: "players", label: "Players & visits" },
  { key: "umami", label: "Umami" },
];

const SITE_TABS: { key: AnalyticsSite; label: string }[] = [
  { key: "v2", label: "v2 · holo.nasfaq.biz" },
  { key: "v1", label: "v1 · nasfaq.biz" },
];

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string) {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function duration(seconds: number) {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

const UMAMI_LABELS = { visitors: "visitors", pageviews: "page views" };

/** What Umami knows about one site over the range. Ad blockers hide a lot of visitors from it. */
function UmamiView({ from, to }: { from: string; to: string }) {
  const [site, setSite] = useState<AnalyticsSite>("v2");
  const [data, setData] = useState<SiteAnalytics | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${site}|${from}|${to}`;
  const busy = settledKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchSiteAnalytics(site, from, to)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
        setSettledKey(requestKey);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(adminErrorText(caught));
        setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [site, from, to, requestKey]);

  const shown = data?.site === site ? data : null;
  const totals = shown?.totals;
  const previous = shown?.previous;
  const multiDay = shown ? shown.from !== shown.to : false;

  return (
    <>
      <p className={styles.viewNote}>
        Umami doesn&apos;t use cookies, so a visitor is a browser and device, not a player. Ad blockers block its tracker, so it misses many visitors: on Nov 5 it counted 10
        when the site&apos;s logs had 28 browsers. It&apos;s the only record of v1&apos;s traffic.
      </p>
      <div className={ui.tabs} role="tablist" aria-label="Site">
        {SITE_TABS.map((tab) => (
          <button key={tab.key} type="button" role="tab" aria-selected={site === tab.key} onClick={() => setSite(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <Notice>{error}</Notice> : null}

      {shown && totals && previous ? (
        <div className={styles.body} data-stale={busy || Boolean(error) || undefined}>
          <div className={ui.stripWrap}>
            <div className={ui.strip} style={{ "--cols": shown.from_v1 ? 6 : 5, "--cols-tablet": 3 } as React.CSSProperties}>
              <Stat label="Visitors" value={fmtCount(totals.visitors)} note={changeText(totals.visitors, previous.visitors)} />
              <Stat label="Visits" value={fmtCount(totals.visits)} note={changeText(totals.visits, previous.visits)} />
              <Stat label="Page views" value={fmtCount(totals.pageviews)} note={changeText(totals.pageviews, previous.pageviews)} />
              <Stat label="Bounce rate" value={`${percent(totals.bounces, totals.visits)}%`} note={`${percent(previous.bounces, previous.visits)}% before`} title="Visits that saw one page and left" />
              <Stat
                label="Average visit"
                value={duration(totals.visits ? totals.total_time_sec / totals.visits : 0)}
                note={`${duration(previous.visits ? previous.total_time_sec / previous.visits : 0)} before`}
              />
              {shown.from_v1 ? (
                <Stat label="Came from v1" value={fmtCount(shown.from_v1.visitors)} note={`${fmtCount(shown.from_v1.pageviews)} page views`} title="Visitors who followed a link on nasfaq.biz. Doesn't count anyone who typed the address or came from the email." />
              ) : null}
            </div>
          </div>

          <div className={styles.charts}>
            <Section title="Visitors" hint={multiDay ? `By ${shown.unit}` : "By hour"}>
              <ColumnChart points={shown.series} metric="visitors" labels={UMAMI_LABELS} multiDay={multiDay} />
            </Section>
            <Section title="Page views" hint={multiDay ? `By ${shown.unit}` : "By hour"}>
              <ColumnChart points={shown.series} metric="pageviews" labels={UMAMI_LABELS} multiDay={multiDay} />
            </Section>
          </div>

          <details className={styles.table}>
            <summary>As a table</summary>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{shown.unit === "hour" ? "Hour" : "Day"}</th>
                    <th scope="col">Visitors</th>
                    <th scope="col">Page views</th>
                  </tr>
                </thead>
                <tbody>
                  {[...shown.series].reverse().map((point) => (
                    <tr key={point.at}>
                      <th scope="row">{bucketLabel(point.at)}</th>
                      <td>{fmtCount(point.visitors)}</td>
                      <td>{fmtCount(point.pageviews)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className={styles.lists}>
            <Section title="Top pages" hint="Page views">
              <RankList rows={shown.pages} empty="No page views in this range." />
            </Section>
            <Section title="Referrers" hint="Page views. Direct visits aren't listed.">
              <RankList rows={shown.referrers} empty="No other site sent anyone in this range." />
            </Section>
            <Section title="Countries" hint="Visitors">
              <RankList rows={shown.countries} nameOf={countryName} empty="No visitors in this range." />
            </Section>
            <Section title="Campaigns" hint="Page views from links tagged with utm_campaign, like the ones in emails">
              <RankList rows={shown.campaigns} empty="No campaign links were used in this range." />
            </Section>
          </div>
        </div>
      ) : !error ? (
        <p className={ui.empty}>Loading…</p>
      ) : null}
    </>
  );
}

/**
 * /admin/analytics. "Players & visits" is our own data (services/playerAnalytics.js): accounts,
 * sessions, referrals, what players do, and signed-out visits from the site's own counter, none of
 * which an ad blocker can hide. "Umami" is the old view, still the only one with v1's traffic.
 * Days are New York days.
 */
export function AdminAnalyticsPage() {
  const access = useAdminAccess();
  const [view, setView] = useState<View>("players");
  const [range, setRange] = useState<[string, string]>(() => PRESETS[1].range(todayKey()));
  const [from, to] = range;
  const chooseView = useHashTab(VIEWS, "players", setView);

  if (!access.initialized) return <AdminLoading title="Analytics" />;
  if (!access.isAdmin) return <AdminGate title="Analytics" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const today = todayKey();

  return (
    <AdminFrame
      title="Analytics"
      blurb={
        <>
          Who signs up, comes back and plays, from our own database, plus signed-out visitors from the site&apos;s own counter, which ad blockers don&apos;t block. Days are New
          York days, and &ldquo;before&rdquo; means the same length of time just before this range.
        </>
      }
    >
      <Tabs tabs={VIEW_TABS} value={view} onChange={chooseView} label="Numbers from" />

      <div className={styles.filters}>
        <div className={styles.presets} role="group" aria-label="Date range">
          {PRESETS.map((preset) => {
            const [presetFrom, presetTo] = preset.range(today);
            return (
              <button key={preset.label} type="button" aria-pressed={from === presetFrom && to === presetTo} onClick={() => setRange([presetFrom, presetTo])}>
                {preset.label}
              </button>
            );
          })}
        </div>
        <label className={ui.field}>
          <span>From</span>
          <input className={ui.input} type="date" value={from} max={to} onChange={(event) => event.target.value && setRange([event.target.value, to])} />
        </label>
        <label className={ui.field}>
          <span>To</span>
          <input className={ui.input} type="date" value={to} min={from} max={today} onChange={(event) => event.target.value && setRange([from, event.target.value])} />
        </label>
      </div>

      {view === "players" ? <PlayerAnalyticsView from={from} to={to} /> : <UmamiView from={from} to={to} />}

      <AdminV1Players />
    </AdminFrame>
  );
}
