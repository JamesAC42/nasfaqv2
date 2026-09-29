"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import { BUILD_VERSION } from "@/app/stores/site-store";
import styles from "@/app/components/common/bug-report.module.scss";

type Sent = { id: number } | null;

/**
 * "Report a bug": a small dialog that sends what went wrong, with the page it happened on and the
 * browser, to the admins (the admin overview lists reports; they also land in Discord).
 */
export function BugReportButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={[styles.trigger, className].filter(Boolean).join(" ")} onClick={() => setOpen(true)}>
        Report a bug
      </button>
      {open ? <BugReportDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BugReportDialog({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ id: number }>("/api/site/bug-reports", {
        method: "POST",
        body: JSON.stringify({ message, page: window.location.pathname, version: BUILD_VERSION || null }),
      });
      setSent({ id: Number(result.id) });
    } catch (reason) {
      const code = String((reason as Error).message || reason);
      setError(code === "rate_limited" || code === "429" ? "That's a lot of reports for one hour. Try again a bit later." : "Couldn't send it. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const ready = message.trim().length >= 5;

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="bug-report-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="bug-report-title">Report a bug</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {sent ? (
          <div className={styles.done}>
            <p>
              Thanks, that&apos;s report <b>#{sent.id}</b>. We read every one.
            </p>
            <button type="button" className={styles.primary} onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !busy) void send();
            }}
          >
            <label>
              <span className={styles.label}>What happened?</span>
              <textarea
                ref={field}
                value={message}
                maxLength={2000}
                rows={6}
                placeholder="What you did, what you expected, and what happened instead."
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <small className={styles.fine}>
              Sent with your username (if you&apos;re signed in), this page&apos;s address and your browser. Screenshots help: post them in the Discord.
            </small>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={styles.primary} disabled={!ready || busy}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
