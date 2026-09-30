"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchExchangeReview, type ExchangeReview, type ReviewParty } from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, ago } from "@/app/components/admin/admin-ui";
import styles from "@/app/components/admin/admin-exchange-review.module.scss";

const WINDOWS = [7, 14, 30, 60];

function Party({ party, gains }: { party: ReviewParty; gains: boolean }) {
  return (
    <span className={styles.party} data-gains={gains || undefined}>
      <Link href={`/profile/${encodeURIComponent(party.username)}`}>{party.username}</Link>
      <small data-new={party.age_days < 14 || undefined}>{party.age_days}d old</small>
    </span>
  );
}

/**
 * Exchange transfers worth a second look (cards and capsule items): sales and trades where at least
 * one side is a new account and the value moved is far off the market price (the shape of alts
 * feeding a main); pairs of accounts that keep trading with each other; and accounts dealing with
 * several new ones. Read-only; freeze someone's exchange from People & roles.
 */
export function AdminExchangeReview() {
  const access = useAdminAccess();
  const now = useNow(30_000);
  const [days, setDays] = useState(14);
  const [review, setReview] = useState<ExchangeReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!access.initialized || !access.isAdmin) return;
    let cancelled = false;
    fetchExchangeReview(days)
      .then((data) => !cancelled && (setReview(data), setError(null)))
      .catch((caught) => !cancelled && setError(adminErrorText(caught)));
    return () => {
      cancelled = true;
    };
  }, [access.initialized, access.isAdmin, days]);

  if (!access.initialized) return <AdminLoading title="Exchange review" />;
  if (!access.isAdmin) return <AdminGate title="Exchange review" signedIn={access.signedIn} need="admins" headline="Admins only." />;

  const flags = review?.flags ?? null;
  return (
    <AdminFrame
      title="Exchange review"
      blurb={
        <>
          Card and capsule item sales and trades where a new account (under {review?.new_account_days ?? 14} days) moved value at {review?.ratio ?? 3}× or more off the market
          price, pairs of accounts that keep trading with each other, and accounts dealing with several new ones. To stop someone, freeze their exchange in{" "}
          <Link href="/admin/people">People &amp; roles</Link>.
        </>
      }
    >
      <div className={ui.tabs} role="tablist" aria-label="Window">
        {WINDOWS.map((value) => (
          <button key={value} type="button" role="tab" aria-selected={days === value} onClick={() => setDays(value)}>
            Last {value} days
          </button>
        ))}
      </div>
      {error ? <Notice>{error}</Notice> : null}
      <Section title="Flagged" count={flags ? flags.length : "…"} tone={flags?.length ? "warn" : undefined} hint="Green marks who came out ahead.">
        {flags === null ? (
          <p className={ui.empty}>Loading…</p>
        ) : flags.length ? (
          <ul className={styles.list}>
            {flags.map((flag) => (
              <li key={`${flag.type}-${flag.id}`} className={styles.row}>
                <span className={ui.pill} data-tone={flag.type === "trade" ? "blue" : undefined}>
                  {flag.type}
                </span>
                <div className={styles.main}>
                  <p className={styles.parties}>
                    <Party party={flag.from} gains={flag.favours === "from"} />
                    <span aria-hidden="true">→</span>
                    <Party party={flag.to} gains={flag.favours === "to"} />
                    {flag.pair_flags > 1 ? (
                      <span className={ui.pill} data-tone="warn">
                        {flag.pair_flags}× this pair
                      </span>
                    ) : null}
                  </p>
                  <p className={styles.summary}>{flag.summary}</p>
                </div>
                <span className={styles.end}>
                  <b>{flag.ratio === null ? "∞" : `${flag.ratio}×`}</b>
                  <small>{ago(flag.at, now)} ago</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={ui.empty}>Nothing lopsided involving new accounts in this window.</p>
        )}
      </Section>
      <Section title="Pairs that keep trading" count={review?.pairs ? review.pairs.length : "…"} tone={review?.pairs?.length ? "warn" : undefined} hint={`${review?.pair_min ?? 3}+ sales or trades between the same two accounts, at any price.`}>
        {!review ? (
          <p className={ui.empty}>Loading…</p>
        ) : review.pairs?.length ? (
          <ul className={styles.list}>
            {review.pairs.map((pair) => (
              <li key={`pair-${pair.a.id}-${pair.b.id}`} className={styles.row}>
                <span className={ui.pill} data-tone="warn">
                  pair
                </span>
                <div className={styles.main}>
                  <p className={styles.parties}>
                    <Party party={pair.a} gains={false} />
                    <span aria-hidden="true">⇄</span>
                    <Party party={pair.b} gains={false} />
                  </p>
                  <p className={styles.summary}>
                    {pair.transfers} sales and trades between them in the last {review.window_days} days.
                  </p>
                </div>
                <span className={styles.end}>
                  <b>{pair.transfers}×</b>
                  <small>{ago(pair.last_at, now)} ago</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={ui.empty}>No two accounts trading back and forth in this window.</p>
        )}
      </Section>
      <Section title="Dealing with new accounts" count={review?.funnels ? review.funnels.length : "…"} tone={review?.funnels?.length ? "warn" : undefined} hint={`Accounts that traded with ${review?.funnel_min ?? 3}+ different accounts that were under ${review?.new_account_days ?? 14} days old.`}>
        {!review ? (
          <p className={ui.empty}>Loading…</p>
        ) : review.funnels?.length ? (
          <ul className={styles.list}>
            {review.funnels.map((funnel) => (
              <li key={`funnel-${funnel.hub.id}`} className={styles.row}>
                <span className={ui.pill} data-tone="warn">
                  funnel
                </span>
                <div className={styles.main}>
                  <p className={styles.parties}>
                    <Party party={funnel.hub} gains />
                    <span aria-hidden="true">←</span>
                    {funnel.accounts.slice(0, 6).map((account) => (
                      <Party key={account.id} party={account} gains={false} />
                    ))}
                    {funnel.accounts.length > 6 ? <small>+{funnel.accounts.length - 6} more</small> : null}
                  </p>
                  <p className={styles.summary}>
                    {funnel.transfers} sales and trades with {funnel.accounts.length} new accounts in the last {review.window_days} days.
                  </p>
                </div>
                <span className={styles.end}>
                  <b>{funnel.accounts.length}</b>
                  <small>{ago(funnel.last_at, now)} ago</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={ui.empty}>Nobody dealing with a crowd of new accounts in this window.</p>
        )}
      </Section>
    </AdminFrame>
  );
}
