"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { V1Trophy } from "@/app/components/profile/profile-sections";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { normalizeV1Account } from "@/app/lib/normalizers";
import type { V1Account } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/profile/v1-link-page.module.scss";

const CUTOFF = "October 1, 2026";

// How a try ended, from the ?status= the API redirects back with.
const OUTCOMES: Record<string, string> = {
  expired: "That took longer than 10 minutes, so it ran out. Start again below.",
  signed_out: "You were signed out here by the time you got back, so nothing was linked. Sign in and start again.",
  wrong_account: "You came back signed in to a different account than the one that started this, so nothing was linked. If someone sent you here, that link was theirs: only start from this page yourself.",
  other_session: "This was started in a different session, so nothing was linked. Start again here.",
  already_linked: "This account is already linked to a v1 account.",
  v1_taken: "That v1 account is already linked to another account here. If that's wrong, ask staff in the Discord.",
  too_new: `Only v1 accounts made before ${CUTOFF} can link, and that one is newer.`,
  suspended: "Your account is suspended, so it can't link right now.",
  used: "That link was already used. Start again below if you still need to.",
  invalid: "That link didn't check out, so nothing was linked. Start again below.",
  not_configured: "Linking isn't open right now. Try again later.",
};

function V1Link() {
  const status = useSearchParams().get("status") || "";
  const { user, isLoading } = useAuth();
  const [link, setLink] = useState<V1Account | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    apiFetch<{ configured: boolean; link: unknown }>("/api/v1-link/me", { cache: "no-store" })
      .then((result) => {
        if (cancelled) return;
        setLink(normalizeV1Account(result.link));
        setConfigured(result.configured);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Your link status couldn't load. Reload the page to try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/v1-link/start", { method: "POST", body: "{}" });
      window.location.assign(url);
    } catch (reason) {
      const code = String((reason as Error).message || reason);
      setError(code === "v1_link_not_configured" ? OUTCOMES.not_configured : code === "v1_already_linked" ? OUTCOMES.already_linked : "That didn't go through. Try again in a minute.");
      setBusy(false);
    }
  };

  const outcome = status && status !== "linked" ? OUTCOMES[status] ?? OUTCOMES.invalid : null;

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.head}>
          <h1>Link your v1 account</h1>
          <p>Played the original NASFAQ at nasfaq.biz? Bring your history with you.</p>
        </header>

        {status === "linked" && link ? (
          <p className={styles.notice} data-tone="ok" role="status">
            Linked. Your veteran badge is on, and the v1 Classic theme is in your locker.
          </p>
        ) : null}
        {outcome && !link ? (
          <p className={styles.notice} role="alert">
            {outcome}
          </p>
        ) : null}
        {error ? (
          <p className={styles.notice} role="alert">
            {error}
          </p>
        ) : null}

        {link ? (
          <>
            <V1Trophy account={link} isSelf onChange={setLink} />
            <p className={styles.next}>
              <Link href="/profile">See your profile →</Link> <Link href="/games/item-locker">Open your locker →</Link>
            </p>
            <p className={styles.note}>To wear the theme, press Edit profile on your profile and pick it under Theme.</p>
          </>
        ) : (
          <>
            <ul className={styles.rewards}>
              <li>
                <b>Veteran badge</b>
                <span>&ldquo;v1 Veteran&rdquo; with the year you joined, on your profile and the leaderboard.</span>
              </li>
              <li>
                <b>Profile trophy</b>
                <span>Your v1 name, join date, peak net worth and final rank, on your profile.</span>
              </li>
              <li>
                <b>v1 Classic theme</b>
                <span>Your profile page, the way the old site looked.</span>
              </li>
            </ul>

            {!user ? (
              isLoading ? null : (
                <p className={styles.actions}>
                  <Link href="/login" className={styles.primary}>
                    SIGN IN
                  </Link>
                  <Link href="/register" className={styles.ghost}>
                    MAKE AN ACCOUNT
                  </Link>
                </p>
              )
            ) : loaded && !configured ? (
              <p className={styles.notice}>{OUTCOMES.not_configured}</p>
            ) : (
              <p className={styles.actions}>
                <button type="button" className={styles.primary} disabled={busy || !loaded} onClick={() => void start()}>
                  {busy ? "TAKING YOU THERE…" : "LINK MY V1 ACCOUNT"}
                </button>
              </p>
            )}

            <div className={styles.rules}>
              <h2>How it works</h2>
              <ol>
                <li>You go to nasfaq.biz, log in there if you need to, and confirm. This site never sees your v1 password or email.</li>
                <li>
                  nasfaq.biz sends back your stats from that moment, and they stay here even after v1 is gone. Forgot your v1 password?{" "}
                  <a href="https://nasfaq.biz/resetPassword">Reset it there</a> first.
                </li>
                <li>Your v1 username shows on your profile unless you hide it.</li>
                <li>
                  Each v1 account links to one account here, and only staff can undo a link. v1 accounts made on or after {CUTOFF} can&apos;t link.
                </li>
              </ol>
            </div>
          </>
        )}
      </div>
    </SiteShell>
  );
}

export function V1LinkPage() {
  return (
    <Suspense fallback={null}>
      <V1Link />
    </Suspense>
  );
}
