"use client";

import { type FormEvent, useState } from "react";
import { apiErrorCode } from "@/app/lib/api";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/common/change-email.module.scss";

// "Wrong address?" on an unverified account: a typo at sign-up sends the link, and any password
// reset, to the wrong inbox (auth.changeUnverifiedEmail). It opens with the address as typed, since
// the fix is usually one letter.

const MESSAGES: Record<string, string> = {
  invalid_email: "That doesn’t look like an email address.",
  email_taken: "There’s already an account on that inbox. One inbox, one account: addresses that differ only by a +tag (or by dots, on Gmail) count as the same.",
  disposable_email: "Throwaway email addresses can’t sign up. Use one you’ll keep: password resets go there.",
  email_unchanged: "That’s the address we already have. Fix the typo, or look in spam.",
  email_already_verified: "Your email is already verified.",
};

export function ChangeEmail() {
  const { user, changeEmail } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { email: saved, verification_email: sent } = await changeEmail(email);
      setResult(sent === "failed" ? `Saved, but the email to ${saved} didn’t go out. Ask for a new link in a minute.` : `Done. A new link is on its way to ${saved}, and the old one won’t work.`);
      setOpen(false);
    } catch (reason) {
      setError(MESSAGES[apiErrorCode(reason)] ?? String((reason as Error).message || reason));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        <button
          type="button"
          className="appLink"
          onClick={() => {
            setEmail(user?.email ?? "");
            setError(null);
            setResult(null);
            setOpen(true);
          }}
        >
          Wrong address? Change it
        </button>
        {result ? <div role="status">{result}</div> : null}
      </>
    );
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <label>
        <span>Your email</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={320} required autoFocus />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.save} disabled={busy}>
          {busy ? "…" : "SEND A NEW LINK"}
        </button>
        <button type="button" className="appLink" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
