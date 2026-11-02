"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fetchSiteAnalytics, type AnalyticsPoint, type AnalyticsRow, type AnalyticsSite, type SiteAnalytics } from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, fmtCount, marketDateKey } from "@/app/components/admin/admin-ui";
import { AdminV1Players } from "@/app/components/admin/admin-v1-players";
import styles from "@/app/components/admin/admin-analytics-page.module.scss";

const SITE_TABS: { key: AnalyticsSite; label: string }[] = [
  { key: "v2", label: "v2 · holo.nasfaq.biz" },
  { key: "v1", label: "v1 · nasfaq.biz" },
];

const V2_LAUNCH = "2026-10-31";

const shiftDays = (dateKey: string, days: number) => new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const todayKey = () => marketDateKey(new Date().toISOString());

const PRESETS: { label: string; range: (today: string) => [string, string] }[] = [
  { label: "Today", range: (today) => [today, today] },
  { label: "7 days", range: (today) => [shiftDays(today, -6), today] },
  { label: "30 days", range: (today) => [shiftDays(today, -29), today] },
  { label: "90 days", range: (today) => [shiftDays(today, -89), today] },
  { label: "Since launch", range: (today) => [V2_LAUNCH, today] },
];

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string) {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** A day key ("2026-10-31") or an hour key ("2026-10-31 13") as words. */
function bucketLabel(at: string, withDay = true) {
  const date = new Date(`${at.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  if (at.length <= 10) return date;
  const hour = `${at.slice(11, 13)}:00`;
  return withDay ? `${date}, ${hour}` : hour;
}

function duration(seconds: number) {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** "+12% vs before", from the same length of time just before the range. */
function changeText(value: number, previous: number) {
  if (!previous) return value ? "none before" : "—";
  const change = Math.round(((value - previous) / previous) * 100);
  if (change === 0) return "same as before";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}% vs before`;
}

/** The top of the y axis: 1, 2 or 5 times a power of ten, and at least 4 so small counts stay whole. */
function axisTop(max: number) {
  if (max <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((multiple) => multiple * power >= max) ?? 10;
  return step * power;
}

type Metric = "visitors" | "pageviews";
const METRIC_LABEL: Record<Metric, string> = { visitors: "visitors", pageviews: "page views" };

/** One measure over the range, a column per day or hour. The hovered or focused column shows both measures. */
function ColumnChart({ points, metric, multiDay }: { points: AnalyticsPoint[]; metric: Metric; multiDay: boolean }) {
  const plot = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const top = axisTop(Math.max(0, ...points.map((point) => point[metric])));
  const other: Metric = metric === "visitors" ? "pageviews" : "visitors";

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box?.width || !points.length) return;
    setActive(Math.min(points.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * points.length))));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((current) => Math.min(points.length - 1, Math.max(0, (current ?? points.length) + step)));
  };

  const point = active === null ? null : points[active];
  const middle = Math.floor((points.length - 1) / 2);
  const ticks = points.length > 2 ? [0, middle, points.length - 1] : points.map((_, index) => index);

  return (
    <figure className={styles.chart}>
      <div className={styles.axis} aria-hidden="true">
        <span>{compact.format(top)}</span>
        <span>{compact.format(top / 2)}</span>
        <span>0</span>
      </div>
      <div
        ref={plot}
        className={styles.plot}
        tabIndex={0}
        role="img"
        aria-label={`${METRIC_LABEL[metric]} by ${multiDay ? "day" : "hour"}. Use the left and right arrow keys to read each one, or open the table below.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((current) => current ?? points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        {points.map((entry, index) => (
          <span key={entry.at} className={styles.band} data-active={active === index || undefined}>
            <i style={{ height: `${(entry[metric] / top) * 100}%` }} data-some={entry[metric] > 0 || undefined} />
          </span>
        ))}
        {point && active !== null ? (
          <div
            className={styles.tip}
            style={{ left: `${((active + 0.5) / points.length) * 100}%` }}
            data-edge={active < points.length * 0.25 ? "start" : active > points.length * 0.75 ? "end" : undefined}
            aria-live="polite"
          >
            <small>{bucketLabel(point.at)}</small>
            <span>
              <b>{fmtCount(point[metric])}</b> {METRIC_LABEL[metric]}
            </span>
            <span>
              <b>{fmtCount(point[other])}</b> {METRIC_LABEL[other]}
            </span>
          </div>
        ) : null}
      </div>
      <div className={styles.ticks} aria-hidden="true">
        {ticks.map((index) => (
          <span key={points[index].at} style={{ left: `${((index + 0.5) / points.length) * 100}%` }} data-edge={index === 0 ? "start" : index === points.length - 1 && points.length > 1 ? "end" : undefined}>
            {bucketLabel(points[index].at, multiDay)}
          </span>
        ))}
      </div>
    </figure>
  );
}

function RankList({ rows, nameOf, empty }: { rows: AnalyticsRow[]; nameOf?: (label: string) => string; empty: string }) {
  if (!rows.length) return <p className={ui.empty}>{empty}</p>;
  const top = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ol className={styles.rank}>
      {rows.map((row) => (
        <li key={row.label}>
          <span title={row.label}>{nameOf ? nameOf(row.label) : row.label}</span>
          <b>{fmtCount(row.count)}</b>
          <i aria-hidden="true" style={{ width: `${(row.count / top) * 100}%` }} />
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, note, title }: { label: string; value: string; note: string; title?: string }) {
  return (
    <div className={ui.stat} title={title}>
      <small>{label}</small>
      <b>{value}</b>
      <em>{note}</em>
    </div>
  );
}

/**
 * /admin/analytics: what Umami knows about both sites, so nobody has to go to Umami's own site. The
 * numbers come through the API (services/umami.js), which holds the key. Days are New York days.
 */
export function AdminAnalyticsPage() {
  const access = useAdminAccess();
  const [site, setSite] = useState<AnalyticsSite>("v2");
  const [range, setRange] = useState<[string, string]>(() => PRESETS[1].range(todayKey()));
  const [data, setData] = useState<SiteAnalytics | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, to] = range;
  const requestKey = `${site}|${from}|${to}`;
  const busy = settledKey !== requestKey;

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
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
  }, [access.initialized, access.isAdmin, site, from, to, requestKey]);

  if (!access.initialized) return <AdminLoading title="Analytics" />;
  if (!access.isAdmin) return <AdminGate title="Analytics" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const today = todayKey();
  const shown = data?.site === site ? data : null;
  const totals = shown?.totals;
  const previous = shown?.previous;
  const multiDay = shown ? shown.from !== shown.to : false;

  return (
    <AdminFrame
      title="Analytics"
      blurb={
        <>
          Traffic from Umami. It doesn&apos;t use cookies, so a visitor is a browser and device, not a player. Days are New York days, and &ldquo;before&rdquo; means the same
          length of time just before this range.
        </>
      }
    >
      <div className={ui.tabs} role="tablist" aria-label="Site">
        {SITE_TABS.map((tab) => (
          <button key={tab.key} type="button" role="tab" aria-selected={site === tab.key} onClick={() => setSite(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

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
              <ColumnChart points={shown.series} metric="visitors" multiDay={multiDay} />
            </Section>
            <Section title="Page views" hint={multiDay ? `By ${shown.unit}` : "By hour"}>
              <ColumnChart points={shown.series} metric="pageviews" multiDay={multiDay} />
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

      <AdminV1Players />
    </AdminFrame>
  );
}
