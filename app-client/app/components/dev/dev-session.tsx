"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/dev/dev-session.module.scss";

const COOKIE = process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME || "nasfaq_session";

/** Dev-only page that stores a session token as a localhost cookie. */
export function DevSession({ apiBase }: { apiBase: string }) {
  const { user, refreshSession } = useAuth();
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const sameOrigin = !apiBase;

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const save = async () => {
    const value = token.trim().replace(/^nasfaq_session=/, "").replace(/;.*$/, "");
    if (!value) return;
    document.cookie = `${COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
    setToken("");
    const next = await refreshSession();
    setStatus(next ? `Signed in as ${next.username}.` : "The API didn't accept that token. It may have expired, or you copied part of it.");
  };

  const clear = async () => {
    document.cookie = `${COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
    await refreshSession();
    setStatus("Cleared the local session cookie.");
  };

  return (
    <SiteShell>
      <div className={styles.page}>
        <h1>Dev session</h1>
        <p className={styles.lede}>
          Local development only. The captcha is locked to the real domain, so sign in on the real site and borrow that session here. This page 404s in production builds.
        </p>

        <div className={`${styles.state} ${user ? styles.ok : ""}`}>
          {user ? (
            <>
              Signed in as <b>{user.username}</b>
              {user.is_admin ? " (admin)" : ""}. <Link href="/profile">Open your profile →</Link>
            </>
          ) : (
            "Not signed in."
          )}
        </div>

        {!sameOrigin ? (
          <div className={styles.warn}>
            <b>This won&apos;t work yet.</b> The app is calling <code>{apiBase}</code> directly, so a cookie on localhost is never sent. Point the app at the built-in proxy instead, in <code>app-client/.env.local</code>:
            <pre>{`NEXT_PUBLIC_API_BASE=\nSERVER_API_BASE=${apiBase}`}</pre>
            then restart <code>npm run dev</code>.
          </div>
        ) : null}

        <ol className={styles.steps}>
          <li>Sign in on the real site in this browser.</li>
          <li>
            Open DevTools → Application → Cookies → the site, and copy the value of <code>{COOKIE}</code>.
          </li>
          <li>Paste it here. It stays in this browser&apos;s localhost cookies and nowhere else.</li>
        </ol>

        <div className={styles.form}>
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder={`${COOKIE} value`} spellCheck={false} autoComplete="off" type="password" aria-label="Session token" />
          <button type="button" className={styles.primary} onClick={() => void save()} disabled={!token.trim()}>
            USE SESSION
          </button>
          <button type="button" className={styles.ghost} onClick={() => void clear()}>
            CLEAR
          </button>
        </div>
        {status ? <p className={styles.status}>{status}</p> : null}
        <p className={styles.note}>
          The token is as good as your password for as long as the session lives. Logging out on the real site revokes it. Anything you do here hits the real API: posts, votes and trades are real.
        </p>
      </div>
    </SiteShell>
  );
}
