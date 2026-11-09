"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchPlayerAnalytics, type PlayerAnalytics, type RetentionRow } from "@/app/components/admin/admin-api";
import { ColumnChart, RankList, Stat, bucketLabel, changeText, percent } from "@/app/components/admin/admin-analytics-parts";
import { Notice, Section, adminErrorText, adminUi as ui, fmtCash, fmtCount } from "@/app/components/admin/admin-ui";
import styles from "@/app/components/admin/admin-analytics-page.module.scss";

const SIGNUP_LABELS = { signups: "sign-ups", verified: "verified", first_orders: "first orders" };
const ACTIVE_LABELS = { active: "active that day", weekly_active: "active in the 7 days to it" };
const WEEKLY_LABELS = { weekly_active: "active in the 7 days to it", active: "active that day" };
const VISITOR_LABELS = { visitors: "signed-out visitors", pageviews: "page views" };

const VIA_LABEL: Record<string, string> = { link: "Player's link", blackjack: "Shared blackjack hand", cards: "Shared card pull" };

const REASON_LABEL: Record<string, string> = {
  shared_ip: "Shared a network with the sharer or a sibling",
  self: "Same account",
  suspended: "Suspended",
  no_trade: "No trade within the window",
  unverified: "Email not verified",
  expired: "Ran out",
  too_new: "Sharer's account too new (waiting)",
  weekly_cap: "Sharer at the weekly cap (waiting)",
  waiting: "Waiting",
  refused: "Refused",
  sharer_rewards_off: "Sharer rewards turned off",
  ip_check_off: "IP linking is off, so the alt check can't run (waiting; set IP_HASH_SALT)",
  feature_off: "The referrals flag is off for the sharer (waiting)",
};

const STATUS_LABEL: Record<string, string> = { pending: "waiting for a trade", paid: "paid", refused: "not paid", expired: "ran out" };

/** A table of counts that scrolls sideways on its own when the screen is too narrow for it. */
function DataTable({ children, text = false }: { children: React.ReactNode; text?: boolean }) {
  return (
    <div className={styles.dataScroll}>
      <table className={styles.dataTable} data-text={text || undefined}>
        {children}
      </table>
    </div>
  );
}

/** "3 · 60%" for a count out of a cohort; "—" while the window hasn't started. */
function cohortCell(count: number, of: number, started: boolean, complete: boolean) {
  if (!started) return <span className={styles.muted}>—</span>;
  return (
    <span className={complete ? undefined : styles.muted} title={complete ? undefined : "So far: this window isn't over yet"}>
      {fmtCount(count)} · {percent(count, of)}%
    </span>
  );
}

function RetentionTable({ rows }: { rows: RetentionRow[] }) {
  if (!rows.length) return <p className={ui.empty}>Nobody signed up in this range.</p>;
  const sum = (key: keyof RetentionRow) => rows.reduce((total, row) => total + Number(row[key]), 0);
  const complete = (window: number) => rows.filter((row) => row.age_days > window);
  const rate = (key: "day1" | "week1" | "month1", window: number) => {
    const done = complete(window);
    const of = done.reduce((total, row) => total + row.signups, 0);
    return of ? `${percent(done.reduce((total, row) => total + row[key], 0), of)}%` : "—";
  };
  return (
    <DataTable>
      <thead>
        <tr>
          <th scope="col">Signed up</th>
          <th scope="col">Sign-ups</th>
          <th scope="col" title="Signed in the next day">Next day</th>
          <th scope="col" title="Signed in on any of the 7 days after">Within 7 days</th>
          <th scope="col" title="Signed in on any of the 30 days after">Within 30 days</th>
          <th scope="col" title="Signed in during the last 7 days (not counting their first day)">Last 7 days</th>
          <th scope="col" title="Has a stock fill">Traded</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.day}>
            <th scope="row">{bucketLabel(row.day)}</th>
            <td>{fmtCount(row.signups)}</td>
            <td>{cohortCell(row.day1, row.signups, row.age_days >= 1, row.age_days > 1)}</td>
            <td>{cohortCell(row.week1, row.signups, row.age_days >= 1, row.age_days > 7)}</td>
            <td>{cohortCell(row.month1, row.signups, row.age_days >= 1, row.age_days > 30)}</td>
            <td>{cohortCell(row.recent, row.signups, row.age_days >= 1, true)}</td>
            <td>{cohortCell(row.traded, row.signups, true, true)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">All</th>
          <td>{fmtCount(sum("signups"))}</td>
          <td title="Of the days whose window is over">{rate("day1", 1)}</td>
          <td title="Of the days whose window is over">{rate("week1", 7)}</td>
          <td title="Of the days whose window is over">{rate("month1", 30)}</td>
          <td>{percent(sum("recent"), sum("signups"))}%</td>
          <td>{percent(sum("traded"), sum("signups"))}%</td>
        </tr>
      </tfoot>
    </DataTable>
  );
}

