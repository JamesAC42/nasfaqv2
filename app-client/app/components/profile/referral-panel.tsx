"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { fetchReferralSummary, referralLink, rewardText, type ReferralJoin, type ReferralSummary } from "@/app/lib/referrals";
import { useAuth } from "@/app/providers/auth-provider";
import profile from "@/app/components/profile/profile.module.scss";
import styles from "@/app/components/profile/referral-panel.module.scss";

const enc = encodeURIComponent;

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const whenText = (iso: string) => `${dayFormat.format(new Date(iso))} ET`;

/** Where one person who joined stands, in a few words. */
function statusOf(row: ReferralJoin): { text: string; tone: "up" | "down" | "flat"; title?: string } {
  if (row.status === "pending") return { text: "waiting for their first trade", tone: "flat" };
  if (row.status === "expired") return { text: "no trade in time", tone: "flat" };
  if (row.status === "refused") return { text: "didn't qualify", tone: "down", title: "Referrals don't pay between accounts that have used the same network." };
  if (row.your_share === "paid") return { text: "you were paid", tone: "up" };
  if (row.your_share === "waiting") {
    const when = row.your_share_retry_at ? whenText(row.your_share_retry_at) : null;
    if (row.your_share_reason === "weekly_cap") return { text: when ? `weekly limit, yours lands ${when}` : "weekly limit reached", tone: "flat" };
    if (row.your_share_reason === "too_new") return { text: when ? `yours lands ${when}` : "yours lands when your account is older", tone: "flat" };
    if (row.your_share_reason === "unverified") return { text: "verify your email to get yours", tone: "flat" };
    return { text: "yours is on hold for a check", tone: "flat" };
  }
  if (row.your_share === "refused") return { text: "they were paid, you weren't", tone: "down", title: "Referrals don't pay between accounts that have used the same network." };
  return { text: "they were paid", tone: "up" };
}

/**
 * The player's referral link on their own profile: copy it, see who joined through it, and what's
 * been paid. /profile?invite=1 (the bell's referral notices) scrolls here.
 */
export function ReferralPanel() {
  const userId = useAuth().user?.id ?? null;
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const panel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // The link needs the real origin, known only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    if (userId === null) return;
    let cancelled = false;
    fetchReferralSummary(userId, true)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // /profile?invite=1 (the bell's referral notices) scrolls here. The sections above load on their
  // own and push the panel down, so it's brought back a few times while they do, until the player
  // scrolls or taps themselves.
  useEffect(() => {
    if (!summary || new URLSearchParams(window.location.search).get("invite") !== "1") return;
    let moved = false;
    const stop = () => {
      moved = true;
    };
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const name of events) window.addEventListener(name, stop, { passive: true });
    const timers = [300, 1200, 2500].map((ms) => window.setTimeout(() => !moved && panel.current?.scrollIntoView({ block: "start" }), ms));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, stop);
    };
  }, [summary]);

  const link = summary && origin ? referralLink(origin, summary.code) : "";

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const reward = summary ? rewardText(summary.settings) : "";
  const days = summary ? Math.round(summary.settings.min_age_hours / 24) : 0;

  return (
    <section ref={panel} id="invite" className={`${profile.sec} ${styles.panel}`} aria-labelledby="invite-title">
      <div className={profile.secHead}>
        <h2 id="invite-title">Invite friends</h2>
        {summary ? (
          <span className={profile.aside}>
            {summary.totals.joined} joined · {summary.totals.paid} paid you
          </span>
        ) : null}
      </div>
      {failed ? <p className={styles.note}>Your link didn&apos;t load. Try again in a moment.</p> : null}
      {summary ? (
        <>
          <p className={styles.pitch}>
            When a friend signs up through your link and makes their first stock trade, you each get <b>{reward}</b>.
          </p>
          <div className={styles.linkRow}>
            <input className={styles.linkBox} readOnly value={link} aria-label="Your referral link" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className={styles.copy} onClick={() => void copy()} disabled={!link}>
              {copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className={styles.note}>Your shared blackjack hands and card pulls carry the same link.</p>

          {summary.invited_by ? (
            <p className={styles.invited}>
              You joined through <Link href={`/profile/${enc(summary.invited_by.username)}`}>{summary.invited_by.username}</Link>&apos;s link.{" "}
              {summary.invited_by.status === "paid"
                ? `You got ${rewardText({ cash: summary.invited_by.cash, credit: summary.invited_by.credit })}.`
                : summary.invited_by.status === "pending"
                  ? `Make your first stock trade and you both get ${reward}.`
                  : null}
            </p>
          ) : null}

          {summary.joined.length ? (
            <div className={styles.list}>
              {summary.joined.map((row) => {
                const status = statusOf(row);
                return (
                  <div key={`${row.username}-${row.joined_at}`} className={profile.person}>
                    <PlayerAvatar username={row.username} pictureUrl={row.profile_picture_url} color={row.profile_color} size={22} />
                    <Link href={`/profile/${enc(row.username)}`}>{row.username}</Link>
                    <span className={profile.pAct}>
                      <small className={styles[status.tone]} title={status.title}>
                        {status.text}
                      </small>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.empty}>Nobody has joined through your link yet.</p>
          )}

          <details className={styles.rules}>
            <summary>How it works</summary>
            <ul>
              <li>Your friend gets {reward} after their first stock trade. They have {summary.settings.window_days} days from signing up.</li>
              <li>
                You get the same, up to {summary.settings.weekly_cap} times a week (this week: {summary.totals.paid_this_week}). Past that, yours waits for next week. Your email
                needs to be verified and your account {days} day{days === 1 ? "" : "s"} old.
              </li>
              <li>Accounts that have used the same network as you, or as someone else you brought in, don&apos;t count. Neither do extra accounts of your own.</li>
            </ul>
          </details>
        </>
      ) : !failed ? (
        <p className={styles.empty}>Loading…</p>
      ) : null}
    </section>
  );
}
