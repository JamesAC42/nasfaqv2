"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/auth/verify-email.module.scss";

const REASONS: Record<string, string> = {
  missing_token: "The link is missing its token. Open it straight from the email.",
  invalid_verification_token: "That link is invalid, has expired, or was already used.",
};

function VerifyEmail() {
  const token = useSearchParams().get("token") || "";
  const { user, refreshSession, resendVerification } = useAuth();
  const [status, setStatus] = useState<"pending" | "success" | "error">(token ? "pending" : "error");
  const [error, setError] = useState(token ? "" : "missing_token");
  const [resent, setResent] = useState<"idle" | "busy" | "sent" | "failed">("idle");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ ok: boolean }>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(async () => {
        if (cancelled) return;
        await refreshSession();
        setStatus("success");
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(String((reason as Error).message || reason));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshSession, token]);

  const resend = async () => {
    setResent("busy");
    try {
      await resendVerification();
      setResent("sent");
    } catch {
      setResent("failed");
    }
  };

  return (
    <section className={styles.card} aria-live="polite">
      <ArtSlot kind="chibi" pose={status === "success" ? "hype" : status === "error" ? "shock" : "idle"} symbol="VERIFY" accent="var(--blue)" width={120} className={styles.chibi} />
      {status === "pending" ? (
        <>
          <span className={styles.kicker}>CHECKING</span>
          <h1>Verifying your email…</h1>
          <p>One second.</p>
        </>
      ) : status === "success" ? (
        <>
          <span className={`${styles.kicker} ${styles.ok}`}>VERIFIED</span>
          <h1>You&apos;re in.</h1>
          <p>Your email is verified. You can trade, chat, comment and write articles now.</p>
          <div className={styles.actions}>
            <Link href="/stocks" className={styles.primary}>
              PICK YOUR FIRST STOCK
            </Link>
            <Link href="/profile" className={styles.ghost}>
              YOUR PROFILE
            </Link>
          </div>
        </>
      ) : (
        <>
          <span className={`${styles.kicker} ${styles.bad}`}>COULDN&apos;T VERIFY</span>
          <h1>That link didn&apos;t work.</h1>
          <p>{REASONS[error] ?? `Verification failed (${error}).`}</p>
          {user && !user.email_verified ? (
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => void resend()} disabled={resent === "busy" || resent === "sent"}>
                {resent === "sent" ? "NEW LINK SENT" : resent === "busy" ? "SENDING…" : "SEND A NEW LINK"}
              </button>
              {resent === "failed" ? <span className={styles.fail}>Couldn&apos;t send it. Try again in a minute.</span> : null}
            </div>
          ) : user ? (
            <div className={styles.actions}>
              <span>Your account ({user.username}) is already verified.</span>
              <Link href="/profile" className={styles.ghost}>
                YOUR PROFILE
              </Link>
            </div>
          ) : (
            <div className={styles.actions}>
              <Link href="/login?next=/profile" className={styles.primary}>
                SIGN IN TO GET A NEW LINK
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function VerifyEmailPage() {
  return (
    <SiteShell>
      <div className={styles.page}>
        <Suspense fallback={<section className={styles.card}>Loading…</section>}>
          <VerifyEmail />
        </Suspense>
      </div>
    </SiteShell>
  );
}