/**
 * The "Players & visits" view of /admin/analytics: our own tables, so ad blockers can't hide
 * anyone (api/src/services/playerAnalytics.js).
 */
export function PlayerAnalyticsView({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<PlayerAnalytics | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${from}|${to}`;
  const busy = settledKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchPlayerAnalytics(from, to)
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
  }, [from, to, requestKey]);

  if (!data) return error ? <Notice>{error}</Notice> : <p className={ui.empty}>Loading…</p>;
  const { totals, previous, now } = data;
  const multiDay = data.from !== data.to;

  return (
    <>
      {error ? <Notice>{error}</Notice> : null}
      <div className={styles.body} data-stale={busy || Boolean(error) || undefined}>
        <h3 className={styles.stripHeading}>Right now</h3>
        <div className={ui.stripWrap}>
          <div className={ui.strip} style={{ "--cols": 4, "--cols-tablet": 2 } as React.CSSProperties}>
            <Stat label="Active today" value={fmtCount(now.active_today)} note="players signed in" />
            <Stat label="Active, 7 days" value={fmtCount(now.active_7d)} note="weekly actives" />
            <Stat label="Active, 30 days" value={fmtCount(now.active_30d)} note="monthly actives" />
            <Stat label="Visitors today" value={fmtCount(now.visitors_today)} note="signed out" title="Browsers that aren't signed in, counted by the site itself" />
          </div>
        </div>

        <h3 className={styles.stripHeading}>
          {bucketLabel(data.from)}
          {multiDay ? ` to ${bucketLabel(data.to)}` : ""}
        </h3>
        <div className={ui.stripWrap}>
          <div className={ui.strip} style={{ "--cols": 4, "--cols-tablet": 2 } as React.CSSProperties}>
            <Stat label="Sign-ups" value={fmtCount(totals.signups)} note={changeText(totals.signups, previous.signups)} />
            <Stat label="Verified" value={fmtCount(totals.verified)} note={`${percent(totals.verified, totals.signups)}% of sign-ups`} title="Sign-ups in the range whose email is verified now" />
            <Stat label="First orders" value={fmtCount(totals.first_orders)} note={`${fmtCount(totals.first_fills)} first fills`} title="Players whose first-ever stock order (or fill) was in the range" />
            <Stat label="Active players" value={fmtCount(totals.active)} note={changeText(totals.active, previous.active)} title="Signed in on at least one day of the range" />
            <Stat label="Signed-out visitors" value={fmtCount(totals.visitors)} note={changeText(totals.visitors, previous.visitors)} title="One per browser per day, added up over the range" />
            <Stat label="Their page views" value={fmtCount(totals.pageviews)} note={changeText(totals.pageviews, previous.pageviews)} />
            <Stat label="Through a referral" value={fmtCount(totals.referred)} note={`${percent(totals.referred, totals.signups)}% of sign-ups`} />
            <Stat label="With a source tag" value={fmtCount(totals.tagged)} note={`${fmtCount(totals.neither)} came with neither`} title="Sign-ups whose link carried ?ref=<tag>, like the v1 email" />
          </div>
        </div>

        <div className={styles.charts}>
          <Section title="Sign-ups" hint="By day">
            <ColumnChart points={data.series} metric="signups" labels={SIGNUP_LABELS} multiDay={multiDay} />
          </Section>
          <Section title="Daily active players" hint="Signed in that day">
            <ColumnChart points={data.series} metric="active" labels={ACTIVE_LABELS} multiDay={multiDay} />
          </Section>
          <Section title="Weekly active players" hint="Signed in during the 7 days up to each day">
            <ColumnChart points={data.series} metric="weekly_active" labels={WEEKLY_LABELS} multiDay={multiDay} />
          </Section>
          <Section title="Signed-out visitors" hint="By day, from the site's own counter">
            <ColumnChart points={data.series} metric="visitors" labels={VISITOR_LABELS} multiDay={multiDay} />
          </Section>
        </div>

        <details className={styles.table}>
          <summary>As a table</summary>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Sign-ups</th>
                  <th scope="col">Verified</th>
                  <th scope="col">First orders</th>
                  <th scope="col">Active</th>
                  <th scope="col">Weekly active</th>
                  <th scope="col">Visitors</th>
                  <th scope="col">Page views</th>
                </tr>
              </thead>
              <tbody>
                {[...data.series].reverse().map((point) => (
                  <tr key={point.at}>
                    <th scope="row">{bucketLabel(point.at)}</th>
                    <td>{fmtCount(point.signups)}</td>
                    <td>{fmtCount(point.verified)}</td>
                    <td>{fmtCount(point.first_orders)}</td>
                    <td>{fmtCount(point.active)}</td>
                    <td>{fmtCount(point.weekly_active)}</td>
                    <td>{fmtCount(point.visitors)}</td>
                    <td>{fmtCount(point.pageviews)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <Section title="Retention by sign-up day" hint="Came back and signed in. Gray numbers are still filling in.">
          <RetentionTable rows={data.retention} />
        </Section>

        <div className={styles.lists}>
          <Section title="Sign-ups through referrals" hint="By where the link was found">
            {data.sources.referrals.length ? (
              <DataTable>
                <thead>
                  <tr>
                    <th scope="col">Link</th>
                    <th scope="col">Sign-ups</th>
                    <th scope="col">Traded</th>
                    <th scope="col">Paid</th>
                    <th scope="col">Waiting</th>
                    <th scope="col">Not paid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.referrals.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{VIA_LABEL[row.label] ?? row.label}</th>
                      <td>{fmtCount(row.signups)}</td>
                      <td>{fmtCount(row.traded)}</td>
                      <td>{fmtCount(row.paid)}</td>
                      <td>{fmtCount(row.pending)}</td>
                      <td>{fmtCount(row.not_paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <p className={ui.empty}>Nobody signed up through a referral link in this range.</p>
            )}
          </Section>
          <Section title="Visitors and sign-ups by source tag" hint="Links with ?ref=<tag>, or only utm_source. Visitors: signed-out arrivals, once per person per day.">
            {data.sources.tags.length ? (
              <DataTable>
                <thead>
                  <tr>
                    <th scope="col">Tag</th>
                    <th scope="col">Visitors</th>
                    <th scope="col">Sign-ups</th>
                    <th scope="col">Verified</th>
                    <th scope="col">Traded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.tags.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">
                        <code>{row.label}</code>
                      </th>
                      <td>{fmtCount(row.visitors)}</td>
                      <td>{fmtCount(row.signups)}</td>
                      <td>{fmtCount(row.verified)}</td>
                      <td>{fmtCount(row.traded)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <p className={ui.empty}>No tagged visitors or sign-ups in this range.</p>
            )}
          </Section>
          <Section title="Top sharers" hint="Sign-ups through each player's links">
            <RankList rows={data.referrals.top.map((row) => ({ label: row.username, count: row.signups }))} empty="Nobody's link brought anyone in this range." />
          </Section>
          <Section title="Not paid, or not yet" hint={`Paid out in the range: ${fmtCash(data.referrals.paid_out.cash)} and ${fmtCount(data.referrals.paid_out.credit)} Credit`}>
            <RankList
              rows={data.referrals.reasons.map((row) => ({ label: `${row.side === "sharer" ? "Sharer: " : "New player: "}${REASON_LABEL[row.label] ?? row.label}`, count: row.count }))}
              empty="Every referral in this range paid, or is waiting for a first trade."
            />
          </Section>
        </div>

        {data.referrals.recent.length ? (
          <Section title="Latest referrals" hint="Accounts made in the range">
            <DataTable text>
              <thead>
                <tr>
                  <th scope="col">Joined</th>
                  <th scope="col">New player</th>
                  <th scope="col">Sharer</th>
                  <th scope="col">Link</th>
                  <th scope="col">New player’s share</th>
                  <th scope="col">Sharer’s share</th>
                </tr>
              </thead>
              <tbody>
                {data.referrals.recent.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{bucketLabel(new Date(row.at).toLocaleDateString("en-CA", { timeZone: "America/New_York" }))}</th>
                    <td>
                      <Link href={`/profile/${encodeURIComponent(row.referee)}`}>{row.referee}</Link>
                    </td>
                    <td>
                      <Link href={`/profile/${encodeURIComponent(row.referrer)}`}>{row.referrer}</Link>
                    </td>
                    <td>{VIA_LABEL[row.via] ?? row.via}</td>
                    <td data-tone={row.status === "paid" ? "up" : row.status === "refused" ? "down" : undefined}>
                      {STATUS_LABEL[row.status] ?? row.status}
                      {row.reason ? ` (${REASON_LABEL[row.reason] ?? row.reason})` : ""}
                    </td>
                    <td data-tone={row.sharer_status === "paid" ? "up" : row.sharer_status === "refused" ? "down" : undefined}>
                      {row.sharer_status ? (STATUS_LABEL[row.sharer_status] ?? row.sharer_status) : "—"}
                      {row.sharer_reason ? ` (${REASON_LABEL[row.sharer_reason] ?? row.sharer_reason})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Section>
        ) : null}

        <div className={styles.lists}>
          <Section title="Activity by game and market" hint="Things players did in the range">
            <DataTable>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Count</th>
                  <th scope="col">Players</th>
                </tr>
              </thead>
              <tbody>
                {[...data.activity.games]
                  .sort((a, b) => b.events - a.events)
                  .map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td>{fmtCount(row.events)}</td>
                      <td>{fmtCount(row.players)}</td>
                    </tr>
                  ))}
              </tbody>
            </DataTable>
          </Section>
          <Section title="Most traded stocks" hint="Stock fills in the range">
            {data.activity.stocks.length ? (
              <DataTable>
                <thead>
                  <tr>
                    <th scope="col">Stock</th>
                    <th scope="col">Fills</th>
                    <th scope="col">Sells</th>
                    <th scope="col">Shares</th>
                    <th scope="col">Players</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activity.stocks.map((row) => (
                    <tr key={row.symbol}>
                      <th scope="row" title={row.name}>
                        <Link href={`/stocks/${encodeURIComponent(row.symbol)}`}>{row.symbol}</Link>
                      </th>
                      <td>{fmtCount(row.fills)}</td>
                      <td>{fmtCount(row.sells)}</td>
                      <td>{fmtCount(row.shares)}</td>
                      <td>{fmtCount(row.players)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <p className={ui.empty}>No stock fills in this range.</p>
            )}
          </Section>
          <Section title="Signed-out visitors' top pages" hint="Page views">
            <RankList rows={data.visitors.pages} empty="No signed-out visits in this range." />
          </Section>
          <Section title="Sites that sent them" hint="Visitors">
            <RankList rows={data.visitors.referrers} empty="No other site sent anyone in this range." />
          </Section>
        </div>
        <p className={styles.viewNote}>
          Active players come from sessions: a day counts when a player’s session was seen that day. Signed-out visitors are counted by the site itself, with a hash salted
          afresh each day, the page and the referring site, and no address or cookie. Visit rows are deleted after {data.visits_kept_days} days.
        </p>
      </div>
    </>
  );
}
