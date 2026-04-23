"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/providers/auth-provider";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const { refreshSession } = useAuth();
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    async function verify() {
      try {
        await apiFetch<{ ok: boolean }>("/api/auth/verify-email", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        await refreshSession();
        setStatus("success");
      } catch (err) {
        if (cancelled) return;
        setError(String((err as Error).message || err));
        setStatus("error");
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [refreshSession, token]);

  return (
    <SiteShell>
      <section className="contentPanel">
        <h1>Email Verification</h1>
        {token && status === "pending" ? <p>Verifying your email...</p> : null}
        {status === "success" ? (
          <p className="statusMessage statusMessageSuccess">
            Email verified. You can now trade, chat, comment, and publish content. <Link href="/profile">Go to profile</Link>.
          </p>
        ) : null}
        {!token || status === "error" ? (
          <p className="statusMessage statusMessageError">
            Verification failed: {!token ? "missing_token" : error || "invalid_verification_token"}. Sign in and resend the verification email.
          </p>
        ) : null}
      </section>
    </SiteShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<SiteShell><section className="contentPanel"><p>Loading verification...</p></section></SiteShell>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
