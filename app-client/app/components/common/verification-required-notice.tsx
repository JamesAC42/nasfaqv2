"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/app/providers/auth-provider";

export const VERIFICATION_REQUIRED_MESSAGE = "Verify your email before trading, posting, commenting, voting, or writing articles.";

export function isVerificationRequiredError(error: unknown) {
  const message = String((error as Error)?.message || error);
  return message === "email_verification_required" || message === "Verify your email before using this feature.";
}

export function userNeedsEmailVerification(user: { email_verified?: boolean } | null | undefined) {
  return Boolean(user && !user.email_verified);
}

export function verificationRequiredText(action = "do this") {
  return `Verify your email before you can ${action}.`;
}

export function VerificationRequiredNotice({
  action = "do this",
  compact = false,
}: {
  action?: string;
  compact?: boolean;
}) {
  const { resendVerification, user } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleResend() {
    setBusy(true);
    setStatus(null);
    try {
      await resendVerification();
      setStatus("Verification email sent. Check your inbox.");
    } catch (error) {
      setStatus(`Could not resend verification email: ${String((error as Error).message || error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="statusMessage statusMessageWarn" role={compact ? "status" : "alert"}>
      <strong>Email verification required.</strong> {verificationRequiredText(action)}{" "}
      {user ? (
        <button type="button" className="appLink" onClick={() => void handleResend()} disabled={busy}>
          {busy ? "Sending..." : "Resend verification email"}
        </button>
      ) : (
        <Link href="/login" className="appLink">Sign in</Link>
      )}
      {status ? <div>{status}</div> : null}
    </div>
  );
}
