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
 * Card exchange transfers worth a second look: sales and trades where at least one side is a new
 * account and the value moved is far off the market price (the shape of alts feeding a main).
 * Read-only; act from the players' profiles or People & roles.
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
      blurb={<>Card sales and trades where a new account (under {review?.new_account_days ?? 14} days) moved value at {review?.ratio ?? 3}× or more off the market price. Pairs that keep doing it come first.</>}
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
    </AdminFrame>
  );
}
