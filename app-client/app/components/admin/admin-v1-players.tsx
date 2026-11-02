"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchV1Links, undoV1Link, type V1LinkRow, type V1LinkSummary } from "@/app/components/admin/admin-api";
import { Notice, Section, adminErrorText, adminUi as ui, etTime, fmtCount } from "@/app/components/admin/admin-ui";
import styles from "@/app/components/admin/admin-analytics-page.module.scss";

const REASON_LABEL: Record<string, string> = {
  abandoned: "Never came back from v1",
  expired: "Took longer than 10 minutes",
  signed_out: "Signed out of v2 on the way",
  wrong_account: "Came back signed in to another account",
  other_session: "Came back in another session",
  already_linked: "Already linked",
  v1_taken: "v1 account already linked elsewhere",
  too_new: "v1 account too new",
  suspended: "v2 account suspended",
  invalid: "Message didn't check out",
};

const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const percentText = (value: number) => (value > 0 && value < 0.1 ? "under 0.1%" : `${value > 0 && value < 1 ? value.toFixed(1) : Math.round(value)}%`);
// v1's balances run into the trillions.
const bigMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** Undoing takes a reason and a second press, since it takes the badge and theme back from the player. */
function UndoLink({ row, onDone, onError }: { row: V1LinkRow; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className={styles.undo} onClick={() => setConfirming(true)}>
        Undo
      </button>
    );
  }

  const undo = async () => {
    setBusy(true);
    try {
      await undoV1Link(row.user_id, reason.trim());
      onDone(`Undid the link between ${row.username} and ${row.v1_username} on v1. The badge and theme are gone, and the v1 account can link again.`);
    } catch (caught) {
      onError(adminErrorText(caught));
      setBusy(false);
    }
  };

  return (
    <span className={styles.undoForm}>
      <input className={ui.input} value={reason} maxLength={280} placeholder="Why? (for the log)" aria-label={`Why undo the link for ${row.username}?`} onChange={(event) => setReason(event.target.value)} />
      <button type="button" className={styles.undo} data-danger="" disabled={busy} onClick={() => void undo()}>
        Confirm
      </button>
      <button type="button" className={styles.undo} disabled={busy} onClick={() => setConfirming(false)}>
        Keep
      </button>
    </span>
  );
}

/** Who came over from the original NASFAQ and linked, on /admin/analytics. These are from v2's own tables, so the date range above doesn't apply. */
export function AdminV1Players() {
  const [summary, setSummary] = useState<V1LinkSummary | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((term: string) => {
    fetchV1Links(term)
      .then((next) => {
        setSummary(next);
        setError(null);
      })
      .catch((caught) => setError(adminErrorText(caught)));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load(search), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const cutoff = summary ? new Date(summary.joined_before).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" }) : "";
  const stuck = summary ? summary.not_finished.reduce((sum, row) => sum + row.players, 0) : 0;
  const top = summary ? Math.max(1, ...summary.not_finished.map((row) => row.players)) : 1;
  const days = summary ? [...summary.by_day].reverse().slice(0, 14) : [];

  return (
    <Section title="v1 players" hint="From v2's own records, so the date range doesn't apply. A v1 player who never links only shows in Came from v1 and Campaigns.">
      {error ? <Notice>{error}</Notice> : null}
      {notice ? (
        <Notice tone="ok" onClose={() => setNotice(null)}>
          {notice}
        </Notice>
      ) : null}
      {summary ? (
        <>
          <div className={ui.stripWrap}>
            <div className={ui.strip} style={{ "--cols": 4, "--cols-tablet": 2 } as React.CSSProperties}>
              <div className={ui.stat}>
                <small>Linked</small>
                <b>{fmtCount(summary.linked)}</b>
                <em>
                  {percentText(percent(summary.linked, summary.eligible_accounts))} of {fmtCount(summary.eligible_accounts)} eligible
                </em>
              </div>
              <div className={ui.stat} title="Linked players seen on v2 in the last 7 days">
                <small>Active, 7 days</small>
                <b>{fmtCount(summary.active_7d)}</b>
                <em>{percentText(percent(summary.active_7d, summary.linked))} of linked</em>
              </div>
              <div className={ui.stat}>
                <small>Started linking</small>
                <b>{fmtCount(summary.players_started)}</b>
                <em>{summary.in_progress ? `${fmtCount(summary.in_progress)} in progress now` : "players"}</em>
              </div>
              <div className={ui.stat} title="Players who tried and haven't linked">
                <small>Didn&apos;t finish</small>
                <b>{fmtCount(stuck)}</b>
                <em>players</em>
              </div>
            </div>
          </div>
          <p className={styles.v1Note}>Eligible means a v1 account made before {cutoff}.</p>

          <div className={styles.lists}>
            <div>
              <h3 className={styles.v1Heading}>Why they didn&apos;t finish</h3>
              {summary.not_finished.length ? (
                <ol className={styles.rank}>
                  {summary.not_finished.map((row) => (
                    <li key={row.reason}>
                      <span>{REASON_LABEL[row.reason] ?? row.reason}</span>
                      <b>{fmtCount(row.players)}</b>
                      <i aria-hidden="true" style={{ width: `${(row.players / top) * 100}%` }} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={ui.empty}>Nobody has stopped partway.</p>
              )}
            </div>
            <div>
              <h3 className={styles.v1Heading}>Linked by day</h3>
              {days.length ? (
                <ol className={styles.rank}>
                  {days.map((row) => (
                    <li key={row.day}>
                      <span>{dayLabel(row.day)}</span>
                      <b>{fmtCount(row.linked)}</b>
                      <i aria-hidden="true" style={{ width: `${(row.linked / Math.max(1, ...days.map((entry) => entry.linked))) * 100}%` }} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={ui.empty}>Nobody has linked yet.</p>
              )}
            </div>
          </div>

          <div className={styles.v1Links}>
            <div className={styles.v1LinksHead}>
              <h3 className={styles.v1Heading}>Latest links</h3>
              <label className={ui.field}>
                <span>Search</span>
                <input className={ui.input} type="search" value={search} placeholder="Either username" onChange={(event) => setSearch(event.target.value)} />
              </label>
            </div>
            {summary.recent.length ? (
              <div className={styles.tableScroll}>
                <table className={styles.v1Table}>
                  <thead>
                    <tr>
                      <th scope="col">v2 player</th>
                      <th scope="col">v1 account</th>
                      <th scope="col">Joined v1</th>
                      <th scope="col">Peak net worth</th>
                      <th scope="col">Linked</th>
                      <th scope="col">
                        <span className={ui.srOnly}>Undo</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent.map((row) => (
                      <tr key={row.user_id}>
                        <th scope="row">
                          <Link href={`/profile/${encodeURIComponent(row.username)}`}>{row.username}</Link>
                        </th>
                        <td>{row.v1_username}</td>
                        <td>{new Date(row.v1_joined_at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", year: "numeric" })}</td>
                        <td>{row.peak_net_worth === null ? "—" : bigMoney.format(row.peak_net_worth)}</td>
                        <td>{etTime(row.linked_at)}</td>
                        <td>
                          <UndoLink
                            row={row}
                            onError={setError}
                            onDone={(message) => {
                              setNotice(message);
                              load(search);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={ui.empty}>{search ? "No link matches that." : "Nobody has linked yet."}</p>
            )}
          </div>
        </>
      ) : !error ? (
        <p className={ui.empty}>Loading…</p>
      ) : null}
    </Section>
  );
}
