"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { V1Trophy } from "@/app/components/profile/profile-sections";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { normalizeV1Account } from "@/app/lib/normalizers";
import { forgetLinkIntent, LINK_V1_PATH, rememberLinkIntent, takeLinkIntent, withNext } from "@/app/lib/return-path.mjs";
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

const sessionStore = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

type StepState = "done" | "current" | "todo";

function Step({ n, state, title, site, children }: { n: number; state: StepState; title: string; site: string; children: ReactNode }) {
  return (
    <li className={styles.step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
      <span className={styles.stepNum} aria-hidden>
        {state === "done" ? "✓" : n}
      </span>
      <div className={styles.stepBody}>
        <p className={styles.stepHead}>
          <b>{title}</b>
          <span className={styles.site}>{site}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

function V1Link() {
  const params = useSearchParams();
  const status = params.get("status") || "";
  const fromV1 = params.get("from") === "v1";
  const { user, isLoading } = useAuth();
  const [link, setLink] = useState<V1Account | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id ?? null;

  const start = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    apiFetch<{ configured: boolean; link: unknown }>("/api/v1-link/me", { cache: "no-store" })
      .then((result) => {
        if (cancelled) return;
        const linked = normalizeV1Account(result.link);
        setLink(linked);
        setConfigured(result.configured);
        setLoaded(true);
        // Back from making an account or signing in, after pressing one of the buttons below in this
        // tab: carry on to nasfaq.biz without making them find the button again. Only once, and not
        // after a try that just came back with a problem.
        if (linked || !result.configured || status) forgetLinkIntent(sessionStore());
        else if (takeLinkIntent(sessionStore())) void start();
      })
      .catch(() => {
        if (cancelled) return;
        setError("Your link status couldn't load. Reload the page to try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [start, status, userId]);

  const outcome = status && status !== "linked" ? OUTCOMES[status] ?? OUTCOMES.invalid : null;
  const signedIn = Boolean(user);
  const goingToV1 = busy;

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.head}>
          <h1>Link your v1 account</h1>
          {fromV1 && !signedIn ? (
            <p>
              Welcome from nasfaq.biz. This is NASFAQ v2, the new game at holo.nasfaq.biz. It has its own accounts, so your old login doesn&apos;t work here. Make an account here first, then
              we&apos;ll send you back to nasfaq.biz to confirm the link.
            </p>
          ) : (
            <p>Played the original NASFAQ at nasfaq.biz? Bring your history to this account here on holo.nasfaq.biz.</p>
          )}
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
        {goingToV1 ? (
          <p className={styles.notice} data-tone="ok" role="status">
            Taking you to nasfaq.biz to confirm. Log in there with your old username and password if it asks.
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
        ) : isLoading && !signedIn ? null : (
          <>
            <ol className={styles.steps} aria-label="Three steps to link">
              <Step n={1} state={signedIn ? "done" : "current"} title={signedIn ? "You have an account here" : "Make an account here, or sign in"} site="holo.nasfaq.biz · this site">
                {signedIn ? (
                  <p>
                    Signed in as <b>{user?.username}</b>. Your v1 history joins this account. Wrong one? Sign out from the menu and sign in to the right one.
                  </p>
                ) : (
                  <>
                    <p>This is a separate account from your old one: pick a username, an email and a password. Already made one here? Sign in. Either way, you come straight back to this page.</p>
                    <p className={styles.actions}>
                      <Link href={withNext("/register", LINK_V1_PATH)} className={styles.primary} onClick={() => rememberLinkIntent(sessionStore())}>
                        MAKE AN ACCOUNT
                      </Link>
                      <Link href={withNext("/login", LINK_V1_PATH)} className={styles.ghost} onClick={() => rememberLinkIntent(sessionStore())}>
                        SIGN IN
                      </Link>
                    </p>
                  </>
                )}
              </Step>

              <Step n={2} state={signedIn ? "current" : "todo"} title="Confirm on nasfaq.biz" site="nasfaq.biz · the original site">
                <p>
                  We send you to nasfaq.biz. Log in there with your old username and password if it asks, check both names, and press LINK. This site never sees your v1 password or email. Forgot it?{" "}
                  <a href="https://nasfaq.biz/resetPassword">Reset it on nasfaq.biz</a> first.
                </p>
                {signedIn ? (
                  loaded && !configured ? (
                    <p className={styles.notice}>{OUTCOMES.not_configured}</p>
                  ) : (
                    <p className={styles.actions}>
                      <button type="button" className={styles.primary} disabled={busy || !loaded} onClick={() => void start()}>
                        {busy ? "TAKING YOU THERE…" : "GO TO NASFAQ.BIZ TO CONFIRM"}
                      </button>
                    </p>
                  )
                ) : null}
              </Step>

              <Step n={3} state="todo" title="Back here, linked" site="holo.nasfaq.biz">
                <p>nasfaq.biz sends you back here with your stats, and you get:</p>
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
              </Step>
            </ol>

            <div className={styles.rules}>
              <h2>Good to know</h2>
              <ul>
                <li>Only v1 accounts made before {CUTOFF} can link.</li>
                <li>Each v1 account links to one account here, and only staff can undo a link.</li>
                <li>Your stats are kept as they were when you linked, even after v1 is gone.</li>
                <li>Your v1 username shows on your profile unless you hide it.</li>
                <li>Each try lasts 10 minutes. If it runs out, start again from this page.</li>
              </ul>
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
